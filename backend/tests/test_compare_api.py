# Compare: products from different categories (coffee and shoes) can't be compared.

import os
from urllib.parse import quote

import psycopg
import pytest
from fastapi.testclient import TestClient
from testcontainers.community.postgres import PostgresContainer

import auth
from conftest import apply_init_sql
from main import app

COMPARE = "/api/compare"


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


@pytest.fixture(autouse=True)
def _signed_in(client, monkeypatch):
    monkeypatch.setattr(auth, "cognito_client", FakeCognito())
    token = "compare-shopper"
    claims = {"token_use": "access", "client_id": auth.COGNITO_CLIENT_ID, "sub": token}
    app.dependency_overrides[auth.verify_access_token] = lambda: {"claims": claims, "token": token}
    client.get("/me")
    yield
    app.dependency_overrides.pop(auth.verify_access_token, None)


def _ids(db, category, count) -> list[int]:
    rows = db.execute(
        "SELECT product_id FROM products WHERE category = %s AND deleted_at IS NULL ORDER BY product_id LIMIT %s",
        (category, count),
    ).fetchall()
    assert len(rows) == count
    return [row["product_id"] for row in rows]


def test_same_category_compares(client, db):
    response = client.post(COMPARE, json={"product_ids": _ids(db, "shoes", 2)})
    assert response.status_code == 200
    assert len(response.json()["items"]) == 2


def test_different_categories_are_refused(client, db):
    ids = _ids(db, "shoes", 1) + _ids(db, "coffee", 1)
    response = client.post(COMPARE, json={"product_ids": ids})
    assert response.status_code == 400
    assert response.json()["detail"] == "You can only compare products in the same category."


def test_one_odd_one_out_is_refused(client, db):
    ids = _ids(db, "headphones", 2) + _ids(db, "backpacks", 1)
    response = client.post(COMPARE, json={"product_ids": ids})
    assert response.status_code == 400
