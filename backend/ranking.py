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
  text        = price limits ("under $100", "$50-$100") and brand names in the text
                are hard limits. Requirements ("waterproof", from words like
                "rain") boost products that mention them: +0.2 similarity and
                +0.25 on the final score. Price phrases are left out of the match.
  pool        = up to the 10 most similar products that are real matches (raw
                embedding similarity of at least 0.6, mixed like the similarity),
                keeping only those at least 70% as similar as the best one, though
                the 4 most similar real matches always stay. Can be empty.
                Preferences only reorder this pool, so a cheap or highly rated but
                unrelated product can never jump into the results.
  preference  = sum(weight x score) / sum(weight), weights from the ranking
                (#1 = 6, #2 = 5, ..., unranked = 1). Price and rating are
                compared among the pool (cheapest = 1), since those are the
                products the shopper is choosing between. Quality, durability
                and comfort use the saved review-based scores.
  final       = 0.4 x similarity + 0.6 x preference, or similarity alone when
                nothing is ranked. The pool already keeps results relevant,
                so the shopper's #1 priority can decide the order within it.
  best_matches = up to 3 from the pool, dropping any that score under 75% of #1,
                  so weak matches are hidden instead of always filling 3 spots.
  for_you     = best of the pool (minus the top 3 and liked products), using what
                we know about the shopper instead of the "right now" ranking:
                0.4 x similarity + 0.4 x saved preference + 0.2 x likes.
                Without likes: 0.5 / 0.5. Without a saved ranking: 0.6 x
                similarity + 0.4 x likes. likes = how close it is to the
                closest liked product, on a fixed scale (0.5 or less = 0,
                0.9 or more = 1). Only when the shopper has a saved ranking or likes.
  compare     = for 2+ picked products: up to 3 pros and 3 cons each, strongest
                first, from what they typed (requirements, budget), best/worst
                among the picks when the gap matters (10% on price, 0.3 stars
                otherwise) and what reviews say on their own (4.5+ or 3.5- stars).
                Notes list what couldn't be judged for lack of reviews.
                best_for_you uses the text and/or ranking.
Ties always go to the lower product_id, so the same input gives the same order.
"""

import re

import numpy as np
from sklearn.metrics.pairwise import cosine_similarity

from database import get_connection
from embeddings import build_product_embeddings, embed_query
from preferences import CRITERIA, has_ranking, rank_weights
from recommendation import build_tfidf_matrix
from text_parsing import REQUIREMENTS, mentions, parse_request

TFIDF_WEIGHT, EMBEDDING_WEIGHT = 0.4, 0.6
TEXT_WEIGHT, PRODUCT_WEIGHT = 0.6, 0.4
SIMILARITY_WEIGHT, PREFERENCE_WEIGHT = 0.4, 0.6
TYPE_BONUS = 0.15
BEST_MATCHES = 3
CANDIDATE_POOL = 10
RELATIVE_SIMILARITY = 0.7
MIN_POOL = BEST_MATCHES + 1
# Raw embedding similarity a product needs to count as a real match, using the
# same text/product mix as the similarity. From testing: unrelated text
# ("laptop", "cook pasta") 0.52 or less; real but looser matches (a waterproof
# hiking shoe for "rain") around 0.58.
MIN_MATCH = 0.55
# Products that mention what the shopper asked for ("waterproof") get a boost:
# on similarity, so they make the pool, and on the final score, so a ranked
# criterion like comfort can't bury them.
REQUIREMENT_SIMILARITY_BONUS = 0.2
REQUIREMENT_FINAL_BONUS = 0.25

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
# Comparison (task 7): pros/cons between the products the shopper picked.
# criterion -> (higher is better, smallest gap worth mentioning, pro, con, how to show the value)
COMPARISON = {
    "price": (False, 0.10, "Cheapest of these", "Most expensive", "${:.0f}"),  # gap = share of the cheaper price
    "rating": (True, 0.3, "Highest rated", "Lowest rated", "{:.1f}★"),         # gaps below are in stars
    "brand": (True, 0.3, "Most trusted brand", "Less trusted brand", "{:.1f}★ brand average"),
    "quality": (True, 0.3, "Best quality", "Lowest quality", "{:.1f}★"),
    "durability": (True, 0.3, "Most durable", "Least durable", "{:.1f}★"),
    "comfort": (True, 0.3, "Most comfortable", "Least comfortable", "{:.1f}★"),
}
# What reviews say about one product on its own, whatever the others score
STRONG_STARS, WEAK_STARS = 4.5, 3.5
REVIEW_PROS = {"quality": "Reviewers love the quality", "durability": "Reviewers say it lasts",
               "comfort": "Reviewers love the comfort"}
REVIEW_CONS = {"quality": "Reviewers find the quality lacking", "durability": "Reviewers say it wears out quickly",
               "comfort": "Reviewers find it uncomfortable"}
STAR_ASPECTS = ("quality", "durability", "comfort")
MAX_POINTS = 3  # pros and cons each, per product


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
    """Product types mentioned in typed text.

    Counts a type when the text names it ("running shoes" -> 'Running Shoe'),
    its last word ("boots" -> 'Boot' and 'Rain Boot'), or its first word
    ("hiking" -> 'Hiking Shoe'). "shoes" alone is too general to count.
    """
    lower = (text or "").lower()
    words = set(re.findall(r"[a-z]+", lower))
    named = {t for t in product_types if re.search(rf"\b{re.escape(t.lower())}s?\b", lower)}
    heads = {t.split()[-1].lower() for t in named} - {"shoe"}
    named |= {t for t in product_types if t.split()[-1].lower() in heads}
    named |= {t for t in product_types if len(t.split()) > 1 and t.split()[0].lower() in words}
    return named

def join_words(words: list[str]) -> str:
    """['quality', 'comfort'] -> 'quality or comfort'."""
    return words[0] if len(words) == 1 else ", ".join(words[:-1]) + " or " + words[-1]

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
        self.brands = sorted({p["brand"] for p in products if p.get("brand")})
        self.product_text = [f"{p['name']} {p.get('description') or ''}" for p in products]
        # Unscaled review stars per aspect, for comparing products of different types
        self.aspect_stars = np.array([
            [np.nan if (scores.get(pid) or {}).get(f"{a}_stars") is None else float(scores[pid][f"{a}_stars"])
             for a in ("quality", "durability", "comfort")]
            for pid in self.ids
        ])

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

    def similarity(self, product_id: int | None, text: str | None, candidates: np.ndarray):
        """0-1 similarity of each candidate, and whether each one is a real match.

        A real match has a raw embedding similarity of at least MIN_MATCH, mixed
        the same way as the similarity (0.6 text + 0.4 product when both are given).
        """
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
        raw = sum(weight / total * embedding[candidates] for weight, _, embedding in parts)
        return np.minimum(similarity + bonus, 1.0), raw >= MIN_MATCH

    # --- the request ------------------------------------------------------

    def recommend(
        self,
        product_id: int | None = None,
        text: str | None = None,
        now_ranks: dict | None = None,
        saved_ranks: dict | None = None,
        liked_ids: list[int] | None = None,
    ) -> dict:
        """Up to 3 best matches plus one "for you" pick, each with reasons."""
        text = (text or "").strip()
        if product_id is None and not text:
            raise ValueError("Give a product, some text, or both")
        if product_id is not None and product_id not in self.index:
            raise KeyError(f"Product {product_id} is not in the catalog")

        parsed = parse_request(text, self.brands) if text else None
        named_types = types_named_in(text, set(self.types)) if text else set()
        candidates = np.array([
            i for i, pid in enumerate(self.ids)
            if pid != product_id
            and self._within_limits(i, parsed)
            and (not named_types or self.types[i] in named_types)
        ])
        if len(candidates) == 0:
            return {"best_matches": [], "for_you": None}

        # Price phrases say nothing about the product, so they're left out of the match
        match_text = parsed.remaining_text if parsed and parsed.remaining_text else text
        similarity, strong = self.similarity(product_id, match_text, candidates)
        met = self._requirements_met(candidates, parsed)
        strong = strong | (met > 0)
        similarity = np.minimum(similarity + REQUIREMENT_SIMILARITY_BONUS * met, 1.0)
        ids = np.array(self.ids)[candidates]

        # Only real matches near the best one are considered, then preferences reorder them
        most_similar = sorted(range(len(candidates)), key=lambda j: (-similarity[j], ids[j]))
        cutoff = RELATIVE_SIMILARITY * similarity[most_similar[0]]
        pool = [
            j for n, j in enumerate(most_similar[:CANDIDATE_POOL])
            if strong[j] and (n < MIN_POOL or similarity[j] >= cutoff)
        ]
        if not pool:
            return {"best_matches": [], "for_you": None}

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

        final = final + REQUIREMENT_FINAL_BONUS * met

        # Products meeting more of what they asked for come first; their ranking orders the rest
        order = sorted(pool, key=lambda j: (-met[j], -final[j], ids[j]))
        top = order[:BEST_MATCHES]

        best = [
            self._card(candidates[j], final[j], similarity[j], scores[j], now_ranks if personalized else None)
            for j in top
        ]
        for_you = self._for_you(
            candidates, order, final, similarity, scores, now_ranks, saved_ranks, liked_ids or [], met
        )
        return {"best_matches": best, "for_you": for_you}

    def _within_limits(self, i: int, parsed) -> bool:
        """Price range and brand from the text are hard limits."""
        if parsed is None:
            return True
        price = self.prices[i]
        if parsed.min_price is not None and not (price >= parsed.min_price):
            return False
        if parsed.max_price is not None and not (price <= parsed.max_price):
            return False
        if parsed.brands and self.products[i].get("brand") not in parsed.brands:
            return False
        return True

    def _requirements_met(self, candidates: np.ndarray, parsed) -> np.ndarray:
        """Share (0-1) of the asked-for requirements each candidate mentions."""
        if parsed is None or not parsed.requirements:
            return np.zeros(len(candidates))
        return np.array([
            sum(mentions(self.product_text[i], REQUIREMENTS[r][1]) for r in parsed.requirements)
            / len(parsed.requirements)
            for i in candidates
        ])

    def _for_you(self, candidates, order, final, similarity, scores, now_ranks, saved_ranks, liked_ids, met):
        has_saved = bool(saved_ranks) and has_ranking(saved_ranks)
        liked = [self.index[pid] for pid in liked_ids if pid in self.index]
        if not has_saved and not liked:
            return None

        liked_set = set(liked)
        pool = [j for j in order if candidates[j] not in liked_set]
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

        # What they asked for still counts: a general pick shouldn't ignore "waterproof"
        pick = pick + REQUIREMENT_FINAL_BONUS * met[pool]

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

    # --- comparison -------------------------------------------------------
    def compare(self, product_ids: list[int], text: str | None = None, ranks: dict | None = None) -> dict:
        """Pros, cons and notes for each picked product, plus the best pick for the shopper.

        Pros and cons, strongest first and up to 3 each, come from:
          - what they typed: requirements met or not ("Waterproof"), budget kept or not
          - best or worst of the picked products on a criterion, when the gap matters
          - what reviews say about the product on its own (4.5 stars or more, 3.5 or less)
        Notes say what couldn't be judged for lack of reviews. best_for_you uses the
        text and/or ranking, and is None without either.
        """
        product_ids = list(dict.fromkeys(product_ids))  # drop repeats, keep order
        if len(product_ids) < 2:
            raise ValueError("Pick at least 2 products to compare")
        missing = [pid for pid in product_ids if pid not in self.index]
        if missing:
            raise KeyError(f"Products not in the catalog: {missing}")

        rows = np.array([self.index[pid] for pid in product_ids])
        text = (text or "").strip()
        parsed = parse_request(text, self.brands) if text else None
        values = {
            "price": self.prices[rows],
            "rating": self.ratings[rows],
            "brand": np.array([self._brand_stars(i) for i in rows]),
            **{a: self.aspect_stars[rows, k] for k, a in enumerate(STAR_ASPECTS)},
        }
        points = {pid: {"pros": [], "cons": []} for pid in product_ids}
        covered = set()  # (product_id, criterion) already said something about

        def add(pid, kind, strength, sentence, criterion=None):
            points[pid][kind].append((strength, sentence))
            if criterion:
                covered.add((pid, criterion))

        # 1. What they typed: requirements and budget
        if parsed:
            for n, pid in enumerate(product_ids):
                i = rows[n]
                for r in sorted(parsed.requirements):
                    if mentions(self.product_text[i], REQUIREMENTS[r][1]):
                        add(pid, "pros", 3.0, r.capitalize())
                    else:
                        add(pid, "cons", 3.0, f"Not listed as {r}")
                if parsed.max_price is not None and not np.isnan(self.prices[i]):
                    if self.prices[i] <= parsed.max_price:
                        add(pid, "pros", 2.5, f"Within your ${parsed.max_price:.0f} budget")
                    else:
                        add(pid, "cons", 2.5, f"Over your ${parsed.max_price:.0f} budget")

        # 2. Best and worst of the picked products, when the gap matters
        for criterion, (higher_is_better, min_gap, pro, con, shown) in COMPARISON.items():
            v = values[criterion]
            known = ~np.isnan(v)
            if known.sum() < 2:
                continue
            best = np.nanmax(v) if higher_is_better else np.nanmin(v)
            worst = np.nanmin(v) if higher_is_better else np.nanmax(v)
            gap = abs(best - worst)
            if criterion == "price":
                gap /= min(best, worst) or 1
            if gap < min_gap:
                continue
            strength = 1 + min(gap / min_gap, 4) / 4  # bigger gaps come first
            for n, pid in enumerate(product_ids):
                if not known[n]:
                    continue
                if np.isclose(v[n], best):
                    add(pid, "pros", strength, f"{pro} ({shown.format(v[n])})", criterion)
                elif np.isclose(v[n], worst):
                    add(pid, "cons", strength, f"{con} ({shown.format(v[n])})", criterion)

        # 3. What reviews say about each product on its own
        for k, aspect in enumerate(STAR_ASPECTS):
            for n, pid in enumerate(product_ids):
                stars = self.aspect_stars[rows[n], k]
                if np.isnan(stars) or (pid, aspect) in covered:
                    continue
                if stars >= STRONG_STARS:
                    add(pid, "pros", 1 + min(stars - STRONG_STARS, 0.5), f"{REVIEW_PROS[aspect]} ({stars:.1f}★)")
                elif stars <= WEAK_STARS:
                    add(pid, "cons", 1 + min(WEAK_STARS - stars, 0.5), f"{REVIEW_CONS[aspect]} ({stars:.1f}★)")

        def strongest(items):
            return [sentence for _, sentence in sorted(items, key=lambda item: -item[0])[:MAX_POINTS]]

        products = []
        for n, pid in enumerate(product_ids):
            # Only aspects some other picked product has reviews for, so it's worth saying
            unknown = [
                a for k, a in enumerate(STAR_ASPECTS)
                if np.isnan(self.aspect_stars[rows[n], k]) and not np.isnan(self.aspect_stars[rows, k]).all()
            ]
            products.append({
                "product_id": pid,
                "pros": strongest(points[pid]["pros"]),
                "cons": strongest(points[pid]["cons"]),
                "notes": [f"Not enough reviews to judge {join_words(unknown)}"] if unknown else [],
            })
        return {
            "products": products,
            "best_for_you": self._best_for_you(product_ids, rows, values, parsed, ranks),
        }

    def _brand_stars(self, i: int) -> float:
        """Average rating of the brand's products; unknown (nan) with fewer than 2 rated."""
        brand = (self.products[i].get("brand") or "").strip().lower()
        rated = [
            self.ratings[n] for n, p in enumerate(self.products)
            if (p.get("brand") or "").strip().lower() == brand and not np.isnan(self.ratings[n])
        ]
        return float(np.mean(rated)) if brand and len(rated) >= 2 else np.nan

    def _best_for_you(self, product_ids, rows, values, parsed, ranks) -> int | None:
        """The picked product that best fits what they typed and/or their ranking.

        Uses the same values as the pros and cons, so a product with no reviews is
        neutral on that criterion. Products outside their price limits can't win.
        """
        has_ranks = bool(ranks) and has_ranking(ranks)
        if parsed is None and not has_ranks:
            return None
        prices = self.prices[rows]
        eligible = [
            n for n in range(len(product_ids))
            if parsed is None or (
                (parsed.max_price is None or prices[n] <= parsed.max_price)
                and (parsed.min_price is None or prices[n] >= parsed.min_price)
            )
        ]
        if not eligible:
            return None

        match_text = parsed.remaining_text if parsed else ""
        similarity = self.similarity(None, match_text, rows)[0] if match_text else np.zeros(len(rows))
        if has_ranks:
            criteria = np.column_stack([
                compare_within(values[c], higher_is_better=COMPARISON[c][0]) for c in CRITERIA
            ])
            preference = preference_scores(criteria, rank_weights(ranks))
            fit = SIMILARITY_WEIGHT * similarity + PREFERENCE_WEIGHT * preference if match_text else preference
        else:
            fit = similarity
        fit = fit + REQUIREMENT_FINAL_BONUS * self._requirements_met(rows, parsed)
        return product_ids[min(eligible, key=lambda n: (-fit[n], product_ids[n]))]


# --- the shared engine the API uses ------------------------------------------

_engine: RecommendationEngine | None = None


def rebuild_engine() -> int:
    """Load products and saved scores from the database and build a new engine.

    The new engine replaces the old one only once it's fully built, so requests
    in the meantime keep using the old one. Returns how many products it holds.

    Store-agnostic prices are used: the average price of a product across all stores is used for scoring.
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
                ip.price,
                s.average_rating AS rating,
                p.description
            FROM products p
            LEFT JOIN (
                SELECT product_id, AVG(price) AS price
                FROM inventory
                GROUP BY product_id
            ) ip ON ip.product_id = p.product_id
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