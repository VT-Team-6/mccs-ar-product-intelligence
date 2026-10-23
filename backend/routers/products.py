from fastapi import APIRouter, HTTPException, status

from database import get_connection
from schemas import Product, ProductCreate, ProductUpdate

router = APIRouter(prefix="/api/admin/products", tags=["admin-products"])

_PRODUCT_SELECT = """
    SELECT
        p.product_id,
        p.name,
        p.brand,
        p.product_type,
        p.price,
        s.average_rating AS rating,
        p.description,
        p.image_url,
        p.created_at,
        p.updated_at
    FROM products p
    LEFT JOIN product_review_stats s
        ON p.product_id = s.product_id
"""
_NON_NULLABLE = ("name", "product_type")


def _fetch_product(conn, product_id: int) -> dict:
    row = conn.execute(
        _PRODUCT_SELECT + " WHERE p.product_id = %s",
        (product_id,)
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
            _PRODUCT_SELECT + " ORDER BY p.product_id"
        ).fetchall()


@router.get("/{product_id}", response_model=Product)
def read_product(product_id: int) -> dict:
    with get_connection() as conn:
        return _fetch_product(conn, product_id)
    
@router.post("", response_model=Product, status_code=status.HTTP_201_CREATED)
def create_product(product: ProductCreate) -> dict:
    with get_connection() as conn:
        row = conn.execute(
            """
            INSERT INTO products
                (name, brand, product_type, price, description, image_url)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING product_id
            """,
            (
                product.name,
                product.brand,
                product.product_type,
                product.price,
                product.description,
                product.image_url,
            ),
        ).fetchone()
        
        return _fetch_product(conn, row["product_id"])


@router.put("/{product_id}", response_model=Product)
def update_product(product_id: int, product: ProductUpdate) -> dict:
    updates = product.model_dump(exclude_unset=True)

    for column in _NON_NULLABLE:
        if column in updates and updates[column] is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Field '{column}' cannot be null",
            )

    with get_connection() as conn:
        _fetch_product(conn, product_id)

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

        return _fetch_product(conn, product_id)


@router.delete("/{product_id}")
def delete_product(product_id: int) -> dict:
    with get_connection() as conn:
        cursor = conn.execute(
            "DELETE FROM products WHERE product_id = %s", (product_id,)
        )
        if cursor.rowcount == 0:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Product {product_id} not found",
            )
    return {"deleted": True, "product_id": product_id}
