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
import secure_text
import stock

# How many products a notification lists before "and N more"
MESSAGE_LINES = 25

# Statuses a manager can send in an order request
REORDERABLE = ("open", "unavailable")

# Always evaluate the buyer's current role and assignment, not just the saved ID.
_BUYER_ELIGIBLE = """EXISTS (
    SELECT 1 FROM users buyer JOIN user_stores us ON us.user_id = buyer.user_id
    WHERE buyer.user_id = r.buyer_user_id AND buyer.role = 'store_buyer'
      AND us.store_id = r.store_id
)"""


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
            # Saved encrypted; list_messages decrypts them
            (recipient, store_id, kind, secure_text.encrypt(subject[:200]), secure_text.encrypt(body), request_id),
        )


# --- alerts ----------------------------------------------------------------


# The product's name, color and size, each on its own so nobody mixes up
# "Samba (10)" with a quantity: messages read "Product: …", "Color: …", "Size: …"
_ITEM_NAME = "p.name"


def item_lines(item: dict, indent: str = "  ") -> list[str]:
    """['Product: Adidas Samba OG', 'Color: Black', 'Size: 10'], skipping what doesn't apply."""
    lines = [f"Product: {item['name']}"]
    if item.get("color"):
        lines.append(f"{indent}Color: {item['color']}")
    if item.get("size"):
        lines.append(f"{indent}Size: {item['size']}")
    return lines


def item_title(item: dict) -> str:
    """One line for a subject: 'Adidas Samba OG (Color: Black, Size: 10)'."""
    options = ", ".join(
        f"{label}: {item[key]}" for label, key in (("Color", "color"), ("Size", "size")) if item.get(key)
    )
    return f"{item['name']} ({options})" if options else item["name"]


def check_stock(conn: Connection, store_id: int, product_ids: list[int]) -> list[dict]:
    """Open or resolve alerts for these products after their stock, level or buyer changed.

    Each color/size is checked on its own: it's low when the product is on
    sale and that variant's stock is at or below the product's level, so a
    sold-out size 10 is flagged even when other sizes are plentiful. Returns
    the variants that just went low (and were notified about).
    """
    if not product_ids:
        return []
    rows = conn.execute(
        f"SELECT i.product_id, v.variant_id, {_ITEM_NAME} AS name, v.color, v.size, vs.quantity,"
        " i.low_stock_threshold AS threshold,"
        " (i.status = 'active' AND COALESCE(vs.quantity, 0) <= i.low_stock_threshold) AS is_low,"
        " i.status = 'active' AS on_sale, a.alert_id, a.kind, a.quantity AS alert_quantity"
        " FROM inventory i JOIN products p ON p.product_id = i.product_id"
        " JOIN product_variants v ON v.product_id = i.product_id"
        " LEFT JOIN variant_stock vs ON vs.variant_id = v.variant_id AND vs.store_id = i.store_id"
        " LEFT JOIN low_stock_alerts a ON a.variant_id = v.variant_id"
        "   AND a.store_id = i.store_id AND a.status <> 'resolved'"
        " WHERE i.store_id = %s AND i.product_id = ANY(%s)"
        " ORDER BY lower(p.name), v.color_order, v.size_order",
        (store_id, sorted(set(product_ids))),
    ).fetchall()

    went_low, back_up = [], []
    for row in rows:
        if row["is_low"] and row["alert_id"] is None:
            conn.execute(
                "INSERT INTO low_stock_alerts (product_id, variant_id, store_id, quantity, threshold)"
                " VALUES (%s, %s, %s, %s, %s)",
                (row["product_id"], row["variant_id"], store_id, row["quantity"] or 0, row["threshold"]),
            )
            went_low.append(row)
        elif row["alert_id"] is None:
            continue
        elif row["kind"] == "manual":
            # Ordered ahead of time: done once the order arrives (stock rises
            # above what it was when ordered) or the product is off sale
            if not row["on_sale"] or (row["quantity"] or 0) > row["alert_quantity"]:
                back_up.append(row["alert_id"])
        elif not row["is_low"]:
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
        subject = f"{item_title(went_low[0])} is low on stock at {store}"
    else:
        subject = f"{_plural(len(went_low), 'item')} are low on stock at {store}"
    body = _lines([
        "\n".join(["• " + item_lines(row)[0], *item_lines(row)[1:],
                   f"  Left: {row['quantity'] or 0} (low at {row['threshold']})"])
        for row in went_low
    ])
    _notify(conn, store_managers(conn, store_id), store_id, "low_stock", subject, body)


