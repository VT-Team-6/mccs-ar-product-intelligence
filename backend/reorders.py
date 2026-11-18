"""Reorders: low-stock alerts, order requests and notifications.

check_stock() runs after every stock change (a manual edit, a CSV import, a
changed low-stock level or buyer). It opens an alert for each product that just
dropped to its level, resolves the alerts of products that went back above it,
and notifies the store's managers once about everything that just went low.
check_all_stores() does the same for every product when the backend starts, so
products that were already low get alerts too.

Each alert is a product's reorder status:
    open (needs reorder) -> requested -> ordered
                                      -> unavailable (with the buyer's reason)
and it's resolved, leaving the Reorders list, when stock goes back above the
level. A manager sends needs-reorder and unavailable products to one buyer as an
order request (send_request). The buyer marks products ordered or unavailable
(update_items), which notifies every manager of the store.
"""

from psycopg import Connection

import low_stock
import stock

# How many products a notification lists before "and N more"
MESSAGE_LINES = 25

# Statuses a manager can send in an order request
REORDERABLE = ("open", "unavailable")


def _store(conn: Connection, store_id: int) -> dict:
    row = conn.execute(
        "SELECT name, address FROM stores WHERE store_id = %s", (store_id,)
    ).fetchone()
    return row or {"name": f"Store {store_id}", "address": ""}


def _plural(count: int, word: str) -> str:
    return f"{count} {word}{'' if count == 1 else 's'}"


def _lines(lines: list[str]) -> str:
    shown = lines[:MESSAGE_LINES]
    if len(lines) > MESSAGE_LINES:
        shown.append(f"…and {len(lines) - MESSAGE_LINES} more")
    return "\n".join(shown)


def suggested_quantity(quantity: int, threshold: int) -> int:
    """How many to ask for: enough to get back to twice the low-stock level."""
    return max(1, 2 * threshold - quantity)


def store_managers(conn: Connection, store_id: int) -> list[int]:
    """The store admins assigned to this store, who get its reorder notifications."""
    rows = conn.execute(
        "SELECT u.user_id FROM users u JOIN user_stores us ON us.user_id = u.user_id"
        " WHERE us.store_id = %s AND u.role = 'store_admin' ORDER BY u.user_id",
        (store_id,),
    ).fetchall()
    return [row["user_id"] for row in rows]


def _notify(conn, recipients, store_id, kind, subject, body="", request_id=None) -> None:
    for recipient in recipients:
        conn.execute(
            "INSERT INTO messages (recipient_user_id, store_id, kind, subject, body, request_id)"
            " VALUES (%s, %s, %s, %s, %s, %s)",
            (recipient, store_id, kind, subject[:200], body, request_id),
        )


# --- alerts ----------------------------------------------------------------


def check_stock(conn: Connection, store_id: int, product_ids: list[int]) -> list[dict]:
    """Open or resolve alerts for these products after their stock, level or buyer changed.

    A product is low when it's on sale and its quantity is at or below its
    level. Returns the products that just went low (and were notified about).
    """
    if not product_ids:
        return []
    rows = conn.execute(
        "SELECT i.product_id, p.name, i.quantity, i.low_stock_threshold AS threshold,"
        " (i.status = 'active' AND COALESCE(i.quantity, 0) <= i.low_stock_threshold) AS is_low,"
        " a.alert_id"
        " FROM inventory i JOIN products p ON p.product_id = i.product_id"
        " LEFT JOIN low_stock_alerts a ON a.product_id = i.product_id"
        "   AND a.store_id = i.store_id AND a.status <> 'resolved'"
        " WHERE i.store_id = %s AND i.product_id = ANY(%s)"
        " ORDER BY lower(p.name)",
        (store_id, sorted(set(product_ids))),
    ).fetchall()

    went_low, back_up = [], []
    for row in rows:
        if row["is_low"] and row["alert_id"] is None:
            conn.execute(
                "INSERT INTO low_stock_alerts (product_id, store_id, quantity, threshold)"
                " VALUES (%s, %s, %s, %s)",
                (row["product_id"], store_id, row["quantity"] or 0, row["threshold"]),
            )
            went_low.append(row)
        elif not row["is_low"] and row["alert_id"] is not None:
            back_up.append(row["alert_id"])

    if back_up:
        conn.execute(
            "UPDATE low_stock_alerts SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP"
            " WHERE alert_id = ANY(%s)",
            (back_up,),
        )
    if went_low:
        _notify_low(conn, store_id, went_low)
    return went_low


