# Tests for GET /api/search.

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

# The fields the mobile app's Product type expects (mobile/src/api/products.ts)
APP_PRODUCT_FIELDS = [
    "product_id",
    "name",
    "brand",
    "product_type",
    "price",
    "rating",
    "description",
    "image_url",
    "created_at",
    "updated_at",
]


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
            conn.execute(INIT_SQL.read_text())

        # Point the app at the throwaway database instead of the dev container.
        previous_url = get_database_url()
        os.environ["DATABASE_URL"] = url
        try:
            with TestClient(app) as test_client:
                yield test_client
        finally:
            os.environ["DATABASE_URL"] = previous_url


def test_search_matches_name(client):
    response = client.get("/api/search", params={"q": "nike"})
    assert response.status_code == 200
    names = [product["name"] for product in response.json()]
    assert names == ["Nike Air Force 1 Low"]


def test_search_ignores_case(client):
    response = client.get("/api/search", params={"q": "TIMBERLAND"})
    assert response.status_code == 200
    assert len(response.json()) == 1
    assert response.json()[0]["brand"] == "Timberland"


def test_search_matches_product_type(client):
    response = client.get("/api/search", params={"q": "boot"})
    assert response.status_code == 200
    assert [p["name"] for p in response.json()] == ['Timberland 6" Premium Waterproof Boots']


def test_search_matches_description(client):
    response = client.get("/api/search", params={"q": "padded collar"})
    assert response.status_code == 200
    assert [p["brand"] for p in response.json()] == ["Timberland"]


def test_search_ignores_spaces_around_text(client):
    response = client.get("/api/search", params={"q": "  nike  "})
    assert response.status_code == 200
    assert len(response.json()) == 1


def test_search_with_no_matches_returns_empty_list(client):
    response = client.get("/api/search", params={"q": "zzzzzz"})
    assert response.status_code == 200
    assert response.json() == []


def test_search_treats_percent_as_plain_text(client):
    response = client.get("/api/search", params={"q": "%"})
    assert response.status_code == 200
    assert response.json() == []


def test_search_requires_text(client):
    response = client.get("/api/search")
    assert response.status_code == 422
    response = client.get("/api/search", params={"q": ""})
    assert response.status_code == 422


def test_search_results_have_every_field_the_app_uses(client):
    # The app shows the name, brand, type, price, rating, and image on each result row
    response = client.get("/api/search", params={"q": "nike"})
    assert response.status_code == 200
    product = response.json()[0]
    for field in APP_PRODUCT_FIELDS:
        assert field in product
    assert isinstance(product["product_id"], int)
    assert isinstance(product["price"], (int, float))
    assert isinstance(product["rating"], (int, float))
    # The app puts the backend address in front of this path to load the image
    assert product["image_url"].startswith("/static/")


def test_search_results_are_sorted_by_name(client):
    # "a" appears in every sample product, so all of them come back
    response = client.get("/api/search", params={"q": "a"})
    assert response.status_code == 200
    names = [product["name"] for product in response.json()]
    assert len(names) > 1
    assert names == sorted(names)