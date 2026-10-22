from datetime import datetime
from pydantic import BaseModel, Field

# this file defines the structure of data that the providers will return 

class ReviewCandidate(BaseModel):
    source_product_id: str
    title: str
    description: str | None = None
    url: str | None = None
    review_count: int | None = None

class ReviewData(BaseModel):
    source_review_id: str | None = None
    rating: float | None = Field(
        default=None, ge=0, le=5
    )
    title: str | None = None
    body: str
    review_date: datetime | None = None