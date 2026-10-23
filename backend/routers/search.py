from fastapi import APIRouter, Query

from database import get_connection
from schemas import Product
from routers.products import _PRODUCT_SELECT

router = APIRouter(prefix="/api/search", tags=["search"])

_COLUMNS = (
    "product_id, name, brand, product_type, price, rating, description, image_url, created_at, updated_at"
)


@router.get("", response_model=list[Product])
def search_products(q: str = Query(min_length=1, max_length=100)) -> list[dict]:
    # Match the text against name, brand, type, and description (ignoring upper/lower case).
    # % and _ are wildcards in SQL, so escape them to search for them literally.
    text = q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    pattern = f"%{text}%"
    with get_connection() as conn:
        return conn.execute(
            _PRODUCT_SELECT + """
            WHERE
                p.name ILIKE %s OR
                p.brand ILIKE %s OR
                p.product_type ILIKE %s OR
                p.description ILIKE %s
            ORDER BY p.name
            """,
            (pattern, pattern, pattern, pattern),
        ).fetchall()