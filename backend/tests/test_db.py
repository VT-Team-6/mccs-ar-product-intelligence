# AI-gen tests for the database schema and constraints.

import re
import uuid
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


def _new_user(conn) -> int:
    """Create a user with unique Cognito/email values and return its user_id."""
    token = uuid.uuid4().hex
    return conn.execute(
        "INSERT INTO users (cognito_sub, email) VALUES (%s, %s) RETURNING user_id",
        (f"sub-{token}", f"{token}@example.com"),
    ).fetchone()[0]


def _new_product(conn) -> int:
    """Create a product and return its product_id."""
    return conn.execute(
        "INSERT INTO products (name, product_type)"
        " VALUES (%s, 'Test') RETURNING product_id",
        (f"Test Product {uuid.uuid4().hex}",),
    ).fetchone()[0]


def _missing_id(conn, table: str, column: str) -> int:
    """An ID that cannot exist yet, so tests never depend on seeded rows."""
    return conn.execute(
        f"SELECT COALESCE(MAX({column}), 0) + 1 FROM {table}"
    ).fetchone()[0]


def _index_def(conn, name: str) -> str:
    """The full CREATE INDEX statement for an index, or '' if it does not exist."""
    row = conn.execute(
        "SELECT indexdef FROM pg_indexes WHERE indexname = %s", (name,)
    ).fetchone()
    return row[0] if row else ""


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


def test_product_deleted_at_is_nullable_and_defaults_to_null(conn):
    product_id = _new_product(conn)
    deleted_at = conn.execute(
        "SELECT deleted_at FROM products WHERE product_id = %s", (product_id,)
    ).fetchone()[0]
    assert deleted_at is None


def test_history_accepts_every_action(conn):
    user_id = _new_user(conn)
    product_id = _new_product(conn)
    for interaction in ("scanned", "viewed", "viewed-from-search", "purchased", "liked", "unliked"):
        conn.execute(
            "INSERT INTO user_product_history (product_id, user_id, interaction)"
            " VALUES (%s, %s, %s)",
            (product_id, user_id, interaction),
        )
    rows = conn.execute(
        "SELECT interaction FROM user_product_history WHERE user_id = %s ORDER BY history_id",
        (user_id,),
    ).fetchall()
    assert [r[0] for r in rows] == [
        "scanned",
        "viewed",
        "viewed-from-search",
        "purchased",
        "liked",
        "unliked",
    ]


def test_history_rejects_unknown_action(conn):
    user_id = _new_user(conn)
    product_id = _new_product(conn)
    # An unknown value is rejected by the enum type itself.
    with pytest.raises(psycopg.errors.InvalidTextRepresentation):
        conn.execute(
            "INSERT INTO user_product_history (product_id, user_id, interaction)"
            " VALUES (%s, %s, 'abandoned')",
            (product_id, user_id),
        )


def test_history_occurred_at_defaults_to_now(conn):
    user_id = _new_user(conn)
    product_id = _new_product(conn)
    occurred_at = conn.execute(
        "INSERT INTO user_product_history (product_id, user_id, interaction)"
        " VALUES (%s, %s, 'viewed') RETURNING occurred_at",
        (product_id, user_id),
    ).fetchone()[0]
    assert occurred_at is not None


def test_history_requires_existing_user(conn):
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        conn.execute(
            "INSERT INTO user_product_history (product_id, user_id, interaction)"
            " VALUES (%s, %s, 'viewed')",
            (_new_product(conn), _missing_id(conn, "users", "user_id")),
        )


def test_history_requires_existing_product(conn):
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        conn.execute(
            "INSERT INTO user_product_history (product_id, user_id, interaction)"
            " VALUES (%s, %s, 'viewed')",
            (_missing_id(conn, "products", "product_id"), _new_user(conn)),
        )


