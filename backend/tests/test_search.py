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
    "rating",
    "description",
    "image_url",
    "created_at",
    "updated_at",
    "store_inventory",
]

# One seed tuple per line: name, brand, type, description, image_url. Price
# lives in the inventory seed now, so it is not part of this row.
_STRING = r"'((?:[^']|'')*)'"
_SEED_ROW = re.compile(
    rf"^\s*\(\s*{_STRING}\s*,\s*(?:{_STRING}|NULL)\s*,\s*{_STRING}\s*,"
    rf"\s*(?:{_STRING}|NULL)\s*,",
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
    # The app shows the name, brand, type, rating, and image on each result row
    response = client.get("/api/search", params={"q": "nike"})
    assert response.status_code == 200
    results = response.json()
    assert results, "seed data must contain a Nike product"
    for product in results:
        for field in APP_PRODUCT_FIELDS:
            assert field in product
        assert isinstance(product["product_id"], int)
        assert isinstance(product["rating"], (int, float))
        # Without a resolved store there is no price to show (anonymous caller,
        # no ?store_id=): the whole store_inventory object is null, so the app
        # prompts for a store instead of rendering a wrong price.
        assert product["store_inventory"] is None
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


def test_search_with_explicit_store_prices_results_at_that_store(client):
    # Store 1 carries every seeded product, so every Nike result is priced.
    response = client.get("/api/search", params={"q": "nike", "store_id": 1})
    assert response.status_code == 200
    results = response.json()
    assert results
    for product in results:
        inventory = product["store_inventory"]
        assert inventory is not None
        assert inventory["store_id"] == 1
        assert isinstance(inventory["price"], (int, float))
        assert isinstance(inventory["quantity"], int)
        assert inventory["in_stock"] == (inventory["quantity"] > 0)


def test_search_price_is_per_store(client):
    # Product 1 is the seed's cross-store fixture: 220.00 at store 1 and
    # 240.00 at store 2. A query that ignores store_id fails this test.
    by_store = {}
    for store_id in (1, 2):
        response = client.get(
            "/api/search", params={"q": "Timberland 6", "store_id": store_id}
        )
        assert response.status_code == 200
        (result,) = response.json()
        by_store[store_id] = result["store_inventory"]

    assert by_store[1]["price"] == 220.0
    assert by_store[2]["price"] == 240.0


def test_search_out_of_stock_flag(client):
    # Store 2 carries product 1 with quantity 0 (the seed's out-of-stock
    # fixture), so in_stock must be false rather than a missing row.
    response = client.get("/api/search", params={"q": "Timberland 6", "store_id": 2})
    assert response.status_code == 200
    (result,) = response.json()
    assert result["store_inventory"]["quantity"] == 0
    assert result["store_inventory"]["in_stock"] is False
