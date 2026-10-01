import os

import psycopg
from psycopg.rows import dict_row

# Local Docker database by default. Later this points at the real database.
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://mccs:mccs@localhost:5433/mccs")


def get_product(product_id: int):
    """Return one product as a dict, or None if that ID doesn't exist."""
    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        return conn.execute(
            "SELECT product_id, name, product_type, price, rating, description "
            "FROM products WHERE product_id = %s",
            (product_id,),
        ).fetchone()