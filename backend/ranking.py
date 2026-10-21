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
  preference  = sum(weight x score) / sum(weight), weights from the ranking
                (#1 = 6, #2 = 5, ..., unranked = 1)
  pool        = up to the 10 most similar products, keeping only those at least 70%
                as similar as the best one (but always at least 4). Preferences
                only reorder this pool, so a cheap or highly rated but unrelated
                product can never jump into the results.
  final       = 0.6 x similarity + 0.4 x preference, or similarity alone when
                nothing is ranked
  for_you     = best of the pool (minus the top 3 and liked products) by
                0.5 x final + 0.3 x combined preference + 0.2 x likes
                (0.6 / 0.4 without likes). Only when the shopper has a saved
                ranking or likes.
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
SIMILARITY_WEIGHT, PREFERENCE_WEIGHT = 0.6, 0.4
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

# Reasons shown on a card when a ranked criterion's score is high
REASON_THRESHOLD = 0.7
VERY_SIMILAR = 0.8
REASONS = {
    "price": "Cheaper than most {type}",
    "rating": "Highly rated",
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


def plural(product_type: str) -> str:
    """'Boot' -> 'boots', 'Flip-Flop' -> 'flip-flops' (used in reason text)."""
    lower = product_type.lower()
    return lower if lower.endswith("s") else lower + "s"


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


def combined_weights(now_ranks: dict | None, saved_ranks: dict | None) -> dict[str, float]:
    """Average of the "right now" and saved weights, each scaled to add up to 1."""
    parts = []
    for ranks in (now_ranks, saved_ranks):
        if ranks and has_ranking(ranks):
            weights = rank_weights(ranks)
            total = sum(weights.values())
            parts.append({c: weights[c] / total for c in CRITERIA})
    if not parts:
        return {c: 1.0 for c in CRITERIA}
    return {c: sum(p[c] for p in parts) / len(parts) for c in CRITERIA}


class RecommendationEngine:
    """Everything needed to rank products, built once and reused for every request."""

    def __init__(self, products: list[dict], scores: dict[int, dict[str, float]], embeddings=None):
        self.products = products
        self.ids = [p["product_id"] for p in products]
        self.index = {pid: i for i, pid in enumerate(self.ids)}
        self.types = np.array([p["product_type"] for p in products])
        self.vectorizer, self.tfidf = build_tfidf_matrix(products)
        self.embeddings = build_product_embeddings(products) if embeddings is None else embeddings
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
        scores = self.scores[candidates]
        personalized = bool(now_ranks) and has_ranking(now_ranks)
        if personalized:
            preference = preference_scores(scores, rank_weights(now_ranks))
            final = SIMILARITY_WEIGHT * similarity + PREFERENCE_WEIGHT * preference
        else:
            final = similarity

        # Only the most similar products are considered, then preferences reorder them
        ids = np.array(self.ids)[candidates]
        most_similar = sorted(range(len(candidates)), key=lambda j: (-similarity[j], ids[j]))
        cutoff = RELATIVE_SIMILARITY * similarity[most_similar[0]]
        pool = [
            j for n, j in enumerate(most_similar[:CANDIDATE_POOL])
            if n < MIN_POOL or similarity[j] >= cutoff
        ]
        order = sorted(pool, key=lambda j: (-final[j], ids[j]))
        top = order[:BEST_MATCHES]

        best = [
            self._card(candidates[j], final[j], similarity[j], now_ranks if personalized else None)
            for j in top
        ]
        for_you = self._for_you(
            candidates, order, top, final, similarity, now_ranks, saved_ranks, liked_ids or []
        )
        return {"best_matches": best, "for_you": for_you}

    def _for_you(self, candidates, order, top, final, similarity, now_ranks, saved_ranks, liked_ids):
        has_saved = bool(saved_ranks) and has_ranking(saved_ranks)
        liked = [self.index[pid] for pid in liked_ids if pid in self.index]
        if not has_saved and not liked:
            return None

        liked_set = set(liked)
        pool = [j for j in order if j not in top and candidates[j] not in liked_set]
        if not pool:
            return None

        weights = combined_weights(now_ranks, saved_ranks)
        personal = preference_scores(self.scores[candidates[pool]], weights)
        if liked:
            closeness = (self.embeddings[candidates[pool]] @ self.embeddings[liked].T).max(axis=1)
            likes = rescale(closeness) if len(pool) > 1 else np.ones(len(pool))
            pick = 0.5 * final[pool] + 0.3 * personal + 0.2 * likes
        else:
            likes = None
            pick = 0.6 * final[pool] + 0.4 * personal

        ids = np.array(self.ids)
        best = min(range(len(pool)), key=lambda n: (-pick[n], ids[candidates[pool[n]]]))
        j = pool[best]
        card = self._card(
            candidates[j], pick[best], similarity[j], saved_ranks if has_saved else now_ranks,
            liked=likes is not None and likes[best] >= REASON_THRESHOLD,
        )
        return card

    def _card(self, i: int, score: float, similarity: float, ranks: dict | None, liked: bool = False) -> dict:
        """One recommendation: the product, its score, and up to 2 reasons."""
        reasons = []
        if liked:
            reasons.append("Like products you liked")
        if similarity >= VERY_SIMILAR:
            reasons.append("Very similar")
        if ranks:
            ranked = sorted((r, c) for c, r in ranks.items() if r > 0)
            for _, criterion in ranked:
                if self.scores[i][CRITERIA.index(criterion)] >= REASON_THRESHOLD:
                    reasons.append(REASONS[criterion].format(type=plural(self.types[i])))
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
            "SELECT product_id, name, brand, product_type, price, rating, description "
            "FROM products WHERE deleted_at IS NULL ORDER BY product_id"
        ).fetchall()
    _engine = RecommendationEngine(products, load_product_scores()) if products else None
    return len(products)


def get_engine() -> RecommendationEngine:
    if _engine is None:
        rebuild_engine()
    if _engine is None:
        raise RuntimeError("There are no products to recommend")
    return _engine