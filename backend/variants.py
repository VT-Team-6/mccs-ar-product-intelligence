"""Colors and sizes: a product's variants, and each variant's stock at a store.

A product has one or more variants, one per color/size combination it comes
in. A product with no options has a single default variant (no color, no
size). Which options make sense depends on the category:

    shoes                  color and size
    backpacks, headphones  color
    coffee, shampoo        size

Photos follow the option that changes how the product looks: color for shoes,
backpacks and headphones, size for coffee and shampoo (a bigger bag is a
different package). See PHOTO_OPTION.

Stock and price live on variant_stock (one row per variant per store). The
inventory row for the product at that store keeps the totals in step through
the triggers in db/migrations/023-product-variants.sql: quantity is the sum,
price the lowest ("from $90").

Like stock.py, every function takes an open connection and raises
stock.InventoryError for problems the caller can fix.
"""

import re

from psycopg import Connection

import stock

# Must match OPTIONS_FOR_CATEGORY in mobile/src/constants/variants.ts
OPTIONS: dict[str, tuple[str, ...]] = {
    "shoes": ("color", "size"),
    "backpacks": ("color",),
    "headphones": ("color",),
    "coffee": ("size",),
    "shampoo": ("size",),
}
PHOTO_OPTION: dict[str, str] = {
    "shoes": "color",
    "backpacks": "color",
    "headphones": "color",
    "coffee": "size",
    "shampoo": "size",
}

MAX_COLORS = 12
MAX_SIZES = 30
HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")

_VARIANT_COLUMNS = """
    v.variant_id, v.product_id, v.color, v.color_hex, v.color_hex_2, v.size, v.sku,
    v.color_order, v.size_order
"""


def options_for(category: str | None) -> tuple[str, ...]:
    return OPTIONS.get(category or "", ())


def label(variant: dict) -> str:
    """'Black / 10', 'Black', '12 oz', or '' for the default variant."""
    return " / ".join(part for part in (variant.get("color"), variant.get("size")) if part)


def _clean(text) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


def _sku_part(text: str | None) -> str:
    return re.sub(r"[^A-Za-z0-9.]+", "", text or "").upper()


def make_sku(product_id: int, color: str | None, size: str | None) -> str:
    return "-".join(part for part in (f"P{product_id}", _sku_part(color), _sku_part(size)) if part)


def list_variants(conn: Connection, product_id: int, store_id: int | None = None) -> list[dict]:
    """A product's variants in display order, with stock at the store if one is given.

    in_stock also needs the product to be active at the store.
    """
    if store_id is None:
        return conn.execute(
            f"SELECT {_VARIANT_COLUMNS}, NULL::INTEGER AS quantity, NULL::NUMERIC AS price,"
            " FALSE AS in_stock FROM product_variants v WHERE v.product_id = %s"
            " ORDER BY v.color_order, v.size_order, v.variant_id",
            (product_id,),
        ).fetchall()
    return conn.execute(
        f"SELECT {_VARIANT_COLUMNS}, vs.quantity, vs.price,"
        " COALESCE(vs.quantity > 0 AND i.status = 'active', FALSE) AS in_stock"
        " FROM product_variants v"
        " LEFT JOIN variant_stock vs ON vs.variant_id = v.variant_id AND vs.store_id = %s"
        " LEFT JOIN inventory i ON i.product_id = v.product_id AND i.store_id = %s"
        " WHERE v.product_id = %s"
        " ORDER BY v.color_order, v.size_order, v.variant_id",
        (store_id, store_id, product_id),
    ).fetchall()


def get_variant(conn: Connection, variant_id: int) -> dict | None:
    return conn.execute(
        f"SELECT {_VARIANT_COLUMNS} FROM product_variants v WHERE v.variant_id = %s",
        (variant_id,),
    ).fetchone()


def has_options(conn: Connection, product_id: int) -> bool:
    """True when the product comes in more than its single default variant."""
    row = conn.execute(
        "SELECT count(*) AS n, bool_or(color IS NOT NULL OR size IS NOT NULL) AS named"
        " FROM product_variants WHERE product_id = %s",
        (product_id,),
    ).fetchone()
    return bool(row and (row["n"] > 1 or row["named"]))


def default_variant_id(conn: Connection, product_id: int) -> int | None:
    """The only variant of a product without options, else None."""
    rows = conn.execute(
        "SELECT variant_id FROM product_variants WHERE product_id = %s LIMIT 2",
        (product_id,),
    ).fetchall()
    return rows[0]["variant_id"] if len(rows) == 1 else None


