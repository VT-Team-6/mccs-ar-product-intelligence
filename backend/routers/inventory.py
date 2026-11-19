"""Stock levels: public reads, and permission-gated writes including the push flow.

Reads are completely public, and the public routes are in their own routers so they can be mounted.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from auth import require_permission
import stock
import stock_csv
import low_stock
import reorders
from database import get_connection
from product_access import can_manage_store
from schemas import (
    InventoryApproval,
    InventoryBatch,
    InventoryPush,
    InventoryRecord,
    InventoryStatus,
    InventoryWrite,
    LowStockSettings,
    ProductStock,
    PushedEntry,
    StockImport,
    StockImportResult,
    StaffStoreStock,
    StoreBuyer,
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
    response_model=StaffStoreStock,
)
def read_store_inventory(
    store_id: int = Query(gt=0),
    entry_status: InventoryStatus = Query(default=stock.SHOPPER_STATUS),
    limit: int = Query(default=DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
    cursor: str | None = Query(default=None),
    user=Depends(require_permission("view_inventory")),
) -> dict:
    """One store's inventory in any status — the pending queue and the rest.

    The status filter allows admin access to the pending queue, which is not visible to shoppers.
    """
    _require_store_access(user, store_id)
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


def _require_store_access(user: dict, store_id: int) -> None:
    if not can_manage_store(user, store_id):
        raise HTTPException(403, "You don't manage this store")


def _require_stock_write(conn, user: dict, product_id: int, store_id: int, body: InventoryWrite) -> None:
    _require_store_access(user, store_id)
    if "manage_inventory" in user["permissions"]:
        return
    if body.model_fields_set & {"price", "status"}:
        raise HTTPException(403, "Only inventory managers can change prices or status")
    # A clerk may count existing active stock, but cannot create or approve an entry.
    entry = conn.execute(
        "SELECT status FROM inventory WHERE product_id = %s AND store_id = %s FOR UPDATE",
        (product_id, store_id),
    ).fetchone()
    if entry is None or entry["status"] != "active":
        raise HTTPException(403, "Stock counts can only be updated for active inventory")


@writer_router.get("/buyers", response_model=list[StoreBuyer])
def read_store_buyers(
    store_id: int = Query(gt=0),
    user=Depends(require_permission("manage_inventory")),
) -> list[dict]:
    """The store buyers at this store, who can be picked as a product's buyer."""
    _require_store_access(user, store_id)
    with get_connection() as conn:
        try:
            return low_stock.list_buyers(conn, store_id)
        except stock.InventoryError as error:
            raise _http_error(error) from error


@writer_router.put("/low-stock-settings")
def update_low_stock_settings(
    body: LowStockSettings,
    user=Depends(require_permission("manage_inventory")),
) -> dict:
    """Set the low-stock level and/or buyer on one or many of a store's products."""
    _require_store_access(user, body.store_id)
    with get_connection() as conn:
        try:
            updated = low_stock.update_settings(
                conn,
                body.store_id,
                body.product_ids,
                low_stock_threshold=body.low_stock_threshold,
                buyer_user_id=body.buyer_user_id,
                clear_buyer=body.clear_buyer,
            )
            reorders.check_stock(conn, body.store_id, body.product_ids)
        except stock.InventoryError as error:
            raise _http_error(error) from error
    return {"updated": updated}


@writer_router.get("/stock.csv")
def export_stock_csv(
    store_id: int = Query(gt=0),
    user=Depends(require_permission("manage_stock")),
) -> Response:
    """The store's products and stock as a CSV, ready to fill in and import."""
    _require_store_access(user, store_id)
    with get_connection() as conn:
        try:
            text = stock_csv.export_csv(conn, store_id)
        except stock.InventoryError as error:
            raise _http_error(error) from error
    return Response(
        content=text,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="stock-store-{store_id}.csv"'},
    )


@writer_router.post("/stock-import/preview", response_model=StockImportResult)
def preview_stock_import(
    body: StockImport,
    user=Depends(require_permission("manage_stock")),
) -> dict:
    """What importing the file would change. Nothing is saved."""
    _require_store_access(user, body.store_id)
    with get_connection() as conn:
        try:
            return stock_csv.preview(conn, body.store_id, body.csv)
        except stock.InventoryError as error:
            raise _http_error(error) from error


@writer_router.post("/stock-import", response_model=StockImportResult)
def apply_stock_import(
    body: StockImport,
    user=Depends(require_permission("manage_stock")),
) -> dict:
    """Save every stock change in the file, or none if any row has a problem."""
    _require_store_access(user, body.store_id)
    with get_connection() as conn:
        try:
            return stock_csv.apply(conn, body.store_id, body.csv, user["user_id"])
        except stock.InventoryError as error:
            raise _http_error(error) from error


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
        _require_stock_write(conn, user, product_id, store_id, body)
        try:
            record = stock.upsert_record(
                conn,
                product_id,
                store_id,
                quantity=body.quantity,
                price=body.price,
                status=body.status,
                actor_user_id=user["user_id"],
            )
            reorders.check_stock(conn, store_id, [product_id])
            return record
        except stock.InventoryError as error:
            raise _http_error(error) from error


@writer_router.put("", response_model=list[InventoryRecord])
def replace_stock_batch(
    body: InventoryBatch,
    user=Depends(require_permission("manage_stock")),
) -> list[dict]:
    """Apply many product+store rows, or none of them."""
    with get_connection() as conn:
        for entry in body.items:
            _require_stock_write(conn, user, entry.product_id, entry.store_id, entry)
        try:
            records = stock.upsert_many(
                conn,
                [
                    {**entry.model_dump(), "actor_user_id": user["user_id"]}
                    for entry in body.items
                ],
            )
            by_store: dict[int, list[int]] = {}
            for entry in body.items:
                by_store.setdefault(entry.store_id, []).append(entry.product_id)
            for store_id, product_ids in by_store.items():
                reorders.check_stock(conn, store_id, product_ids)
            return records
        except stock.InventoryError as error:
            raise _http_error(error) from error


@writer_router.post(
    "/push",
    response_model=list[PushedEntry],
)
def push_products(body: InventoryPush, user=Depends(require_permission("manage_inventory"))) -> list[dict]:
    """Push catalog products to stores as pending entries awaiting approval.

    Nothing about a pushed product reaches a shopper until the store approves
    it. Pushing a pair that already has an entry leaves it untouched.
    """
    for store_id in body.store_ids:
        _require_store_access(user, store_id)
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
    _require_store_access(user, store_id)
    with get_connection() as conn:
        try:
            record = stock.approve(
                conn,
                product_id,
                store_id,
                user["user_id"],
                quantity=body.quantity,
                price=body.price,
            )
            reorders.check_stock(conn, store_id, [product_id])
            return record
        except stock.InventoryError as error:
            raise _http_error(error) from error


@writer_router.delete(
    "/{product_id}/{store_id}",
)
def delete_stock(product_id: int, store_id: int, user=Depends(require_permission("manage_inventory"))) -> dict:
    """Remove an entry. Declining a push is exactly this: delete the pending row."""
    _require_store_access(user, store_id)
    with get_connection() as conn:
        try:
            return stock.delete_record(conn, product_id, store_id)
        except stock.InventoryError as error:
            raise _http_error(error) from error
