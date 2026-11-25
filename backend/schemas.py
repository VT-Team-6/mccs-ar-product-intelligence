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
# Who a shoe is sized for (migration 024); shoes only
ProductFit = Literal["mens", "womens", "kids"]


class ProductCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    product_type: str = Field(min_length=1, max_length=100)
    brand: str | None = Field(default=None, max_length=100)
    description: str | None = None
    image_url: str | None = Field(default=None, max_length=500)
    # Decides which shopping criteria apply (categories.py)
    category: ProductCategory | None = None
    fit: ProductFit | None = None
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
    fit: ProductFit | None = None

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
    fit: str | None = None
    rating: float | None
    description: str | None
    image_url: str | None
    created_at: datetime
    updated_at: datetime
    # The store that added it, or None for an MCCS catalog product.
    created_by_store_id: int | None = None
    # resolved at runtime by the API layer, not stored in the database.
    store_inventory: StoreInventory | None = None


class ProductImage(BaseModel):
    """One extra photo of a product, shown alongside its featured image.

    image_url is sent back exactly as stored, so a relative /static/... path
    stays relative and the client resolves it against its API address.
    """

    image_id: int
    image_url: str
    # The color or size the photo shows (see variants.PHOTO_OPTION); None for all
    color: str | None = None
    size: str | None = None


class ProductImageCreate(BaseModel):
    """A gallery photo to add, by link. Uploads are a separate multipart route."""

    image_url: str = Field(min_length=1, max_length=500)
    color: str | None = Field(default=None, max_length=40)
    size: str | None = Field(default=None, max_length=20)

    _validate_image_url = field_validator("image_url")(validate_product_image_url)


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
    # The color it was liked in; image_url is then that color's first photo
    liked_color: str | None = None


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


class StaffStoreStockEntry(StoreStockEntry):
    """A store's stock as its staff see it: adds the low-stock level and buyer."""

    category: str | None = None
    low_stock_threshold: int
    low_stock: bool
    buyer_user_id: int | None
    buyer_email: str | None
    # How many colors/sizes it comes in, and how many are low
    variant_count: int = 1
    low_variant_count: int = 0
    # How many colors/sizes have their own low-stock level
    custom_level_count: int = 0


class StaffStoreStock(BaseModel):
    store_id: int
    name: str
    items: list[StaffStoreStockEntry]
    next_cursor: str | None


class StoreBuyer(BaseModel):
    user_id: int
    email: str


class LowStockSettings(BaseModel):
    """Set the low-stock level and/or buyer on many of a store's products at once.

    A field left out is not changed; clear_buyer removes the buyer.
    """

    store_id: int = Field(gt=0)
    product_ids: list[int] = Field(min_length=1, max_length=2000)
    low_stock_threshold: int | None = Field(default=None, ge=0, le=100_000)
    buyer_user_id: int | None = Field(default=None, gt=0)
    clear_buyer: bool = False

    @model_validator(mode="after")
    def _something_to_change(self):
        if self.low_stock_threshold is None and self.buyer_user_id is None and not self.clear_buyer:
            raise ValueError("Give a low-stock level or a buyer to change")
        if self.clear_buyer and self.buyer_user_id is not None:
            raise ValueError("Give a buyer or clear_buyer, not both")
        return self


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


class StockImport(BaseModel):
    """An edited stock CSV for one store, sent as text."""

    store_id: int = Field(gt=0)
    csv: str = Field(min_length=1, max_length=2_000_000)


class StockImportChange(BaseModel):
    product_id: int
    variant_id: int | None = None
    name: str
    color: str | None = None
    size: str | None = None
    brand: str | None
    old_quantity: int
    new_quantity: int


class StockImportProblem(BaseModel):
    row: int
    message: str


class StockImportResult(BaseModel):
    """What an import changes (preview) or changed (apply)."""

    store_id: int
    changes: list[StockImportChange]
    unchanged: int
    errors: list[StockImportProblem]
    # How many products this import takes to their low-stock level or below
    low_after: int = 0


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
    "store_clerk",
    "store_buyer",
    "store_admin",
    "system_admin",
]

AssignableStaffRole = Literal["store_clerk", "store_buyer", "store_admin"]

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


# --- Reorders ---------------------------------------------------------------

ReorderStatus = Literal["open", "requested", "ordered", "unavailable"]


