"""A shopper's active store: the one location that prices the catalog.

Mirrors preferences.py

Resolution order, everywhere:
    1. an explicit ?store_id= query param,
    2. the signed-in user's saved store,
    3. nothing — the client shows the "select a store" prompt.
"""

from psycopg import Connection


def get_selected_store(conn: Connection, user_id: int) -> int | None:
    """The user's saved store id, or None if they have not picked one."""
    row = conn.execute(
        "SELECT store_id FROM user_store_selection WHERE user_id = %s",
        (user_id,),
    ).fetchone()
    return row["store_id"] if row else None


def save_selected_store(conn: Connection, user_id: int, store_id: int) -> int:
    """Create or replace the user's store selection and return what was saved.

    DO UPDATE is required: a bare ON CONFLICT (user_id) would silently
    ignore the new value on a repeat save.
    """
    conn.execute(
        """
        INSERT INTO user_store_selection (user_id, store_id)
        VALUES (%s, %s)
        ON CONFLICT (user_id) DO UPDATE
            SET store_id = EXCLUDED.store_id,
                updated_at = CURRENT_TIMESTAMP
        """,
        (user_id, store_id),
    )
    return store_id


def clear_selected_store(conn: Connection, user_id: int) -> None:
    """Remove the user's selection; they go back to "no store selected"."""
    conn.execute(
        "DELETE FROM user_store_selection WHERE user_id = %s",
        (user_id,),
    )


def resolve_store_id(
    conn: Connection, user_id: int | None, store_id: int | None
) -> int | None:
    """Explicit ?store_id= wins, then the signed-in user's saved store, else None."""
    if store_id is not None:
        return store_id
    return get_selected_store(conn, user_id) if user_id is not None else None
