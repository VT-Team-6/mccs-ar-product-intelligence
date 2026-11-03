# Tests for GET /api/search.

import os
import re
from urllib.parse import quote

import psycopg
import pytest
from fastapi.testclient import TestClient
from testcontainers.community.postgres import PostgresContainer

from conftest import DB_DIR, apply_init_sql
from main import app

PRODUCTS_SEED = DB_DIR / "seeds" / "001-products.sql"

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

# One seed tuple per line: name, brand, type, price, rating, description, image_url.
_STRING = r"'((?:[^']|'')*)'"
_SEED_ROW = re.compile(
    rf"^\s*\(\s*{_STRING}\s*,\s*(?:{_STRING}|NULL)\s*,\s*{_STRING}\s*,"
    rf"\s*[^,]+,\s*[^,]+,\s*(?:{_STRING}|NULL)\s*,",
    re.MULTILINE,
)

_SEARCHABLE_FIELDS = ("name", "brand", "product_type", "description")


def _seed_products() -> list[dict]:
    """Products from the seed file, so expectations track the data itself.

    Parsed from the SQL rather than duplicated as a second hard-coded list that
    silently goes stale when seeds change.
    """
    products = []
    for name, brand, product_type, description in _SEED_ROW.findall(
        PRODUCTS_SEED.read_text(encoding="utf-8")
    ):
        products.append(
            {
                "name": name.replace("''", "'"),
                "brand": brand.replace("''", "'"),
                "product_type": product_type.replace("''", "'"),
                "description": description.replace("''", "'"),
            }
        )
    return products


def _matching_names(q: str) -> list[str]:
    """Expected result of the endpoint's case-insensitive substring search."""
    needle = q.strip().lower()
    return sorted(
        product["name"]
        for product in _seed_products()
        if any(needle in product[field].lower() for field in _SEARCHABLE_FIELDS)
    )


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


def test_search_matches_name(client):
    response = client.get("/api/search", params={"q": "air force"})
    assert response.status_code == 200
    names = [product["name"] for product in response.json()]
    assert names == _matching_names("air force")
    assert names, "seed data must contain a product whose name matches"


def test_search_ignores_case(client):
    response = client.get("/api/search", params={"q": "TIMBERLAND"})
    assert response.status_code == 200
    names = [product["name"] for product in response.json()]
    assert names == _matching_names("timberland")
    assert names, "seed data must contain a Timberland product"


def test_search_matches_product_type(client):
    response = client.get("/api/search", params={"q": "boot"})
    assert response.status_code == 200
    names = [product["name"] for product in response.json()]
    assert names == _matching_names("boot")
    assert len(names) > 1, "several seeded products have a boot type"


def test_search_matches_description(client):
    response = client.get("/api/search", params={"q": "padded collar"})
    assert response.status_code == 200
    names = [product["name"] for product in response.json()]
    assert names == _matching_names("padded collar")
    assert len(names) > 1, "several seeded descriptions mention a padded collar"


def test_search_ignores_spaces_around_text(client):
    response = client.get("/api/search", params={"q": "  nike  "})
    assert response.status_code == 200
    names = [product["name"] for product in response.json()]
    assert names == _matching_names("nike")
    assert names, "seed data must contain a Nike product"


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
    results = response.json()
    assert results, "seed data must contain a Nike product"
    for product in results:
        for field in APP_PRODUCT_FIELDS:
            assert field in product
        assert isinstance(product["product_id"], int)
        assert isinstance(product["price"], (int, float))
        assert isinstance(product["rating"], (int, float))
        # The app puts the backend address in front of this path to load the image
        assert product["image_url"].startswith("/static/")


def test_search_results_are_sorted_by_name(client):
    # "a" matches many seeded products, so sorting is observable
    response = client.get("/api/search", params={"q": "a"})
    assert response.status_code == 200
    names = [product["name"] for product in response.json()]
    assert names == _matching_names("a")
    assert len(names) > 1, "the query must match more than one product"
    assert names == sorted(names)
