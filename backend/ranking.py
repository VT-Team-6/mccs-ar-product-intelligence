"""Recommendation ranking (tasks 8.10-8.13).

Given what the shopper is looking at and/or typed, returns:
  - best_matches: the top 3 for this request, ranked by similarity and the
    "right now" ranking the shopper picked
  - for_you: 1 extra pick that also uses their saved ranking and liked products

Rules (8.10):
  similarity  = 0.4 x TF-IDF + 0.6 x embedding, each rescaled per request so the
                best candidate is 1 and the worst is 0. With both a product and
                text: 0.6 x text + 0.4 x product. +0.15 for the same type as the
                product on screen or a type named in the text (capped at 1).
  pool        = up to the 10 most similar products, keeping only those at least 70%
                as similar as the best one (but always at least 4). Preferences
                only reorder this pool, so a cheap or highly rated but unrelated
                product can never jump into the results.
  preference  = sum(weight x score) / sum(weight), weights from the ranking
                (#1 = 6, #2 = 5, ..., unranked = 1). Price and rating are
                compared among the pool (cheapest = 1), since those are the
                products the shopper is choosing between. Quality, durability
                and comfort use the saved review-based scores.
  final       = 0.4 x similarity + 0.6 x preference, or similarity alone when
                nothing is ranked. The pool already keeps results relevant,
                so the shopper's #1 priority can decide the order within it.
  for_you     = best of the pool (minus the top 3 and liked products), using what
                we know about the shopper instead of the "right now" ranking:
                0.4 x similarity + 0.4 x saved preference + 0.2 x likes.
                Without likes: 0.5 / 0.5. Without a saved ranking: 0.6 x
                similarity + 0.4 x likes. likes = how close it is to the
                closest liked product, on a fixed scale (0.5 or less = 0,
                0.9 or more = 1). Only when the shopper has a saved ranking or likes.
Ties always go to the lower product_id, so the same input gives the same order.
"""

import re

import numpy as np
from sklearn.metrics.pairwise import cosine_similarity

from database import get_connection
from embeddings import build_product_embeddings, embed_query
from preferences import CRITERIA, has_ranking, rank_weights
from recommendation import build_tfidf_matrix

TFIDF_WEIGHT, EMBEDDING_WEIGHT = 0.4, 0.6
TEXT_WEIGHT, PRODUCT_WEIGHT = 0.6, 0.4
SIMILARITY_WEIGHT, PREFERENCE_WEIGHT = 0.4, 0.6
TYPE_BONUS = 0.15
BEST_MATCHES = 3
CANDIDATE_POOL = 10
MIN_POOL = BEST_MATCHES + 1
RELATIVE_SIMILARITY = 0.7

# Words that say nothing about which product someone wants. They're dropped from
# typed text before the word match (TF-IDF), so "looking for wedding shoes" matches
# on "wedding", not on any product whose name happens to say "shoes".
FILLER_WORDS = {
    "looking", "look", "want", "need", "something", "anything", "pair", "pairs",
    "shoe", "shoes", "good", "best", "great", "nice", "find", "buy", "get", "wear", "wearing",
}

# How close (0-1) a product must be to a liked product to count. Unrelated
# products still land around 0.5, so closeness is mapped from 0.5-0.9 to 0-1.
LIKE_FLOOR, LIKE_CEILING = 0.5, 0.9
LIKED_REASON = 0.75  # "Like products you liked" only when this close

# Reasons shown on a card when a ranked criterion's score is high
REASON_THRESHOLD = 0.7
VERY_SIMILAR = 0.8
REASONS = {
    "price": "Cheaper than similar products",
    "rating": "Rated higher than similar products",
    "brand": "Trusted brand",
    "quality": "Well made",
    "durability": "Built to last",
    "comfort": "Very comfortable",
}


def rescale(values: np.ndarray) -> np.ndarray:
    """Best value becomes 1, worst becomes 0. All-equal values become 0."""
    low, high = values.min(), values.max()
    if high == low:
        return np.zeros_like(values, dtype=float)
    return (values - low) / (high - low)


def compare_within(values: np.ndarray, higher_is_better: bool) -> np.ndarray:
    """Score raw values against each other: best = 1, worst = 0.

    Missing values (nan), or nothing to compare (fewer than 2 values, or all
    equal), give 0.5.
    """
    scores = np.full(len(values), 0.5)
    known = ~np.isnan(values)
    if known.sum() < 2 or np.nanmax(values) == np.nanmin(values):
        return scores
    scaled = rescale(values[known])
    scores[known] = scaled if higher_is_better else 1 - scaled
    return scores


