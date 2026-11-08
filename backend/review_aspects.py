"""Find what reviews say about comfort, durability and quality (part of task 8.1).

Each review is split into short phrases ("They are comfortable, but they crease
quickly" -> "They are comfortable" and "they crease quickly"). Every phrase is
compared, using embeddings, to a few example phrases for each topic of the
product's category, and counts toward the topic whose closest example it
matches best. The extra topics (fit, sound, scent, ...) are there so a phrase
about sizing doesn't get counted as comfort just because comfort was the
closest of only three choices.

A product's comfort rating is then the average star rating of its reviews that
talk about comfort. product_features.py turns those ratings into 0-1 scores.
Shampoo and coffee only get quality (categories.py).

Finding topics is slow (every phrase goes through the embedding model), so each
review's topics are saved in review_topics and only worked out again when the
review is new or its category's examples change (topics_version).
"""

import hashlib
import json
import re

import numpy as np

from categories import criteria_for
from embeddings import embed_texts

# Every topic that can become a score
ASPECTS = ("comfort", "durability", "quality")

# Topics reviews talk about in every category. A phrase closest to one is ignored.
_SHARED = {
    "value": ["worth the price", "too expensive for what you get", "good value for the money"],
    "shipping": ["arrived late", "shipping and delivery", "the box was damaged", "it arrived broken"],
    "overall": [
        "I love it",
        "would buy again",
        "happy with this purchase",
        "not what I expected",
        "I recommend it",
        "it is okay overall",
    ],
}

# Example phrases for every topic, per category. Short, everyday wording works
# best: a review phrase belongs to the topic with the single closest example. To
# fix a phrase that lands in the wrong topic, add an example like it to the
# right topic. Changing these makes the next refresh redo that category's reviews.
TOPICS = {
    "shoes": {
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
        "fit": ["they run small", "true to size", "too narrow for my feet", "had to size up", "fits snugly around the heel"],
        "style": ["they look great", "stylish and goes with everything", "nice color"],
        "weather": ["kept my feet dry in the rain", "waterproof in snow and puddles", "dries quickly after getting wet"],
        "grip": ["good traction on slippery surfaces", "the grip on wet ground", "slippery on smooth floors", "the rubber is sticky"],
        "weight": ["they are lightweight", "they feel heavy"],
        **_SHARED,
        "overall": [*_SHARED["overall"], "I love them", "I wear them all the time"],
    },
    "backpacks": {
        "comfort": [
            "comfortable to carry all day",
            "the straps dig into my shoulders",
            "the padded straps feel great",
            "hurts my back after a while",
            "sits comfortably on my back",
            "comfortable even when it is full",
        ],
        "durability": [
            "the zipper broke after a few months",
            "a strap ripped off",
            "the seams came apart",
            "the fabric tore quickly",
            "still holding up after years of daily use",
            "survived a lot of abuse and still looks new",
        ],
        "quality": [
            "well made with quality materials",
            "the material feels cheap",
            "solid construction and sturdy zippers",
            "poor stitching quality",
        ],
        "space": ["lots of room and pockets", "my laptop fits perfectly", "too small to fit my things", "well organized compartments"],
        "style": ["it looks great", "nice color and design"],
        "weather": ["kept my things dry in the rain", "water resistant fabric"],
        "weight": ["it is lightweight", "it is heavy even when empty"],
        **_SHARED,
    },
    "headphones": {
        "comfort": [
            "comfortable to wear for hours",
            "they hurt my ears after an hour",
            "the ear cushions are soft",
            "too tight on my head",
            "they keep falling out of my ears",
            "they fit snugly and comfortably",
        ],
        "durability": [
            "stopped working after a few months",
            "the headband cracked",
            "one side stopped working",
            "the cable broke",
            "still working perfectly after years",
            "they fell apart quickly",
        ],
        "quality": [
            "well built with premium materials",
            "feels cheap and plasticky",
            "solid build quality",
            "poorly made",
        ],
        "sound": ["great sound quality", "the bass is amazing", "the sound is muddy and tinny", "the noise cancelling works well"],
        "battery": ["the battery lasts all day", "the battery dies quickly", "charges fast"],
        "connection": ["bluetooth keeps disconnecting", "pairs easily with my phone", "the connection drops"],
        "microphone": ["people can hear me clearly on calls", "the microphone sounds bad"],
        "style": ["they look great", "nice color and design"],
        **_SHARED,
    },
    "shampoo": {
        "quality": [
            "works really well on my hair",
            "left my hair soft and clean",
            "made my hair greasy",
            "dried out my hair",
            "did nothing for my hair",
            "my hair has never looked better",
        ],
        "scent": ["smells amazing", "the smell is too strong", "I don't like the scent"],
        "lather": ["lathers nicely", "a little goes a long way", "it does not lather"],
        "packaging": ["the bottle leaked", "the pump does not work"],
        "skin": ["irritated my scalp", "helped my itchy scalp"],
        **_SHARED,
    },
    "coffee": {
        "quality": [
            "rich and smooth flavor",
            "tastes burnt and bitter",
            "great tasting coffee",
            "stale and flavorless",
            "weak and watery",
            "the best coffee I have had",
        ],
        "strength": ["strong and bold", "too weak for me", "a nice medium roast"],
        "aroma": ["smells wonderful when brewing", "no aroma at all"],
        "packaging": ["the bag was open when it arrived", "the bag is resealable"],
        **_SHARED,
    },
}


