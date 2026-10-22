from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ProductCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    product_type: str = Field(min_length=1, max_length=100)
    brand: str | None = Field(default=None, max_length=100)
    price: float | None = Field(default=None, ge=0)
    rating: float | None = Field(default=None, ge=0, le=5)
    description: str | None = None
    image_url: str | None = Field(default=None, max_length=500)


class ProductUpdate(BaseModel):
    """Partial update: omitted fields keep their current value."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    product_type: str | None = Field(default=None, min_length=1, max_length=100)
    brand: str | None = Field(default=None, max_length=100)
    price: float | None = Field(default=None, ge=0)
    rating: float | None = Field(default=None, ge=0, le=5)
    description: str | None = None
    image_url: str | None = Field(default=None, max_length=500)


class Product(BaseModel):
    product_id: int
    name: str
    brand: str | None
    price: float | None
    product_type: str
    rating: float | None
    description: str | None
    image_url: str | None
    created_at: datetime
    updated_at: datetime


# --- Shopper screens (likes and history) ---------------------------------


class MyProduct(Product):
    """A product seen by a signed-in shopper, with their current like state."""

    is_liked: bool


class LikedProduct(Product):
    """A product in the user's Likes tab, with when they liked it."""

    liked_at: datetime


class LikedProductPage(BaseModel):
    items: list[LikedProduct]
    next_cursor: str | None


class HistoryItem(BaseModel):
    """One interaction event. The same product can appear more than once."""

    history_id: int
    interaction: str
    occurred_at: datetime
    product: MyProduct


class HistoryPage(BaseModel):
    items: list[HistoryItem]
    next_cursor: str | None


# Interactions the client is allowed to report. 'liked'/'unliked' are written
# by the server when the like state actually changes, so they are not listed.
ClientInteraction = Literal["scanned", "viewed", "viewed-from-search"]

class InteractionCreate(BaseModel):
    product_id: int
    interaction: ClientInteraction



class Review(BaseModel):
    review_id: int
    product_id: int
    rating: float | None
    source: str
    source_review_id: str | None
    title: str | None
    body: str
    review_date: datetime | None
    fetched_at: datetime

class ReviewShortened(BaseModel):
    rating: float | None
    title: str | None
    body: str
    review_date: datetime | None

class ReviewAggregate(BaseModel):
    review_count: int
    average_rating: float | None
    rating_distribution: dict[str, int]
    reviews: list[ReviewShortened]

class Preferences(BaseModel):
    """Each criterion's rank: 1 = matters most, 2 = next, ..., 0 = not ranked."""

    # Reject unknown criteria so a typo can't be silently ignored
    model_config = ConfigDict(extra="forbid")

    price: int = Field(default=0, ge=0, le=6)
    rating: int = Field(default=0, ge=0, le=6)
    brand: int = Field(default=0, ge=0, le=6)
    quality: int = Field(default=0, ge=0, le=6)
    durability: int = Field(default=0, ge=0, le=6)
    comfort: int = Field(default=0, ge=0, le=6)

    @model_validator(mode="after")
    def ranks_are_1_2_3_in_order(self):
        """Ranked criteria must be numbered 1, 2, 3, ... with no repeats or gaps."""
        ranks = sorted(rank for rank in self.model_dump().values() if rank > 0)
        if ranks != list(range(1, len(ranks) + 1)):
            raise ValueError("Ranks must be 1, 2, 3, ... with no repeats or gaps")
        return self


# Recommendations 
class RecommendationRequest(BaseModel):
    """What the shopper asked for: the product on screen and/or typed text,
    plus what matters to them right now (a ranking, same rules as Preferences)."""

    model_config = ConfigDict(extra="forbid")

    product_id: int | None = None
    text: str | None = Field(default=None, max_length=200)
    ranking: Preferences = Field(default_factory=Preferences)

    @model_validator(mode="after")
    def needs_a_product_or_text(self):
        if self.product_id is None and not (self.text or "").strip():
            raise ValueError("Give a product_id, some text, or both")
        return self


class Recommendation(BaseModel):
    product: Product
    score: float
    reasons: list[str]


class RecommendationResponse(BaseModel):
    best_matches: list[Recommendation]
    for_you: Recommendation | None