def set_options(
    conn: Connection,
    product_id: int,
    category: str | None,
    colors: list[dict],
    sizes: list[str],
    skip: list[dict] | None = None,
) -> list[dict]:
    """Replace a product's colors and sizes.

    colors: [{"name": "Black", "hex": "#1A1A1A", "hex2": None}], sizes: ["9", "9.5"], in
    display order. Every color comes in every size except the combinations in
    skip ([{"color": "Black", "size": "6"}]).

    A combination that already exists keeps its variant, so its stock and SKU
    stay. A combination that's gone is removed with its stock. No options at all
    leaves the single default variant. Options the category doesn't use are
    refused, so a shampoo can't get colors.
    """
    allowed = options_for(category)
    # hex2 is a second swatch color for a two-tone colorway ("White/Black")
    colors = [
        {
            "name": _clean(c.get("name")),
            "hex": (c.get("hex") or "").strip() or None,
            "hex2": (c.get("hex2") or "").strip() or None,
        }
        for c in colors
    ]
    sizes = [_clean(s) for s in sizes]
    if colors and "color" not in allowed:
        raise stock.InventoryError(f"{(category or 'This category').capitalize()} don't come in colors")
    if sizes and "size" not in allowed:
        raise stock.InventoryError(f"{(category or 'This category').capitalize()} don't come in sizes")
    if len(colors) > MAX_COLORS:
        raise stock.InventoryError(f"Up to {MAX_COLORS} colors")
    if len(sizes) > MAX_SIZES:
        raise stock.InventoryError(f"Up to {MAX_SIZES} sizes")
    for color in colors:
        if not color["name"]:
            raise stock.InventoryError("Every color needs a name")
        if len(color["name"]) > 40:
            raise stock.InventoryError("Color names can be up to 40 characters")
        for code in (color["hex"], color["hex2"]):
            if code and not HEX.match(code):
                raise stock.InventoryError(f"'{code}' isn't a color code like #1A1A1A")
        if color["hex2"] and not color["hex"]:
            raise stock.InventoryError("A two-tone color needs its first swatch color too")
    for size in sizes:
        if not size:
            raise stock.InventoryError("Sizes can't be blank")
        if len(size) > 20:
            raise stock.InventoryError("Sizes can be up to 20 characters")
    lowered = [c["name"].lower() for c in colors]
    if len(set(lowered)) != len(lowered):
        raise stock.InventoryError("A color is listed twice")
    if len({s.lower() for s in sizes}) != len(sizes):
        raise stock.InventoryError("A size is listed twice")

    skipped = {
        (_clean(s.get("color")).lower() or None, _clean(s.get("size")).lower() or None)
        for s in (skip or [])
    }
    wanted = []  # (color, hex, hex2, size, color_order, size_order)
    for ci, color in enumerate(colors or [None], start=1):
        for si, size in enumerate(sizes or [None], start=1):
            key = ((color or {}).get("name", "").lower() or None, (size or "").lower() or None)
            if (colors or sizes) and key in skipped:
                continue
            wanted.append((
                color["name"] if color else None,
                color["hex"] if color else None,
                color["hex2"] if color else None,
                size,
                ci if color else 0,
                si if size else 0,
            ))
    if (colors or sizes) and not wanted:
        raise stock.InventoryError("Every combination is turned off. Keep at least one.")

    # Serialize option edits on this product
    conn.execute("SELECT 1 FROM products WHERE product_id = %s FOR NO KEY UPDATE", (product_id,))
    existing = {
        ((row["color"] or "").lower() or None, (row["size"] or "").lower() or None): row
        for row in conn.execute(
            "SELECT variant_id, color, size FROM product_variants WHERE product_id = %s",
            (product_id,),
        ).fetchall()
    }

    keep: set[int] = set()
    for color, hex_code, hex_code_2, size, color_order, size_order in wanted:
        key = ((color or "").lower() or None, (size or "").lower() or None)
        row = existing.get(key)
        if row:
            conn.execute(
                "UPDATE product_variants SET color = %s, color_hex = %s, color_hex_2 = %s, size = %s,"
                " color_order = %s, size_order = %s WHERE variant_id = %s",
                (color, hex_code, hex_code_2, size, color_order, size_order, row["variant_id"]),
            )
            keep.add(row["variant_id"])
            continue
        sku = make_sku(product_id, color, size)
        # A SKU taken by another product (edited by hand) gets a number on the end
        n = 2
        while conn.execute("SELECT 1 FROM product_variants WHERE sku = %s", (sku,)).fetchone():
            sku = f"{make_sku(product_id, color, size)}-{n}"
            n += 1
        new = conn.execute(
            "INSERT INTO product_variants"
            " (product_id, color, color_hex, color_hex_2, size, color_order, size_order, sku)"
            " VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING variant_id",
            (product_id, color, hex_code, hex_code_2, size, color_order, size_order, sku),
        ).fetchone()
        keep.add(new["variant_id"])

    # Open low-stock alerts for removed options are closed first; their history stays.
    conn.execute(
        "UPDATE low_stock_alerts a SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP"
        " FROM product_variants v WHERE v.variant_id = a.variant_id AND v.product_id = %s"
        " AND NOT (v.variant_id = ANY(%s)) AND a.status <> 'resolved'",
        (product_id, sorted(keep)),
    )
    conn.execute(
        "DELETE FROM product_variants WHERE product_id = %s AND NOT (variant_id = ANY(%s))",
        (product_id, sorted(keep)),
    )
    return list_variants(conn, product_id)


