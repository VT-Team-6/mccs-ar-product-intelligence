from fastapi import APIRouter, Depends, Query

import auth
import store_selection
from database import get_connection
from routers.products import _fetch_product
from schemas import Product

router = APIRouter(prefix="/api/products", tags=["products"])


@router.get("/{product_id}", response_model=Product)
def read_product(
    product_id: int,
    store_id: int | None = Query(default=None),
    user=Depends(auth.optional_user),
) -> dict:
    """One product, priced at the resolved store if one is known.

    Optional auth: a signed-in shopper's saved store applies automatically; an
    anonymous caller needs an explicit ?store_id= to see local data; an invalid
    token still 401s rather than quietly downgrading to anonymous.
    """
    with get_connection() as conn:
        resolved = store_selection.resolve_store_id(
            conn, user["user_id"] if user else None, store_id
        )
        return _fetch_product(conn, product_id, resolved)