# --- the Reorders list (managers) -----------------------------------------

# Each low product with its status and its latest order request, if any
_PRODUCTS_SQL = """
    SELECT a.alert_id, a.product_id, a.variant_id, """ + _ITEM_NAME + """ AS name,
           v.color, v.size, p.brand,
           COALESCE(vs.quantity, 0) AS quantity, i.low_stock_threshold,
           a.status, a.created_at,
           pb.user_id AS buyer_user_id, pb.email AS buyer_email,
           r.request_id, ri.quantity AS requested_quantity, ri.reason, ri.updated_at,
           r.created_at AS requested_at, rb.email AS requested_from
      FROM low_stock_alerts a
      JOIN inventory i ON i.product_id = a.product_id AND i.store_id = a.store_id
      JOIN products p ON p.product_id = a.product_id
      LEFT JOIN product_variants v ON v.variant_id = a.variant_id
      LEFT JOIN variant_stock vs ON vs.variant_id = a.variant_id AND vs.store_id = a.store_id
      LEFT JOIN users pb ON pb.user_id = i.buyer_user_id AND pb.role = 'store_buyer'
                         AND EXISTS (SELECT 1 FROM user_stores us
                                     WHERE us.user_id = pb.user_id AND us.store_id = i.store_id)
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
    rows = conn.execute(
        _PRODUCTS_SQL + " ORDER BY lower(p.name), v.color_order, v.size_order", (store_id,)
    ).fetchall()
    for row in rows:
        row["quantity"] = row["quantity"] or 0
        row["suggested_quantity"] = suggested_quantity(row["quantity"], row["low_stock_threshold"])
    return secure_text.decrypt_rows(rows, "reason")


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


# --- reordering any product (not just low ones) ---------------------------

# Most urgent first: a product's chip shows the first of these any size has
STATUS_ORDER = ("open", "unavailable", "requested", "ordered")

_BUYER_JOIN = """
      LEFT JOIN users pb ON pb.user_id = i.buyer_user_id AND pb.role = 'store_buyer'
                         AND EXISTS (SELECT 1 FROM user_stores us
                                     WHERE us.user_id = pb.user_id AND us.store_id = i.store_id)