def check_all_stores(conn: Connection) -> int:
    """Check every product at every store; returns how many were newly low."""
    total = 0
    for store in conn.execute("SELECT store_id FROM stores ORDER BY store_id").fetchall():
        product_ids = [
            row["product_id"]
            for row in conn.execute(
                "SELECT product_id FROM inventory WHERE store_id = %s", (store["store_id"],)
            ).fetchall()
        ]
        total += len(check_stock(conn, store["store_id"], product_ids))
    return total


def _notify_low(conn: Connection, store_id: int, went_low: list[dict]) -> None:
    store = _store(conn, store_id)["name"]
    if len(went_low) == 1:
        subject = f"{went_low[0]['name']} is low on stock at {store}"
    else:
        subject = f"{_plural(len(went_low), 'product')} are low on stock at {store}"
    body = _lines([
        f"• {row['name']}: {row['quantity'] or 0} left (low at {row['threshold']})"
        for row in went_low
    ])
    _notify(conn, store_managers(conn, store_id), store_id, "low_stock", subject, body)


# --- the Reorders list (managers) -----------------------------------------

# Each low product with its status and its latest order request, if any
_PRODUCTS_SQL = """
    SELECT a.alert_id, a.product_id, p.name, p.brand, i.quantity, i.low_stock_threshold,
           a.status, a.created_at,
           i.buyer_user_id, pb.email AS buyer_email,
           r.request_id, ri.quantity AS requested_quantity, ri.reason, ri.updated_at,
           r.created_at AS requested_at, rb.email AS requested_from
      FROM low_stock_alerts a
      JOIN inventory i ON i.product_id = a.product_id AND i.store_id = a.store_id
      JOIN products p ON p.product_id = a.product_id
      LEFT JOIN users pb ON pb.user_id = i.buyer_user_id
      LEFT JOIN LATERAL (
            SELECT * FROM order_request_items x
             WHERE x.alert_id = a.alert_id
             ORDER BY x.request_id DESC LIMIT 1
      ) ri ON true
      LEFT JOIN order_requests r ON r.request_id = ri.request_id
      LEFT JOIN users rb ON rb.user_id = r.buyer_user_id
     WHERE a.store_id = %s AND a.status <> 'resolved'
"""


def list_products(conn: Connection, store_id: int) -> list[dict]:
    """Every low product at the store with its reorder status, alphabetical."""
    stock._require_store(conn, store_id)
    rows = conn.execute(_PRODUCTS_SQL + " ORDER BY lower(p.name)", (store_id,)).fetchall()
    for row in rows:
        row["quantity"] = row["quantity"] or 0
        row["suggested_quantity"] = suggested_quantity(row["quantity"], row["low_stock_threshold"])
    return rows


def status_counts(conn: Connection, store_id: int) -> dict:
    rows = conn.execute(
        "SELECT status, count(*) AS n FROM low_stock_alerts"
        " WHERE store_id = %s AND status <> 'resolved' GROUP BY status",
        (store_id,),
    ).fetchall()
    counts = {status: 0 for status in ("open", "requested", "ordered", "unavailable")}
    counts.update({row["status"]: row["n"] for row in rows})
    return counts


def reorder_groups(conn: Connection, store_id: int) -> list[dict]:
    """Products that can be sent (needs reorder or unavailable), grouped by buyer.

    Products with no buyer come last, in a group whose buyer is None.
    """
    groups: dict[int | None, dict] = {}
    products = [p for p in list_products(conn, store_id) if p["status"] in REORDERABLE]
    products.sort(key=lambda p: (p["buyer_email"] is None, p["buyer_email"] or "", p["name"].lower()))
    for product in products:
        groups.setdefault(product["buyer_user_id"], {
            "buyer_user_id": product["buyer_user_id"],
            "buyer_email": product["buyer_email"],
            "items": [],
        })["items"].append(product)
    return list(groups.values())


