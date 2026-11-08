from datetime import datetime
from decimal import Decimal
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def validate_product_image_url(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    value = value.strip()
    if any(char.isspace() for char in value):
        raise ValueError("Image URL cannot contain spaces")
    if value.startswith("/static/"):
        return value
    try:
        parsed = urlsplit(value)
        valid = parsed.scheme.lower() in {"http", "https"} and bool(parsed.hostname)
    except ValueError:
        valid = False
    if not valid:
        raise ValueError("Use a direct HTTP or HTTPS image URL")
    return value


# Must match CATEGORIES in categories.py and the CHECK in migration 013
ProductCategory = Literal["shoes", "backpacks", "headphones", "shampoo", "coffee"]


class ProductCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    product_type: str = Field(min_length=1, max_length=100)
    brand: str | None = Field(default=None, max_length=100)
    description: str | None = None
    image_url: str | None = Field(default=None, max_length=500)
    # Decides which shopping criteria apply (categories.py)
    category: ProductCategory | None = None
    # The store adding the product: it owns it, and the product starts pending
    # there. Required for store admins; the app admin can leave it out to add
    # an MCCS catalog product with no owner.
    store_id: int | None = Field(default=None, gt=0)

    _validate_image_url = field_validator("image_url")(validate_product_image_url)


class ProductUpdate(BaseModel):
    """Partial update: omitted fields keep their current value."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    product_type: str | None = Field(default=None, min_length=1, max_length=100)
    brand: str | None = Field(default=None, max_length=100)
    description: str | None = None
    image_url: str | None = Field(default=None, max_length=500)
    category: ProductCategory | None = None

    _validate_image_url = field_validator("image_url")(validate_product_image_url)


# Lifecycle of a product at one store. Only 'active' is visible to shoppers.
InventoryStatus = Literal["pending", "active", "discontinued"]


class StoreInventory(BaseModel):
    """Price and stock at one store. Null when the store has no row for the
    product — a different thing from "no store selected", which the client
    distinguishes from its own state."""

    store_id: int
    price: float | None
    quantity: int
    in_stock: bool
    # 'discontinued' lets the client show its discontinued screen; a 'pending'
    # entry never reaches a shopper, so it is never reported here.
    status: InventoryStatus = "active"


class Product(BaseModel):
    product_id: int
    name: str
    brand: str | None
    product_type: str
    category: str | None = None
    rating: float | None
    description: str | None
    image_url: str | None
    created_at: datetime
    updated_at: datetime
    # The store that added it, or None for an MCCS catalog product.
    created_by_store_id: int | None = None
    # resolved at runtime by the API layer, not stored in the database.
    store_inventory: StoreInventory | None = None


class Store(BaseModel):
    """A location the shopper can pick. Public catalog data."""

    store_id: int
    name: str
    address: str
    latitude: float | None
    longitude: float | None


class StoreSelection(BaseModel):
    """The shopper's active store: null means "no store selected"."""

    store_id: int | None


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
    """One interaction event. The same product can appear more than once.
    Records the store and price at the time of the interaction, can differ 
    from user's current store selection and the product's current price.
    """

    history_id: int
    interaction: str
    occurred_at: datetime
    store_id: int | None
    store_name: str | None
    price_at_interaction: float | None
    product: MyProduct


class HistoryPage(BaseModel):
    items: list[HistoryItem]
    next_cursor: str | None


# Interactions the client is allowed to report. 'liked'/'unliked' are written
# by the server when the like state actually changes, so they are not listed.
ClientInteraction = Literal["scanned", "viewed", "viewed-from-search", "viewed-from-recommendation"]

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


class UnderstoodRequest(BaseModel):
    """How the typed text was read: limits and requirements the results follow."""

    min_price: float | None
    max_price: float | None
    brands: list[str]
    product_types: list[str]
    requirements: list[str]


class RecommendationResponse(BaseModel):
    best_matches: list[Recommendation]
    for_you: Recommendation | None
    # Only when text was sent. Lets the app show "Under $150 · Waterproof"
    understood: UnderstoodRequest | None = None


# --- Inventory ------------------------------------------------------------


class InventoryRecord(BaseModel):
    """One product's stock at one store, as the API writes and reports it."""

    product_id: int
    store_id: int
    quantity: int
    price: float | None
    in_stock: bool
    status: InventoryStatus
    updated_at: datetime


class ProductStockEntry(InventoryRecord):
    """Where else a product is on sale: the store, its address, and the stock."""

    store_name: str
    address: str
    # Nullable: a store may not have coordinates yet. The client sorts the
    # stores it can place and leaves the rest in catalog order.
    latitude: float | None = None
    longitude: float | None = None


class ProductStock(BaseModel):
    product_id: int
    name: str
    stores: list[ProductStockEntry]


class StoreStockEntry(InventoryRecord):
    """What a store sells: the product's name, brand and photo, and its stock there."""

    product_name: str
    brand: str | None
    image_url: str | None = None


class StoreStock(BaseModel):
    store_id: int
    name: str
    items: list[StoreStockEntry]
    next_cursor: str | None


class InventoryWrite(BaseModel):
    """Replace stock for one product+store. Omitted fields keep their value.

    price is a Decimal rather than a float so a value like 9.999 is
    rejected instead of silently rounding to the column's two decimals.
    """

    quantity: int | None = Field(default=None, ge=0)
    price: Decimal | None = Field(
        default=None, ge=0, max_digits=10, decimal_places=2
    )
    status: InventoryStatus | None = None

    @model_validator(mode="after")
    def needs_a_change(self):
        if self.quantity is None and self.price is None and self.status is None:
            raise ValueError("Give a quantity, a price, or a status")
        return self


class InventoryBatchEntry(InventoryWrite):
    product_id: int = Field(gt=0)
    store_id: int = Field(gt=0)


class InventoryBatch(BaseModel):
    """Many product+store rows applied together, or not at all."""

    items: list[InventoryBatchEntry] = Field(min_length=1, max_length=500)

    @model_validator(mode="after")
    def no_duplicate_pairs(self):
        seen = set()
        for entry in self.items:
            pair = (entry.product_id, entry.store_id)
            if pair in seen:
                raise ValueError(
                    f"Product {pair[0]} at store {pair[1]} appears more than once"
                )
            seen.add(pair)
        return self


class InventoryPush(BaseModel):
    """Push catalog products to stores; each becomes a pending entry."""

    product_ids: list[int] = Field(min_length=1, max_length=200)
    store_ids: list[int] = Field(min_length=1, max_length=200)


class InventoryApproval(BaseModel):
    """Approve a pending entry, supplying whatever the store still needs."""

    quantity: int | None = Field(default=None, ge=0)
    price: Decimal | None = Field(
        default=None, ge=0, max_digits=10, decimal_places=2
    )


class PushedEntry(BaseModel):
    """One product+store pair after a push, including whether it already had
    an entry (in which case nothing was changed)."""

    product_id: int
    store_id: int
    quantity: int
    price: float | None
    in_stock: bool
    status: InventoryStatus
    updated_at: datetime
    already_present: bool
      
      
# --- Staff management -----------------------------------------------------


UserRole = Literal[
    "user",
    "store_buyer",
    "store_admin",
    "system_admin",
]

AssignableStaffRole = Literal["store_buyer", "store_admin"]

class StaffAccessUpdate(BaseModel):
    role: AssignableStaffRole
    model_config = {"extra": "forbid"}

class StaffUser(BaseModel):
    user_id: int
    email: str
    role: UserRole


class StaffAssignment(BaseModel):
    user_id: int
    email: str
    store_id: int
    role: AssignableStaffRole


class StaffAssignmentResults(BaseModel):
    assignments: list[StaffAssignment]
    limit: int
    offset: int

class StaffUserResults(BaseModel):
    users: list[StaffUser]
    limit: int
    offset: int

class StaffStore(BaseModel):
    store_id: int
    name: str
    address: str
    allowed_roles: list[AssignableStaffRole]

class StaffOptions(BaseModel):
    stores: list[StaffStore]
