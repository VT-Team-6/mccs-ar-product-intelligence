"""Stock levels: public reads, and permission-gated writes including the push flow.

Reads are completely public, and the public routes are in their own routers so they can be mounted.
"""

from fastapi import APIRouter, Depends, HTTPException, Query

from auth import require_permission
import stock
from database import get_connection
from schemas import (
    InventoryApproval,
    InventoryBatch,
    InventoryPush,
    InventoryRecord,
    InventoryStatus,
    InventoryWrite,
    ProductStock,
    PushedEntry,
    StoreStock,
)

DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 200

# The public routes own these prefixes so a nested path cannot be added to
# routers/stores.py or routers/products.py without duplicating the segment.
product_stock_router = APIRouter(prefix="/api/products", tags=["stock"])
store_stock_router = APIRouter(prefix="/api/stores", tags=["stock"])

# Each route declares the permission it needs.
writer_router = APIRouter(
    prefix="/api/admin/inventory",
    tags=["admin-stock"],
)


def _http_error(error: stock.InventoryError) -> HTTPException:
    """Translate a service problem into the response the client sees."""
    return HTTPException(status_code=error.status, detail=error.detail)


@product_stock_router.get("/{product_id}/stock", response_model=ProductStock)
def read_product_stock(product_id: int) -> dict:
    """Every store currently selling this product, with its own price and stock."""
    with get_connection() as conn:
        try:
            return stock.list_product_stock(conn, product_id)
        except stock.InventoryError as error:
            raise _http_error(error) from error


@store_stock_router.get("/{store_id}/stock", response_model=StoreStock)
def read_store_stock(
    store_id: int,
    limit: int = Query(default=DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
    cursor: str | None = Query(default=None),
) -> dict:
    """What this store sells, one page at a time. Only active entries appear."""
    with get_connection() as conn:
        try:
            items, next_cursor = stock.list_store_stock(
                conn, store_id, limit=limit, cursor=cursor
            )
            store = conn.execute(
                "SELECT name FROM stores WHERE store_id = %s", (store_id,)
            ).fetchone()
        except stock.InventoryError as error:
            raise _http_error(error) from error
    return {
        "store_id": store_id,
        "name": store["name"],
        "items": items,
        "next_cursor": next_cursor,
    }


@writer_router.get(
    "",
    response_model=StoreStock,
    dependencies=[Depends(require_permission("manage_stock"))],
)
def read_store_inventory(
    store_id: int = Query(gt=0),
    entry_status: InventoryStatus = Query(default=stock.SHOPPER_STATUS),
    limit: int = Query(default=DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
    cursor: str | None = Query(default=None),
) -> dict:
    """One store's inventory in any status — the pending queue and the rest.

    The status filter allows admin access to the pending queue, which is not visible to shoppers.
    """
    with get_connection() as conn:
        try:
            items, next_cursor = stock.list_store_stock(
                conn, store_id, entry_status, limit, cursor
            )
            store = conn.execute(
                "SELECT name FROM stores WHERE store_id = %s", (store_id,)
            ).fetchone()
        except stock.InventoryError as error:
            raise _http_error(error) from error
    return {
        "store_id": store_id,
        "name": store["name"],
        "items": items,
        "next_cursor": next_cursor,
    }


@writer_router.put("/{product_id}/{store_id}", response_model=InventoryRecord)
def replace_stock(
    product_id: int,
    store_id: int,
    body: InventoryWrite,
    user=Depends(require_permission("manage_stock")),
) -> dict:
    """Create or replace one product's stock at one store.

    Omitted fields keep their stored value; a pair with no entry is created,
    which requires a price.
    """
    with get_connection() as conn:
        try:
            return stock.upsert_record(
                conn,
                product_id,
                store_id,
                quantity=body.quantity,
                price=body.price,
                status=body.status,
                actor_user_id=user["user_id"],
            )
        except stock.InventoryError as error:
            raise _http_error(error) from error


@writer_router.put("", response_model=list[InventoryRecord])
def replace_stock_batch(
    body: InventoryBatch,
    user=Depends(require_permission("manage_stock")),
) -> list[dict]:
    """Apply many product+store rows, or none of them."""
    with get_connection() as conn:
        try:
            return stock.upsert_many(
                conn,
                [
                    {**entry.model_dump(), "actor_user_id": user["user_id"]}
                    for entry in body.items
                ],
            )
        except stock.InventoryError as error:
            raise _http_error(error) from error


@writer_router.post(
    "/push",
    response_model=list[PushedEntry],
    dependencies=[Depends(require_permission("manage_stock"))],
)
def push_products(body: InventoryPush) -> list[dict]:
    """Push catalog products to stores as pending entries awaiting approval.

    Nothing about a pushed product reaches a shopper until the store approves
    it. Pushing a pair that already has an entry leaves it untouched.
    """
    with get_connection() as conn:
        try:
            return stock.push_to_stores(conn, body.product_ids, body.store_ids)
        except stock.InventoryError as error:
            raise _http_error(error) from error


@writer_router.post("/{product_id}/{store_id}/approve", response_model=InventoryRecord)
def approve_pushed_product(
    product_id: int,
    store_id: int,
    body: InventoryApproval,
    user=Depends(require_permission("manage_inventory")),
) -> dict:
    """Approve a pending entry, with the price the store is setting."""
    with get_connection() as conn:
        try:
            return stock.approve(
                conn,
                product_id,
                store_id,
                user["user_id"],
                quantity=body.quantity,
                price=body.price,
            )
        except stock.InventoryError as error:
            raise _http_error(error) from error


@writer_router.delete(
    "/{product_id}/{store_id}",
    dependencies=[Depends(require_permission("manage_stock"))],
)
def delete_stock(product_id: int, store_id: int) -> dict:
    """Remove an entry. Declining a push is exactly this: delete the pending row."""
    with get_connection() as conn:
        try:
            return stock.delete_record(conn, product_id, store_id)
        except stock.InventoryError as error:
            raise _http_error(error) from error
