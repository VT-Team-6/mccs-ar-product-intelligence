from fastapi import APIRouter, Depends, Query
from psycopg import sql

import auth
import store_selection
from database import get_connection
from schemas import Product
from routers.products import product_select

router = APIRouter(prefix="/api/search", tags=["search"])


@router.get("", response_model=list[Product])
def search_products(
    q: str = Query(min_length=1, max_length=100),
    store_id: int | None = Query(default=None),
    user=Depends(auth.optional_user),
) -> list[dict]:
    """Catalog search, with each result priced at the resolved store.

    Optional auth, same rule as product details: saved store for a signed-in
    shopper, explicit ?store_id= for anyone, null inventory otherwise.
    """
    # Match the text against name, brand, type, and description (ignoring upper/lower case).
    # % and _ are wildcards in SQL, so escape them to search for them literally.
    text = q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    pattern = f"%{text}%"
    with get_connection() as conn:
        resolved = store_selection.resolve_store_id(
            conn, user["user_id"] if user else None, store_id
        )
        return conn.execute(
            product_select(resolved)
            + sql.SQL("""
            WHERE
                p.name ILIKE %s OR
                p.brand ILIKE %s OR
                p.product_type ILIKE %s OR
                p.description ILIKE %s
            ORDER BY p.name
            """),
            (pattern, pattern, pattern, pattern),
        ).fetchall()
