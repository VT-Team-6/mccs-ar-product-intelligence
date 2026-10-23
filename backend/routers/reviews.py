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
                r.review_id,
                r.product_id,
                r.rating,
                prs.source,
                r.source_review_id,
                r.title,
                r.body,
                r.review_date,
                r.fetched_at
            FROM reviews r
            JOIN product_review_sources prs
                ON r.review_source_id = prs.review_source_id
            WHERE r.product_id = %s
            ORDER BY r.review_date DESC
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


# Admin review-source management and import routes
from datetime import datetime

from fastapi import Depends, Query
from pydantic import BaseModel, Field

from auth import require_admin
from services.reviews.importer import ReviewImporter
from services.reviews.models import ReviewCandidate
from services.reviews.registry import get_provider


admin_router = APIRouter(
    prefix="/api/admin/products",
    tags=["admin-reviews"],
    dependencies=[Depends(require_admin)],
)
review_importer = ReviewImporter()


class CandidateResults(BaseModel):
    candidates: list[ReviewCandidate]


class SavedReviewSource(BaseModel):
    review_source_id: int
    source: str
    source_product_id: str
    source_url: str | None = None
    last_fetched_at: datetime | None = None


class SourceResults(BaseModel):
    sources: list[SavedReviewSource]


class ReviewSourceSelection(BaseModel):
    source: str = Field(min_length=1, max_length=50)
    source_product_ids: list[str] = Field(default_factory=list, max_length=20)


class ImportResults(BaseModel):
    product_id: int
    source_count: int
    available_reviews: int
    imported_reviews: int


def _get_review_product(conn, product_id: int):
    product = conn.execute(
        "SELECT product_id, name FROM products WHERE product_id = %s",
        (product_id,),
    ).fetchone()
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    return product


def _get_review_provider(source: str):
    try:
        return get_provider(source)
    except (KeyError, ValueError):
        raise HTTPException(
            status_code=400, detail=f"Unsupported review source: {source}"
        ) from None


def _approved_review_sources(conn, product_id: int, source: str | None = None):
    sql = """
        SELECT review_source_id, source, source_product_id,
               source_url, last_fetched_at
        FROM product_review_sources
        WHERE product_id = %s AND source_product_id IS NOT NULL
    """
    params = [product_id]
    if source is not None:
        sql += " AND source = %s"
        params.append(source)
    sql += " ORDER BY review_source_id"
    return conn.execute(sql, params).fetchall()


@admin_router.get("/{product_id}/review-candidates", response_model=CandidateResults)
async def get_review_candidates(
    product_id: int,
    source: str = "amazon",
    query: str | None = Query(default=None, max_length=200),
):
    provider = _get_review_provider(source.strip().lower())
    with get_connection() as conn:
        product = _get_review_product(conn, product_id)

    # Default to the app product name; let the admin refine the search.
    search_query = (query or "").strip() or product["name"]
    return {"candidates": await provider.search_products(search_query)}


@admin_router.get("/{product_id}/review-sources", response_model=SourceResults)
def get_product_review_sources(product_id: int, source: str | None = None):
    with get_connection() as conn:
        _get_review_product(conn, product_id)
        rows = _approved_review_sources(conn, product_id, source)
    return {"sources": rows}


@admin_router.put("/{product_id}/review-sources", response_model=SourceResults)
async def set_product_review_sources(product_id: int, selection: ReviewSourceSelection):
    source = selection.source.strip().lower()
    provider = _get_review_provider(source)
    ids = [item.strip() for item in selection.source_product_ids]
    if any(not item for item in ids) or len(ids) != len(set(ids)):
        raise HTTPException(status_code=422, detail="Listing IDs must be unique and nonempty")

    # For the dataset provider, an ASIN is valid only if archived reviews exist.
    for source_product_id in ids:
        if not await provider.get_reviews(source_product_id):
            raise HTTPException(
                status_code=422,
                detail=f"No available reviews for {source} listing {source_product_id}",
            )

    with get_connection() as conn:
        _get_review_product(conn, product_id)

        # Replace selections for this provider only. Other providers stay intact.
        conn.execute(
            """
            DELETE FROM product_review_sources
            WHERE product_id = %s AND source = %s
              AND source_product_id IS NOT NULL
              AND NOT (source_product_id = ANY(%s::text[]))
            """,
            (product_id, source, ids),
        )
        for source_product_id in ids:
            url = (
                f"https://www.amazon.com/dp/{source_product_id}"
                if source == "amazon" else None
            )
            conn.execute(
                """
                INSERT INTO product_review_sources
                    (product_id, source, source_product_id, source_url)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (product_id, source, source_product_id)
                DO NOTHING
                """,
                (product_id, source, source_product_id, url),
            )
        rows = _approved_review_sources(conn, product_id, source)
    return {"sources": rows}


@admin_router.post("/{product_id}/import-reviews", response_model=ImportResults)
async def import_product_reviews(product_id: int):
    with get_connection() as conn:
        _get_review_product(conn, product_id)
        try:
            result = await review_importer.import_product_reviews(conn, product_id)
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
    return result