class ReorderProduct(BaseModel):
    """A low product at a store, with its reorder status and latest order request."""

    alert_id: int
    product_id: int
    variant_id: int | None = None
    name: str
    color: str | None = None
    size: str | None = None
    brand: str | None
    quantity: int
    low_stock_threshold: int
    suggested_quantity: int
    status: ReorderStatus
    created_at: datetime
    buyer_user_id: int | None
    buyer_email: str | None
    request_id: int | None
    requested_quantity: int | None
    requested_from: str | None
    requested_at: datetime | None
    reason: str | None
    updated_at: datetime | None


class ReorderList(BaseModel):
    products: list[ReorderProduct]
    counts: dict[str, int]


class ReorderCatalogProduct(BaseModel):
    """A product on sale at a store, for the Reorders list (one row per product)."""

    product_id: int
    name: str
    brand: str | None
    category: str | None = None
    fit: str | None = None
    quantity: int
    low_stock_threshold: int
    variant_count: int
    low_count: int
    # Every reorder status any of its sizes has, most urgent first; status is the first
    statuses: list[ReorderStatus]
    status: ReorderStatus | None
    buyer_user_id: int | None
    buyer_email: str | None


class ReorderCatalog(BaseModel):
    products: list[ReorderCatalogProduct]
    # Products with each status, and "all"
    counts: dict[str, int]


class ReorderLine(BaseModel):
    """One size/color of a product, for the send screen."""

    product_id: int
    name: str
    brand: str | None
    category: str | None = None
    fit: str | None = None
    buyer_user_id: int | None
    buyer_email: str | None
    variant_id: int
    color: str | None
    color_hex: str | None
    size: str | None
    quantity: int
    low_stock_threshold: int
    low: bool
    alert_id: int | None
    status: ReorderStatus | None
    suggested_quantity: int
    # False while it's already requested or ordered
    sendable: bool


class ReorderGroup(BaseModel):
    """Products that can be sent to one buyer. buyer_user_id is None for products with no buyer."""

    buyer_user_id: int | None
    buyer_email: str | None
    items: list[ReorderProduct]


class OrderRequestSendItem(BaseModel):
    """A low product's alert_id, or any size/color by variant_id (to order ahead)."""

    alert_id: int | None = Field(default=None, gt=0)
    variant_id: int | None = Field(default=None, gt=0)
    quantity: int = Field(gt=0, le=100_000)

    @model_validator(mode="after")
    def _alert_or_variant(self):
        if (self.alert_id is None) == (self.variant_id is None):
            raise ValueError("Give an alert_id or a variant_id")
        return self


class OrderRequestSend(BaseModel):
    """Send some of a store's low products to one buyer as one order request."""

    store_id: int = Field(gt=0)
    buyer_user_id: int = Field(gt=0)
    items: list[OrderRequestSendItem] = Field(min_length=1, max_length=2000)
    note: str = Field(default="", max_length=2000)
    # Save this buyer on any of the products that have none
    remember_buyer: bool = False

    @field_validator("items")
    @classmethod
    def _each_alert_once(cls, items):
        keys = {(item.alert_id, item.variant_id) for item in items}
        if len(keys) != len(items):
            raise ValueError("A product is in the request twice")
        return items


class OrderRequestUpdate(BaseModel):
    """The buyer marks some of a request's items ordered or unavailable.

    alert_ids picks items one color/size at a time; product_ids (older
    clients) picks every color/size of those products.
    """

    product_ids: list[int] = Field(default_factory=list, max_length=2000)
    alert_ids: list[int] | None = Field(default=None, min_length=1, max_length=2000)
    status: Literal["ordered", "unavailable"]
    reason: str = Field(default="", max_length=500)


class OrderRequestReassign(BaseModel):
    buyer_user_id: int = Field(gt=0)
    model_config = ConfigDict(extra="forbid")


class OrderRequestReassignment(BaseModel):
    from_buyer_email: str | None
    to_buyer_email: str | None
    changed_by_email: str | None
    created_at: datetime


class OrderRequestSummary(BaseModel):
    pending: int
    ordered: int
    unavailable: int
    received: int
    finished: bool


class OrderRequestItem(BaseModel):
    alert_id: int
    product_id: int
    variant_id: int | None = None
    name: str
    color: str | None = None
    size: str | None = None
    brand: str | None
    quantity: int
    status: Literal["pending", "ordered", "unavailable"]
    reason: str
    updated_at: datetime | None
    current_quantity: int | None
    restocked: bool
    updated_by: int | None
    updated_by_email: str | None