def topics_for(category: str | None) -> dict[str, list[str]]:
    """The example phrases for a category; shoes' when it's unknown."""
    return TOPICS.get(category or "", TOPICS["shoes"])


def aspects_for(category: str | None) -> tuple[str, ...]:
    """The aspects that become scores in a category (no comfort for coffee)."""
    return tuple(a for a in ASPECTS if a in criteria_for(category))


def topics_version(category: str | None) -> str:
    """Changes whenever the category's examples change, so saved topics are redone."""
    examples = json.dumps(topics_for(category), sort_keys=True)
    return hashlib.sha256(examples.encode()).hexdigest()[:16]


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


def phrase_topics(phrases: list[str], category: str | None = None) -> list[str]:
    """For each phrase, the name of the topic with the closest example phrase."""
    if not phrases:
        return []
    topics = topics_for(category)
    names = list(topics)
    examples = [(name, text) for name in names for text in topics[name]]
    closeness = embed_texts(phrases) @ embed_texts([text for _, text in examples]).T

    # Best match per topic = the closest of that topic's examples
    best = np.full((len(phrases), len(names)), -1.0)
    for column, (name, _) in enumerate(examples):
        topic = names.index(name)
        best[:, topic] = np.maximum(best[:, topic], closeness[:, column])
    return [names[i] for i in best.argmax(axis=1)]


def review_topics(reviews: list[dict]) -> list[list[str]]:
    """The aspects each review talks about, e.g. [["comfort"], [], ["durability", "quality"]].

    Each review needs title and body, and can include its product's category
    (which examples to compare with) and name, which is swapped for "these" so
    it doesn't affect the topic. Reviews of one category are done together.
    """
    found: list[set[str]] = [set() for _ in reviews]
    by_category: dict[str | None, list[int]] = {}
    for index, review in enumerate(reviews):
        by_category.setdefault(review.get("category"), []).append(index)

    for category, indexes in by_category.items():
        aspects = aspects_for(category)
        # Every phrase, remembering which review it came from
        phrases, owners = [], []
        for index in indexes:
            review = reviews[index]
            text = f"{review.get('title') or ''}. {review.get('body') or ''}"
            if review.get("name"):
                text = re.sub(re.escape(review["name"]), "these", text, flags=re.IGNORECASE)
            for phrase in split_phrases(text):
                phrases.append(phrase)
                owners.append(index)
        for index, topic in zip(owners, phrase_topics(phrases, category)):
            if topic in aspects:
                found[index].add(topic)
    return [sorted(topics) for topics in found]


def aspect_ratings(
    reviews: list[dict], topics: list[list[str]] | None = None
) -> dict[int, dict[str, float]]:
    """Average star rating of the reviews that mention each aspect, per product.

    Each review needs product_id and rating, plus what review_topics() needs.
    topics are the saved review_topics() results, worked out here when missing.
    Returns {product_id: {"comfort": 4.5, ...}}. An aspect is left out when
    fewer than MIN_REVIEWS of the product's reviews mention it.
    """
    if topics is None:
        topics = review_topics(reviews)

    ratings: dict[int, dict[str, list[float]]] = {}
    for review, aspects in zip(reviews, topics):
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
