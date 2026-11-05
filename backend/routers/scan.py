from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Query, status

import auth
import store_selection
from database import get_connection
from schemas import Product
from routers.products import _fetch_product

router = APIRouter(prefix="/api/scan", tags=["scan"])


@router.get("", response_model=Product)
def scan_product(
    code: str,
    store_id: int | None = Query(default=None),
    user=Depends(auth.optional_user),
) -> dict:
    """
    Look up a product from the URL stored in its QR code.

    Example:
    GET /api/scan?code=http://localhost:8000/p/1

    Resolves the store with the same order as product details (explicit
    ?store_id= → the signed-in user's saved store → none), so the price cannot
    flicker between the scan response and the product page that follows. Scan
    is never blocked by store selection: without a resolvable store the
    product still returns, with store_inventory: null.
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
        resolved = store_selection.resolve_store_id(
            conn, user["user_id"] if user else None, store_id
        )
        return _fetch_product(conn, product_id, resolved)