class OrderRequest(BaseModel):
    request_id: int
    store_id: int
    store_name: str
    store_address: str
    buyer_user_id: int | None
    buyer_email: str | None
    sent_by_email: str | None
    note: str
    created_at: datetime
    message: str
    summary: OrderRequestSummary
    items: list[OrderRequestItem]
    needs_reassignment: bool
    reassignments: list[OrderRequestReassignment]


class OrderRequestListEntry(BaseModel):
    request_id: int
    store_id: int
    store_name: str
    sent_by_email: str | None
    buyer_email: str | None
    created_at: datetime
    unread: bool
    product_count: int
    summary: OrderRequestSummary
    needs_reassignment: bool


class BuyerItem(OrderRequestItem):
    """A product in one of the buyer's order requests, for the By product view."""

    request_id: int
    store_name: str
    requested_at: datetime


class Message(BaseModel):
    message_id: int
    kind: Literal["low_stock", "order_request", "order_update"]
    subject: str
    body: str
    store_id: int | None
    request_id: int | None
    created_at: datetime
    read: bool


class MessageList(BaseModel):
    messages: list[Message]
    unread: int
    # Unread notifications per store id, for managers of several stores
    unread_by_store: dict[int, int] = {}


class MarkRead(BaseModel):
    """Which notifications to mark read; with nothing given, all of them."""

    message_ids: list[int] | None = None
    request_id: int | None = None
    store_id: int | None = None


# --- Recent searches -----------------------------------------------------------


class RecentSearch(BaseModel):
    search_id: int
    query: str
    searched_at: datetime


class RecentSearchCreate(BaseModel):
    query: str = Field(min_length=1, max_length=200)


# --- colors and sizes (variants.py) ------------------------------------------


class Variant(BaseModel):
    """One color/size of a product. Stock fields are for the store asked about."""

    variant_id: int
    product_id: int
    color: str | None
    color_hex: str | None
    # Second swatch color of a two-tone colorway
    color_hex_2: str | None = None
    size: str | None
    sku: str
    quantity: int | None = None
    price: Decimal | None = None
    in_stock: bool = False


class StoreVariant(Variant):
    """A variant on the staff inventory screen."""

    label: str
    low_stock: bool
    # The level this color/size uses, and its own level (None = the product's)
    low_stock_threshold: int
    own_low_stock_threshold: int | None = None
    # selling ("active") or discontinued at this store
    status: Literal["active", "discontinued"] = "active"


class VariantColor(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    hex: str | None = Field(default=None, max_length=7)
    # A second swatch color for a two-tone colorway ("White/Black")
    hex2: str | None = Field(default=None, max_length=7)


class VariantCombination(BaseModel):
    color: str | None = None
    size: str | None = None


class VariantOptions(BaseModel):
    """A product's colors and sizes, in display order.

    Every color comes in every size except the combinations in skip.
    """

    colors: list[VariantColor] = Field(default_factory=list, max_length=12)
    sizes: list[str] = Field(default_factory=list, max_length=30)
    skip: list[VariantCombination] = Field(default_factory=list, max_length=400)


class VariantLowStockLevel(BaseModel):
    variant_id: int = Field(gt=0)
    # None clears its own level so it uses the product's again
    low_stock_threshold: int | None = Field(default=None, ge=0, le=100_000)


class VariantLowStockLevels(BaseModel):
    """A product's low-stock level and each color/size's own level at a store.

    low_stock_threshold left out keeps the product's level; levels lists only
    the colors/sizes being changed.
    """

    low_stock_threshold: int | None = Field(default=None, ge=0, le=100_000)
    levels: list[VariantLowStockLevel] = Field(default_factory=list, max_length=500)


class VariantStatusWrite(BaseModel):
    """Discontinue (or sell again) some of a product's colors/sizes at a store."""

    variant_ids: list[int] = Field(min_length=1, max_length=500)
    status: Literal["active", "discontinued"]


class VariantStockWrite(BaseModel):
    """Set one color/size's stock and/or price at a store."""

    quantity: int | None = Field(default=None, ge=0)
    price: Decimal | None = Field(default=None, ge=0)


class ImageOptionUpdate(BaseModel):
    """Which color or size a photo shows; both None makes it shared."""

    color: str | None = Field(default=None, max_length=40)
    size: str | None = Field(default=None, max_length=20)
