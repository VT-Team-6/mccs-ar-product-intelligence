# Product categories: every product has one, the API accepts and returns it,
# and the catalog additions' reviews import from the SQLite archive.

import asyncio
import os
import sqlite3
from collections import Counter
from contextlib import closing
from urllib.parse import quote

import psycopg
import pytest
from fastapi.testclient import TestClient
from testcontainers.community.postgres import PostgresContainer

import auth
import routers.products
from categories import CATEGORIES, criteria_for
from conftest import apply_init_sql
from main import app
from preferences import CRITERIA


class FakeCognito:
    def get_user(self, AccessToken):
        return {"UserAttributes": [{"Name": "email", "Value": f"{AccessToken}@example.com"}]}


@pytest.fixture(scope="module")
def db_url():
    with PostgresContainer("postgres:17") as pg:
        url = (
            f"postgresql://{quote(pg.username)}:{quote(pg.password)}"
            f"@{pg.get_container_host_ip()}:{pg.get_exposed_port(5432)}/{pg.dbname}"
        )
        with psycopg.connect(url, autocommit=True) as conn:
            apply_init_sql(conn)
        yield url


@pytest.fixture(scope="module")
def client(db_url):
    previous_url = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = db_url
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        if previous_url is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = previous_url


@pytest.fixture
def db(db_url):
    with psycopg.connect(db_url, autocommit=True, row_factory=psycopg.rows.dict_row) as conn:
        yield conn


@pytest.fixture
def app_admin(client, db, monkeypatch):
    monkeypatch.setattr(auth, "cognito_client", FakeCognito())
    monkeypatch.setattr(routers.products, "refresh_recommendation_data", lambda: None)
    token = "category-admin"
    claims = {"token_use": "access", "client_id": auth.COGNITO_CLIENT_ID, "sub": token}
    app.dependency_overrides[auth.verify_access_token] = lambda: {"claims": claims, "token": token}
    user = client.get("/me").json()
    db.execute("UPDATE users SET role = 'system_admin' WHERE user_id = %s", (user["user_id"],))
    yield
    app.dependency_overrides.pop(auth.verify_access_token, None)


# --- the categories ---------------------------------------------------------


def test_shampoo_and_coffee_skip_durability_and_comfort():
    assert criteria_for("shampoo") == criteria_for("coffee") == ("price", "rating", "brand", "quality")
    for category in ("shoes", "backpacks", "headphones"):
        assert criteria_for(category) == CRITERIA


def test_an_unknown_category_gets_every_criterion():
    assert criteria_for(None) == criteria_for("toys") == CRITERIA


# --- the seed ---------------------------------------------------------------


def test_every_seeded_product_has_a_category(db):
    rows = db.execute("SELECT category FROM products WHERE deleted_at IS NULL").fetchall()
    counts = Counter(row["category"] for row in rows)
    assert None not in counts
    assert set(counts) == set(CATEGORIES)


def test_seeded_categories_follow_product_type(db):
    rows = db.execute("SELECT product_type, category FROM products").fetchall()
    expected = {"Backpack": "backpacks", "Headphones": "headphones",
                "Shampoo": "shampoo", "Ground Coffee": "coffee"}
    for row in rows:
        assert row["category"] == expected.get(row["product_type"], "shoes"), row


# --- the API ----------------------------------------------------------------


def test_create_and_read_a_category(client, app_admin):
    response = client.post(
        "/api/admin/products",
        json={"name": "Category Test Roast", "product_type": "Ground Coffee", "category": "coffee"},
    )
    assert response.status_code == 201
    product_id = response.json()["product_id"]
    assert response.json()["category"] == "coffee"
    assert client.get(f"/api/products/{product_id}").json()["category"] == "coffee"


def test_unknown_category_is_rejected(client, app_admin):
    response = client.post(
        "/api/admin/products",
        json={"name": "Toy Car", "product_type": "Toy", "category": "toys"},
    )
    assert response.status_code == 422


def test_change_category_but_not_clear_it(client, app_admin):
    product_id = client.post(
        "/api/admin/products",
        json={"name": "Category Change Pack", "product_type": "Backpack", "category": "shoes"},
    ).json()["product_id"]

    changed = client.put(f"/api/admin/products/{product_id}", json={"category": "backpacks"})
    assert changed.status_code == 200
    assert changed.json()["category"] == "backpacks"

    cleared = client.put(f"/api/admin/products/{product_id}", json={"category": None})
    assert cleared.status_code == 422


# --- importing the catalog additions' reviews --------------------------------


def _archive(path, asin: str, reviews: list[tuple[str, float, str]]) -> None:
    """A tiny archive in the builder's layout with one listing and its reviews."""
    with closing(sqlite3.connect(path)) as conn:
        conn.executescript("""
            CREATE TABLE products(parent_asin TEXT PRIMARY KEY, title TEXT, brand TEXT,
                description TEXT, source_url TEXT, source_rating_count INTEGER, image_url TEXT);
            CREATE TABLE reviews(review_id TEXT PRIMARY KEY, parent_asin TEXT, rating REAL,
                title TEXT, body TEXT, review_date TEXT);
        """)
        conn.execute(
            "INSERT INTO products VALUES (?, 'A listing', 'Brand', NULL, NULL, 10, NULL)", (asin,)
        )
        conn.executemany(
            "INSERT INTO reviews VALUES (?, ?, ?, 'Title', ?, '2024-01-01')",
            [(review_id, asin, rating, body) for review_id, rating, body in reviews],
        )
        conn.commit()


def test_catalog_reviews_import_from_the_archive(client, db, tmp_path, monkeypatch):
    from scripts import import_catalog_reviews
    from services.reviews import registry
    from services.reviews.amazon_dataset import AmazonDatasetProvider

    item = next(i for i in import_catalog_reviews.load_catalog() if i["product_type"] == "Ground Coffee")
    archive = tmp_path / "archive.sqlite"
    _archive(archive, item["source_product_id"], [
        ("r1", 5.0, "Rich and smooth, my favorite morning coffee."),
        ("r2", 2.0, "Tasted burnt and bitter."),
        ("r3", 4.0, "Good flavor for the price."),
    ])
    monkeypatch.setitem(registry.providers, "amazon", AmazonDatasetProvider(archive))

    summary = asyncio.run(import_catalog_reviews.import_all([item], apply=True))

    assert summary["products"] == 1 and summary["reviews"] == 3
    product_id = db.execute(
        "SELECT product_id FROM products WHERE name = %s", (item["name"],)
    ).fetchone()["product_id"]
    ratings = sorted(
        float(row["rating"]) for row in db.execute(
            "SELECT rating FROM reviews WHERE product_id = %s", (product_id,)
        ).fetchall()
    )
    assert ratings == [2.0, 4.0, 5.0]


def test_dry_run_changes_nothing(client, db):
    from scripts import import_catalog_reviews

    items = import_catalog_reviews.load_catalog()
    before = db.execute("SELECT count(*) AS n FROM product_review_sources").fetchone()["n"]

    summary = asyncio.run(import_catalog_reviews.import_all(items, apply=False))

    assert summary["products"] == len(items)
    assert summary["missing"] == []
    assert db.execute("SELECT count(*) AS n FROM product_review_sources").fetchone()["n"] == before
