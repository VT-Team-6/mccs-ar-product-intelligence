"""Low-stock levels and buyers for a store's products.

Each inventory row holds its own low_stock_threshold and buyer_user_id. The
bulk editor sends many products at once and the edit screen sends one; both go
through update_settings, so there is one place these values are written.
"""

from psycopg import Connection

import stock


# The seed data's demo accounts. They're offered as buyers only until the
# store has a real one.
EXAMPLE_DOMAIN = "@example.com"


def list_buyers(conn: Connection, store_id: int, everyone: bool = False) -> list[dict]:
    """The store buyers assigned to this store, the only people who can be a product's buyer.

    Once the store has a real buyer, the seed's example.com demo buyers are left
    out, unless everyone is True (used to check a buyer someone already picked).
    """
    stock._require_store(conn, store_id)
    buyers = conn.execute(
        "SELECT u.user_id, u.email FROM users u"
        " JOIN user_stores us ON us.user_id = u.user_id"
        " WHERE us.store_id = %s AND u.role = 'store_buyer'"
        " ORDER BY lower(u.email)",
        (store_id,),
    ).fetchall()
    real = [b for b in buyers if not b["email"].lower().endswith(EXAMPLE_DOMAIN)]
    return buyers if everyone or not real else real


def update_settings(
    conn: Connection,
    store_id: int,
    product_ids: list[int],
    low_stock_threshold: int | None = None,
    buyer_user_id: int | None = None,
    clear_buyer: bool = False,
) -> int:
    """Set the low-stock level and/or buyer on these products at this store.

    A value left as None is not changed. clear_buyer removes the buyer.
    Every product must be in the store's inventory, and the buyer must be a
    store buyer at this store, or nothing is changed. Returns how many products
    were updated.
    """
    stock._require_store(conn, store_id)
    if low_stock_threshold is None and buyer_user_id is None and not clear_buyer:
        raise stock.InventoryError("Give a low-stock level or a buyer to change")
    if low_stock_threshold is not None and low_stock_threshold < 0:
        raise stock.InventoryError("The low-stock level cannot be negative")

    ids = sorted(set(product_ids))
    found = {
        row["product_id"]
        for row in conn.execute(
            "SELECT product_id FROM inventory WHERE store_id = %s AND product_id = ANY(%s)",
            (store_id, ids),
        ).fetchall()
    }
    missing = [product_id for product_id in ids if product_id not in found]
    if missing:
        listed = ", ".join(map(str, missing[:5]))
        raise stock.InventoryError(f"Not in this store's inventory: product {listed}", status=404)

    if buyer_user_id is not None:
        buyers = {buyer["user_id"] for buyer in list_buyers(conn, store_id, everyone=True)}
        if buyer_user_id not in buyers:
            raise stock.InventoryError("That person isn't a buyer at this store")

    sets, params = [], []
    if low_stock_threshold is not None:
        sets.append("low_stock_threshold = %s")
        params.append(low_stock_threshold)
    if clear_buyer:
        sets.append("buyer_user_id = NULL")
    elif buyer_user_id is not None:
        sets.append("buyer_user_id = %s")
        params.append(buyer_user_id)

    conn.execute(
        f"UPDATE inventory SET {', '.join(sets)}, updated_at = CURRENT_TIMESTAMP"
        " WHERE store_id = %s AND product_id = ANY(%s)",
        (*params, store_id, ids),
    )
    return len(ids)


def set_variant_levels(
    conn: Connection,
    store_id: int,
    product_id: int,
    low_stock_threshold: int | None,
    levels: list[dict],
) -> None:
    """Set a product's low-stock level and/or its colors'/sizes' own levels at a store.

    Each entry in levels is {variant_id, low_stock_threshold}; a None level
    clears it so that size uses the product's level again. Every variant must
    belong to the product, or nothing is changed. The caller re-checks alerts.
    """
    stock._require_store(conn, store_id)
    entry = conn.execute(
        "SELECT 1 FROM inventory WHERE store_id = %s AND product_id = %s FOR NO KEY UPDATE",
        (store_id, product_id),
    ).fetchone()
    if entry is None:
        raise stock.InventoryError(f"Not in this store's inventory: product {product_id}", status=404)

    wanted = {level["variant_id"]: level["low_stock_threshold"] for level in levels}
    if wanted:
        owned = {
            row["variant_id"]
            for row in conn.execute(
                "SELECT variant_id FROM product_variants WHERE product_id = %s AND variant_id = ANY(%s)",
                (product_id, list(wanted)),
            ).fetchall()
        }
        if owned != set(wanted):
            raise stock.InventoryError("Some of these sizes aren't part of this product. Refresh and try again.")

    if low_stock_threshold is not None:
        conn.execute(
            "UPDATE inventory SET low_stock_threshold = %s, updated_at = CURRENT_TIMESTAMP"
            " WHERE store_id = %s AND product_id = %s",
            (low_stock_threshold, store_id, product_id),
        )
    for variant_id, level in wanted.items():
        # A size with no stock row yet gets one at 0, so it can hold its level
        conn.execute(
            "INSERT INTO variant_stock (variant_id, store_id, quantity, low_stock_threshold)"
            " VALUES (%s, %s, 0, %s)"
            " ON CONFLICT (variant_id, store_id) DO UPDATE SET low_stock_threshold = EXCLUDED.low_stock_threshold",
            (variant_id, store_id, level),
        )