def _reorderable(conn: Connection, store_id: int, alert_ids: list[int]) -> dict[int, dict]:
    """These alerts, which must all be reorderable at this store, or nothing happens."""
    rows = conn.execute(
        "SELECT a.alert_id, a.product_id, p.name, i.quantity"
        " FROM low_stock_alerts a"
        " JOIN products p ON p.product_id = a.product_id"
        " JOIN inventory i ON i.product_id = a.product_id AND i.store_id = a.store_id"
        " WHERE a.store_id = %s AND a.status = ANY(%s) AND a.alert_id = ANY(%s)",
        (store_id, list(REORDERABLE), alert_ids),
    ).fetchall()
    found = {row["alert_id"]: row for row in rows}
    if len(found) != len(set(alert_ids)):
        raise stock.InventoryError(
            "Some of these products were already sent or are back in stock. Refresh and try again.",
            status=409,
        )
    return found


def formal_message(store: dict, items: list[dict], note: str, sender: str | None) -> str:
    """The Order Request text the buyer reads."""
    where = f"{store['name']} ({store['address']})" if store.get("address") else store["name"]
    lines = [
        f"• {item['name']}: {item['quantity']} units ({item['current_quantity'] or 0} currently in stock)"
        for item in items
    ]
    parts = [
        "Hello,",
        f"{where} is requesting a reorder of the following products:",
        "\n".join(lines),
    ]
    if note.strip():
        parts.append(note.strip())
    parts.append("Please confirm each item once it has been ordered.")
    parts.append(f"Thank you,\n{sender or 'Store manager'}, Store Manager")
    return "\n\n".join(parts)


def send_request(
    conn: Connection,
    store_id: int,
    buyer_user_id: int,
    items: list[dict],
    note: str,
    sent_by: int,
    remember_buyer: bool = False,
) -> dict:
    """Send these products to one buyer as a single order request.

    remember_buyer saves this buyer on any of the products that have none.
    """
    stock._require_store(conn, store_id)
    if buyer_user_id not in {b["user_id"] for b in low_stock.list_buyers(conn, store_id, everyone=True)}:
        raise stock.InventoryError("That person isn't a buyer at this store")
    alerts = _reorderable(conn, store_id, [item["alert_id"] for item in items])

    request_id = conn.execute(
        "INSERT INTO order_requests (store_id, buyer_user_id, sent_by, note)"
        " VALUES (%s, %s, %s, %s) RETURNING request_id",
        (store_id, buyer_user_id, sent_by, note.strip()),
    ).fetchone()["request_id"]

    for item in items:
        alert = alerts[item["alert_id"]]
        conn.execute(
            "INSERT INTO order_request_items (request_id, alert_id, product_id, quantity)"
            " VALUES (%s, %s, %s, %s)",
            (request_id, alert["alert_id"], alert["product_id"], item["quantity"]),
        )
    conn.execute(
        "UPDATE low_stock_alerts SET status = 'requested' WHERE alert_id = ANY(%s)",
        (list(alerts),),
    )
    if remember_buyer:
        conn.execute(
            "UPDATE inventory SET buyer_user_id = %s"
            " WHERE store_id = %s AND buyer_user_id IS NULL AND product_id = ANY(%s)",
            (buyer_user_id, store_id, [a["product_id"] for a in alerts.values()]),
        )

    store = _store(conn, store_id)
    subject = f"Order Request — {store['name']} ({_plural(len(items), 'product')})"
    _notify(conn, [buyer_user_id], store_id, "order_request", subject, request_id=request_id)
    return {"request_id": request_id, "sent": len(items)}


# --- order requests (buyers) -----------------------------------------------


