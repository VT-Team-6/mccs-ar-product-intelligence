"""Review reliability scoring"""

import re
from dataclasses import dataclass
from collections import Counter

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity


RELIABILITY_VERSION = "hybrid-reliability-v1"

# Tunable initial thresholds.
NEAR_DUPLICATE_THRESHOLD = 0.86
MIN_SIMILARITY_WORDS = 8
MIN_RELIABILITY = 10

_URL = re.compile(
    r"(?:https?://|www\.)\S+",
    re.IGNORECASE,
)

_PROMOTIONAL = re.compile(
    r"\b(?:buy now|click here|limited time offer|"
    r"discount code|use my code|shop now|"
    r"best deal guaranteed|promo code)\b",
    re.IGNORECASE,
)

_WORD = re.compile(r"[a-z0-9']+")

_GENERIC = {
    "good",
    "great",
    "excellent",
    "amazing",
    "awesome",
    "nice",
    "perfect",
    "love it",
    "i love it",
    "bad",
    "terrible",
    "awful",
    "horrible",
    "okay",
    "ok",
    "not good",
    "very good",
    "very bad",
    "five stars",
    "one star",
    "recommended",
}


# Concrete product features and customer experiences.
# These can make a short review useful despite its length.
_SPECIFIC_FEATURES = re.compile(
    r"\b(?:"
    r"battery|charging|charger|sound|audio|bass|microphone|"
    r"bluetooth|connection|noise cancelling|"
    r"sole|soles|heel|heels|insole|cushioning|"
    r"fit|sizing|size|arch support|"
    r"zipper|zippers|strap|straps|stitching|seams|"
    r"fabric|material|leather|waterproof|"
    r"pockets|compartments|laptop|"
    r"scent|smell|lather|scalp|hair|"
    r"flavor|taste|aroma|roast|brewing|"
    r"screen|display|buttons|"
    r"durability|comfort|quality"
    r")\b",
    re.IGNORECASE,
)

# Reports of concrete outcomes or failures.
_EXPERIENCE_DETAILS = re.compile(
    r"\b(?:"
    r"broke|broken|cracked|peeled|peeling|"
    r"failed|failure|stopped working|died|"
    r"leaked|leaking|ripped|tore|"
    r"disconnected|disconnecting|"
    r"scratched|faded|worn out|"
    r"lasts|lasted|fits|fitted|"
    r"comfortable|uncomfortable|"
    r"too small|too large|too tight|"
    r"irritated|dried out|"
    r"arrived damaged"
    r")\b",
    re.IGNORECASE,
)

# Measurable experiences such as "after 3 days" or
# "lasted two months", including written-out numbers.
_MEASURED_EXPERIENCE = re.compile(
    r"\b(?:\d+(?:\.\d+)?|one|two|three|four|five|six|"
    r"seven|eight|nine|ten|a|an)\s*"
    r"(?:hours?|days?|weeks?|months?|years?|"
    r"minutes?|miles?|kilometers?|km|lbs?|pounds?)\b",
    re.IGNORECASE,
)


def _has_specific_details(text: str) -> bool:
    """Does a review contain a concrete feature or experience?

    Specificity is a useful signal, not proof of authenticity.
    """
    return bool(
        _SPECIFIC_FEATURES.search(text)
        or _EXPERIENCE_DETAILS.search(text)
        or _MEASURED_EXPERIENCE.search(text)
    )


@dataclass(frozen=True)
class ReliabilityResult:
    review_id: int
    score: int
    reasons: tuple[str, ...]

    @property
    def weight(self) -> float:
        """Relative evidence weight supplied to ARC."""
        return self.score / 100.0


def _normalized_text(review: dict) -> str:
    title = str(review.get("title") or "")
    body = str(review.get("body") or "")
    text = f"{title} {body}".casefold()
    return " ".join(_WORD.findall(text))


