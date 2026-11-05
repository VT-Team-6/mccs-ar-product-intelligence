"""Per-store stock: reads, admin writes, and the push approve lifecycle.

Every function takes an open connection and never reads request or auth state.
The routers translate InventoryError into an HTTP response, the same shape
user_products uses, so this module stays HTTP-agnostic.

An inventory row is one product at one store. Its status is the lifecycle:

    pending       pushed by an admin, awaiting the store's approval (no price)
    active        on sale; visible to shoppers
    discontinued  no longer sold there; hidden from shoppers but still scannable

Shopper-facing reads only ever see active rows. That filter lives in the
queries here and in the product/search joins, not in the client.
"""

from typing import Any, Literal

from psycopg import Connection

from pagination import InvalidCursor, decode_cursor, encode_cursor

InventoryStatus = Literal["pending", "active", "discontinued"]

STATUSES: tuple[InventoryStatus, ...] = ("pending", "active", "discontinued")

# Statuses a shopper may see, and therefore the only ones public reads return.
SHOPPER_STATUS: InventoryStatus = "active"

INVALID_STATUS_DETAIL = "Status must be one of: pending, active, discontinued"
PRICE_REQUIRED_DETAIL = "A price is required to make an entry active or discontinued"
NOTHING_TO_UPDATE_DETAIL = "Give a quantity, a price, or a status"


class InventoryError(Exception):
    """A caller-correctable problem, mapped to an HTTP status by the router."""

    def __init__(self, detail: str, status: int = 422):
        super().__init__(detail)
        self.detail = detail
        self.status = status


def _require_product(conn: Connection, product_id: int) -> None:
    row = conn.execute(
        "SELECT 1 FROM products WHERE product_id = %s AND deleted_at IS NULL",
        (product_id,),
    ).fetchone()
    if row is None:
        raise InventoryError(f"Product {product_id} not found", status=404)


def _require_store(conn: Connection, store_id: int) -> None:
    row = conn.execute(
        "SELECT 1 FROM stores WHERE store_id = %s", (store_id,)
    ).fetchone()
    if row is None:
        raise InventoryError(f"Store {store_id} not found", status=404)


def _validate(quantity: int | None, price, status: str | None) -> None:
    """Reject values the columns would refuse, with a readable message."""
    if quantity is not None and quantity < 0:
        raise InventoryError("Quantity cannot be negative")
    if price is not None and price < 0:
        raise InventoryError("Price cannot be negative")
    if status is not None and status not in STATUSES:
        raise InventoryError(INVALID_STATUS_DETAIL)


# ensures in_stock is correct, deriving from quantity and status.
_RECORD_COLUMNS = """
    i.product_id, i.store_id, i.quantity, i.price, i.status, i.updated_at,
    (i.quantity > 0 AND i.status = 'active') AS in_stock
"""


def _get_record(conn: Connection, product_id: int, store_id: int) -> dict | None:
    return conn.execute(
        f"SELECT {_RECORD_COLUMNS} FROM inventory i"
        " WHERE i.product_id = %s AND i.store_id = %s",
        (product_id, store_id),
    ).fetchone()


def list_product_stock(conn: Connection, product_id: int) -> dict:
    """Every store that actively sells this product, in a stable order."""
    _require_product(conn, product_id)
    product = conn.execute(
        "SELECT name FROM products WHERE product_id = %s", (product_id,)
    ).fetchone()
    stores = conn.execute(
        "SELECT i.product_id, i.store_id, s.name AS store_name, s.address,"
        " i.quantity, i.price, i.status, i.updated_at,"
        " (i.quantity > 0 AND i.status = 'active') AS in_stock"
        " FROM inventory i JOIN stores s ON s.store_id = i.store_id"
        " WHERE i.product_id = %s AND i.status = 'active'"
        " ORDER BY i.store_id",
        (product_id,),
    ).fetchall()
    return {"product_id": product_id, "name": product["name"], "stores": stores}


