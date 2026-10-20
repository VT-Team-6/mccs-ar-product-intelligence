from fastapi import APIRouter, HTTPException, status
from database import get_connection
from schemas import Review, ReviewAggregate, ReviewShortened

router = APIRouter(prefix="/api/products/{product_id}/reviews", tags=["reviews"])

@router.get("", response_model=list[Review])
def get_reviews(product_id: int):
    if not product_exists(product_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Product not found",
        )

    with get_connection() as conn:
        reviews = conn.execute(
            """
            SELECT
                review_id,
                product_id,
                rating,
                source,
                source_review_id,
                title,
                body,
                review_date,
                fetched_at
            FROM reviews
            WHERE product_id = %s
            ORDER BY review_date DESC
            """,
            (product_id,),
        ).fetchall()
    return reviews

@router.get("/aggregate", response_model=ReviewAggregate)
def get_aggregated_reviews(product_id: int):
    if not product_exists(product_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Product not found",
        )

    with get_connection() as conn:
        reviews = conn.execute(
            """
            SELECT *
            FROM reviews
            WHERE product_id = %s
            """,
            (product_id,),
        ).fetchall()
    return aggregate_reviews(reviews)

def aggregate_reviews(reviews: list[dict]) -> ReviewAggregate:
    ratings = [float(review["rating"]) for review in reviews if review["rating"] is not None]
    average_rating = (sum(ratings) / len(ratings)) if ratings else None

    rating_distribution = {}

    for rating in ratings:
        key = str(rating)
        rating_distribution[key] = rating_distribution.get(key, 0) + 1

    analysis_reviews = [
        ReviewShortened(
            rating=review["rating"],
            title=review["title"],
            body=review["body"],
            review_date=review["review_date"]
        )
        for review in reviews]

    return  ReviewAggregate(
        review_count=len(reviews),
        average_rating=average_rating,
        rating_distribution=rating_distribution,
        reviews=analysis_reviews
    )

def product_exists(product_id: int) -> bool:
    with get_connection() as conn:
        product = conn.execute(
            """
            SELECT 1
            FROM products
            WHERE product_id = %s
            """,
            (product_id,),
        ).fetchone()

    return product is not None