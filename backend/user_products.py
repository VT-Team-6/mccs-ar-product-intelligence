"""Business logic for a shopper's likes and product history.

Every function takes an explicit ``user_id`` and a connection, and never reads
request or authentication state. The routers pass the signed-in user's id today;
a future ``/api/users/{user_id}/...`` route can call the same functions without
these queries being duplicated. Ownership is enforced here by always filtering
on ``user_id``, so no caller can read or change another user's rows by accident.
"""

from typing import Any, Literal

from psycopg import Connection

from pagination import InvalidCursor, decode_cursor, encode_cursor

# Columns every product response carries, aliased so the joins below can use a
# bare `p` for products. Keeps responses the same shape as GET /api/products/{id}.
_PRODUCT_COLUMNS = (
    "p.product_id, p.name, p.brand, p.product_type, p.price, p.rating, "
    "p.description, p.image_url, p.created_at, p.updated_at"
)
_PRODUCT_KEYS = (
    "product_id", "name", "brand", "product_type", "price",
    "rating", "description", "image_url", "created_at", "updated_at",
)

# Interactions the client may report itself. Like changes are recorded by
# set_liked, so a client cannot forge them.
CLIENT_INTERACTIONS = ("scanned", "viewed", "viewed-from-search")


LikedSort = Literal["recent", "name", "rating", "price"]

# Newest like first, then stable tie-breakers so keyset paging never skips or
# repeats a row when two products share a sort value.
_SORT_ORDERS = {
    "recent": "lit.liked_at DESC, p.product_id DESC",
    "name": "p.name ASC, p.product_id ASC",
    "rating": "p.rating DESC NULLS LAST, p.product_id ASC",
    "price": "p.price ASC NULLS LAST, p.product_id ASC",
}


class UserProductError(Exception):
    """A caller-correctable problem, mapped to an HTTP status by the router.

    The service stays HTTP-agnostic so it can be reused from a future non-HTTP
    caller; ``status`` says what a web caller should return.
    """

    def __init__(self, detail: str, status: int = 422):
        super().__init__(detail)
        self.detail = detail
        self.status = status


def _fetch_product(conn: Connection, product_id: int) -> dict:
    row = conn.execute(
        f"SELECT {_PRODUCT_COLUMNS} FROM products p"
        " WHERE p.product_id = %s AND p.deleted_at IS NULL",
        (product_id,),
    ).fetchone()
    if row is None:
        raise UserProductError(f"Product {product_id} not found", status=404)
    return row


def _escape_like(text: str) -> str:
    """Make user text safe inside an ILIKE pattern (same rules as /api/search)."""
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _text_filter(query: str | None) -> tuple[str, tuple]:
    """A WHERE fragment matching the typed text against product text fields."""
    if not query or not query.strip():
        return "", ()
    pattern = f"%{_escape_like(query.strip())}%"
    return (
        " AND (p.name ILIKE %s OR p.brand ILIKE %s OR p.product_type ILIKE %s)",
        (pattern, pattern, pattern),
    )


def _resume_after(sort: LikedSort, values: dict[str, Any]) -> tuple[str, tuple]:
    """The WHERE fragment that resumes a sorted list right after a cursor row.

    Mirrors _SORT_ORDERS, including how NULL rating/price values sort last.
    """
    last = values["v"]
    product_id = values["id"]

    # Rating / Price sort
    if sort in ("rating", "price"):
        column = "p.rating" if sort == "rating" else "p.price"
        if last is None:
            # Everything after a NULL is the remaining NULLs, ordered by id.
            return f" AND ({column} IS NULL AND p.product_id > %s)", (product_id,)
        return (
            f" AND ({column} < %s"
            f" OR ({column} = %s AND p.product_id > %s)"
            f" OR {column} IS NULL)",
            (last, last, product_id),
        )

    # Recent sort
    if sort == "recent":
        return (
            " AND (lit.liked_at < %s"
            " OR (lit.liked_at = %s AND p.product_id < %s))",
            (last, last, product_id),
        )
    
    # Alphabetical sort
    return (
        " AND (p.name > %s OR (p.name = %s AND p.product_id > %s))",
        (last, last, product_id),
    )


def _cursor_for(last_row: dict, sort: LikedSort) -> str:
    if sort == "recent":
        value = last_row["liked_at"].isoformat()
    elif sort == "name":
        value = last_row["name"]
    else:
        value = last_row[sort]
    return encode_cursor({"v": value, "id": last_row["product_id"]})


def _page(rows: list[dict], limit: int) -> tuple[list[dict], bool]:
    """Trim the look-ahead row and report whether another page exists."""
    return rows[:limit], len(rows) > limit


def _product_from_row(row: dict, is_liked: bool) -> dict:
    """Extract the product fields from a row and add the user's like state."""
    return {**{key: row[key] for key in _PRODUCT_KEYS}, "is_liked": bool(is_liked)}


def get_product_for_user(conn: Connection, user_id: int, product_id: int) -> dict:
    """One product plus this user's current like state (``is_liked``)."""
    product = _fetch_product(conn, product_id)
    liked = conn.execute(
        "SELECT 1 FROM user_product_likes WHERE user_id = %s AND product_id = %s",
        (user_id, product_id),
    ).fetchone()
    return {**product, "is_liked": liked is not None}


