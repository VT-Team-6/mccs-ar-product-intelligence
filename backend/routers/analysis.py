from fastapi import APIRouter, HTTPException, status
from database import get_connection
from review_analysis import analyze_product_reviews
from openai import OpenAIError

router = APIRouter(tags=["analysis"])

@router.get("/api/products/{product_id}/analysis")
def get_product_analysis(product_id: int):

    with get_connection() as conn:
        product = conn.execute(
            "SELECT 1 FROM products WHERE product_id = %s",
            (product_id,),
        ).fetchone()
    
    if product is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Product not found",
        )

    try:
        return analyze_product_reviews(product_id)

    except OpenAIError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI analysis is temporarily unavailable",
        ) from exc

    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="AI analysis returned an invalid response",
        ) from exc