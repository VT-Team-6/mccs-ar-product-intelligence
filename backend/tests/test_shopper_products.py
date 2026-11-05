import os
from urllib.parse import quote

import psycopg
import pytest
from fastapi.testclient import TestClient
from testcontainers.community.postgres import PostgresContainer

from conftest import apply_init_sql
from main import app


def _connection_url(pg):
    # testcontainers masks credentials in get_connection_url(), so build it here.
    return (
        f"postgresql://{quote(pg.username)}:{quote(pg.password)}"
        f"@{pg.get_container_host_ip()}:{pg.get_exposed_port(5432)}/{pg.dbname}"
    )


@pytest.fixture(scope="module")
def client():
    with PostgresContainer("postgres:17") as pg:
        url = _connection_url(pg)
        with psycopg.connect(url, autocommit=True) as conn:
            apply_init_sql(conn)

        # Point the app at the throwaway database instead of the dev container.
        # Capture the raw value (possibly absent) so the environment is restored
        # exactly as found, rather than pinning a resolved fallback URL into it.
        previous_url = os.environ.get("DATABASE_URL")
        os.environ["DATABASE_URL"] = url
        try:
            with TestClient(app) as test_client:
                yield test_client
        finally:
            if previous_url is None:
                os.environ.pop("DATABASE_URL", None)
            else:
                os.environ["DATABASE_URL"] = previous_url


def test_get_product_returns_all_fields(client):
    response = client.get("/api/products/1")
    assert response.status_code == 200
    body = response.json()
    for field in ("product_id", "name", "brand", "product_type",
                  "rating", "description", "image_url", "store_inventory"):
        assert field in body
    assert body["product_id"] == 1


def test_get_missing_product_returns_404(client):
    response = client.get("/api/products/999999")
    assert response.status_code == 404


def test_get_product_anonymous_has_null_store_inventory(client):
    # Anonymous caller, no ?store_id=: the product is global, so it returns
    # fine; there is simply no price to attach.
    response = client.get("/api/products/1")
    assert response.status_code == 200
    assert response.json()["store_inventory"] is None


def test_get_product_with_store_prices_at_that_store(client):
    response = client.get("/api/products/1", params={"store_id": 1})
    assert response.status_code == 200
    inventory = response.json()["store_inventory"]
    assert inventory == {
        "store_id": 1,
        "price": 220.0,
        "quantity": 12,
        "in_stock": True,
        "status": "active",
    }


def test_get_product_price_differs_per_store(client):
    # Product 1 is the seed's cross-store fixture: 220.00 at store 1, 240.00
    # at store 2 (and out of stock there). Catching a query that hard-codes
    # one store or ignores the parameter entirely.
    store_1 = client.get("/api/products/1", params={"store_id": 1}).json()
    store_2 = client.get("/api/products/1", params={"store_id": 2}).json()
    assert store_1["store_inventory"]["price"] == 220.0
    assert store_2["store_inventory"]["price"] == 240.0
    assert store_2["store_inventory"]["in_stock"] is False


def test_get_product_unknown_store_has_null_store_inventory(client):
    # A store with no inventory row for the product yields null — not a
    # {price: null} object — so the client shows "unavailable here", not a
    # blank price. No seeded store 99 exists, but the lookup is safe either way.
    response = client.get("/api/products/1", params={"store_id": 99})
    assert response.status_code == 200
    assert response.json()["store_inventory"] is None


def test_get_product_invalid_token_is_unauthorized(client):
    # optional_user must not silently treat a *bad* token as anonymous.
    response = client.get(
        "/api/products/1", headers={"Authorization": "Bearer not-a-real-token"}
    )
    assert response.status_code == 401


def test_get_product_qr_returns_png(client):
    # The QR route's existence check no longer selects dropped columns, so it
    # must still serve the image rather than 500 after migration 005.
    response = client.get("/api/products/1/qr")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/png")
    assert response.content[:8] == b"\x89PNG\r\n\x1a\n"


def test_get_missing_product_qr_returns_404(client):
    response = client.get("/api/products/999999/qr")
    assert response.status_code == 404