def _items(conn: Connection, request_id: int, store_id: int) -> list[dict]:
    return conn.execute(
        "SELECT ri.product_id, p.name, p.brand, ri.quantity, ri.status, ri.reason, ri.updated_at,"
        " i.quantity AS current_quantity, a.status = 'resolved' AS restocked"
        " FROM order_request_items ri"
        " JOIN products p ON p.product_id = ri.product_id"
        " JOIN low_stock_alerts a ON a.alert_id = ri.alert_id"
        " LEFT JOIN inventory i ON i.product_id = ri.product_id AND i.store_id = %s"
        " WHERE ri.request_id = %s ORDER BY lower(p.name)",
        (store_id, request_id),
    ).fetchall()


def summarize(items: list[dict]) -> dict:
    """Counts of each item status, and whether the request is finished.

    It's finished once nothing is pending and every ordered product has arrived
    (its stock is back above the level). Unavailable products are finished from
    the buyer's side; the manager can reorder them.
    """
    counts = {"pending": 0, "ordered": 0, "unavailable": 0, "received": 0}
    for item in items:
        if item["status"] == "ordered" and item["restocked"]:
            counts["received"] += 1
        elif item["restocked"] and item["status"] == "pending":
            counts["received"] += 1
        else:
            counts[item["status"]] += 1
    finished = counts["pending"] == 0 and counts["ordered"] == 0
    return {**counts, "finished": finished}


def get_request(conn: Connection, request_id: int) -> dict | None:
    request = conn.execute(
        "SELECT r.request_id, r.store_id, s.name AS store_name, s.address AS store_address,"
        " r.buyer_user_id, b.email AS buyer_email, m.email AS sent_by_email, r.note, r.created_at"
        " FROM order_requests r JOIN stores s ON s.store_id = r.store_id"
        " LEFT JOIN users b ON b.user_id = r.buyer_user_id"
        " LEFT JOIN users m ON m.user_id = r.sent_by"
        " WHERE r.request_id = %s",
        (request_id,),
    ).fetchone()
    if request is None:
        return None
    request["items"] = _items(conn, request_id, request["store_id"])
    request["summary"] = summarize(request["items"])
    request["message"] = formal_message(
        {"name": request["store_name"], "address": request["store_address"]},
        request["items"],
        request["note"],
        request["sent_by_email"],
    )
    return request


def list_requests(
    conn: Connection,
    user_id: int,
    store_id: int | None = None,
    include_finished: bool = False,
) -> list[dict]:
    """Order requests, newest first, with item counts and unread state.

    With store_id, every request at that store (for its managers); otherwise the
    requests sent to this user as the buyer. unread means this user has an
    unread notification about the request.
    """
    where, param = ("r.store_id = %s", store_id) if store_id is not None else ("r.buyer_user_id = %s", user_id)
    requests = conn.execute(
        "SELECT r.request_id, r.store_id, s.name AS store_name, m.email AS sent_by_email,"
        " b.email AS buyer_email, r.created_at,"
        " EXISTS (SELECT 1 FROM messages n WHERE n.request_id = r.request_id"
        "         AND n.recipient_user_id = %s AND n.read_at IS NULL) AS unread"
        " FROM order_requests r JOIN stores s ON s.store_id = r.store_id"
        " LEFT JOIN users m ON m.user_id = r.sent_by"
        " LEFT JOIN users b ON b.user_id = r.buyer_user_id"
        f" WHERE {where} ORDER BY r.created_at DESC, r.request_id DESC",
        (user_id, param),
    ).fetchall()
    result = []
    for request in requests:
        items = _items(conn, request["request_id"], request["store_id"])
        request["summary"] = summarize(items)
        request["product_count"] = len(items)
        if include_finished or not request["summary"]["finished"]:
            result.append(request)
    return result


def list_items_for_buyer(conn: Connection, user_id: int) -> list[dict]:
    """Every product in the buyer's unfinished order requests, for the By product view."""
    items = []
    for request in list_requests(conn, user_id):
        for item in _items(conn, request["request_id"], request["store_id"]):
            items.append({
                **item,
                "request_id": request["request_id"],
                "store_name": request["store_name"],
                "requested_at": request["created_at"],
            })
    items.sort(key=lambda item: item["name"].lower())
    return items


