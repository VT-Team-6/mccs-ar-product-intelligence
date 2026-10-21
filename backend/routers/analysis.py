from fastapi import APIRouter, HTTPException
from database import get_product
from review_analysis import analyze_product_reviews
from openai import OpenAIError

router = APIRouter(
    prefix="/api/products",
    tags=["analysis"]
)

@router.get("/{product_id}/analysis")
def get_product_analysis(product_id: int):

    # Check whether product exists
    if get_product(product_id) is None:
        raise HTTPException(
            status_code=404,
            detail="Product not found"
        )

    try:
        result = analyze_product_reviews(product_id)
        return result

    except OpenAIError:
        raise HTTPException(
            status_code=503,
            detail="AI analysis service is currently unavailable"
        )

    except ValueError:
        raise HTTPException(
            status_code=502,
            detail="AI analysis returned an invalid response"
        )