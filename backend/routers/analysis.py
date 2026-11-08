import logging

from fastapi import APIRouter, HTTPException, status, Depends
from database import get_connection
from openai import OpenAIError
from starlette.concurrency import run_in_threadpool
from auth import require_authenticated_user, require_permission

from services.product_analysis_cache import (
    get_saved_analysis,
    refresh_product_analysis,
    mark_analysis_stale,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["analysis"])

@router.get("/api/products/{product_id}/analysis")
def get_product_analysis(product_id: int, user=Depends(require_authenticated_user)):

    with get_connection() as conn:
        product = conn.execute(
            "SELECT 1 FROM products WHERE product_id = %s AND deleted_at IS NULL",
            (product_id,),
        ).fetchone()
    
    if product is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Product not found",
        )

    return get_saved_analysis(product_id)

@router.post("/api/admin/products/{product_id}/generate-analysis")
async def generate_product_analysis(
    product_id: int,
    user=Depends(require_permission("manage_products")),
):
    with get_connection() as conn:
        product = conn.execute(
            """
            SELECT 1 FROM products
            WHERE product_id = %s AND deleted_at IS NULL
            """,
            (product_id,),
        ).fetchone()

    if product is None:
        raise HTTPException(
            status_code=404,
            detail="Product not found",
        )

    try:
        result = await run_in_threadpool(
            refresh_product_analysis,
            product_id,
            True,
        )
        return {
            **result,
            "analysis": get_saved_analysis(product_id),
        }

    except OpenAIError as exc:
        mark_analysis_stale(product_id)
        logger.exception("ARC failed for product %s", product_id)
        raise HTTPException(
            status_code=503,
            detail="AI analysis is temporarily unavailable",
        ) from exc

    except (ValueError, RuntimeError) as exc:
        mark_analysis_stale(product_id)
        raise HTTPException(
            status_code=502,
            detail=str(exc),
        ) from exc