def list_store_stock(
    conn: Connection,
    store_id: int,
    status: InventoryStatus = SHOPPER_STATUS,
    limit: int = 50,
    cursor: str | None = None,
) -> tuple[list[dict], str | None]:
    """One page of a store's stock, ordered by product id."""

    _require_store(conn, store_id)
    if status not in STATUSES:
        raise InventoryError(INVALID_STATUS_DETAIL)

    params: tuple = (store_id, status)
    where = ""
    if cursor:
        try:
            values = decode_cursor(cursor, ("id", "s", "st"))
        except InvalidCursor as error:
            raise InventoryError(str(error), status=400) from error
        # A cursor belongs to one store and one status; resuming another pair
        # with it would skip or repeat rows.
        if values.get("s") != store_id or values.get("st") != status:
            raise InventoryError(
                "Cursor does not match this store and status", status=400
            )
        where = " AND i.product_id > %s"
        params = (*params, values["id"])

    rows = conn.execute(
        "SELECT i.product_id, p.name AS product_name, p.brand, i.store_id,"
        " i.quantity, i.price, i.status, i.updated_at,"
        " (i.quantity > 0 AND i.status = 'active') AS in_stock"
        " FROM inventory i JOIN products p ON p.product_id = i.product_id"
        f" WHERE i.store_id = %s AND i.status = %s{where}"
        " ORDER BY i.product_id LIMIT %s",
        (*params, limit + 1),
    ).fetchall()

    page, has_more = rows[:limit], len(rows) > limit
    next_cursor = None
    if has_more and page:
        next_cursor = encode_cursor(
            {"id": page[-1]["product_id"], "s": store_id, "st": status}
        )
    return page, next_cursor


def upsert_record(
    conn: Connection,
    product_id: int,
    store_id: int,
    quantity: int | None = None,
    price=None,
    status: InventoryStatus | None = None,
    actor_user_id: int | None = None,
) -> dict:
    """Create or replace one product+store entry, returning the stored row.

    Omitted fields keep their stored value. A price is mandatory whenever the
    resulting entry would be active or discontinued, so the only way to hold an
    entry without a price is to leave it pending.

    actor_user_id is recorded as the approver whenever this write moves an
    entry into active.
    """
    _validate(quantity, price, status)
    _require_product(conn, product_id)
    _require_store(conn, store_id)

    existing = _get_record(conn, product_id, store_id)
    if existing is None and quantity is None and price is None and status is None:
        raise InventoryError(NOTHING_TO_UPDATE_DETAIL)

    # Deciding the price and status together is what lets "approve with a price
    # the store already set" and "flip to discontinued, keep the price" both
    # work without a second request.
    final_status = status or (existing["status"] if existing else "active")
    final_price = price if price is not None else (
        existing["price"] if existing else None
    )
    if final_status != "pending" and final_price is None:
        raise InventoryError(PRICE_REQUIRED_DETAIL)

    if existing is None and price is None:
        # No row to carry a price forward, and a new row needs one.
        raise InventoryError(PRICE_REQUIRED_DETAIL)

    approving = (
        final_status == "active"
        and (existing is None or existing["status"] != "active")
        and actor_user_id is not None
    )

    if price is not None:
        conn.execute(
            """
            INSERT INTO inventory
                (product_id, store_id, quantity, price, status, approved_at, approved_by)
            VALUES (%s, %s, COALESCE(%s, 0), %s, %s,
                    CASE WHEN %s THEN CURRENT_TIMESTAMP END,
                    CASE WHEN %s THEN %s END)
            ON CONFLICT (product_id, store_id) DO UPDATE SET
                quantity = COALESCE(%s, inventory.quantity),
                price = EXCLUDED.price,
                status = EXCLUDED.status,
                approved_at = CASE
                    WHEN EXCLUDED.status = 'active'
                         AND inventory.status IS DISTINCT FROM 'active'
                    THEN CURRENT_TIMESTAMP ELSE inventory.approved_at END,
                approved_by = CASE
                    WHEN EXCLUDED.status = 'active'
                         AND inventory.status IS DISTINCT FROM 'active'
                    THEN COALESCE(%s, inventory.approved_by)
                    ELSE inventory.approved_by END,
                updated_at = CURRENT_TIMESTAMP
            """,
            (
                product_id, store_id, quantity, price, final_status,
                approving, approving, actor_user_id,
                quantity, actor_user_id,
            ),
        )
    else:
        # No price supplied: the row must already exist, so this is an UPDATE.
        conn.execute(
            """
            UPDATE inventory SET
                quantity = COALESCE(%s, quantity),
                status = %s,
                approved_at = CASE
                    WHEN %s AND status IS DISTINCT FROM 'active'
                    THEN CURRENT_TIMESTAMP ELSE approved_at END,
                approved_by = CASE
                    WHEN %s AND status IS DISTINCT FROM 'active'
                    THEN COALESCE(%s, approved_by) ELSE approved_by END,
                updated_at = CURRENT_TIMESTAMP
            WHERE product_id = %s AND store_id = %s
            """,
            (quantity, final_status, approving, approving, actor_user_id,
             product_id, store_id),
        )

    return _get_record(conn, product_id, store_id)


