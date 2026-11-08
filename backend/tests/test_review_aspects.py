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

    def topics(phrases, category=None):
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
    monkeypatch.setattr(review_aspects, "phrase_topics", lambda phrases, category=None: seen.extend(phrases) or ["overall"] * len(phrases))
    aspect_ratings([{**review(1, 5, "The Comfort Max Runner looks great"), "name": "Comfort Max Runner"}])
    assert seen == ["The these looks great"]


def test_no_reviews():
    assert aspect_ratings([]) == {}


def test_shampoo_and_coffee_only_get_quality(monkeypatch):
    fake_topics(monkeypatch, {"soft": "comfort", "tasty": "quality", "broke": "durability"})
    reviews = [
        {**review(1, 5, "It feels so soft. Really tasty coffee here"), "category": "coffee"},
        {**review(1, 3, "The bag broke open. Quite tasty for me"), "category": "coffee"},
    ]
    assert aspect_ratings(reviews) == {1: {"quality": 4.0}}


def test_each_category_uses_its_own_examples(monkeypatch):
    used = []
    monkeypatch.setattr(
        review_aspects, "phrase_topics",
        lambda phrases, category=None: used.append(category) or ["overall"] * len(phrases),
    )
    review_aspects.review_topics([
        {**review(1, 5, "Great sound and very comfy"), "category": "headphones"},
        {**review(2, 5, "Rich flavor every single morning"), "category": "coffee"},
    ])
    assert sorted(used) == ["coffee", "headphones"]


def test_saved_topics_skip_the_model(monkeypatch):
    monkeypatch.setattr(review_aspects, "phrase_topics", lambda *a, **k: 1 / 0)
    reviews = [review(1, 5, "anything"), review(1, 3, "anything")]
    assert aspect_ratings(reviews, topics=[["comfort"], ["comfort"]]) == {1: {"comfort": 4.0}}


def test_changing_examples_changes_the_version(monkeypatch):
    before = review_aspects.topics_version("coffee")
    assert review_aspects.topics_version("shampoo") != before
    monkeypatch.setitem(review_aspects.TOPICS, "coffee", {"quality": ["new example"]})
    assert review_aspects.topics_version("coffee") != before


def test_every_category_has_examples_for_its_aspects():
    from categories import CATEGORIES

    for category in CATEGORIES:
        for aspect in review_aspects.aspects_for(category):
            assert review_aspects.TOPICS[category][aspect], (category, aspect)


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


def test_model_sorts_headphone_and_coffee_phrases():
    sound, comfort, broke = phrase_topics([
        "the bass sounds amazing and clear",
        "they hurt my ears after an hour of wearing",
        "the left earbud stopped working after two months",
    ], "headphones")
    assert (comfort, broke) == ("comfort", "durability")
    assert sound not in review_aspects.ASPECTS  # sound quality isn't build quality

    taste, smell = phrase_topics(["it tastes burnt and really bitter", "smells wonderful while brewing"], "coffee")
    assert taste == "quality"
    assert smell not in review_aspects.ASPECTS


def test_keeps_dr_martens_and_decimal_sizes_together():
    assert split_phrases("The Dr. Martens boots fit great. Size 10.5 was perfect") == [
        "The Dr. Martens boots fit great",
        "Size 10.5 was perfect",
    ]