from psycopg import sql
from fastapi import APIRouter, BackgroundTasks, HTTPException, status, Depends
from database import get_connection
from schemas import Product, ProductCreate, ProductUpdate
from product_features import refresh_recommendation_data
from auth import require_permission
from product_access import can_manage_store, require_product_owner
import stock

router = APIRouter(prefix="/api/admin/products", tags=["admin-products"])

# The store filter for the inventory join, built by product_select().
# Admin routes pass store_id=None, which matches no rows, so admin responses
# carry store_inventory: null.
_STORE_INVENTORY = """
    CASE WHEN i.product_id IS NULL OR i.status = 'pending' THEN NULL ELSE
        json_build_object(
            'store_id', i.store_id,
            'price',    i.price,
            'quantity', i.quantity,
            'in_stock', i.quantity > 0 AND i.status = 'active',
            'status',   i.status
        )
    END AS store_inventory
"""

_PRODUCT_SELECT = """
    SELECT
        p.product_id,
        p.name,
        p.brand,
        p.product_type,
        s.average_rating AS rating,
        p.description,
        p.image_url,
        p.created_at,
        p.updated_at,
        p.created_by_store_id,
        {store_inventory}
    FROM products p
    LEFT JOIN product_review_stats s
        ON p.product_id = s.product_id
    {inventory_join}
"""
_NON_NULLABLE = ("name", "product_type")


def _store_inventory_join(store_id: int | None) -> sql.Composed:
    """The store-scoped inventory join, with the store bound as a literal.

    A `%s` in the FROM clause would force every call site to prepend the store
    to its parameter tuple; one missed prepend silently binds the store to a
    query value and returns wrong rows. `store_id` is an int (or None), so
    literal interpolation is injection-safe and leaves the tuples untouched.
    """
    return sql.SQL(
        "LEFT JOIN inventory i"
        " ON i.product_id = p.product_id AND i.store_id = {}"
    ).format(sql.Literal(store_id))


def product_select(store_id: int | None) -> sql.Composed:
    """The full product select, scoped to one store (or none for admin)."""
    return sql.SQL(_PRODUCT_SELECT).format(
        store_inventory=sql.SQL(_STORE_INVENTORY),
        inventory_join=_store_inventory_join(store_id),
    )


def _fetch_product(conn, product_id: int, store_id: int | None = None) -> dict:
    row = conn.execute(
        product_select(store_id) + sql.SQL(" WHERE p.product_id = %s"),
        (product_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Product {product_id} not found",
        )
    return row

@router.get("", response_model=list[Product])
def list_products() -> list[dict]:
    with get_connection() as conn:
        return conn.execute(
            product_select(None) + sql.SQL(" ORDER BY p.product_id")
        ).fetchall()


@router.get("/{product_id}", response_model=Product)
def read_product(product_id: int) -> dict:
    with get_connection() as conn:
        return _fetch_product(conn, product_id)
    
@router.post("", response_model=Product,
    status_code=status.HTTP_201_CREATED,
)
def create_product(
    product: ProductCreate,
    background_tasks: BackgroundTasks,
    user=Depends(require_permission("create_products")),
) -> dict:
    """Add a product. A store's product is owned by it and starts pending there."""
    owner = product.store_id
    if owner is None and "manage_products" not in user["permissions"]:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Choose the store this product is for",
        )
    if owner is not None and not can_manage_store(user, owner):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only add products for your own store",
        )

    with get_connection() as conn:
        if owner is not None and conn.execute(
            "SELECT 1 FROM stores WHERE store_id = %s", (owner,)
        ).fetchone() is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Store {owner} not found",
            )
        row = conn.execute(
            """
            INSERT INTO products
                (name, brand, product_type, description, image_url, created_by_store_id)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING product_id
            """,
            (
                product.name,
                product.brand,
                product.product_type,
                product.description,
                product.image_url,
                owner,
            ),
        ).fetchone()
        if owner is not None:
            # Same transaction, so the product never exists without its store entry.
            stock.push_to_stores(conn, [row["product_id"]], [owner])
        background_tasks.add_task(refresh_recommendation_data)
        return _fetch_product(conn, row["product_id"])


@router.put("/{product_id}", response_model=Product)
def update_product(
    product_id: int,
    product: ProductUpdate,
    background_tasks: BackgroundTasks,
    user=Depends(require_permission("create_products")),
) -> dict:
    """Edit a product: the app admin edits any, a store admin only their store's."""
    updates = product.model_dump(exclude_unset=True)

    for column in _NON_NULLABLE:
        if column in updates and updates[column] is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Field '{column}' cannot be null",
            )

    with get_connection() as conn:
        require_product_owner(conn, user, product_id)

        if updates:
            assignments = ", ".join(f"{column} = %s" for column in updates)
            conn.execute(
                f"""
                UPDATE products
                SET {assignments}, updated_at = CURRENT_TIMESTAMP
                WHERE product_id = %s
                """,
                (*updates.values(), product_id),
            )

        row = _fetch_product(conn, product_id)
        background_tasks.add_task(refresh_recommendation_data)
        return row


# Deleting removes the product from every store, so only the app admin can.
# Store admins use "Remove from my store" (DELETE /api/admin/inventory/...).
@router.delete("/{product_id}", dependencies=[Depends(require_permission("manage_products"))])
def delete_product(product_id: int, background_tasks: BackgroundTasks) -> dict:
    with get_connection() as conn:
        cursor = conn.execute(
            "DELETE FROM products WHERE product_id = %s", (product_id,)
        )
        if cursor.rowcount == 0:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Product {product_id} not found",
            )
    background_tasks.add_task(refresh_recommendation_data)
    return {"deleted": True, "product_id": product_id}