def update_items(
    conn: Connection,
    request_id: int,
    product_ids: list[int],
    status: str,
    reason: str,
    user: dict,
) -> dict:
    """The buyer marks some of a request's products ordered or unavailable.

    The products' reorder status follows, unless a product has since been sent
    in a newer request. Every manager of the store is notified.
    """
    request = get_request(conn, request_id)
    in_request = {item["product_id"]: item for item in request["items"]}
    missing = [p for p in product_ids if p not in in_request]
    if missing:
        raise stock.InventoryError(f"Not in this order request: product {missing[0]}", status=404)
    if status == "unavailable" and not reason.strip():
        raise stock.InventoryError("Say why these products are unavailable")

    conn.execute(
        "UPDATE order_request_items SET status = %s, reason = %s, updated_at = CURRENT_TIMESTAMP"
        " WHERE request_id = %s AND product_id = ANY(%s)",
        (status, reason.strip() if status == "unavailable" else "", request_id, product_ids),
    )
    # The product's status follows its latest request only
    conn.execute(
        "UPDATE low_stock_alerts a SET status = %s"
        " FROM order_request_items ri"
        " WHERE ri.alert_id = a.alert_id AND ri.request_id = %s AND ri.product_id = ANY(%s)"
        " AND a.status <> 'resolved'"
        " AND NOT EXISTS (SELECT 1 FROM order_request_items newer"
        "                 WHERE newer.alert_id = a.alert_id AND newer.request_id > ri.request_id)",
        ({"ordered": "ordered", "unavailable": "unavailable"}.get(status, "requested"),
         request_id, product_ids),
    )

    names = [in_request[p]["name"] for p in product_ids]
    who = user.get("email") or "The buyer"
    if status == "ordered":
        subject = f"{who} ordered {_plural(len(names), 'product')} for {request['store_name']}"
        body = _lines([f"• {name}: ordered" for name in names])
    else:
        subject = f"{who} couldn't order {_plural(len(names), 'product')} for {request['store_name']}"
        body = _lines([f"• {name}: unavailable" for name in names]) + f"\n\nReason: {reason.strip()}"
    _notify(conn, store_managers(conn, request["store_id"]), request["store_id"],
            "order_update", subject, body, request_id)
    return get_request(conn, request_id)


# --- notifications ---------------------------------------------------------


def list_messages(conn: Connection, user_id: int, limit: int = 50) -> list[dict]:
    return conn.execute(
        "SELECT message_id, kind, subject, body, store_id, request_id, created_at,"
        " read_at IS NOT NULL AS read"
        " FROM messages WHERE recipient_user_id = %s"
        " ORDER BY created_at DESC, message_id DESC LIMIT %s",
        (user_id, limit),
    ).fetchall()


def unread_count(conn: Connection, user_id: int) -> int:
    return conn.execute(
        "SELECT count(*) AS n FROM messages WHERE recipient_user_id = %s AND read_at IS NULL",
        (user_id,),
    ).fetchone()["n"]


def mark_read(
    conn: Connection,
    user_id: int,
    message_ids: list[int] | None = None,
    request_id: int | None = None,
    store_id: int | None = None,
) -> int:
    """Mark the user's notifications read: these ids, one request's, one store's, or all."""
    where, params = ["recipient_user_id = %s", "read_at IS NULL"], [user_id]
    if message_ids is not None:
        where.append("message_id = ANY(%s)")
        params.append(message_ids)
    if request_id is not None:
        where.append("request_id = %s")
        params.append(request_id)
    if store_id is not None:
        where.append("store_id = %s")
        params.append(store_id)
    rows = conn.execute(
        f"UPDATE messages SET read_at = CURRENT_TIMESTAMP WHERE {' AND '.join(where)}"
        " RETURNING message_id",
        params,
    ).fetchall()
    return len(rows)