def _base_score(review: dict) -> tuple[int, list[str]]:
    body = str(review.get("body") or "").strip()
    title = str(review.get("title") or "").strip()
    text = f"{title} {body}".strip()

    words = _WORD.findall(body.casefold())
    normalized = " ".join(_WORD.findall(text.casefold()))
    normalized_body = " ".join(_WORD.findall(body.casefold()))

    score = 100
    reasons: list[str] = []

    # Short reviews should only receive a length penalty
    # when they lack concrete product information.
    specific = _has_specific_details(text)

    if len(words) < 4:
        if not specific:
            score -= 25
            reasons.append("very_short")

    elif len(words) < 10:
        if not specific:
            score -= 10
            reasons.append("short_review")

    # The body may be generic even when the title is not.
    if normalized in _GENERIC or normalized_body in _GENERIC:
        score -= 15
        reasons.append("generic_feedback")

    if _URL.search(text):
        score -= 35
        reasons.append("external_link")

    if _PROMOTIONAL.search(text):
        score -= 35
        reasons.append("promotional_language")

    # Ratings and sentiment never affect the reliability score.
    return score, reasons


def score_reviews(reviews: list[dict]) -> list[ReliabilityResult]:
    """Score a batch of reviews and detect duplicated wording.

    Reviews are compared within the supplied product-review batch.
    The first copy retains its text-based score; later copies are
    penalized.
    """
    if not reviews:
        return []

    scores: list[int] = []
    reasons: list[list[str]] = []
    texts = [_normalized_text(review) for review in reviews]

    for review in reviews:
        score, why = _base_score(review)
        scores.append(score)
        reasons.append(why)

    # Exact duplicates: later repeated copies contribute less.
    seen: set[str] = set()
    duplicate_indexes: set[int] = set()

    for index, text in enumerate(texts):
        # Very short generic phrases are handled by the text rules.
        if len(text.split()) < MIN_SIMILARITY_WORDS:
            continue

        if text in seen:
            scores[index] -= 60
            reasons[index].append("exact_duplicate")
            duplicate_indexes.add(index)
        else:
            seen.add(text)

    # TF-IDF detects similar phrasing that is not an exact copy.
    eligible = [
        index for index, text in enumerate(texts)
        if len(text.split()) >= MIN_SIMILARITY_WORDS
    ]

    if len(eligible) >= 2:
        eligible_texts = [texts[index] for index in eligible]
        matrix = TfidfVectorizer(
            lowercase=False,
            stop_words=None,
            token_pattern=r"(?u)\b\w+\b",
            ngram_range=(1, 2),
            sublinear_tf=True,
        ).fit_transform(eligible_texts)

        # Compare each review only against earlier representatives.
        # Avoid allowing a large repeated cluster to dominate scoring.
        representatives: list[int] = []

        for position, index in enumerate(eligible):
            if index in duplicate_indexes:
                continue

            if representatives:
                similarities = cosine_similarity(
                    matrix[position],
                    matrix[representatives],
                )[0]

                if similarities.max() >= NEAR_DUPLICATE_THRESHOLD:
                    scores[index] -= 40
                    reasons[index].append("near_duplicate")
                    continue

            representatives.append(position)

    return [
        ReliabilityResult(
            review_id=int(review["review_id"]),
            score=max(
                MIN_RELIABILITY,
                min(100, scores[index]),
            ),
            reasons=tuple(reasons[index]),
        )
        for index, review in enumerate(reviews)
    ]



