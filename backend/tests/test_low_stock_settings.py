# Low-stock levels and buyers: set on one product or many at once, per store.

import os
from urllib.parse import quote

import psycopg
import pytest
from fastapi.testclient import TestClient
from testcontainers.community.postgres import PostgresContainer

import auth
from conftest import DB_DIR, apply_init_sql
from main import app

SEED = DB_DIR / "seeds" / "003-inventory.sql"
SETTINGS = "/api/admin/inventory/low-stock-settings"
BUYERS = "/api/admin/inventory/buyers"


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
        conn.execute("DELETE FROM stock_changes")
        conn.execute("DELETE FROM inventory")
        conn.execute(SEED.read_text())
        yield conn


@pytest.fixture(autouse=True)
def _fakes(monkeypatch):
    monkeypatch.setattr(auth, "cognito_client", FakeCognito())
    yield
    app.dependency_overrides.pop(auth.verify_access_token, None)


def _sign_in_as(client, db, role, store_ids=(), token=None) -> dict:
    token = token or f"stock-{role}-{'-'.join(map(str, store_ids))}"
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


def _quantity(db, product_id, store_id=1) -> int:
    return db.execute(
        "SELECT quantity FROM inventory WHERE product_id = %s AND store_id = %s",
        (product_id, store_id),
    ).fetchone()["quantity"]


def _row(db, product_id, store_id=1) -> dict:
    return db.execute(
        "SELECT low_stock_threshold, buyer_user_id FROM inventory"
        " WHERE product_id = %s AND store_id = %s",
        (product_id, store_id),
    ).fetchone()


def _listed(client, store_id=1) -> dict[int, dict]:
    response = client.get("/api/admin/inventory", params={"store_id": store_id, "limit": 200})
    assert response.status_code == 200
    return {item["product_id"]: item for item in response.json()["items"]}


# --- defaults and the inventory list ---------------------------------------


def test_every_product_starts_low_at_10_with_no_buyer(client, db):
    _sign_in_as(client, db, "store_admin", [1])

    item = _listed(client)[1]

    assert item["low_stock_threshold"] == 10
    assert item["buyer_user_id"] is None


def test_the_list_marks_products_at_or_below_their_level(client, db):
    _sign_in_as(client, db, "store_admin", [1])
    # product 1 has 12, product 2 has 20 at store 1
    client.put(SETTINGS, json={"store_id": 1, "product_ids": [1], "low_stock_threshold": 12})

    listed = _listed(client)

    assert listed[1]["low_stock"] is True   # 12 <= 12
    assert listed[2]["low_stock"] is False  # 20 > 10


def test_shoppers_never_see_levels_or_buyers(client, db):
    item = client.get("/api/stores/1/stock").json()["items"][0]

    assert "low_stock_threshold" not in item
    assert "buyer_user_id" not in item


# --- setting levels --------------------------------------------------------


def test_set_one_level_for_many_products_at_once(client, db):
    _sign_in_as(client, db, "store_admin", [1])

    response = client.put(SETTINGS, json={"store_id": 1, "product_ids": [1, 2, 3], "low_stock_threshold": 5})

    assert response.status_code == 200
    assert response.json() == {"updated": 3}
    assert [_row(db, i)["low_stock_threshold"] for i in (1, 2, 3, 4)] == [5, 5, 5, 10]


def test_each_store_keeps_its_own_level(client, db):
    _sign_in_as(client, db, "system_admin")

    client.put(SETTINGS, json={"store_id": 1, "product_ids": [1], "low_stock_threshold": 3})

    assert _row(db, 1, store_id=1)["low_stock_threshold"] == 3
    assert _row(db, 1, store_id=2)["low_stock_threshold"] == 10


def test_a_product_not_at_the_store_changes_nothing(client, db):
    _sign_in_as(client, db, "store_admin", [1])

    response = client.put(SETTINGS, json={"store_id": 1, "product_ids": [1, 999999], "low_stock_threshold": 3})

    assert response.status_code == 404
    assert _row(db, 1)["low_stock_threshold"] == 10


@pytest.mark.parametrize("body", [
    {"product_ids": [1]},                                  # nothing to change
    {"product_ids": [1], "low_stock_threshold": -1},
    {"product_ids": [], "low_stock_threshold": 3},
    {"product_ids": [1], "buyer_user_id": 1, "clear_buyer": True},
])
def test_bad_requests_are_rejected(client, db, body):
    _sign_in_as(client, db, "store_admin", [1])

    assert client.put(SETTINGS, json={"store_id": 1, **body}).status_code == 422


# --- buyers ----------------------------------------------------------------


def test_only_the_store_buyers_are_listed(client, db):
    buyer = _sign_in_as(client, db, "store_buyer", [1], token="buyer-one")
    _sign_in_as(client, db, "store_buyer", [2], token="buyer-two")
    _sign_in_as(client, db, "store_admin", [1])

    response = client.get(BUYERS, params={"store_id": 1})

    assert response.json() == [{"user_id": buyer["user_id"], "email": "buyer-one@example.com"}]


def test_assign_and_clear_a_buyer(client, db):
    buyer = _sign_in_as(client, db, "store_buyer", [1], token="buyer-one")
    _sign_in_as(client, db, "store_admin", [1])

    client.put(SETTINGS, json={"store_id": 1, "product_ids": [1, 2], "buyer_user_id": buyer["user_id"]})

    listed = _listed(client)
    assert listed[1]["buyer_email"] == "buyer-one@example.com"
    assert _row(db, 2)["buyer_user_id"] == buyer["user_id"]

    client.put(SETTINGS, json={"store_id": 1, "product_ids": [1], "clear_buyer": True})

    assert _row(db, 1)["buyer_user_id"] is None
    assert _row(db, 2)["buyer_user_id"] == buyer["user_id"]


def test_level_and_buyer_together(client, db):
    buyer = _sign_in_as(client, db, "store_buyer", [1], token="buyer-one")
    _sign_in_as(client, db, "store_admin", [1])

    client.put(SETTINGS, json={
        "store_id": 1, "product_ids": [4], "low_stock_threshold": 20, "buyer_user_id": buyer["user_id"],
    })

    assert _row(db, 4) == {"low_stock_threshold": 20, "buyer_user_id": buyer["user_id"]}


def test_a_buyer_from_another_store_cannot_be_assigned(client, db):
    other = _sign_in_as(client, db, "store_buyer", [2], token="buyer-two")
    _sign_in_as(client, db, "store_admin", [1])

    response = client.put(SETTINGS, json={"store_id": 1, "product_ids": [1], "buyer_user_id": other["user_id"]})

    assert response.status_code == 422
    assert _row(db, 1)["buyer_user_id"] is None


# --- who can change them ---------------------------------------------------


def test_managers_cannot_change_another_store(client, db):
    _sign_in_as(client, db, "store_admin", [1])

    response = client.put(SETTINGS, json={"store_id": 2, "product_ids": [1], "low_stock_threshold": 3})

    assert response.status_code == 403
    assert client.get(BUYERS, params={"store_id": 2}).status_code == 403


@pytest.mark.parametrize("role", ["store_buyer", "user"])
def test_buyers_and_shoppers_cannot_change_them(client, db, role):
    _sign_in_as(client, db, role, [1] if role == "store_buyer" else [])

    response = client.put(SETTINGS, json={"store_id": 1, "product_ids": [1], "low_stock_threshold": 3})

    assert response.status_code == 403
