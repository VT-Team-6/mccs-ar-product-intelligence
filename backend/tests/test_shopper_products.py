import os
from pathlib import Path
from urllib.parse import quote

import psycopg
import pytest
from fastapi.testclient import TestClient
from testcontainers.community.postgres import PostgresContainer

from database import get_database_url
from main import app

INIT_SQL = Path(__file__).parents[1] / "db" / "init.sql"


@pytest.fixture(scope="module")
def client():
    with PostgresContainer("postgres:17") as pg:
        url = (
            f"postgresql://{quote(pg.username)}:{quote(pg.password)}"
            f"@{pg.get_container_host_ip()}:{pg.get_exposed_port(5432)}/{pg.dbname}"
        )
        with psycopg.connect(url, autocommit=True) as conn:
            conn.execute(INIT_SQL.read_text())

        previous_url = get_database_url()
        os.environ["DATABASE_URL"] = url
        try:
            with TestClient(app) as test_client:
                yield test_client
        finally:
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