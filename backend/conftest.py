# Marks the backend/ directory as the pytest root, so application modules
# (main, database, schemas, routers) are importable from tests/.

import os
from pathlib import Path

import pytest

# A throwaway key so tests can save and read encrypted reorder messages
# (secure_text.py) without a backend/.env
os.environ.setdefault("MESSAGE_KEY", "JR4-LKccF2xPYrO1KxDHIp6kTWiBFpUsiA6HBElaSNo=")

DB_DIR = Path(__file__).parent / "db"


# Seeded products the stock and reorder tests use as plain "set the quantity
# to N" products. The seed gives them sizes (and the Air Force 1 colors), so
# apply_init_sql takes those off again unless a test asks to keep them.
PLAIN_FIXTURE_PRODUCTS = (1, 2, 3, 4)


def apply_init_sql(conn, keep_options: bool = False) -> None:
    """Apply every SQL file under db/ in the same order as `docker compose up`.

    Files directly inside db/ are run by the postgres image; files in
    subdirectories are run by db/zz-load-nested-sql.sh, after those.
    """
    top_level = sorted(DB_DIR.glob("*.sql"))
    nested = sorted(p for p in DB_DIR.rglob("*.sql") if p.parent != DB_DIR)
    for path in [*top_level, *nested]:
        conn.execute(path.read_text())
    if not keep_options:
        remove_options(conn, PLAIN_FIXTURE_PRODUCTS)


def remove_options(conn, product_ids) -> None:
    """Gives these products back a single default variant, keeping each
    store's total stock, and the usual low-stock level of 10."""
    from psycopg.rows import dict_row

    ids = list(product_ids)
    totals = conn.cursor(row_factory=dict_row).execute(
        "SELECT product_id, store_id, quantity FROM inventory WHERE product_id = ANY(%s)", (ids,)
    ).fetchall()
    conn.execute("DELETE FROM low_stock_alerts WHERE product_id = ANY(%s)", (ids,))
    conn.execute("DELETE FROM product_variants WHERE product_id = ANY(%s)", (ids,))
    conn.execute(
        "INSERT INTO product_variants (product_id, sku)"
        " SELECT product_id, 'P' || product_id FROM unnest(%s::INTEGER[]) AS product_id",
        (ids,),
    )
    for row in totals:
        conn.execute(
            "UPDATE variant_stock vs SET quantity = %s FROM product_variants v"
            " WHERE v.variant_id = vs.variant_id AND v.product_id = %s AND vs.store_id = %s",
            (row["quantity"], row["product_id"], row["store_id"]),
        )
    conn.execute("UPDATE inventory SET low_stock_threshold = 10 WHERE product_id = ANY(%s)", (ids,))



@pytest.fixture(autouse=True)
def _no_learned_for_you_weights(monkeypatch, tmp_path):
    """A locally trained models/for_you_weights.json must not change test results."""
    import for_you_model

    monkeypatch.setattr(for_you_model, "WEIGHTS_FILE", tmp_path / "for_you_weights.json")
