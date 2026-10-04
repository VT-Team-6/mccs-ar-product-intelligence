import os
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row

DEFAULT_DATABASE_URL = "postgresql://mccs:mccs@localhost:5433/mccs"


def get_database_url() -> str:
    return os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)


@contextmanager
def get_connection():
    """Yield a dict-row connection that commits on success, rolls back on error."""
    with psycopg.connect(get_database_url(), row_factory=dict_row) as conn:
        yield conn


def get_product(product_id: int):
    """Return one product as a dict, or None if that ID doesn't exist."""
    with get_connection() as conn:
        return conn.execute(
            "SELECT product_id, name, brand, product_type, rating, description "
            "FROM products WHERE product_id = %s",
            (product_id,),
        ).fetchone()