def upsert_many(conn: Connection, entries: list[dict]) -> list[dict]:
    """Apply every entry or none.

    The single connection block commits once at the end, and a raised
    InventoryError rolls the whole batch back, which is the all-or-nothing
    guarantee callers rely on.
    """
    seen: set[tuple[int, int]] = set()
    for entry in entries:
        pair = (entry["product_id"], entry["store_id"])
        if pair in seen:
            raise InventoryError(
                f"Product {pair[0]} at store {pair[1]} appears more than once"
            )
        seen.add(pair)

    return [
        upsert_record(
            conn,
            entry["product_id"],
            entry["store_id"],
            entry.get("quantity"),
            entry.get("price"),
            entry.get("status"),
            entry.get("actor_user_id"),
        )
        for entry in entries
    ]


def push_to_stores(
    conn: Connection, product_ids: list[int], store_ids: list[int]
) -> list[dict]:
    """Push catalog products to stores as pending entries awaiting approval.

    Pushing a pair that already has an entry is a no-op: re-pushing must never
    reset an active product back to pending or clear the price a store already
    set.
    """
    for product_id in product_ids:
        _require_product(conn, product_id)
    for store_id in store_ids:
        _require_store(conn, store_id)

    pushed: list[dict] = []
    for product_id in product_ids:
        for store_id in store_ids:
            existing = _get_record(conn, product_id, store_id)
            if existing is not None:
                pushed.append({**existing, "already_present": True})
                continue
            conn.execute(
                """
                INSERT INTO inventory (product_id, store_id, quantity, price, status)
                VALUES (%s, %s, 0, NULL, 'pending')
                """,
                (product_id, store_id),
            )
            pushed.append(
                {**_get_record(conn, product_id, store_id), "already_present": False}
            )
    return pushed


def approve(
    conn: Connection,
    product_id: int,
    store_id: int,
    actor_user_id: int,
    quantity: int | None = None,
    price=None,
) -> dict:
    """Turn a pending entry into an active one, stamping who approved it."""
    _require_product(conn, product_id)
    _require_store(conn, store_id)

    existing = _get_record(conn, product_id, store_id)
    if existing is None:
        raise InventoryError(
            f"Product {product_id} is not stocked at store {store_id}", status=404
        )
    if existing["status"] != "pending":
        raise InventoryError("Only a pending entry can be approved")

    return upsert_record(
        conn,
        product_id,
        store_id,
        quantity=quantity,
        price=price,
        status="active",
        actor_user_id=actor_user_id,
    )


def delete_record(conn: Connection, product_id: int, store_id: int) -> dict:
    """Remove one entry. Used both for cleanup and for declining a push."""
    cursor = conn.execute(
        "DELETE FROM inventory WHERE product_id = %s AND store_id = %s",
        (product_id, store_id),
    )
    if cursor.rowcount == 0:
        raise InventoryError(
            f"Product {product_id} is not stocked at store {store_id}", status=404
        )
    return {"deleted": True, "product_id": product_id, "store_id": store_id}
