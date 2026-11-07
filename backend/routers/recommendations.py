"""POST /api/recommendations: the bridge between the app and the ranking engine (8.15).

The app sends what the shopper is looking at and/or typed, plus what matters to
them right now. The backend adds their saved ranking and liked products, asks
the engine, and returns each result with the product details the screen needs.
"""

import logging

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query, status
from psycopg import sql

import auth
import preferences
import store_selection
from database import get_connection
from ranking import get_engine, types_named_in
from schemas import RecommendationRequest, RecommendationResponse
from routers.products import product_select
from search_understanding import understand

router = APIRouter(prefix="/api/recommendations", tags=["recommendations"])
logger = logging.getLogger(__name__)


def _log_impressions(user_id: int, best: list, for_you: dict | None, signals: dict) -> None:
    """Saves the cards shown, with their for-you signals, for learning to rank (task 9).

    Cards with no signals (a product they already liked, or a shopper with no
    saved ranking or likes) are skipped. Never blocks the recommendations.
    """
    shown = [("best", card["product"]["product_id"]) for card in best]
    if for_you:
        shown.append(("for_you", for_you["product"]["product_id"]))
    rows = [(user_id, pid, slot, *signals[pid]) for slot, pid in shown if pid in signals]
    if not rows:
        return
    try:
        with get_connection() as conn, conn.cursor() as cursor:
            cursor.executemany(
                """
                INSERT INTO recommendation_impressions
                    (user_id, product_id, slot, similarity, preference, likes)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                rows,
            )
    except psycopg.Error:
        logger.exception("Could not log recommendation impressions")


@router.post("", response_model=RecommendationResponse)
def recommend(
    body: RecommendationRequest,
    store_id: int | None = Query(
        default=None,
        description="Prices each card at this store; a query parameter, not a body field.",
    ),
    user=Depends(auth.require_authenticated_user),
):
    """Recommendations for the shopper's store (task 39): only products that store
    sells (active), priced at that store, in-stock ones first. Without a store,
    the whole catalog at its average price. The store also sets the price shown
    on each card via store_inventory."""
    with get_connection() as conn:
        saved_ranks = preferences.get_preferences(conn, user["user_id"])
        resolved = store_selection.resolve_store_id(conn, user["user_id"], store_id)
        liked_ids = [
            row["product_id"]
            for row in conn.execute(
                "SELECT product_id FROM user_product_likes WHERE user_id = %s",
                (user["user_id"],),
            ).fetchall()
        ]
        # What the shopper's store sells right now, at its own prices
        store_stock = None
        if resolved is not None:
            store_stock = {
                row["product_id"]: {"price": row["price"], "in_stock": row["in_stock"]}
                for row in conn.execute(
                    """
                    SELECT product_id, price, quantity > 0 AS in_stock
                    FROM inventory
                    WHERE store_id = %s AND status = 'active'
                    """,
                    (resolved,),
                ).fetchall()
            }

    try:
        engine = get_engine()
        result = engine.recommend(
            product_id=body.product_id,
            text=body.text,
            now_ranks=body.ranking.model_dump(),
            saved_ranks=saved_ranks,
            liked_ids=liked_ids,
            store_stock=store_stock,
        )
    except KeyError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Product {body.product_id} not found")
    except RuntimeError as error:  # no products in the catalog yet
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(error))

    # The engine returns product ids; add the details each card shows
    cards = result["best_matches"] + ([result["for_you"]] if result["for_you"] else [])
    with get_connection() as conn:
        rows = conn.execute(
            product_select(resolved) + sql.SQL("""
                WHERE p.product_id = ANY(%s)
                AND p.deleted_at IS NULL
            """),
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
    _log_impressions(user["user_id"], best, for_you, result.get("signals", {}))

    # How the text was read, so the shopper can see the limits the results follow
    understood = understand(body.text, engine.brands, types_named_in(body.text or "", set(engine.types)))
    return {"best_matches": best, "for_you": for_you, "understood": understood}