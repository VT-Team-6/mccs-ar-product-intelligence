"""Integration tests for reliability-aware ARC review analysis."""

import json
import re
import unittest
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from review_analysis import analyze_product_reviews


PRODUCT_ID = 123


def sample_reviews():
    """100 reviews: 80 negative and 20 positive."""
    now = datetime(2026, 11, 19, tzinfo=timezone.utc)
    reviews = []

    for index in range(100):
        negative = index < 80

        reviews.append({
            "review_id": index + 1,
            "rating": 1 if negative else 5,
            "title": "Long-term product experience",
            "body": (
                f"After several weeks of regular use, the product "
                f"stopped working and needed replacement. "
                f"This review describes purchase {index + 1}."
                if negative else
                f"After several weeks of regular use, the product "
                f"continued working well and performed reliably. "
                f"This review describes purchase {index + 1}."
            ),
            "review_date": now - timedelta(days=index),
            "source": "amazon",
        })

    return reviews


class FakeCursor:
    def __init__(self, rows):
        self.rows = rows

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return self.rows


class FakeConnection:
    def __init__(self, reviews):
        self.reviews = reviews

    def execute(self, sql, params=None):
        # Raw product statistics.
        if "COUNT(*) AS review_count" in sql:
            return FakeCursor([{
                "review_count": 100,
                "average_rating": 1.8,
            }])

        # Full rating distribution, not just selected reviews.
        if "GROUP BY rating" in sql:
            return FakeCursor([
                {"rating": 1, "count": 80},
                {"rating": 5, "count": 20},
            ])

        # Reviews considered for AI analysis.
        if "r.review_id" in sql and "LIMIT" in sql:
            return FakeCursor(self.reviews)

        # Review-source attribution.
        if "SELECT DISTINCT prs.source" in sql:
            return FakeCursor([{"source": "amazon"}])

        raise AssertionError(f"Unexpected database query: {sql}")


class ReviewReliabilityIntegrationTests(unittest.TestCase):

    def test_arc_receives_representative_weighted_reviews(self):
        reviews = sample_reviews()
        captured_prompts = []

        @contextmanager
        def fake_connection():
            yield FakeConnection(reviews)

        def fake_arc(prompt):
            captured_prompts.append(prompt)
            return json.dumps({
                "summary": "Customers frequently report product failures.",
                "pros": ["Some customers report reliable performance."],
                "cons": ["Many customers report failures."],
            })

        with (
            patch(
                "review_analysis.get_connection",
                side_effect=fake_connection,
            ),
            patch(
                "review_analysis.analyze_with_arc",
                side_effect=fake_arc,
            ),
        ):
            result = analyze_product_reviews(PRODUCT_ID)

        # The prompt must contain the evidence weighting information.
        self.assertEqual(len(captured_prompts), 1)
        prompt = captured_prompts[0]

        self.assertIn("Reliability score:", prompt)
        self.assertIn("Evidence weight:", prompt)
        self.assertIn("Reliability concerns:", prompt)

        # Exactly 50 reviews should be supplied to ARC.
        self.assertEqual(prompt.count("Review ID:"), 50)

        ratings = re.findall(
            r"^Rating: ([1-5])$",
            prompt,
            flags=re.MULTILINE,
        )

        self.assertEqual(len(ratings), 50)
        self.assertEqual(ratings.count("1"), 40)
        self.assertEqual(ratings.count("5"), 10)

        # The analyzed count reflects the sample.
        self.assertEqual(result["review_count"], 50)

        # The raw product statistics must NOT be weighted.
        self.assertEqual(result["total_review_count"], 100)
        self.assertEqual(result["average_rating"], 1.8)
        self.assertEqual(result["rating_distribution"]["1"], 80)
        self.assertEqual(result["rating_distribution"]["5"], 20)
        self.assertEqual(result["sources"], ["amazon"])

        # Existing frontend response structure stays compatible.
        self.assertIsInstance(result["summary"], str)
        self.assertIsInstance(result["pros"], list)
        self.assertIsInstance(result["cons"], list)


if __name__ == "__main__":
    unittest.main()
