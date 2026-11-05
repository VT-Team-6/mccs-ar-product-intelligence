"""GET /api/stores: the public list of locations a shopper can pick from.

Completly public: no auth, no optional auth. The client calls it before any store is
selected, and it must answer the same way for everyone.
"""


import httpx
from fastapi import APIRouter, HTTPException, Query
from schemas import Store
from database import get_connection

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
   
@router.get("/search")
async def search_locations(q: str = Query(min_length=2, max_length=150)):
    """Resolve a US city/state or ZIP code into selectable locations."""
    query = q.strip()
    if len(query) < 2:
        raise HTTPException(status_code=422, detail="Enter a city or ZIP code")

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                "https://geocoding-api.open-meteo.com/v1/search",
                params={
                    "name": query,
                    "countryCode": "US",
                    "count": 5,
                    "language": "en",
                },
            )
            response.raise_for_status()
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Location search timed out") from None
    except httpx.HTTPError:
        raise HTTPException(
            status_code=502, detail="Location search is temporarily unavailable"
        ) from None

    try:
        locations = [
            {
                "id": place["id"],
                "label": ", ".join(
                    part for part in (
                        place["name"], place.get("admin1"), place.get("country")
                    ) if part
                ),
                "latitude": float(place["latitude"]),
                "longitude": float(place["longitude"]),
            }
            for place in response.json().get("results", [])
        ]
    except (ValueError, KeyError, TypeError, AttributeError):
        raise HTTPException(
            status_code=502, detail="Location service returned an invalid response"
        ) from None

    return {"locations": locations}


_NEARBY_STORES_SQL = """
    WITH origin AS (
        SELECT %s::double precision AS latitude,
               %s::double precision AS longitude
    ), distances AS (
        SELECT s.store_id, s.name, s.address, s.latitude, s.longitude,
            2 * 3958.8 * ASIN(SQRT(LEAST(1.0, GREATEST(0.0,
                POWER(SIN(RADIANS(s.latitude - o.latitude) / 2), 2)
                + COS(RADIANS(o.latitude)) * COS(RADIANS(s.latitude))
                * POWER(SIN(RADIANS(s.longitude - o.longitude) / 2), 2)
            )))) AS distance_miles
        FROM stores s
        CROSS JOIN origin o
        WHERE s.latitude IS NOT NULL AND s.longitude IS NOT NULL
    )
    SELECT * FROM distances
    WHERE distance_miles <= %s
    ORDER BY distance_miles, store_id
    LIMIT %s
"""


@router.get("/nearby")
def get_nearby_stores(
    latitude: float = Query(ge=-90, le=90, allow_inf_nan=False),
    longitude: float = Query(ge=-180, le=180, allow_inf_nan=False),
    radius_miles: float = Query(default=25, gt=0, le=200, allow_inf_nan=False),
    limit: int = Query(default=20, ge=1, le=100),
):
    """Return stored locations by straight-line distance, nearest first."""
    with get_connection() as conn:
        stores = conn.execute(
            _NEARBY_STORES_SQL,
            (latitude, longitude, radius_miles, limit),
        ).fetchall()

    return {
        "origin": {"latitude": latitude, "longitude": longitude},
        "radius_miles": radius_miles,
        "stores": stores,
    }
