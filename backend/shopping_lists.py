"""Shopping-list database"""

from psycopg import Connection

class ShoppingListError(Exception):
    def __init__(self, detail: str, status: int = 400):
        super().__init__(detail)
        self.detail = detail
        self.status = status

def _owned_list(conn: Connection, user_id: int, list_id: int) -> dict:
    row = conn.execute(
        """
        SELECT shopping_list_id, user_id, name, is_active,
               created_at, updated_at
        FROM shopping_lists
        WHERE shopping_list_id = %s AND user_id = %s
        """,
        (list_id, user_id),
    ).fetchone()
    if row is None:
        raise ShoppingListError("Shopping list not found", 404)
    return row

def list_lists(conn: Connection, user_id: int) -> list[dict]:
    """All of this customer's lists, with their item counts."""
    return conn.execute(
        """
        SELECT l.shopping_list_id, l.name, l.is_active,
               l.created_at, l.updated_at,
               COUNT(i.shopping_list_item_id)::int AS total_items,
               COUNT(i.shopping_list_item_id)
                   FILTER (WHERE i.is_completed)::int AS completed_items
        FROM shopping_lists l
        LEFT JOIN shopping_list_items i
            ON i.shopping_list_id = l.shopping_list_id
        WHERE l.user_id = %s
        GROUP BY l.shopping_list_id
        ORDER BY l.is_active DESC, l.created_at DESC,
                 l.shopping_list_id DESC
        """,
        (user_id,),
    ).fetchall()

def get_list(conn: Connection, user_id: int, list_id: int) -> dict:
    """One owned list and its products, including completion statuses."""
    shopping_list = dict(_owned_list(conn, user_id, list_id))

    items = conn.execute(
        """
        SELECT i.shopping_list_item_id, i.product_id,
               i.is_completed, i.added_at,
               p.name, p.brand, p.product_type, p.image_url
        FROM shopping_list_items i
        JOIN products p ON p.product_id = i.product_id
        WHERE i.shopping_list_id = %s
        ORDER BY i.is_completed ASC, i.added_at ASC,
                 i.shopping_list_item_id ASC
        """,
        (list_id,),
    ).fetchall()

    shopping_list["items"] = items
    shopping_list["total_items"] = len(items)
    shopping_list["completed_items"] = sum(
        bool(item["is_completed"]) for item in items
    )
    return shopping_list

def create_list(conn: Connection, user_id: int, name: str) -> dict:
    """Create a shopping list and make it the customer's active list."""
    clean_name = name.strip()

    if not clean_name or len(clean_name) > 100:
        raise ShoppingListError(
            "List name must be 1 to 100 characters"
        )

    # Serialize changes to this customer's active list.
    conn.execute(
        """
        SELECT user_id
        FROM users
        WHERE user_id = %s
        FOR UPDATE
        """,
        (user_id,),
    ).fetchone()

    # Deactivate any previously active list.
    conn.execute(
        """
        UPDATE shopping_lists
        SET is_active = FALSE,
            updated_at = NOW()
        WHERE user_id = %s
          AND is_active = TRUE
        """,
        (user_id,),
    )

    # The newly created list is always active.
    created = conn.execute(
        """
        INSERT INTO shopping_lists (user_id, name, is_active)
        VALUES (%s, %s, TRUE)
        RETURNING shopping_list_id
        """,
        (user_id, clean_name),
    ).fetchone()

    return get_list(
        conn,
        user_id,
        created["shopping_list_id"],
    )

def activate_list(conn: Connection, user_id: int, list_id: int) -> dict:
    """Make this the customer's only active list."""
    _owned_list(conn, user_id, list_id)

    # Serialize activation with other list creation/activation requests.
    conn.execute(
        "SELECT user_id FROM users WHERE user_id = %s FOR UPDATE",
        (user_id,),
    ).fetchone()

    conn.execute(
        """
        UPDATE shopping_lists
        SET is_active = FALSE, updated_at = NOW()
        WHERE user_id = %s AND is_active = TRUE
          AND shopping_list_id <> %s
        """,
        (user_id, list_id),
    )
    conn.execute(
        """
        UPDATE shopping_lists
        SET is_active = TRUE, updated_at = NOW()
        WHERE shopping_list_id = %s AND user_id = %s
          AND is_active = FALSE
        """,
        (list_id, user_id),
    )
    return get_list(conn, user_id, list_id)