def types_named_in(text: str, product_types: set[str]) -> set[str]:
    """Product types mentioned in typed text, singular or plural ('boots' -> 'Boot')."""
    lower = (text or "").lower()
    return {
        t for t in product_types
        if re.search(rf"\b{re.escape(t.lower())}s?\b", lower)
    }


def preference_scores(scores: np.ndarray, weights: dict[str, float]) -> np.ndarray:
    """Weighted average of each product's 0-1 criterion scores."""
    w = np.array([weights[c] for c in CRITERIA], dtype=float)
    return scores @ w / w.sum()


class RecommendationEngine:
    """Everything needed to rank products, built once and reused for every request."""

    def __init__(self, products: list[dict], scores: dict[int, dict[str, float]], embeddings=None):
        self.products = products
        self.ids = [p["product_id"] for p in products]
        self.index = {pid: i for i, pid in enumerate(self.ids)}
        self.types = np.array([p["product_type"] for p in products])
        self.vectorizer, self.tfidf = build_tfidf_matrix(products)
        self.embeddings = build_product_embeddings(products) if embeddings is None else embeddings
        self.prices = np.array([np.nan if p.get("price") is None else float(p["price"]) for p in products])
        self.ratings = np.array([np.nan if p.get("rating") is None else float(p["rating"]) for p in products])
        neutral = {c: 0.5 for c in CRITERIA}
        self.scores = np.array([[scores.get(pid, neutral)[c] for c in CRITERIA] for pid in self.ids])

    # --- similarity -------------------------------------------------------

    def _similarity_to_product(self, i: int) -> np.ndarray:
        tfidf = cosine_similarity(self.tfidf[i], self.tfidf)[0]
        embedding = self.embeddings @ self.embeddings[i]
        return tfidf, embedding

    def _similarity_to_text(self, text: str) -> np.ndarray:
        words = [w for w in re.findall(r"[a-z0-9']+", text.lower()) if w not in FILLER_WORDS]
        tfidf = cosine_similarity(self.vectorizer.transform([" ".join(words)]), self.tfidf)[0]
        embedding = self.embeddings @ embed_query(text)
        return tfidf, embedding

    def similarity(self, product_id: int | None, text: str | None, candidates: np.ndarray) -> np.ndarray:
        """0-1 similarity of each candidate to the product and/or text."""
        parts = []
        wanted_types = set()
        if text:
            tfidf, embedding = self._similarity_to_text(text)
            parts.append((TEXT_WEIGHT, tfidf, embedding))
            wanted_types |= types_named_in(text, set(self.types))
        if product_id is not None:
            i = self.index[product_id]
            tfidf, embedding = self._similarity_to_product(i)
            parts.append((PRODUCT_WEIGHT, tfidf, embedding))
            wanted_types.add(self.types[i])

        total = sum(weight for weight, _, _ in parts)
        similarity = sum(
            weight / total
            * (TFIDF_WEIGHT * rescale(tfidf[candidates]) + EMBEDDING_WEIGHT * rescale(embedding[candidates]))
            for weight, tfidf, embedding in parts
        )
        bonus = np.isin(self.types[candidates], list(wanted_types)) * TYPE_BONUS
        return np.minimum(similarity + bonus, 1.0)

    # --- the request ------------------------------------------------------

    def recommend(
        self,
        product_id: int | None = None,
        text: str | None = None,
        now_ranks: dict | None = None,
        saved_ranks: dict | None = None,
        liked_ids: list[int] | None = None,
    ) -> dict:
        """Best matches (top 3) plus one "for you" pick, each with reasons."""
        text = (text or "").strip()
        if product_id is None and not text:
            raise ValueError("Give a product, some text, or both")
        if product_id is not None and product_id not in self.index:
            raise KeyError(f"Product {product_id} is not in the catalog")

        candidates = np.array([i for i, pid in enumerate(self.ids) if pid != product_id])
        if len(candidates) == 0:
            return {"best_matches": [], "for_you": None}

        similarity = self.similarity(product_id, text, candidates)
        ids = np.array(self.ids)[candidates]

        # Only the most similar products are considered, then preferences reorder them
        most_similar = sorted(range(len(candidates)), key=lambda j: (-similarity[j], ids[j]))
        cutoff = RELATIVE_SIMILARITY * similarity[most_similar[0]]
        pool = [
            j for n, j in enumerate(most_similar[:CANDIDATE_POOL])
            if n < MIN_POOL or similarity[j] >= cutoff
        ]

        # Price and rating are compared among the pool: the products being chosen between
        scores = self.scores[candidates].copy()
        members = candidates[pool]
        scores[pool, CRITERIA.index("price")] = compare_within(self.prices[members], higher_is_better=False)
        scores[pool, CRITERIA.index("rating")] = compare_within(self.ratings[members], higher_is_better=True)

        personalized = bool(now_ranks) and has_ranking(now_ranks)
        if personalized:
            preference = preference_scores(scores, rank_weights(now_ranks))
            final = SIMILARITY_WEIGHT * similarity + PREFERENCE_WEIGHT * preference
        else:
            final = similarity

        order = sorted(pool, key=lambda j: (-final[j], ids[j]))
        top = order[:BEST_MATCHES]

        best = [
            self._card(candidates[j], final[j], similarity[j], scores[j], now_ranks if personalized else None)
            for j in top
        ]
        for_you = self._for_you(
            candidates, order, top, final, similarity, scores, now_ranks, saved_ranks, liked_ids or []
        )
        return {"best_matches": best, "for_you": for_you}

    def _for_you(self, candidates, order, top, final, similarity, scores, now_ranks, saved_ranks, liked_ids):
        has_saved = bool(saved_ranks) and has_ranking(saved_ranks)
        liked = [self.index[pid] for pid in liked_ids if pid in self.index]
        if not has_saved and not liked:
            return None

        liked_set = set(liked)
        pool = [j for j in order if j not in top and candidates[j] not in liked_set]
        if not pool:
            return None

        # Based on who the shopper is (saved ranking + likes), still within the relevant pool
        personal = preference_scores(scores[pool], rank_weights(saved_ranks)) if has_saved else None
        closeness = closest_like = None
        if liked:
            # How close each product is to the closest liked product, on a fixed scale
            to_liked = self.embeddings[candidates[pool]] @ self.embeddings[liked].T
            closeness = to_liked.max(axis=1)
            closest_like = [liked[k] for k in to_liked.argmax(axis=1)]
            likes = np.clip((closeness - LIKE_FLOOR) / (LIKE_CEILING - LIKE_FLOOR), 0, 1)

        if has_saved and liked:
            pick = 0.4 * similarity[pool] + 0.4 * personal + 0.2 * likes
        elif has_saved:
            pick = 0.5 * similarity[pool] + 0.5 * personal
        else:
            pick = 0.6 * similarity[pool] + 0.4 * likes

        ids = np.array(self.ids)
        best = min(range(len(pool)), key=lambda n: (-pick[n], ids[candidates[pool[n]]]))
        j = pool[best]
        liked_name = None
        if closeness is not None and closeness[best] >= LIKED_REASON:
            liked_name = self.products[closest_like[best]]["name"]
        return self._card(
            candidates[j], pick[best], similarity[j], scores[j], saved_ranks if has_saved else None,
            liked_name=liked_name,
        )

    def _card(self, i: int, score: float, similarity: float, criterion_scores: np.ndarray,
              ranks: dict | None, liked_name: str | None = None) -> dict:
        """One recommendation: the product, its score, and up to 2 reasons."""
        reasons = []
        if liked_name:
            reasons.append(f"Similar to {liked_name}, which you liked")
        if similarity >= VERY_SIMILAR:
            reasons.append("Very similar")
        if ranks:
            ranked = sorted((r, c) for c, r in ranks.items() if r > 0)
            for _, criterion in ranked:
                if criterion_scores[CRITERIA.index(criterion)] >= REASON_THRESHOLD:
                    reasons.append(REASONS[criterion])
        if not reasons:
            reasons.append("Good match")
        return {
            "product_id": int(self.ids[i]),
            "score": round(float(score), 4),
            "reasons": reasons[:2],
        }


# --- the shared engine the API uses ------------------------------------------

_engine: RecommendationEngine | None = None


def rebuild_engine() -> int:
    """Load products and saved scores from the database and build a new engine.

    The new engine replaces the old one only once it's fully built, so requests
    in the meantime keep using the old one. Returns how many products it holds.
    """
    global _engine
    from product_features import load_product_scores  # avoids a circular import

    with get_connection() as conn:
        products = conn.execute(
            """
            SELECT
                p.product_id,
                p.name,
                p.brand,
                p.product_type,
                p.price,
                s.average_rating AS rating,
                p.description
            FROM products p
            LEFT JOIN product_review_stats s
                ON p.product_id = s.product_id
            WHERE p.deleted_at IS NULL
            ORDER BY p.product_id
            """
        ).fetchall()
    _engine = RecommendationEngine(products, load_product_scores()) if products else None
    return len(products)


def get_engine() -> RecommendationEngine:
    if _engine is None:
        rebuild_engine()
    if _engine is None:
        raise RuntimeError("There are no products to recommend")
    return _engine