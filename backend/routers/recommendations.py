"""POST /api/recommendations: the bridge between the app and the ranking engine (8.15).

The app sends what the shopper is looking at and/or typed, plus what matters to
them right now. The backend adds their saved ranking and liked products, asks
the engine, and returns each result with the product details the screen needs.
"""

from fastapi import APIRouter, Depends, HTTPException, status

import auth
import preferences
from database import get_connection
from ranking import get_engine
from schemas import RecommendationRequest, RecommendationResponse

router = APIRouter(prefix="/api/recommendations", tags=["recommendations"])

_PRODUCT_COLUMNS = (
    "product_id, name, brand, product_type, price, rating, description, image_url, created_at, updated_at"
)


@router.post("", response_model=RecommendationResponse)
def recommend(body: RecommendationRequest, user=Depends(auth.require_authenticated_user)):
    with get_connection() as conn:
        saved_ranks = preferences.get_preferences(conn, user["user_id"])
        liked_ids = [
            row["product_id"]
            for row in conn.execute(
                "SELECT product_id FROM user_product_likes WHERE user_id = %s",
                (user["user_id"],),
            ).fetchall()
        ]

    try:
        result = get_engine().recommend(
            product_id=body.product_id,
            text=body.text,
            now_ranks=body.ranking.model_dump(),
            saved_ranks=saved_ranks,
            liked_ids=liked_ids,
        )
    except KeyError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Product {body.product_id} not found")
    except RuntimeError as error:  # no products in the catalog yet
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(error))

    # The engine returns product ids; add the details each card shows
    cards = result["best_matches"] + ([result["for_you"]] if result["for_you"] else [])
    with get_connection() as conn:
        rows = conn.execute(
            f"SELECT {_PRODUCT_COLUMNS} FROM products "
            "WHERE product_id = ANY(%s) AND deleted_at IS NULL",
            ([card["product_id"] for card in cards],),
        ).fetchall()
    products = {row["product_id"]: row for row in rows}

    def with_product(card):
        product = products.get(card["product_id"])
        if product is None:  # deleted since the engine was last rebuilt
            return None
        return {"product": product, "score": card["score"], "reasons": card["reasons"]}

    best = [c for c in (with_product(card) for card in result["best_matches"]) if c]
    for_you = with_product(result["for_you"]) if result["for_you"] else None
    return {"best_matches": best, "for_you": for_you}