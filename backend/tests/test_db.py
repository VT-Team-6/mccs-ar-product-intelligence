# AI-gen tests for the database schema and constraints.

import re
from urllib.parse import quote

import psycopg
import pytest
from testcontainers.community.postgres import PostgresContainer

from conftest import DB_DIR, apply_init_sql

PRODUCTS_SEED = DB_DIR / "seeds" / "001-products.sql"
# Each seed tuple is one line, and its first literal is the product name.
_SEEDED_NAME = re.compile(r"^\s*\('((?:[^']|'')*)'", re.MULTILINE)

# Guards against a truncated seed file silently satisfying the comparison in
# test_seed_data_loaded: both sides of that comparison derive from this file, so
# losing rows would otherwise go unnoticed. Update this when seeds change.
EXPECTED_SEED_COUNT = 52


def _seeded_product_names() -> list[str]:
    """Product names from the seed file, in file order.

    Parsed from the SQL so the test tracks the seed data rather than
    duplicating it as a second hard-coded list that silently goes stale.
    """
    text = PRODUCTS_SEED.read_text(encoding="utf-8")
    return [name.replace("''", "'") for name in _SEEDED_NAME.findall(text)]


def _connection_url(pg):
    # testcontainers masks credentials in get_connection_url(), so build it here.
    return (
        f"postgresql://{quote(pg.username)}:{quote(pg.password)}"
        f"@{pg.get_container_host_ip()}:{pg.get_exposed_port(5432)}/{pg.dbname}"
    )


@pytest.fixture(scope="session")
def db_url():
    with PostgresContainer("postgres:17") as pg:
        url = _connection_url(pg)
        with psycopg.connect(url, autocommit=True) as conn:
            apply_init_sql(conn)
        yield url


@pytest.fixture
def conn(db_url):
    with psycopg.connect(db_url, autocommit=True) as connection:
        yield connection


def test_seed_data_loaded(conn):
    expected = _seeded_product_names()
    assert len(expected) == EXPECTED_SEED_COUNT, (
        f"parsed {len(expected)} product names from {PRODUCTS_SEED.name}, "
        f"expected {EXPECTED_SEED_COUNT}"
    )

    rows = conn.execute("SELECT name FROM products ORDER BY product_id").fetchall()
    assert [r[0] for r in rows] == expected


def test_rating_range_enforced(conn):
    with pytest.raises(psycopg.errors.CheckViolation):
        conn.execute(
            "INSERT INTO products (name, product_type, rating) VALUES ('Bad', 'X', 7.5)"
        )


def test_inventory_requires_existing_store(conn):
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        conn.execute(
            "INSERT INTO inventory (product_id, store_id, quantity, price)"
            " VALUES (1, 999, 5, 9.99)"
        )


def test_inventory_unique_per_product_and_store(conn):
    conn.execute("INSERT INTO stores (name, address) VALUES ('S1', '1 Main St')")
    store_id = conn.execute(
        "SELECT store_id FROM stores WHERE name = 'S1'"
    ).fetchone()[0]
    conn.execute(
        "INSERT INTO inventory (product_id, store_id, quantity, price)"
        " VALUES (1, %s, 5, 9.99)",
        (store_id,),
    )
    with pytest.raises(psycopg.errors.UniqueViolation):
        conn.execute(
            "INSERT INTO inventory (product_id, store_id, quantity, price)"
            " VALUES (1, %s, 9, 4.99)",
            (store_id,),
        )
