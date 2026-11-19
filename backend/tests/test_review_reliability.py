"""Tests for review reliability scoring."""

import unittest

from services.review_reliability import (
    score_reviews,
    select_reviews,
    reliability_summary,
)


def make_review(review_id, body, rating=5, title=""):
    return {
        "review_id": review_id,
        "title": title,
        "body": body,
        "rating": rating,
        "source": "amazon",
    }


class ReviewReliabilityTests(unittest.TestCase):

    def test_detailed_review_has_full_reliability(self):
        review = make_review(
            1,
            "These shoes are comfortable for everyday walking, "
            "but the soles wore out after six months.",
            rating=2,
        )
        result = score_reviews([review])[0]
        self.assertEqual(result.score, 100)
        self.assertEqual(result.reasons, ())

    def test_short_generic_review_is_downweighted(self):
        result = score_reviews([
            make_review(1, "Amazing!")
        ])[0]
        self.assertLess(result.score, 100)
        self.assertIn("very_short", result.reasons)

    def test_exact_duplicates_are_downweighted(self):
        body = (
            "These headphones have excellent sound quality "
            "and the battery lasts a full day of regular use."
        )
        results = score_reviews([
            make_review(1, body),
            make_review(2, body),
        ])

        self.assertEqual(results[0].score, 100)
        self.assertLess(results[1].score, results[0].score)
        self.assertIn("exact_duplicate", results[1].reasons)

    
    def test_near_duplicates_are_downweighted(self):
        reviews = [
            make_review(
                1,
                "The headphones have excellent sound quality "
                "and the battery lasts all day during regular use.",
            ),
            make_review(
                2,
                "The headphones have excellent sound quality "
                "and the battery lasts all day during regular "
                "use at work.",
            ),
        ]

        results = score_reviews(reviews)

        # Different wording: not exact duplicates.
        self.assertNotIn(
            "exact_duplicate",
            results[1].reasons,
        )

        # TF-IDF should identify substantially repeated phrasing.
        self.assertIn(
            "near_duplicate",
            results[1].reasons,
        )
        self.assertLess(
            results[1].score,
            results[0].score,
        )

    def test_promotional_link_is_penalized(self):
        result = score_reviews([
            make_review(
                1,
                "Buy now at https://example.com "
                "and use my discount code!",
            )
        ])[0]

        self.assertLessEqual(result.score, 40)
        self.assertIn("external_link", result.reasons)
        self.assertIn("promotional_language", result.reasons)

    def test_star_rating_does_not_change_reliability(self):
        text = (
            "The fabric is lightweight and comfortable, "
            "but the stitching started to fail after several weeks."
        )

        results = score_reviews([
            make_review(1, text, rating=1),
            make_review(
                2,
                text.replace("stitching", "seams"),
                rating=5,
            ),
        ])

        # Both are specific reviews. Star extremes themselves
        # must never cause a penalty.
        self.assertNotIn("extreme_rating", results[0].reasons)
        self.assertNotIn("extreme_rating", results[1].reasons)

    def test_selection_keeps_negative_feedback(self):
        reviews = [
            make_review(
                i,
                f"The headphones are comfortable for long "
                f"listening sessions and the audio is clear "
                f"when listening at home, experience number {i}.",
                rating=5,
            )
            for i in range(1, 30)
        ]

        reviews.append(
            make_review(
                99,
                "The headband cracked after two months, "
                "and the replacement process was frustrating.",
                rating=1,
            )
        )

        selected = select_reviews(reviews, limit=10)

        self.assertEqual(len(selected), 10)
        self.assertIn(
            99,
            [review["review_id"] for review, _ in selected],
        )

    def test_empty_reviews(self):
        self.assertEqual(score_reviews([]), [])
        self.assertEqual(select_reviews([]), [])

    def test_scores_are_bounded(self):
        results = score_reviews([
            make_review(1, "Buy now! https://example.com"),
            make_review(
                2,
                "This product has been useful for my daily "
                "commute and has survived several rainy days.",
            ),
        ])

        self.assertTrue(
            all(10 <= result.score <= 100 for result in results)
        )

    def test_reliability_summary(self):
        results = score_reviews([
            make_review(1, "Great!"),
            make_review(
                2,
                "The backpack has enough space for my laptop "
                "and the padded straps are comfortable.",
            ),
        ])

        summary = reliability_summary(results)

        self.assertEqual(summary["review_count"], 2)
        self.assertIsNotNone(summary["average_score"])

    
    def test_mostly_negative_reviews_remain_mostly_negative(self):
        reviews = [
            make_review(
                i,
                f"The product stopped working after several weeks "
                f"of use and the replacement did not help. "
                f"Purchase experience {i}.",
                rating=1,
            )
            for i in range(1, 81)
        ]

        reviews += [
            make_review(
                i,
                f"The product has worked well for everyday use "
                f"and performs as expected. "
                f"Purchase experience {i}.",
                rating=5,
            )
            for i in range(81, 101)
        ]

        selected = select_reviews(
            reviews,
            limit=50,
            rating_distribution={
                "1": 80, "2": 0, "3": 0,
                "4": 0, "5": 20,
            },
        )

        negative_count = sum(
            review["rating"] <= 2
            for review, _ in selected
        )

        self.assertEqual(len(selected), 50)
        self.assertEqual(negative_count, 40)

    def test_mostly_positive_reviews_remain_mostly_positive(self):
        reviews = [
            make_review(
                i,
                f"The headphones have reliable sound quality "
                f"and a comfortable fit for daily listening. "
                f"Experience {i}.",
                rating=5,
            )
            for i in range(1, 81)
        ]

        reviews += [
            make_review(
                i,
                f"The headphones disconnect frequently "
                f"and the battery stopped holding a charge. "
                f"Experience {i}.",
                rating=1,
            )
            for i in range(81, 101)
        ]

        selected = select_reviews(
            reviews,
            limit=50,
            rating_distribution={
                "1": 20, "2": 0, "3": 0,
                "4": 0, "5": 80,
            },
        )

        positive_count = sum(
            review["rating"] >= 4
            for review, _ in selected
        )

        self.assertEqual(len(selected), 50)
        self.assertEqual(positive_count, 40)

    def test_balanced_review_distribution(self):
        reviews = [
            make_review(
                i,
                f"This product has strengths and weaknesses "
                f"depending on how it is used. "
                f"Review experience {i}.",
                rating=(
                    1 if i <= 40
                    else 3 if i <= 60
                    else 5
                ),
            )
            for i in range(1, 101)
        ]

        selected = select_reviews(
            reviews,
            limit=50,
            rating_distribution={
                "1": 40, "2": 0, "3": 20,
                "4": 0, "5": 40,
            },
        )

        ratings = [
            review["rating"]
            for review, _ in selected
        ]

        self.assertEqual(ratings.count(1), 20)
        self.assertEqual(ratings.count(3), 10)
        self.assertEqual(ratings.count(5), 20)

    def test_short_specific_failure_has_no_length_penalty(self):
        result = score_reviews([
            make_review(
                1,
                "Battery died after 3 days.",
                rating=1,
            ),
        ])[0]

        self.assertEqual(result.score, 100)
        self.assertNotIn("very_short", result.reasons)
        self.assertNotIn("short_review", result.reasons)

    def test_short_specific_product_feature_is_preserved(self):
        result = score_reviews([
            make_review(
                1,
                "Sound quality is excellent.",
                rating=5,
            ),
        ])[0]

        self.assertEqual(result.score, 100)
        self.assertNotIn("short_review", result.reasons)

    def test_generic_negative_feedback_is_still_downweighted(self):
        result = score_reviews([
            make_review(
                1,
                "Terrible!",
                rating=1,
            ),
        ])[0]

        self.assertLess(result.score, 100)
        self.assertIn("very_short", result.reasons)
        self.assertIn("generic_feedback", result.reasons)

    def test_same_product_feature_is_not_automatically_duplicate(self):
        reviews = [
            make_review(
                1,
                "The battery lasts ten hours and the "
                "headphones are comfortable for my daily "
                "train commute.",
                rating=5,
            ),
            make_review(
                2,
                "The battery died after two weeks and "
                "the headphones keep losing bluetooth "
                "connection.",
                rating=1,
            ),
        ]

        results = score_reviews(reviews)

        for result in results:
            self.assertNotIn(
                "exact_duplicate",
                result.reasons,
            )
            self.assertNotIn(
                "near_duplicate",
                result.reasons,
            )
            self.assertEqual(result.score, 100)


if __name__ == "__main__":
    unittest.main()
