"""Colors and sizes (see variants.py).

* public_router     - a product's colors/sizes with stock at a store, for the product page
* admin_router      - set a product's colors and sizes (product owners)
* inventory_router  - each color/size's stock, price and low-stock level at a store (store staff)
"""

from fastapi import APIRouter, Depends, HTTPException, Query

import auth
import low_stock
import reorders
import stock
import store_selection
import variants
from auth import require_permission
from database import get_connection
from product_access import can_manage_store, require_product_owner
from schemas import (
    StoreVariant,
    Variant,
    VariantLowStockLevels,
    VariantOptions,
    VariantStatusWrite,
    VariantStockWrite,
)

public_router = APIRouter(prefix="/api/products", tags=["variants"])
admin_router = APIRouter(prefix="/api/admin/products", tags=["admin-variants"])
inventory_router = APIRouter(prefix="/api/admin/inventory", tags=["admin-variant-stock"])


def _http_error(error: stock.InventoryError) -> HTTPException:
    return HTTPException(status_code=error.status, detail=error.detail)


def _require_product(conn, product_id: int) -> dict:
    row = conn.execute(
        "SELECT product_id, category FROM products WHERE product_id = %s AND deleted_at IS NULL",
        (product_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(404, f"Product {product_id} not found")
    return row


@public_router.get("/{product_id}/variants", response_model=list[Variant])
def read_variants(
    product_id: int,
    store_id: int | None = Query(default=None),
    user=Depends(auth.optional_user),
) -> list[dict]:
    """The product's colors and sizes, with price and stock at the shopper's store.

    The store is resolved the same way as the product itself: a signed-in
    shopper's saved store, or ?store_id=. A product with no options returns
    its single default variant.
    """
    with get_connection() as conn:
        _require_product(conn, product_id)
        resolved = store_selection.resolve_store_id(conn, user["user_id"] if user else None, store_id)
        # Colors/sizes the store discontinued aren't offered to shoppers
        rows = [
            row for row in variants.list_variants(conn, product_id, resolved)
            if row.get("store_status", "active") == "active"
        ]
        # Shoppers never see a price for a product the store hasn't approved
        if resolved is not None:
            status = conn.execute(
                "SELECT status FROM inventory WHERE product_id = %s AND store_id = %s",
                (product_id, resolved),
            ).fetchone()
            if status is None or status["status"] != "active":
                for row in rows:
                    row["quantity"], row["price"], row["in_stock"] = None, None, False
        return rows


@admin_router.get("/{product_id}/variants", response_model=list[Variant])
def read_variants_for_admin(
    product_id: int,
    user=Depends(require_permission("create_products")),
) -> list[dict]:
    with get_connection() as conn:
        require_product_owner(conn, user, product_id)
        return variants.list_variants(conn, product_id)


@admin_router.put("/{product_id}/variants", response_model=list[Variant])
def set_variants(
    product_id: int,
    body: VariantOptions,
    user=Depends(require_permission("create_products")),
) -> list[dict]:
    """Replace the product's colors and sizes.

    Combinations that stay keep their stock; removed ones lose theirs. Stores
    that carry the product get the new combinations at 0 stock and the
    product's current price there.
    """
    with get_connection() as conn:
        require_product_owner(conn, user, product_id)
        product = _require_product(conn, product_id)
        try:
            rows = variants.set_options(
                conn,
                product_id,
                product["category"],
                [color.model_dump() for color in body.colors],
                body.sizes,
                [combination.model_dump() for combination in body.skip],
            )
        except stock.InventoryError as error:
            raise _http_error(error) from error
        # New sizes start at 0, which can be below the low-stock level
        for store in conn.execute(
            "SELECT store_id FROM inventory WHERE product_id = %s", (product_id,)
        ).fetchall():
            reorders.check_stock(conn, store["store_id"], [product_id])
        return rows


@inventory_router.get("/{store_id}/products/{product_id}/variants", response_model=list[StoreVariant])
def read_store_variants(
    store_id: int,
    product_id: int,
    user=Depends(require_permission("view_inventory")),
) -> list[dict]:
    """Each color/size's stock and price at the store, with low-stock flags."""
    if not can_manage_store(user, store_id):
        raise HTTPException(403, "You don't manage this store")
    with get_connection() as conn:
        try:
            return variants.store_variants(conn, store_id, product_id)
        except stock.InventoryError as error:
            raise _http_error(error) from error


@inventory_router.put("/variants/{variant_id}/{store_id}", response_model=StoreVariant)
def write_variant_stock(
    variant_id: int,
    store_id: int,
    body: VariantStockWrite,
    user=Depends(require_permission("manage_stock")),
) -> dict:
    """Set one color/size's stock and/or price at a store.

    Clerks count stock on active products; prices need an inventory manager.
    """
    if not can_manage_store(user, store_id):
        raise HTTPException(403, "You don't manage this store")
    if body.price is not None and "manage_inventory" not in user["permissions"]:
        raise HTTPException(403, "Only inventory managers can change prices")
    with get_connection() as conn:
        variant = variants.get_variant(conn, variant_id)
        if variant is None:
            raise HTTPException(404, f"Variant {variant_id} not found")
        if "manage_inventory" not in user["permissions"]:
            entry = conn.execute(
                "SELECT status FROM inventory WHERE product_id = %s AND store_id = %s",
                (variant["product_id"], store_id),
            ).fetchone()
            if entry is None or entry["status"] != "active":
                raise HTTPException(403, "Stock counts can only be updated for active inventory")
        try:
            variants.set_stock(
                conn, variant_id, store_id, body.quantity, body.price, user["user_id"]
            )
            reorders.check_stock(conn, store_id, [variant["product_id"]])
            rows = variants.store_variants(conn, store_id, variant["product_id"])
        except stock.InventoryError as error:
            raise _http_error(error) from error
        return next(row for row in rows if row["variant_id"] == variant_id)


@inventory_router.put("/{store_id}/products/{product_id}/low-stock-levels", response_model=list[StoreVariant])
def write_low_stock_levels(
    store_id: int,
    product_id: int,
    body: VariantLowStockLevels,
    user=Depends(require_permission("manage_inventory")),
) -> list[dict]:
    """Set the product's low-stock level and each color/size's own level at the store."""
    if not can_manage_store(user, store_id):
        raise HTTPException(403, "You don't manage this store")
    with get_connection() as conn:
        try:
            low_stock.set_variant_levels(
                conn, store_id, product_id, body.low_stock_threshold,
                [level.model_dump() for level in body.levels],
            )
            reorders.check_stock(conn, store_id, [product_id])
            return variants.store_variants(conn, store_id, product_id)
        except stock.InventoryError as error:
            raise _http_error(error) from error


@inventory_router.put("/{store_id}/products/{product_id}/variant-status", response_model=list[StoreVariant])
def write_variant_status(
    store_id: int,
    product_id: int,
    body: VariantStatusWrite,
    user=Depends(require_permission("manage_inventory")),
) -> list[dict]:
    """Discontinue, or sell again, some of the product's colors/sizes at the store."""
    if not can_manage_store(user, store_id):
        raise HTTPException(403, "You don't manage this store")
    with get_connection() as conn:
        try:
            low_stock.set_variant_status(conn, store_id, product_id, body.variant_ids, body.status)
            reorders.check_stock(conn, store_id, [product_id])
            return variants.store_variants(conn, store_id, product_id)
        except stock.InventoryError as error:
            raise _http_error(error) from error
