"""Product comparison using the recommendation engine."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator

import auth
from database import get_connection
from ranking import get_engine

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

        if any(
            isinstance(pid, bool) or pid <= 0
            for pid in ids
        ):
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

    # Retrieve product details and review counts.
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT
                p.product_id,
                p.name,
                p.brand,
                p.product_type,
                p.price,
                s.average_rating AS rating,
                p.description,
                p.image_url,
                p.created_at,
                p.updated_at,
                COALESCE(s.review_count, 0) AS review_count
            FROM products p
            LEFT JOIN product_review_stats s
                ON p.product_id = s.product_id
            WHERE p.product_id = ANY(%s)
              AND p.deleted_at IS NULL
            """,
            (product_ids,),
        ).fetchall()

    products_by_id = {
        row["product_id"]: row
        for row in rows
    }

    # Find products that are available for comparison.
    engine = get_engine()

    valid_ids = [
        pid
        for pid in product_ids
        if pid in products_by_id and pid in engine.index
    ]

    missing = [
        pid for pid in product_ids
        if pid not in valid_ids
    ]

    # Use the existing recommendation engine.
    comparison = {
        "products": [],
        "best_for_you": None,
    }

    if len(valid_ids) >= 2:
        try:
            comparison = engine.compare(
                product_ids=valid_ids,
                text=body.text,
                ranks=body.ranks,
            )
        except (KeyError, ValueError) as error:
            raise HTTPException(
                status_code=400,
                detail=str(error),
            ) from error

    # Match engine insights to product IDs.
    insights_by_id = {
        item["product_id"]: item
        for item in comparison["products"]
    }

    # Assemble the response in selection order.
    items = []

    for product_id in valid_ids:
        row = products_by_id[product_id]

        product = {
            key: value
            for key, value in row.items()
            if key != "review_count"
        }

        insights = insights_by_id.get(product_id, {})

        items.append({
            "product": product,
            "review_count": row["review_count"],
            "pros": insights.get("pros", []),
            "cons": insights.get("cons", []),
            "notes": insights.get("notes", []),
        })

    return {
        "items": items,
        "missing": missing,
        "best_for_you": comparison["best_for_you"],
    }
