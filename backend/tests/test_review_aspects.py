"""Tests for finding comfort, durability and quality in reviews."""

import review_aspects
from review_aspects import aspect_ratings, phrase_topics, split_phrases


def review(product_id, rating, body, title=""):
    return {"product_id": product_id, "rating": rating, "title": title, "body": body}


# --- splitting (no model needed) ------------------------------------------


def test_splits_sentences_and_but_clauses():
    phrases = split_phrases(
        "They feel great on long walks. The leather looks nice, but the sole wore out in a month!"
    )
    assert phrases == [
        "They feel great on long walks",
        "The leather looks nice",
        "the sole wore out in a month",
    ]


def test_splits_after_a_colon_and_before_especially():
    assert split_phrases("These are good overall: the sole is grippy, especially that the heel feels secure") == [
        "These are good overall",
        "the sole is grippy",
        "that the heel feels secure",
    ]


def test_drops_phrases_shorter_than_3_words():
    assert split_phrases("Love them. Great.") == []


def test_empty_text_has_no_phrases():
    assert split_phrases("") == []
    assert split_phrases(None) == []


# --- averaging (topic detection replaced with a fake) ----------------------


def fake_topics(monkeypatch, topic_by_word):
    """Pretend a phrase is about a topic if it contains that topic's word."""

    def topics(phrases):
        return [
            next((topic for word, topic in topic_by_word.items() if word in p), "overall")
            for p in phrases
        ]

    monkeypatch.setattr(review_aspects, "phrase_topics", topics)


def test_aspect_rating_is_the_average_stars_of_reviews_that_mention_it(monkeypatch):
    fake_topics(monkeypatch, {"cushion": "comfort", "fell apart": "durability"})
    reviews = [
        review(1, 5, "The cushion is amazing on walks"),
        review(1, 4, "Nice cushion for the price"),
        review(1, 2, "These fell apart after a month"),
        review(1, 1, "The heel fell apart quickly"),
        review(1, 3, "They look good with jeans"),
    ]
    assert aspect_ratings(reviews) == {1: {"comfort": 4.5, "durability": 1.5}}


def test_aspect_needs_at_least_2_reviews(monkeypatch):
    fake_topics(monkeypatch, {"cushion": "comfort"})
    reviews = [review(1, 5, "The cushion is amazing on walks"), review(1, 4, "They look good with jeans")]
    assert aspect_ratings(reviews) == {1: {}}


def test_a_review_counts_once_per_aspect(monkeypatch):
    fake_topics(monkeypatch, {"cushion": "comfort"})
    reviews = [
        review(1, 5, "The cushion is soft and nice. The cushion is also thick enough"),
        review(1, 3, "Decent cushion overall for me"),
    ]
    assert aspect_ratings(reviews) == {1: {"comfort": 4.0}}


def test_products_are_kept_separate(monkeypatch):
    fake_topics(monkeypatch, {"cushion": "comfort"})
    reviews = [
        review(1, 5, "Great cushion on these"),
        review(1, 5, "Best cushion I have had"),
        review(2, 2, "Thin cushion on these"),
        review(2, 2, "The cushion is flat now"),
    ]
    ratings = aspect_ratings(reviews)
    assert ratings[1] == {"comfort": 5.0}
    assert ratings[2] == {"comfort": 2.0}


def test_product_name_does_not_count_as_review_text(monkeypatch):
    seen = []
    monkeypatch.setattr(review_aspects, "phrase_topics", lambda phrases: seen.extend(phrases) or ["overall"] * len(phrases))
    aspect_ratings([{**review(1, 5, "The Comfort Max Runner looks great"), "name": "Comfort Max Runner"}])
    assert seen == ["The these looks great"]


def test_no_reviews():
    assert aspect_ratings([]) == {}


# --- real model -------------------------------------------------------------


def test_model_puts_clear_phrases_under_the_right_topic():
    phrases = [
        "my feet did not hurt after a twelve hour shift",
        "the sole started peeling off after two months",
        "the stitching and leather are beautifully finished",
        "they run half a size small",
    ]
    comfort, durability, quality, sizing = phrase_topics(phrases)
    assert (comfort, durability, quality) == ("comfort", "durability", "quality")
    assert sizing not in review_aspects.ASPECTS  # fit or overall, either way it's ignored


def test_keeps_dr_martens_and_decimal_sizes_together():
    assert split_phrases("The Dr. Martens boots fit great. Size 10.5 was perfect") == [
        "The Dr. Martens boots fit great",
        "Size 10.5 was perfect",
    ]