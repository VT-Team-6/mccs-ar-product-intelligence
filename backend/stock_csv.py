"""End-of-day stock update by CSV: export a store's stock, edit it, import it.

The export lists every product the store sells, with the columns the import
reads back:

    product_id, name, brand, stock

Staff overwrite the stock column with what is on the shelf at closing and import
the file. Only product_id and stock are read; name and brand are there so the
file is easy to fill in. A row with a blank stock, or the same stock as now, is
no change, and a product missing from the file keeps its stock.

The import is two steps. preview() checks every row and says what would change
without writing anything. apply() saves all the changes or, if any row has a
problem, none of them.
"""

import csv
import io
from itertools import islice

from psycopg import Connection

import reorders
import stock

COLUMNS = ["product_id", "name", "brand", "stock"]
REQUIRED = ("product_id", "stock")

# A store has a few hundred products; anything far bigger is the wrong file.
MAX_ROWS = 5000
MAX_PRODUCT_ID = 2_147_483_647  # PostgreSQL INTEGER


def export_csv(conn: Connection, store_id: int) -> str:
    """The store's active products and their stock, sorted by name."""
    stock._require_store(conn, store_id)
    rows = conn.execute(
        "SELECT i.product_id, p.name, p.brand, i.quantity"
        " FROM inventory i JOIN products p ON p.product_id = i.product_id"
        " WHERE i.store_id = %s AND i.status = 'active' AND p.deleted_at IS NULL"
        " ORDER BY lower(p.name), i.product_id",
        (store_id,),
    ).fetchall()

    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(COLUMNS)
    for row in rows:
        writer.writerow(
            [row["product_id"], row["name"], row["brand"] or "", row["quantity"] or 0]
        )
    return out.getvalue()


def _whole_number(text: str) -> int | None:
    """'14', ' 14 ' and Excel's '14.0' are 14. Anything else is None."""
    try:
        value = float(text.strip())
    except ValueError:
        return None
    if not value.is_integer():
        return None
    return int(value)


def _new_quantity(row: dict, current: int) -> tuple[int | None, str | None]:
    """The stock a row asks for, or a problem.

    Kept on its own so a "sold today" column can be added later: it would
    return current - sold here instead.
    """
    text = (row.get("stock") or "").strip()
    if not text:
        return None, None
    value = _whole_number(text)
    if value is None:
        return None, f"Stock must be a whole number, not '{text}'"
    if value < 0:
        return None, "Stock cannot be negative"
    return value, None


def preview(conn: Connection, store_id: int, text: str, *, lock_inventory: bool = False) -> dict:
    """What importing this file would change, and any rows with problems."""
    stock._require_store(conn, store_id)
    reader = csv.DictReader(io.StringIO(text.lstrip("﻿")))
    headers = [h.strip().lower() for h in (reader.fieldnames or [])]
    missing = [column for column in REQUIRED if column not in headers]
    if missing:
        raise stock.InventoryError(
            "The file needs a product_id column and a stock column."
            " Export the stock again to get the right format."
        )
    reader.fieldnames = headers

    rows = list(islice(reader, MAX_ROWS + 1))
    if len(rows) > MAX_ROWS:
        raise stock.InventoryError(f"The file has more than {MAX_ROWS} rows")
    parsed_rows = []
    product_ids = set()
    for line, row in enumerate(rows, start=2):  # line 1 is the header
        if not any((value or "").strip() for value in row.values() if isinstance(value, str)):
            continue
        raw_id = (row.get("product_id") or "").strip()
        product_id = _whole_number(raw_id)
        parsed_rows.append((line, row, raw_id, product_id))
        if product_id is not None and 0 < product_id <= MAX_PRODUCT_ID:
            product_ids.add(product_id)
    # Applying a file takes the same row locks as manual stock edits. Preview
    # stays read-only, while apply calculates the changes from the locked rows.
    lock = " ORDER BY i.product_id FOR NO KEY UPDATE OF i" if lock_inventory else ""
    current = {
        row["product_id"]: row
        for row in conn.execute(
            "SELECT i.product_id, p.name, p.brand, i.quantity, i.low_stock_threshold"
            " FROM inventory i JOIN products p ON p.product_id = i.product_id"
            " WHERE i.store_id = %s AND i.product_id = ANY(%s::integer[])"
            " AND i.status = 'active' AND p.deleted_at IS NULL" + lock,
            (store_id, sorted(product_ids)),
        ).fetchall()
    }

    changes, errors, seen = [], [], set()
    unchanged = 0
    low_after = 0  # products this import takes from above their low-stock level to at or below it
    for line, row, raw_id, product_id in parsed_rows:
        if product_id is None:
            errors.append({"row": line, "message": f"'{raw_id}' is not a product id"})
            continue
        if product_id in seen:
            errors.append({"row": line, "message": f"Product {product_id} is in the file twice"})
            continue
        seen.add(product_id)

        product = current.get(product_id)
        if product is None:
            errors.append({"row": line, "message": f"Product {product_id} isn't sold at this store"})
            continue

        old = product["quantity"] or 0
        new, problem = _new_quantity(row, old)
        if problem:
            errors.append({"row": line, "message": f"{product['name']}: {problem}"})
        elif new is None or new == old:
            unchanged += 1
        else:
            threshold = product["low_stock_threshold"]
            if new <= threshold < old:
                low_after += 1
            changes.append({
                "product_id": product_id,
                "name": product["name"],
                "brand": product["brand"],
                "old_quantity": old,
                "new_quantity": new,
            })

    return {
        "store_id": store_id,
        "changes": changes,
        "unchanged": unchanged,
        "errors": errors,
        "low_after": low_after,
    }


def apply(conn: Connection, store_id: int, text: str, user_id: int) -> dict:
    """Save every change in the file, or nothing if any row has a problem.

    The caller's connection commits once at the end, so a failure part way
    through rolls the whole import back.
    """
    result = preview(conn, store_id, text, lock_inventory=True)
    if result["errors"]:
        raise stock.InventoryError(
            f"{len(result['errors'])} row(s) have problems. Fix them and import again."
        )
    for change in result["changes"]:
        conn.execute(
            "UPDATE inventory SET quantity = %s, updated_at = CURRENT_TIMESTAMP"
            " WHERE product_id = %s AND store_id = %s",
            (change["new_quantity"], change["product_id"], store_id),
        )
        stock.log_change(
            conn, change["product_id"], store_id,
            change["old_quantity"], change["new_quantity"], "csv", user_id,
        )
    # One message to the managers for everything this import made low
    reorders.check_stock(conn, store_id, [change["product_id"] for change in result["changes"]])
    return result