"""


def catalog(conn: Connection, store_id: int) -> dict:
    """Every product on sale at the store, one row each, with how many of its
    sizes/colors are low and every reorder status any of them has.

    The Reorders list shows these: "Needs reorder" (the default) is products
    with an open status, "All products" is everything, so a manager can order
    ahead of time.
    """
    stock._require_store(conn, store_id)
    rows = conn.execute(
        """
        SELECT p.product_id, p.name, p.brand, p.category, p.fit,
               i.quantity, i.low_stock_threshold,
               count(*)::INTEGER AS variant_count,
               count(*) FILTER (WHERE COALESCE(vs.quantity, 0) <= i.low_stock_threshold)::INTEGER
                   AS low_count,
               COALESCE(array_agg(DISTINCT a.status) FILTER (WHERE a.status IS NOT NULL), '{}')
                   AS statuses,
               pb.user_id AS buyer_user_id, pb.email AS buyer_email
          FROM inventory i
          JOIN products p ON p.product_id = i.product_id
          JOIN product_variants v ON v.product_id = i.product_id
          LEFT JOIN variant_stock vs ON vs.variant_id = v.variant_id AND vs.store_id = i.store_id
          LEFT JOIN low_stock_alerts a ON a.variant_id = v.variant_id
                AND a.store_id = i.store_id AND a.status <> 'resolved'
        """ + _BUYER_JOIN + """
         WHERE i.store_id = %s AND i.status = 'active' AND p.deleted_at IS NULL
         GROUP BY p.product_id, i.quantity, i.low_stock_threshold, pb.user_id, pb.email
         ORDER BY lower(p.name), p.product_id
        """,
        (store_id,),
    ).fetchall()
    counts = {status: 0 for status in STATUS_ORDER}
    for row in rows:
        row["statuses"] = [s for s in STATUS_ORDER if s in row["statuses"]]
        row["status"] = row["statuses"][0] if row["statuses"] else None
        for status in row["statuses"]:
            counts[status] += 1
    counts["all"] = len(rows)
    return {"products": rows, "counts": counts}


def lines(conn: Connection, store_id: int, product_ids: list[int]) -> list[dict]:
    """Every size/color of these products at the store, for the send screen:
    stock, whether it's low, its reorder status and a suggested amount.

    sendable is False while a size is already requested or ordered.
    """
    stock._require_store(conn, store_id)
    rows = conn.execute(
        """
        SELECT p.product_id, p.name, p.brand, p.category, p.fit,
               pb.user_id AS buyer_user_id, pb.email AS buyer_email,
               v.variant_id, v.color, v.color_hex, v.size,
               COALESCE(vs.quantity, 0) AS quantity, i.low_stock_threshold,
               COALESCE(vs.quantity, 0) <= i.low_stock_threshold AS low,
               a.alert_id, a.status
          FROM inventory i
          JOIN products p ON p.product_id = i.product_id
          JOIN product_variants v ON v.product_id = i.product_id
          LEFT JOIN variant_stock vs ON vs.variant_id = v.variant_id AND vs.store_id = i.store_id
          LEFT JOIN low_stock_alerts a ON a.variant_id = v.variant_id
                AND a.store_id = i.store_id AND a.status <> 'resolved'
        """ + _BUYER_JOIN + """
         WHERE i.store_id = %s AND i.status = 'active' AND p.deleted_at IS NULL
           AND i.product_id = ANY(%s)
         ORDER BY lower(p.name), p.product_id, v.color_order, v.size_order
        """,
        (store_id, product_ids),
    ).fetchall()
    for row in rows:
        row["suggested_quantity"] = suggested_quantity(row["quantity"], row["low_stock_threshold"])
        row["sendable"] = row["status"] is None or row["status"] in REORDERABLE
    return rows


def _alerts_for_variants(conn: Connection, store_id: int, variant_ids: list[int]) -> dict[int, int]:
    """The alert to send for each size/color, opening a manual one for sizes
    that aren't low. Refuses sizes already requested or ordered."""
    if not variant_ids:
        return {}
    # Lock inventory first, like stock changes do
    rows = conn.execute(
        "SELECT v.variant_id, v.product_id, COALESCE(vs.quantity, 0) AS quantity,"
        " i.low_stock_threshold, a.alert_id, a.status"
        " FROM inventory i"
        " JOIN product_variants v ON v.product_id = i.product_id"
        " LEFT JOIN variant_stock vs ON vs.variant_id = v.variant_id AND vs.store_id = i.store_id"
        " LEFT JOIN low_stock_alerts a ON a.variant_id = v.variant_id"
        "   AND a.store_id = i.store_id AND a.status <> 'resolved'"
        " WHERE i.store_id = %s AND i.status = 'active' AND v.variant_id = ANY(%s)"
        " ORDER BY i.product_id FOR NO KEY UPDATE OF i",
        (store_id, variant_ids),
    ).fetchall()
    if len(rows) != len(set(variant_ids)):
        raise stock.InventoryError("Some of these sizes aren't on sale at this store. Refresh and try again.",
                                   status=409)
    alert_for = {}
    for row in rows:
        if row["alert_id"] is not None:
            if row["status"] not in REORDERABLE:
                raise stock.InventoryError(
                    "Some of these sizes were already sent to a buyer. Refresh and try again.", status=409)
            alert_for[row["variant_id"]] = row["alert_id"]
        else:
            alert_for[row["variant_id"]] = conn.execute(
                "INSERT INTO low_stock_alerts (product_id, variant_id, store_id, quantity, threshold, kind)"
                " VALUES (%s, %s, %s, %s, %s, 'manual') RETURNING alert_id",
                (row["product_id"], row["variant_id"], store_id, row["quantity"], row["low_stock_threshold"]),
            ).fetchone()["alert_id"]
    return alert_for


