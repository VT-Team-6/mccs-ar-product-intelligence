"""GET /api/stores: the public list of locations a shopper can pick from.

Completly public: no auth, no optional auth. The client calls it before any store is
selected, and it must answer the same way for everyone.
"""

from fastapi import APIRouter

from database import get_connection
from schemas import Store

router = APIRouter(prefix="/api/stores", tags=["stores"])


@router.get("", response_model=list[Store])
def list_stores() -> list[dict]:
    """Every store, in a stable order so the client's list never reshuffles."""
    with get_connection() as conn:
        return conn.execute(
            """
            SELECT store_id, name, address, latitude, longitude
            FROM stores
            ORDER BY store_id
            """
        ).fetchall()