def test_history_blocks_deleting_referenced_product(conn):
    user_id = _new_user(conn)
    product_id = _new_product(conn)
    conn.execute(
        "INSERT INTO user_product_history (product_id, user_id, interaction)"
        " VALUES (%s, %s, 'purchased')",
        (product_id, user_id),
    )
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        conn.execute("DELETE FROM products WHERE product_id = %s", (product_id,))


def test_likes_default_liked_at(conn):
    user_id = _new_user(conn)
    liked_at = conn.execute(
        "INSERT INTO user_product_likes (product_id, user_id) VALUES (%s, %s)"
        " RETURNING liked_at",
        (_new_product(conn), user_id),
    ).fetchone()[0]
    assert liked_at is not None


def test_likes_one_row_per_product_per_user(conn):
    user_id = _new_user(conn)
    for _ in range(2):
        conn.execute(
            "INSERT INTO user_product_likes (product_id, user_id) VALUES (%s, %s)",
            (_new_product(conn), user_id),
        )
    count = conn.execute(
        "SELECT COUNT(*) FROM user_product_likes WHERE user_id = %s", (user_id,)
    ).fetchone()[0]
    assert count == 2


def test_likes_rejects_duplicate_product_for_user(conn):
    user_id = _new_user(conn)
    product_id = _new_product(conn)
    conn.execute(
        "INSERT INTO user_product_likes (product_id, user_id) VALUES (%s, %s)",
        (product_id, user_id),
    )
    with pytest.raises(psycopg.errors.UniqueViolation):
        conn.execute(
            "INSERT INTO user_product_likes (product_id, user_id) VALUES (%s, %s)",
            (product_id, user_id),
        )


def test_likes_requires_existing_user(conn):
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        conn.execute(
            "INSERT INTO user_product_likes (product_id, user_id) VALUES (%s, %s)",
            (_new_product(conn), _missing_id(conn, "users", "user_id")),
        )


def test_likes_requires_existing_product(conn):
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        conn.execute(
            "INSERT INTO user_product_likes (product_id, user_id) VALUES (%s, %s)",
            (_missing_id(conn, "products", "product_id"), _new_user(conn)),
        )


def test_likes_block_deleting_referenced_product(conn):
    product_id = _new_product(conn)
    conn.execute(
        "INSERT INTO user_product_likes (product_id, user_id) VALUES (%s, %s)",
        (product_id, _new_user(conn)),
    )
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        conn.execute("DELETE FROM products WHERE product_id = %s", (product_id,))


def test_deleting_user_cascades_to_history_and_likes(conn):
    user_id = _new_user(conn)
    product_id = _new_product(conn)
    conn.execute(
        "INSERT INTO user_product_history (product_id, user_id, interaction)"
        " VALUES (%s, %s, 'liked')",
        (product_id, user_id),
    )
    conn.execute(
        "INSERT INTO user_product_likes (product_id, user_id) VALUES (%s, %s)",
        (product_id, user_id),
    )

    conn.execute("DELETE FROM users WHERE user_id = %s", (user_id,))

    history = conn.execute(
        "SELECT COUNT(*) FROM user_product_history WHERE user_id = %s", (user_id,)
    ).fetchone()[0]
    likes = conn.execute(
        "SELECT COUNT(*) FROM user_product_likes WHERE user_id = %s", (user_id,)
    ).fetchone()[0]
    assert history == 0
    assert likes == 0


def test_history_recent_index_covers_user_and_occurred_at(conn):
    indexdef = _index_def(conn, "idx_user_product_history_recent")
    assert indexdef, "idx_user_product_history_recent is missing"
    assert "(user_id, occurred_at DESC, history_id DESC)" in indexdef


def test_likes_indexes_exist(conn):
    recent = _index_def(conn, "idx_user_product_likes_recent")
    assert recent, "idx_user_product_likes_recent is missing"
    assert "(user_id, liked_at DESC)" in recent

    per_product = _index_def(conn, "idx_user_product_likes_product")
    assert per_product, "idx_user_product_likes_product is missing"
    assert "(product_id)" in per_product
