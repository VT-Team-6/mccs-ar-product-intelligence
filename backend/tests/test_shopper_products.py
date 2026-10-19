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
    for field in ("product_id", "name", "brand", "price", "product_type",
                  "rating", "description", "image_url"):
        assert field in body
    assert body["product_id"] == 1


def test_get_missing_product_returns_404(client):
    response = client.get("/api/products/999999")
    assert response.status_code == 404