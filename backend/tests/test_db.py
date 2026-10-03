# AI-gen tests for the database schema and constraints.

from pathlib import Path
from urllib.parse import quote

import psycopg
import pytest
from testcontainers.community.postgres import PostgresContainer

INIT_SQL = Path(__file__).parents[1] / "db" / "init.sql"


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
            conn.execute(INIT_SQL.read_text())
        yield url


@pytest.fixture
def conn(db_url):
    with psycopg.connect(db_url, autocommit=True) as connection:
        yield connection


def test_seed_data_loaded(conn):
    rows = conn.execute(
        "SELECT name FROM products ORDER BY product_id"
    ).fetchall()
    assert [r[0] for r in rows] == [
        "Trail Running Shoe",
        "Everyday Sneaker",
        "Leather Boot",
    ]


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
