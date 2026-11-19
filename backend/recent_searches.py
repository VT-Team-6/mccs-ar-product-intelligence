"""Recent searches for signed-in shoppers.

record() is called each time a search runs. A repeated search (ignoring case)
moves back to the top instead of being listed twice, and only the newest
KEEP searches are kept for each person.
"""

from psycopg import Connection

KEEP = 10
MIN_LENGTH = 2


def record(conn: Connection, user_id: int, query: str) -> None:
    """Save a search, or move it to the top if it's already there."""
    text = " ".join(query.split())[:200]
    if len(text) < MIN_LENGTH:
        return
    conn.execute(
        "INSERT INTO recent_searches (user_id, query) VALUES (%s, %s)"
        " ON CONFLICT (user_id, lower(query))"
        " DO UPDATE SET query = EXCLUDED.query, searched_at = CURRENT_TIMESTAMP",
        (user_id, text),
    )
    # Keep only the newest few
    conn.execute(
        "DELETE FROM recent_searches WHERE user_id = %s AND search_id NOT IN ("
        "  SELECT search_id FROM recent_searches WHERE user_id = %s"
        "  ORDER BY searched_at DESC, search_id DESC LIMIT %s)",
        (user_id, user_id, KEEP),
    )


def list_recent(conn: Connection, user_id: int) -> list[dict]:
    """The person's recent searches, newest first."""
    return conn.execute(
        "SELECT search_id, query, searched_at FROM recent_searches"
        " WHERE user_id = %s ORDER BY searched_at DESC, search_id DESC LIMIT %s",
        (user_id, KEEP),
    ).fetchall()


def remove(conn: Connection, user_id: int, search_id: int) -> bool:
    """Remove one of the person's searches. False if it isn't theirs or doesn't exist."""
    row = conn.execute(
        "DELETE FROM recent_searches WHERE search_id = %s AND user_id = %s RETURNING search_id",
        (search_id, user_id),
    ).fetchone()
    return row is not None


def clear(conn: Connection, user_id: int) -> None:
    conn.execute("DELETE FROM recent_searches WHERE user_id = %s", (user_id,))
