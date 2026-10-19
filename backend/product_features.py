"""Product scores for the recommendation engine (task 8.1).

Each product gets a 0-1 score per preference criterion (1 = best).
Missing data gets 0.5 (neutral), so it doesn't help or hurt a product.
The scores are saved to the product_scores table and rebuilt whenever
products change.
"""

from database import get_connection

NEUTRAL = 0.5
CRITERIA = ("price", "rating", "brand", "quality", "durability", "comfort")


def scale_within_type(products: list[dict], field: str, higher_is_better: bool) -> dict[int, float]:
    """Score one numeric field from 0 to 1, comparing only products of the same type.

    The best value in a type gets 1 and the worst gets 0. A product gets 0.5 when
    its value is missing or there is nothing to compare it with.
    """
    values_by_type: dict[str, list[float]] = {}
    for p in products:
        if p.get(field) is not None:
            values_by_type.setdefault(p["product_type"], []).append(float(p[field]))

    scores = {}
    for p in products:
        values = values_by_type.get(p["product_type"], [])
        if p.get(field) is None or len(values) < 2 or max(values) == min(values):
            scores[p["product_id"]] = NEUTRAL
            continue
        low, high = min(values), max(values)
        position = (float(p[field]) - low) / (high - low)  # 0 = lowest, 1 = highest
        scores[p["product_id"]] = position if higher_is_better else 1 - position
    return scores


def price_scores(products: list[dict]) -> dict[int, float]:
    """Cheaper is better: the cheapest of a type gets 1, the most expensive gets 0."""
    return scale_within_type(products, "price", higher_is_better=False)


def rating_scores(products: list[dict]) -> dict[int, float]:
    """Higher rating is better: the best-rated of a type gets 1, the lowest gets 0."""
    return scale_within_type(products, "rating", higher_is_better=True)


def brand_scores(products: list[dict], ratings: dict[int, float]) -> dict[int, float]:
    """The average rating score of the brand's products.

    Only brands with 2 or more rated products get a real score; otherwise
    it would just repeat the product's own rating.
    """
    by_brand: dict[str, list[float]] = {}
    for p in products:
        if p.get("brand") and p.get("rating") is not None:
            by_brand.setdefault(p["brand"].strip().lower(), []).append(ratings[p["product_id"]])

    scores = {}
    for p in products:
        brand_ratings = by_brand.get((p.get("brand") or "").strip().lower(), [])
        scores[p["product_id"]] = (
            sum(brand_ratings) / len(brand_ratings) if len(brand_ratings) >= 2 else NEUTRAL
        )
    return scores


def compute_scores(products: list[dict]) -> dict[int, dict[str, float]]:
    """Return {product_id: {criterion: score}} for every product.

    Quality, durability and comfort stay neutral until review analysis
    (Sprint 3) provides them.
    """
    price = price_scores(products)
    rating = rating_scores(products)
    brand = brand_scores(products, rating)
    return {
        p["product_id"]: {
            "price": round(price[p["product_id"]], 4),
            "rating": round(rating[p["product_id"]], 4),
            "brand": round(brand[p["product_id"]], 4),
            "quality": NEUTRAL,
            "durability": NEUTRAL,
            "comfort": NEUTRAL,
        }
        for p in products
    }


def refresh_product_scores() -> int:
    """Recalculate every product's scores and replace the product_scores table.

    Deleted products are skipped (and their old scores removed).
    Returns how many products were scored.
    """
    with get_connection() as conn:
        products = conn.execute(
            "SELECT product_id, product_type, brand, price, rating "
            "FROM products WHERE deleted_at IS NULL"
        ).fetchall()
        scores = compute_scores(products)

        # One transaction: if anything fails, the old scores stay
        conn.execute("DELETE FROM product_scores")
        with conn.cursor() as cur:
            cur.executemany(
                "INSERT INTO product_scores (product_id, price_score, rating_score, brand_score, "
                "quality_score, durability_score, comfort_score) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                [(pid, *(s[c] for c in CRITERIA)) for pid, s in scores.items()],
            )
    return len(scores)


def load_product_scores() -> dict[int, dict[str, float]]:
    """Read the saved scores as {product_id: {criterion: score}}."""
    with get_connection() as conn:
        rows = conn.execute("SELECT * FROM product_scores").fetchall()
    return {r["product_id"]: {c: r[f"{c}_score"] for c in CRITERIA} for r in rows}

def refresh_recommendation_data() -> None:
    """Rebuild everything the recommendation engine uses after products change.

    Runs on startup and after admin edits. Errors are printed, not raised,
    so a failed refresh never breaks the app (old data is kept).
    """
    try:
        count = refresh_product_scores()
        print(f"Recommendation data refreshed: {count} products")
    except Exception as error:
        print(f"Recommendation data refresh failed: {error}")