def add_item(
    conn: Connection, user_id: int, list_id: int, product_id: int
) -> dict:
    """Add a catalog product once, without resetting existing check-off."""
    _owned_list(conn, user_id, list_id)

    product = conn.execute(
        """
        SELECT product_id FROM products
        WHERE product_id = %s AND deleted_at IS NULL
        """,
        (product_id,),
    ).fetchone()
    if product is None:
        raise ShoppingListError("Product not found", 404)

    inserted = conn.execute(
        """
        INSERT INTO shopping_list_items (shopping_list_id, product_id)
        VALUES (%s, %s)
        ON CONFLICT (shopping_list_id, product_id) DO NOTHING
        RETURNING shopping_list_item_id
        """,
        (list_id, product_id),
    ).fetchone()

    if inserted:
        conn.execute(
            """
            UPDATE shopping_lists SET updated_at = NOW()
            WHERE shopping_list_id = %s
            """,
            (list_id,),
        )

    return get_list(conn, user_id, list_id)

def set_item_completion(
    conn: Connection,
    user_id: int,
    list_id: int,
    product_id: int,
    completed: bool,
) -> dict:
    """Manually check or uncheck exactly one product in an owned list."""
    _owned_list(conn, user_id, list_id)

    updated = conn.execute(
        """
        UPDATE shopping_list_items
        SET is_completed = %s
        WHERE shopping_list_id = %s AND product_id = %s
        RETURNING shopping_list_item_id
        """,
        (completed, list_id, product_id),
    ).fetchone()

    if updated is None:
        raise ShoppingListError("Product is not on this list", 404)

    conn.execute(
        """
        UPDATE shopping_lists SET updated_at = NOW()
        WHERE shopping_list_id = %s
        """,
        (list_id,),
    )

    return get_list(conn, user_id, list_id)

def remove_item(
    conn: Connection, user_id: int, list_id: int, product_id: int
) -> dict:
    """Remove one item without changing any other item."""
    _owned_list(conn, user_id, list_id)

    deleted = conn.execute(
        """
        DELETE FROM shopping_list_items
        WHERE shopping_list_id = %s AND product_id = %s
        RETURNING shopping_list_item_id
        """,
        (list_id, product_id),
    ).fetchone()

    if deleted is None:
        raise ShoppingListError("Product is not on this list", 404)

    conn.execute(
        """
        UPDATE shopping_lists SET updated_at = NOW()
        WHERE shopping_list_id = %s
        """,
        (list_id,),
    )
    return get_list(conn, user_id, list_id)



""" Trisheka: connect this to the scan workflow"""
def complete_active_product(
    conn: Connection, user_id: int, product_id: int
) -> bool:
    """Future scanner integration: complete only a matching active-list item.

    Returns True if an incomplete matching item was changed.
    Returns False if no match exists or it was already completed.
    """
    updated = conn.execute(
        """
        UPDATE shopping_list_items i
        SET is_completed = TRUE
        FROM shopping_lists l
        WHERE i.shopping_list_id = l.shopping_list_id
          AND l.user_id = %s
          AND l.is_active = TRUE
          AND i.product_id = %s
          AND i.is_completed = FALSE
        RETURNING i.shopping_list_item_id, i.shopping_list_id
        """,
        (user_id, product_id),
    ).fetchone()

    if updated is None:
        return False

    conn.execute(
        """
        UPDATE shopping_lists SET updated_at = NOW()
        WHERE shopping_list_id = %s
        """,
        (updated["shopping_list_id"],),
    )
    return True
