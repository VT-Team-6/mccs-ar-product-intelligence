# Product ownership: store admins can add products for their store and edit
# only their store's products; the app admin can do everything.

import os
from urllib.parse import quote

import psycopg
import pytest
from fastapi.testclient import TestClient
from testcontainers.community.postgres import PostgresContainer

import auth
import routers.products
from conftest import apply_init_sql
from main import app

NEW_PRODUCT = {"name": "Store Rain Boot", "product_type": "Rain Boot"}


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
        conn.execute("TRUNCATE users RESTART IDENTITY CASCADE")
        yield conn


@pytest.fixture(autouse=True)
def _fakes(monkeypatch):
    monkeypatch.setattr(auth, "cognito_client", FakeCognito())
    # Rebuilding the recommendation data is slow and not what these tests check.
    monkeypatch.setattr(routers.products, "refresh_recommendation_data", lambda: None)
    yield
    app.dependency_overrides.pop(auth.verify_access_token, None)


def _sign_in_as(client, db, role, store_ids=(), token=None) -> dict:
    token = token or f"owner-{role}-{'-'.join(map(str, store_ids))}"
    claims = {"token_use": "access", "client_id": auth.COGNITO_CLIENT_ID, "sub": token}
    app.dependency_overrides[auth.verify_access_token] = lambda: {"claims": claims, "token": token}
    user = client.get("/me").json()
    db.execute("UPDATE users SET role = %s WHERE user_id = %s", (role, user["user_id"]))
    for store_id in store_ids:
        db.execute(
            "INSERT INTO user_stores (user_id, store_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
            (user["user_id"], store_id),
        )
    return client.get("/me").json()


def _product_count(db) -> int:
    return db.execute("SELECT count(*) AS n FROM products").fetchone()["n"]


def _inventory(db, product_id):
    return db.execute(
        "SELECT store_id, status FROM inventory WHERE product_id = %s ORDER BY store_id",
        (product_id,),
    ).fetchall()


# --- creating -------------------------------------------------------------


def test_store_admin_adds_a_product_owned_by_their_store_and_pending_there(client, db):
    _sign_in_as(client, db, "store_admin", [1])

    response = client.post("/api/admin/products", json={**NEW_PRODUCT, "store_id": 1})

    assert response.status_code == 201
    product = response.json()
    assert product["created_by_store_id"] == 1
    assert _inventory(db, product["product_id"]) == [{"store_id": 1, "status": "pending"}]


def test_store_admin_must_say_which_store(client, db):
    _sign_in_as(client, db, "store_admin", [1])

    assert client.post("/api/admin/products", json=NEW_PRODUCT).status_code == 422


def test_store_admin_cannot_add_for_another_store(client, db):
    _sign_in_as(client, db, "store_admin", [1])
    before = _product_count(db)

    response = client.post("/api/admin/products", json={**NEW_PRODUCT, "store_id": 2})

    assert response.status_code == 403
    assert _product_count(db) == before


def test_app_admin_adds_a_catalog_product_with_no_owner(client, db):
    _sign_in_as(client, db, "system_admin")

    response = client.post("/api/admin/products", json=NEW_PRODUCT)

    assert response.status_code == 201
    assert response.json()["created_by_store_id"] is None
    assert _inventory(db, response.json()["product_id"]) == []


def test_unknown_store_writes_nothing(client, db):
    _sign_in_as(client, db, "system_admin")
    before = _product_count(db)

    response = client.post("/api/admin/products", json={**NEW_PRODUCT, "store_id": 999999})

    assert response.status_code == 404
    assert _product_count(db) == before


@pytest.mark.parametrize("role", ["user", "store_buyer"])
def test_other_roles_cannot_add_products(client, db, role):
    _sign_in_as(client, db, role, [1] if role == "store_buyer" else [])

    response = client.post("/api/admin/products", json={**NEW_PRODUCT, "store_id": 1})

    assert response.status_code == 403


# --- editing --------------------------------------------------------------


def _store_product(client, db, store_id) -> int:
    _sign_in_as(client, db, "store_admin", [store_id], token=f"creator-{store_id}")
    return client.post("/api/admin/products", json={**NEW_PRODUCT, "store_id": store_id}).json()["product_id"]


def test_any_admin_of_the_owning_store_can_edit(client, db):
    product_id = _store_product(client, db, 1)
    # A different admin of the same store, e.g. after the first one left.
    _sign_in_as(client, db, "store_admin", [1], token="replacement-admin")

    response = client.put(f"/api/admin/products/{product_id}", json={"name": "Renamed"})

    assert response.status_code == 200
    assert response.json()["name"] == "Renamed"


def test_another_store_cannot_edit(client, db):
    product_id = _store_product(client, db, 1)
    _sign_in_as(client, db, "store_admin", [2])

    response = client.put(f"/api/admin/products/{product_id}", json={"name": "Renamed"})

    assert response.status_code == 403


def test_store_admin_cannot_edit_a_catalog_product(client, db):
    _sign_in_as(client, db, "store_admin", [1])

    assert client.put("/api/admin/products/1", json={"name": "Renamed"}).status_code == 403


def test_app_admin_can_edit_a_store_product(client, db):
    product_id = _store_product(client, db, 1)
    _sign_in_as(client, db, "system_admin")

    assert client.put(f"/api/admin/products/{product_id}", json={"name": "Renamed"}).status_code == 200


def test_editing_a_missing_product_is_404(client, db):
    _sign_in_as(client, db, "store_admin", [1])

    assert client.put("/api/admin/products/999999", json={"name": "Renamed"}).status_code == 404


# --- deleting and review sources ------------------------------------------


def test_store_admin_cannot_delete_even_their_own_product(client, db):
    product_id = _store_product(client, db, 1)
    _sign_in_as(client, db, "store_admin", [1], token="creator-1")

    assert client.delete(f"/api/admin/products/{product_id}").status_code == 403


def test_review_sources_follow_ownership(client, db):
    product_id = _store_product(client, db, 1)

    _sign_in_as(client, db, "store_admin", [1], token="creator-1")
    assert client.get(f"/api/admin/products/{product_id}/review-sources").status_code == 200

    _sign_in_as(client, db, "store_admin", [2])
    assert client.get(f"/api/admin/products/{product_id}/review-sources").status_code == 403
    assert client.get("/api/admin/products/1/review-sources").status_code == 403
