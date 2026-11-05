"""Product comparison using the recommendation engine."""

from fastapi import APIRouter, Depends, HTTPException
from psycopg import sql
from pydantic import BaseModel, field_validator

import auth
import store_selection
from database import get_connection
from ranking import get_engine
from routers.products import product_select

router = APIRouter(prefix="/api/compare", tags=["compare"])


class ComparisonRequest(BaseModel):
    product_ids: list[int]
    text: str | None = None
    ranks: dict[str, int] | None = None

    @field_validator("product_ids")
    @classmethod
    def validate_ids(cls, ids: list[int]) -> list[int]:
        if not 2 <= len(ids) <= 4:
            raise ValueError("Select between 2 and 4 products.")
        if any(isinstance(pid, bool) or pid <= 0 for pid in ids):
            raise ValueError("Product IDs must be positive.")
        if len(set(ids)) != len(ids):
            raise ValueError("Products cannot be selected twice.")
        return ids


@router.post("")
def get_comparison(
    body: ComparisonRequest,
    user=Depends(auth.require_authenticated_user),
):
    product_ids = body.product_ids

    # Product details priced at the shopper's chosen store, plus review counts
    with get_connection() as conn:
        store_id = store_selection.resolve_store_id(conn, user["user_id"], None)
        rows = conn.execute(
            product_select(store_id)
            + sql.SQL(" WHERE p.product_id = ANY(%s) AND p.deleted_at IS NULL"),
            (product_ids,),
        ).fetchall()
        review_counts = {
            r["product_id"]: r["review_count"]
            for r in conn.execute(
                "SELECT product_id, review_count FROM product_review_stats WHERE product_id = ANY(%s)",
                (product_ids,),
            ).fetchall()
        }

    products_by_id = {row["product_id"]: row for row in rows}

    # Products that still exist and that the engine knows about
    engine = get_engine()
    valid_ids = [pid for pid in product_ids if pid in products_by_id and pid in engine.index]
    missing = [pid for pid in product_ids if pid not in valid_ids]

    # Pros, cons, notes and best-for-you from the recommendation engine
    comparison = {"products": [], "best_for_you": None}
    if len(valid_ids) >= 2:
        try:
            comparison = engine.compare(product_ids=valid_ids, text=body.text, ranks=body.ranks)
        except (KeyError, ValueError) as error:
            raise HTTPException(status_code=400, detail=str(error)) from error

    insights_by_id = {item["product_id"]: item for item in comparison["products"]}

    # In the order the shopper picked them
    items = []
    for product_id in valid_ids:
        insights = insights_by_id.get(product_id, {})
        items.append({
            "product": dict(products_by_id[product_id]),
            "review_count": review_counts.get(product_id, 0),
            "pros": insights.get("pros", []),
            "cons": insights.get("cons", []),
            "notes": insights.get("notes", []),
        })

    return {
        "items": items,
        "missing": missing,
        "best_for_you": comparison["best_for_you"],
    }