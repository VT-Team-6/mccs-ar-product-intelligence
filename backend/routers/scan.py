from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, status

from database import get_connection
from schemas import Product

router = APIRouter(prefix="/api/scan", tags=["scan"])

_RETURNING = (
    "product_id, name, brand, product_type, price, rating, "
    "description, image_url, created_at, updated_at"
)


@router.get("", response_model=Product)
def scan_product(code: str) -> dict:
    """
    Look up a product from the URL stored in its QR code.

    Example:
    GET /api/scan?code=http://localhost:8000/p/1
    """

    parsed = urlparse(code)
    path_parts = parsed.path.strip("/").split("/")

    if len(path_parts) != 2 or path_parts[0] != "p":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid product QR code",
        )

    try:
        product_id = int(path_parts[1])
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid product QR code",
        )

    with get_connection() as conn:
        product = conn.execute(
            f"SELECT {_RETURNING} FROM products WHERE product_id = %s",
            (product_id,),
        ).fetchone()

    if product is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Product {product_id} not found",
        )

    return product