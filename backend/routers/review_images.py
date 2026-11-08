"""Find listing images before a product exists; never changes product/source data."""

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from auth import require_permission
from services.reviews.models import ReviewCandidate
from services.reviews.registry import get_provider

router = APIRouter(
    prefix="/api/admin/review-images", tags=["admin-products"],
    dependencies=[Depends(require_permission("create_products"))],
)


class ImageCandidates(BaseModel):
    candidates: list[ReviewCandidate]


@router.get("/candidates", response_model=ImageCandidates)
async def image_candidates(
    query: str = Query(min_length=1, max_length=200), source: str = "amazon",
):
    query = query.strip()
    if not query:
        raise HTTPException(422, "Enter a product name or listing ID")
    try:
        provider = get_provider(source.strip().lower())
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    return {"candidates": await provider.search_products(query)}