def _claim_reorder_alerts(conn: Connection, store_id: int, alert_ids: list[int]) -> dict[int, dict]:
    """Claim every requested alert before inserting the order, or roll back."""
    # Stock changes lock inventory before alerts. Use the same order here,
    # including when the request will remember its buyer on the inventory rows.
    inventory_alerts = conn.execute(
        "SELECT a.alert_id FROM inventory i"
        " JOIN low_stock_alerts a USING (product_id, store_id)"
        " WHERE i.store_id = %s AND a.alert_id = ANY(%s)"
        " ORDER BY i.product_id FOR NO KEY UPDATE OF i",
        (store_id, alert_ids),
    ).fetchall()
    rows = conn.execute(
        "UPDATE low_stock_alerts SET status = 'requested'"
        " WHERE alert_id = ANY(%s) AND status = ANY(%s)"
        " RETURNING alert_id, product_id, variant_id",
        ([row["alert_id"] for row in inventory_alerts], list(REORDERABLE)),
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
        "\n".join(["• " + item_lines(item)[0], *item_lines(item)[1:],
                   f"  Quantity: {item['quantity']} units ({item['current_quantity'] or 0} currently in stock)"])
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

    remember_buyer fills in missing or ineligible default buyers.
    """
    stock._require_store(conn, store_id)
    if buyer_user_id not in {b["user_id"] for b in low_stock.list_buyers(conn, store_id, everyone=True)}:
        raise stock.InventoryError("That person isn't a buyer at this store")
    # Items name a low product's alert, or any size/color by variant_id
    alert_for = _alerts_for_variants(
        conn, store_id, [item["variant_id"] for item in items if not item.get("alert_id")]
    )
    items = [
        {**item, "alert_id": item.get("alert_id") or alert_for[item["variant_id"]]} for item in items
    ]
    if len({item["alert_id"] for item in items}) != len(items):
        raise stock.InventoryError("A size is in the request twice")
    alerts = _claim_reorder_alerts(conn, store_id, [item["alert_id"] for item in items])

    request_id = conn.execute(
        "INSERT INTO order_requests (store_id, buyer_user_id, sent_by, note)"
        " VALUES (%s, %s, %s, %s) RETURNING request_id",
        (store_id, buyer_user_id, sent_by, secure_text.encrypt(note.strip())),
    ).fetchone()["request_id"]

    for item in items:
        alert = alerts[item["alert_id"]]
        conn.execute(
            "INSERT INTO order_request_items (request_id, alert_id, product_id, variant_id, color, size, quantity)"
            " SELECT %s, %s, %s, %s, v.color, v.size, %s"
            " FROM (SELECT 1) one LEFT JOIN product_variants v ON v.variant_id = %s",
            (request_id, alert["alert_id"], alert["product_id"], alert["variant_id"],
             item["quantity"], alert["variant_id"]),
        )
    if remember_buyer:
        conn.execute(
            "UPDATE inventory i SET buyer_user_id = %s"
            " WHERE i.store_id = %s AND i.product_id = ANY(%s)"
            " AND NOT EXISTS (SELECT 1 FROM users b JOIN user_stores us USING (user_id)"
            "                 WHERE b.user_id = i.buyer_user_id AND b.role = 'store_buyer'"
            "                   AND us.store_id = i.store_id)",
            (buyer_user_id, store_id, [a["product_id"] for a in alerts.values()]),
        )

    store = _store(conn, store_id)
    subject = f"Order Request — {store['name']} ({_plural(len(items), 'product')})"
    _notify(conn, [buyer_user_id], store_id, "order_request", subject, request_id=request_id)
    return {"request_id": request_id, "sent": len(items)}


# --- order requests (buyers) -----------------------------------------------


def _items(conn: Connection, request_id: int, store_id: int) -> list[dict]:
    return secure_text.decrypt_rows(_items_rows(conn, request_id, store_id), "reason")


def _items_rows(conn: Connection, request_id: int, store_id: int) -> list[dict]:
    return conn.execute(
        "SELECT ri.alert_id, ri.product_id, ri.variant_id,"
        " p.name, ri.color, ri.size,"
        " p.brand, ri.quantity, ri.status, ri.reason, ri.updated_at,"
        " ri.updated_by, actor.email AS updated_by_email,"
        " COALESCE(vs.quantity, i.quantity) AS current_quantity, a.status = 'resolved' AS restocked"
        " FROM order_request_items ri"
        " JOIN products p ON p.product_id = ri.product_id"
        " LEFT JOIN users actor ON actor.user_id = ri.updated_by"
        " JOIN low_stock_alerts a ON a.alert_id = ri.alert_id"
        " LEFT JOIN inventory i ON i.product_id = ri.product_id AND i.store_id = %s"
        " LEFT JOIN variant_stock vs ON vs.variant_id = ri.variant_id AND vs.store_id = %s"
        " LEFT JOIN product_variants v ON v.variant_id = ri.variant_id"
        # Sizes in the order they were set up (7, 8 ... 12), not as text (10, 11, 12, 7)
        " WHERE ri.request_id = %s"
        " ORDER BY lower(p.name), p.product_id, v.color_order NULLS LAST, v.size_order NULLS LAST,"
        " ri.color, ri.size",
        (store_id, store_id, request_id),
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
        " r.buyer_user_id, b.email AS buyer_email, m.email AS sent_by_email, r.note, r.created_at,"
        f" {_BUYER_ELIGIBLE} AS buyer_is_eligible"
        " FROM order_requests r JOIN stores s ON s.store_id = r.store_id"
        " LEFT JOIN users b ON b.user_id = r.buyer_user_id"
        " LEFT JOIN users m ON m.user_id = r.sent_by"
        " WHERE r.request_id = %s",
        (request_id,),
    ).fetchone()
    if request is None:
        return None
    request["note"] = secure_text.decrypt(request["note"])
    request["items"] = _items(conn, request_id, request["store_id"])
    request["summary"] = summarize(request["items"])
    request["needs_reassignment"] = request["summary"]["pending"] > 0 and not request["buyer_is_eligible"]
    request["reassignments"] = conn.execute(
        "SELECT previous.email AS from_buyer_email, next_buyer.email AS to_buyer_email,"
        " actor.email AS changed_by_email, h.created_at FROM order_request_reassignments h"
        " LEFT JOIN users previous ON previous.user_id = h.from_buyer_id"
        " LEFT JOIN users next_buyer ON next_buyer.user_id = h.to_buyer_id"
        " LEFT JOIN users actor ON actor.user_id = h.changed_by"
        " WHERE h.request_id = %s ORDER BY h.reassignment_id", (request_id,),
    ).fetchall()
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
        f" b.email AS buyer_email, r.created_at, {_BUYER_ELIGIBLE} AS buyer_is_eligible,"
        " EXISTS (SELECT 1 FROM messages n WHERE n.request_id = r.request_id"
        "         AND n.recipient_user_id = %s AND n.read_at IS NULL) AS unread"
        " FROM order_requests r JOIN stores s ON s.store_id = r.store_id"
        " LEFT JOIN users m ON m.user_id = r.sent_by"
        " LEFT JOIN users b ON b.user_id = r.buyer_user_id"
        f" WHERE {where}" + (f" AND {_BUYER_ELIGIBLE}" if store_id is None else "")
        + " ORDER BY r.created_at DESC, r.request_id DESC",
        (user_id, param),
    ).fetchall()
    result = []
    for request in requests:
        items = _items(conn, request["request_id"], request["store_id"])
        request["summary"] = summarize(items)
        request["needs_reassignment"] = request["summary"]["pending"] > 0 and not request["buyer_is_eligible"]
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
    request: dict,
    product_ids: list[int],
    status: str,
    reason: str,
    user: dict,
    alert_ids: list[int] | None = None,
) -> dict:
    """The buyer marks some of a request's items ordered or unavailable.

    Items are picked by alert_ids (one per color/size). product_ids still
    works and picks every color/size of those products. The items' reorder
    status follows, unless an item has since been sent in a newer request.
    Every manager of the store is notified.
    """
    request_id = request["request_id"]
    if alert_ids is None:
        wanted = set(product_ids)
        missing = sorted(wanted - {item["product_id"] for item in request["items"]})
        if missing:
            raise stock.InventoryError(f"Not in this order request: product {missing[0]}", status=404)
        alert_ids = [item["alert_id"] for item in request["items"] if item["product_id"] in wanted]
    in_request = {item["alert_id"]: item for item in request["items"]}
    missing = [a for a in alert_ids if a not in in_request]
    if missing:
        raise stock.InventoryError("That item isn't in this order request", status=404)
    if "manage_all_stores" not in user["permissions"]:
        for alert_id in alert_ids:
            item = in_request[alert_id]
            if item["restocked"]:
                raise stock.InventoryError("This item has already been received", status=409)
            if item["status"] != "pending" and item["updated_by"] != user["user_id"]:
                raise stock.InventoryError("A replacement buyer cannot change another buyer's completed work", status=409)
    if status == "unavailable" and not reason.strip():
        raise stock.InventoryError("Say why these products are unavailable")

    conn.execute(
        "UPDATE order_request_items SET status = %s, reason = %s, updated_at = CURRENT_TIMESTAMP, updated_by = %s"
        " WHERE request_id = %s AND alert_id = ANY(%s)",
        (
            status,
            secure_text.encrypt(reason.strip()) if status == "unavailable" else "",
            user["user_id"],
            request_id,
            alert_ids,
        ),
    )
    # The product's status follows its latest request only
    conn.execute(
        "UPDATE low_stock_alerts a SET status = %s"
        " FROM order_request_items ri"
        " WHERE ri.alert_id = a.alert_id AND ri.request_id = %s AND ri.alert_id = ANY(%s)"
        " AND a.status <> 'resolved'"
        " AND NOT EXISTS (SELECT 1 FROM order_request_items newer"
        "                 WHERE newer.alert_id = a.alert_id AND newer.request_id > ri.request_id)",
        ({"ordered": "ordered", "unavailable": "unavailable"}.get(status, "requested"),
         request_id, alert_ids),
    )

    names = [in_request[a] for a in alert_ids]
    who = user.get("email") or "The buyer"

    def listed(word: str) -> str:
        return _lines([
            "\n".join(["• " + item_lines(item)[0], *item_lines(item)[1:], f"  Status: {word}"])
            for item in names
        ])

    if status == "ordered":
        subject = f"{who} ordered {_plural(len(names), 'product')} for {request['store_name']}"
        body = listed("ordered")
    else:
        subject = f"{who} couldn't order {_plural(len(names), 'product')} for {request['store_name']}"
        body = listed("unavailable") + f"\n\nReason: {reason.strip()}"
    _notify(conn, store_managers(conn, request["store_id"]), request["store_id"],
            "order_update", subject, body, request_id)
    return get_request(conn, request_id)


def reassign_request(conn: Connection, request: dict, buyer_user_id: int, actor_id: int) -> dict:
    """Move pending work to a current store buyer, retaining all responses and history."""
    request_id = request["request_id"]
    if request["summary"]["pending"] == 0:
        raise stock.InventoryError("This request has no items awaiting buyer action", status=409)
    if buyer_user_id not in {b["user_id"] for b in low_stock.list_buyers(conn, request["store_id"], everyone=True)}:
        raise stock.InventoryError("That person isn't a buyer at this store")
    if buyer_user_id == request["buyer_user_id"]:
        return request
    conn.execute(
        "INSERT INTO order_request_reassignments (request_id, from_buyer_id, to_buyer_id, changed_by)"
        " VALUES (%s, %s, %s, %s)",
        (request_id, request["buyer_user_id"], buyer_user_id, actor_id),
    )
    conn.execute("UPDATE order_requests SET buyer_user_id = %s WHERE request_id = %s", (buyer_user_id, request_id))
    _notify(conn, [buyer_user_id], request["store_id"], "order_request",
            f"Order Request reassigned to you — {request['store_name']}", request_id=request_id)
    return get_request(conn, request_id)


# --- notifications ---------------------------------------------------------

_VISIBLE_MESSAGES = """FROM messages n JOIN users u ON u.user_id = n.recipient_user_id
    WHERE u.user_id = %s AND CASE n.kind
        WHEN 'order_request' THEN EXISTS (
            SELECT 1 FROM order_requests r
            WHERE r.request_id = n.request_id AND r.buyer_user_id = u.user_id
              AND r.store_id = n.store_id AND """ + _BUYER_ELIGIBLE + """
        )
        ELSE (u.role = 'system_admin' AND n.kind = 'order_update') OR
            (u.role = 'store_admin' AND EXISTS (
                SELECT 1 FROM user_stores us
                WHERE us.user_id = u.user_id AND us.store_id = n.store_id
            ))
    END"""


def list_messages(conn: Connection, user_id: int, limit: int = 50) -> list[dict]:
    rows = conn.execute(
        "SELECT n.message_id, n.kind, n.subject, n.body, n.store_id, n.request_id, n.created_at,"
        " n.read_at IS NOT NULL AS read " + _VISIBLE_MESSAGES
        + " ORDER BY n.created_at DESC, n.message_id DESC LIMIT %s",
        (user_id, limit),
    ).fetchall()
    return secure_text.decrypt_rows(rows, "subject", "body")


def unread_by_store(conn: Connection, user_id: int) -> dict[int, int]:
    """Unread notifications per store, so a manager of several stores sees which has news."""
    rows = conn.execute(
        "SELECT n.store_id, count(*) AS n " + _VISIBLE_MESSAGES
        + " AND n.read_at IS NULL AND n.store_id IS NOT NULL GROUP BY n.store_id",
        (user_id,),
    ).fetchall()
    return {row["store_id"]: row["n"] for row in rows}


def unread_count(conn: Connection, user_id: int) -> int:
    return conn.execute(
        "SELECT count(*) AS n " + _VISIBLE_MESSAGES + " AND n.read_at IS NULL",
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
    filters, params = [], [user_id]
    if message_ids is not None:
        filters.append("n.message_id = ANY(%s)")
        params.append(message_ids)
    if request_id is not None:
        filters.append("n.request_id = %s")
        params.append(request_id)
    if store_id is not None:
        filters.append("n.store_id = %s")
        params.append(store_id)
    visible = "SELECT n.message_id " + _VISIBLE_MESSAGES
    if filters:
        visible += " AND " + " AND ".join(filters)
    return conn.execute(
        "UPDATE messages SET read_at = CURRENT_TIMESTAMP"
        f" WHERE read_at IS NULL AND message_id IN ({visible})",
        params,
    ).rowcount
