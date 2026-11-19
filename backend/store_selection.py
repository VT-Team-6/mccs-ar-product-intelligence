"""A shopper's active store: the one location that prices the catalog.

Mirrors preferences.py

Resolution order, everywhere:
    1. an explicit ?store_id= query param,
    2. the signed-in user's home store,
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


def save_selected_store(
    conn: Connection, user_id: int, store_id: int, *, only_if_unset: bool = False
) -> int | None:
    """Save a home store, optionally keeping any preference already set."""
    conflict = "DO NOTHING" if only_if_unset else (
        "DO UPDATE SET store_id = EXCLUDED.store_id, updated_at = CURRENT_TIMESTAMP"
    )
    saved = conn.execute(
        f"""
        INSERT INTO user_store_selection (user_id, store_id)
        VALUES (%s, %s)
        ON CONFLICT (user_id) {conflict}
        RETURNING store_id
        """,
        (user_id, store_id),
    ).fetchone()
    return saved["store_id"] if saved else get_selected_store(conn, user_id)


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