def set_stock(
    conn: Connection,
    variant_id: int,
    store_id: int,
    quantity: int | None = None,
    price=None,
    actor_user_id: int | None = None,
    source: str = "manual",
) -> dict:
    """Set one variant's stock and/or price at a store. The product must be in that store's inventory."""
    if quantity is None and price is None:
        raise stock.InventoryError("Give a quantity or a price")
    if quantity is not None and quantity < 0:
        raise stock.InventoryError("Quantity cannot be negative")
    if price is not None and price < 0:
        raise stock.InventoryError("Price cannot be negative")
    variant = get_variant(conn, variant_id)
    if variant is None:
        raise stock.InventoryError(f"Variant {variant_id} not found", status=404)
    entry = conn.execute(
        "SELECT status FROM inventory WHERE product_id = %s AND store_id = %s FOR NO KEY UPDATE",
        (variant["product_id"], store_id),
    ).fetchone()
    if entry is None:
        raise stock.InventoryError(
            f"Product {variant['product_id']} is not stocked at store {store_id}", status=404
        )
    current = conn.execute(
        "SELECT quantity, price FROM variant_stock WHERE variant_id = %s AND store_id = %s FOR UPDATE",
        (variant_id, store_id),
    ).fetchone()
    old_quantity = current["quantity"] if current else None
    conn.execute(
        "INSERT INTO variant_stock (variant_id, store_id, quantity, price)"
        " VALUES (%s, %s, COALESCE(%s, 0), %s)"
        " ON CONFLICT (variant_id, store_id) DO UPDATE SET"
        "   quantity = COALESCE(%s, variant_stock.quantity),"
        "   price = COALESCE(%s, variant_stock.price),"
        "   updated_at = CURRENT_TIMESTAMP",
        (variant_id, store_id, quantity, price, quantity, price),
    )
    if quantity is not None and quantity != old_quantity:
        stock.log_change(
            conn, variant["product_id"], store_id, old_quantity, quantity, source, actor_user_id,
            variant_id=variant_id,
        )
    row = list_variants(conn, variant["product_id"], store_id)
    return next(v for v in row if v["variant_id"] == variant_id)


def store_variants(conn: Connection, store_id: int, product_id: int) -> list[dict]:
    """A product's variants at a store, for the staff inventory screen, with low-stock flags."""
    stock._require_store(conn, store_id)
    entry = conn.execute(
        "SELECT status, low_stock_threshold FROM inventory WHERE product_id = %s AND store_id = %s",
        (product_id, store_id),
    ).fetchone()
    if entry is None:
        raise stock.InventoryError(f"Product {product_id} is not stocked at store {store_id}", status=404)
    rows = list_variants(conn, product_id, store_id)
    for row in rows:
        row["label"] = label(row)
        row["low_stock"] = entry["status"] == "active" and (row["quantity"] or 0) <= entry["low_stock_threshold"]
    return rows


def photo_matches(image: dict, variant: dict) -> bool:
    """Whether a tagged photo belongs to this variant (an untagged photo belongs to all)."""
    for option in ("color", "size"):
        tag = image.get(option)
        if tag and (variant.get(option) or "").lower() != tag.lower():
            return False
    return True
