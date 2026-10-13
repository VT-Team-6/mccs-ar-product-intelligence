from fastapi import APIRouter

from database import get_connection
from routers.products import _fetch_product
from schemas import Product

router = APIRouter(prefix="/api/products", tags=["products"])


@router.get("/{product_id}", response_model=Product)
def read_product(product_id: int) -> dict:
    with get_connection() as conn:
        return _fetch_product(conn, product_id)