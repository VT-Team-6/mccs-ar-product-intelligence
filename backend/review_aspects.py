"""Find what reviews say about comfort, durability and quality (part of task 8.1).

Each review is split into short phrases ("They are comfortable, but they crease
quickly" -> "They are comfortable" and "they crease quickly"). Every phrase is
compared, using embeddings, to a few example phrases for each topic below, and
counts toward the topic whose closest example it matches best. The extra topics
(fit, style, ...) are there so a phrase about sizing doesn't get counted as
comfort just because comfort was the closest of only three choices.

A product's comfort rating is then the average star rating of its reviews that
talk about comfort. product_features.py turns those ratings into 0-1 scores.
"""

import re

import numpy as np

from embeddings import embed_texts

# The three topics that become scores
ASPECTS = ("comfort", "durability", "quality")

# Example phrases for every topic. Short, everyday wording works best: a review
# phrase belongs to the topic with the single closest example. To fix a phrase
# that lands in the wrong topic, add an example like it to the right topic.
TOPICS = {
    "comfort": [
        "very comfortable to wear",
        "comfortable to wear all day long",
        "great cushioning and support",
        "my feet hurt after wearing them",
        "my feet feel fine even after a long day on them",
        "they gave me blisters",
        "stiff at first and needed breaking in",
        "took a few wears to break in",
        "uncomfortable after a few hours",
        "the insole feels soft",
        "good arch support",
    ],
    "durability": [
        "they fell apart after a few months",
        "the sole started peeling off",
        "the stitching came undone",
        "they wore out quickly",
        "still holding up after a year of use",
        "they still look new after years of wear",
        "the material cracked and creased",
        "a strap broke",
    ],
    "quality": [
        "well made with quality materials",
        "the materials feel cheap",
        "solid construction and nice finish",
        "the leather is high quality",
        "poor craftsmanship",
    ],
    # Topics reviews also talk about. A phrase closest to one of these is ignored.
    "fit": ["they run small", "true to size", "too narrow for my feet", "had to size up", "fits snugly around the heel"],
    "style": ["they look great", "stylish and goes with everything", "nice color"],
    "weather": ["kept my feet dry in the rain", "waterproof in snow and puddles", "dries quickly after getting wet"],
    "grip": ["good traction on slippery surfaces", "the grip on wet ground", "slippery on smooth floors", "the rubber is sticky"],
    "value": ["worth the price", "too expensive for what you get", "good value for the money"],
    "weight": ["they are lightweight", "they feel heavy"],
    "shipping": ["arrived late", "shipping and delivery", "the box was damaged"],
    "overall": [
        "I love them",
        "would buy again",
        "happy with this purchase",
        "not what I expected",
        "I recommend them",
        "I wear them all the time",
        "they are okay overall",
    ],
}

# A topic needs at least this many reviews mentioning it, or the product stays neutral
MIN_REVIEWS = 2

# Splits "A. B!" and "A: B" into sentences, and "A, but B" / "A although B" into separate phrases.
# A period only ends a sentence when a space follows (so "10.5" stays whole), and
# not after a short title like "Dr." (so "Dr. Martens" stays whole).
_SPLIT = re.compile(
    r"(?<!\bDr)(?<!\bMr)(?<!\bMrs)(?<!\bMs)(?<!\bSt)(?<!\bvs)[.!?;:]+(?:\s+|$)"
    r"|,?\s+\b(?:but|although|though|however|while|yet|especially)\b\s+",
    re.IGNORECASE,
)


def split_phrases(text: str) -> list[str]:
    """Break review text into short phrases of at least 3 words."""
    phrases = (part.strip() for part in _SPLIT.split(text or ""))
    return [p for p in phrases if len(p.split()) >= 3]


def phrase_topics(phrases: list[str]) -> list[str]:
    """For each phrase, the name of the topic with the closest example phrase."""
    if not phrases:
        return []
    names = list(TOPICS)
    examples = [(name, text) for name in names for text in TOPICS[name]]
    closeness = embed_texts(phrases) @ embed_texts([text for _, text in examples]).T

    # Best match per topic = the closest of that topic's examples
    best = np.full((len(phrases), len(names)), -1.0)
    for column, (name, _) in enumerate(examples):
        topic = names.index(name)
        best[:, topic] = np.maximum(best[:, topic], closeness[:, column])
    return [names[i] for i in best.argmax(axis=1)]


def aspect_ratings(reviews: list[dict]) -> dict[int, dict[str, float]]:
    """Average star rating of the reviews that mention each aspect, per product.

    Each review needs product_id, rating, title and body, and can include the
    product's name, which is swapped for "these" so it doesn't affect the topic.
    Returns {product_id: {"comfort": 4.5, ...}}. An aspect is left out when
    fewer than MIN_REVIEWS of the product's reviews mention it.
    """
    # Every phrase, remembering which review it came from
    phrases, owners = [], []
    for index, review in enumerate(reviews):
        text = f"{review.get('title') or ''}. {review.get('body') or ''}"
        if review.get("name"):
            text = re.sub(re.escape(review["name"]), "these", text, flags=re.IGNORECASE)
        for phrase in split_phrases(text):
            phrases.append(phrase)
            owners.append(index)

    # Which aspects each review mentions (a review counts once per aspect)
    mentions: dict[int, set[str]] = {}
    for index, topic in zip(owners, phrase_topics(phrases)):
        if topic in ASPECTS:
            mentions.setdefault(index, set()).add(topic)

    ratings: dict[int, dict[str, list[float]]] = {}
    for index, aspects in mentions.items():
        review = reviews[index]
        if review.get("rating") is None:
            continue
        for aspect in aspects:
            ratings.setdefault(review["product_id"], {}).setdefault(aspect, []).append(float(review["rating"]))

    return {
        product_id: {
            aspect: float(np.mean(values))
            for aspect, values in by_aspect.items()
            if len(values) >= MIN_REVIEWS
        }
        for product_id, by_aspect in ratings.items()
    }