def select_reviews(
    reviews: list[dict],
    limit: int = 50,
    rating_distribution: dict[str, int] | None = None,
) -> list[tuple[dict, ReliabilityResult]]:
    """Select reliable reviews while preserving rating proportions.

    Rating groups:
      negative: 1-2 stars
      neutral:  3 stars
      positive: 4-5 stars

    When provided, rating_distribution represents all stored reviews,
    not just the candidate pool.

    Within each group, higher-reliability reviews are preferred.
    If a group has too few candidates, unused slots are redistributed.
    """
    if limit <= 0 or not reviews:
        return []

    results = score_reviews(reviews)
    candidates = list(enumerate(zip(reviews, results)))
    limit = min(limit, len(candidates))

    groups = {
        "negative": [],
        "neutral": [],
        "positive": [],
        "unrated": [],
    }

    def rating_group(rating) -> str:
        if rating is None:
            return "unrated"

        star = max(1, min(5, int(float(rating) + 0.5)))

        if star <= 2:
            return "negative"
        if star == 3:
            return "neutral"
        return "positive"

    for entry in candidates:
        review = entry[1][0]
        group = rating_group(review.get("rating"))
        groups[group].append(entry)

    # Within each category, prefer reliable reviews.
    # The original input order breaks ties (newest first).
    for group in groups.values():
        group.sort(
            key=lambda entry: (-entry[1][1].score, entry[0])
        )

    if rating_distribution is not None:
        counts = {
            "negative": (
                rating_distribution.get("1", 0)
                + rating_distribution.get("2", 0)
            ),
            "neutral": rating_distribution.get("3", 0),
            "positive": (
                rating_distribution.get("4", 0)
                + rating_distribution.get("5", 0)
            ),
            "unrated": sum(
                review.get("rating") is None
                for review in reviews
            ),
        }
    else:
        counts = {
            name: len(entries)
            for name, entries in groups.items()
        }

    total = sum(counts.values())

    if total == 0:
        return []

    # Largest-remainder allocation:
    # e.g. 80% negative, 10% neutral, 10% positive
    # becomes 40, 5, 5 out of 50 reviews.
    exact = {
        name: limit * count / total
        for name, count in counts.items()
    }

    quotas = {
        name: int(value)
        for name, value in exact.items()
    }

    remaining_slots = limit - sum(quotas.values())

    remainder_order = sorted(
        counts,
        key=lambda name: (
            -(exact[name] - quotas[name]),
            -counts[name],
            name,
        ),
    )

    for name in remainder_order[:remaining_slots]:
        quotas[name] += 1

    
    # Preserve minority feedback: a rating group with available
    # reviews should not disappear solely because proportional
    # rounding assigned it zero slots.
    represented_groups = [
        name
        for name, entries in groups.items()
        if entries and counts[name] > 0
    ]

    if limit >= len(represented_groups):
        for name in represented_groups:
            if quotas[name] > 0:
                continue

            # Borrow one slot from the most represented group.
            # Never reduce another group below its own minimum.
            donors = [
                other
                for other in represented_groups
                if quotas[other] > 1
            ]

            if not donors:
                continue

            donor = max(
                donors,
                key=lambda other: quotas[other],
            )

            quotas[donor] -= 1
            quotas[name] += 1


    selected = []
    used = set()

    # Select each group's allocated number of reviews.
    for name, entries in groups.items():
        for entry in entries[:quotas[name]]:
            selected.append(entry)
            used.add(entry[0])

    # If a group didn't have enough candidate reviews,
    # fill unused slots from the best remaining candidates.
    if len(selected) < limit:
        remaining = [
            entry for entry in candidates
            if entry[0] not in used
        ]

        remaining.sort(
            key=lambda entry: (-entry[1][1].score, entry[0])
        )

        selected.extend(
            remaining[:limit - len(selected)]
        )

    # Strongest evidence first when sent to ARC.
    selected.sort(
        key=lambda entry: (-entry[1][1].score, entry[0])
    )

    return [
        candidate
        for _, candidate in selected[:limit]
    ]


def reliability_summary(
    results: list[ReliabilityResult],
) -> dict:
    reasons = Counter(
        reason
        for result in results
        for reason in result.reasons
    )

    return {
        "review_count": len(results),
        "average_score": (
            round(sum(r.score for r in results) / len(results), 2)
            if results else None
        ),
        "flag_counts": dict(reasons),
    }