def list_liked_products(
    conn: Connection,
    user_id: int,
    query: str | None,
    sort: LikedSort,
    limit: int,
    cursor: str | None,
) -> tuple[list[dict], str | None]:
    """One page of currently liked products, most recently liked first by default.

    ``query`` only narrows this user's likes; it never searches the catalog.
    """
    filter_sql, filter_params = _text_filter(query)
    sql = f"""
        SELECT {_PRODUCT_COLUMNS}, lit.liked_at
        FROM user_product_likes lit
        JOIN products p ON p.product_id = lit.product_id
        WHERE lit.user_id = %s AND p.deleted_at IS NULL{filter_sql}
    """
    params: tuple = (user_id, *filter_params)

    # Add a WHERE clause to resume after the last row of the previous page, if any.
    if cursor:
        try:
            values = decode_cursor(cursor, ("v", "id"))
        except InvalidCursor as error:
            raise UserProductError(str(error), status=400) from error
        resume_sql, resume_params = _resume_after(sort, values)
        sql += resume_sql
        params = (*params, *resume_params)

    sql += f" ORDER BY {_SORT_ORDERS[sort]} LIMIT %s"
    rows, has_more = _page(conn.execute(sql, (*params, limit + 1)).fetchall(), limit)
    # return the rows and a cursor for the last row if there is another page, else None
    return rows, _cursor_for(rows[-1], sort) if has_more else None


def list_product_history(
    conn: Connection,
    user_id: int,
    query: str | None,
    limit: int,
    cursor: str | None,
) -> tuple[list[dict], str | None]:
    """One page of this user's events, newest first.

    A product may appear many times: history is a list of events, not a set of
    products.
    """
    filter_sql, filter_params = _text_filter(query)
    sql = f"""
        SELECT h.history_id, h.interaction::text AS interaction, h.occurred_at,
               {_PRODUCT_COLUMNS}, lit.user_id IS NOT NULL AS is_liked
        FROM user_product_history h
        JOIN products p ON p.product_id = h.product_id
        LEFT JOIN user_product_likes lit
               ON lit.product_id = p.product_id AND lit.user_id = %s
        WHERE h.user_id = %s AND p.deleted_at IS NULL{filter_sql}
    """
    params: tuple = (user_id, user_id, *filter_params)

    # Add a WHERE clause to resume after the last row of the previous page, if any.
    if cursor:
        try:
            values = decode_cursor(cursor, ("at", "id"))
        except InvalidCursor as error:
            raise UserProductError(str(error), status=400) from error
        sql += (
            " AND (h.occurred_at < %s"
            " OR (h.occurred_at = %s AND h.history_id < %s))"
        )
        params = (*params, values["at"], values["at"], values["id"])

    sql += " ORDER BY h.occurred_at DESC, h.history_id DESC LIMIT %s"
    rows, has_more = _page(conn.execute(sql, (*params, limit + 1)).fetchall(), limit)

    # build the response items and a cursor for the last row if there is another page, else None
    items = [
        {
            "history_id": row["history_id"],
            "interaction": row["interaction"],
            "occurred_at": row["occurred_at"],
            "product": _product_from_row(row, row["is_liked"]),
        }
        for row in rows
    ]
    next_cursor = None
    if has_more and rows:
        last = rows[-1]
        next_cursor = encode_cursor(
            {"at": last["occurred_at"].isoformat(), "id": last["history_id"]}
        )
    # returns the items and a cursor for the last row if there is another page, else None
    return items, next_cursor


def set_liked(conn: Connection, user_id: int, product_id: int, liked: bool) -> dict:
    """Set this user's like state, recording a history event on a real change.

    Idempotent: liking an already liked product (or unliking one that is not
    liked) succeeds without writing a second event. Unliking never removes
    history, so the timeline still shows the earlier interaction.
    """
    _fetch_product(conn, product_id)

    already_liked = conn.execute(
        "SELECT 1 FROM user_product_likes WHERE user_id = %s AND product_id = %s",
        (user_id, product_id),
    ).fetchone() is not None

    if liked and not already_liked:
        conn.execute(
            "INSERT INTO user_product_likes (product_id, user_id) VALUES (%s, %s)",
            (product_id, user_id),
        )
        _append_history(conn, user_id, product_id, "liked")
    elif not liked and already_liked:
        conn.execute(
            "DELETE FROM user_product_likes WHERE user_id = %s AND product_id = %s",
            (user_id, product_id),
        )
        _append_history(conn, user_id, product_id, "unliked")

    return get_product_for_user(conn, user_id, product_id)


def record_interaction(
    conn: Connection, user_id: int, product_id: int, interaction: str
) -> dict:
    """Append a client-reported interaction event and return it."""
    if interaction not in CLIENT_INTERACTIONS:
        raise UserProductError(
            f"Interaction must be one of: {', '.join(CLIENT_INTERACTIONS)}"
        )
    _fetch_product(conn, product_id)
    return _append_history(conn, user_id, product_id, interaction)


def _append_history(
    conn: Connection, user_id: int, product_id: int, interaction: str
) -> dict:
    """Insert a row into user_product_history and return it."""
    return conn.execute(
        """
        INSERT INTO user_product_history (product_id, user_id, interaction)
        VALUES (%s, %s, %s)
        RETURNING history_id, interaction::text AS interaction, occurred_at
        """,
        (product_id, user_id, interaction),
    ).fetchone()
