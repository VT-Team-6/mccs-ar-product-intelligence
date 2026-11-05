# Tests for /api/stores and /api/scan: the public store list and the
# QR-scan entry point, which must resolve the store exactly like product
# details so the price cannot flicker between the two screens.

import os
from urllib.parse import quote

import psycopg
import pytest
from fastapi.testclient import TestClient
from testcontainers.community.postgres import PostgresContainer

import auth
import store_selection
from conftest import apply_init_sql
from main import app


def _connection_url(pg):
    # testcontainers masks credentials in get_connection_url(), so build it here.
    return (
        f"postgresql://{quote(pg.username)}:{quote(pg.password)}"
        f"@{pg.get_container_host_ip()}:{pg.get_exposed_port(5432)}/{pg.dbname}"
    )


@pytest.fixture(scope="module")
def db_url():
    with PostgresContainer("postgres:17") as pg:
        url = _connection_url(pg)
        with psycopg.connect(url, autocommit=True) as conn:
            apply_init_sql(conn)
        yield url


@pytest.fixture(scope="module")
def client(db_url):
    # Point the app at the throwaway database instead of the dev container.
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
    with psycopg.connect(
        db_url, autocommit=True, row_factory=psycopg.rows.dict_row
    ) as conn:
        conn.execute("TRUNCATE users RESTART IDENTITY CASCADE")
        yield conn


@pytest.fixture(autouse=True)
def _reset_auth_override():
    # optional_user overrides do not collide across tests.
    yield
    app.dependency_overrides.pop(auth.optional_user, None)
    app.dependency_overrides.pop(auth.verify_access_token, None)


def _override_optional_user(user_id: int) -> None:
    """Make /api/scan and /api/products see a signed-in shopper.

    Those routes authenticate through optional_user, which calls
    verify_access_token as a plain function inside its body — the usual
    verify_access_token dependency override never reaches it.
    """
    app.dependency_overrides[auth.optional_user] = lambda: {
        "user_id": user_id,
        "cognito_sub": f"scan-user-{user_id}",
        "email": f"scan-user-{user_id}@example.com",
        "is_admin": False,
    }


# --- GET /api/stores -------------------------------------------------------


def test_stores_listed_without_authentication(client, db):
    response = client.get("/api/stores")

    assert response.status_code == 200
    stores = response.json()
    assert [store["store_id"] for store in stores] == [1, 2]
    for store in stores:
        assert set(store) == {
            "store_id",
            "name",
            "address",
            "latitude",
            "longitude",
        }
    # The names come from the seed: the flagship store and the outlet.
    assert stores[0]["name"] != stores[1]["name"]


def test_stores_list_is_catalog_data_not_user_scoped(client, db):
    # Two anonymous calls in a row answer the same way — the store list never
    # depends on who is asking (unlike prices, which do).
    first = client.get("/api/stores").json()
    second = client.get("/api/stores").json()
    assert first == second


# --- /api/scan: QR code parsing -------------------------------------------


def test_scan_requires_the_product_path_shape(client):
    for bad_code in (
        "not-a-url",
        "http://localhost:8000/",
        "http://localhost:8000/other/1",
        "http://localhost:8000/p/not-a-number",
        "http://localhost:8000/p/1/extra",
    ):
        response = client.get("/api/scan", params={"code": bad_code})
        assert response.status_code == 400, bad_code
        assert response.json()["detail"] == "Invalid product QR code"


def test_scan_missing_product_returns_404(client):
    response = client.get(
        "/api/scan", params={"code": "http://localhost:8000/p/999999"}
    )
    assert response.status_code == 404


# --- /api/scan: same store resolution as product details -------------------


def test_scan_anonymous_returns_product_without_price(client):
    response = client.get(
        "/api/scan", params={"code": "http://localhost:8000/p/1"}
    )
    assert response.status_code == 200
    assert response.json()["store_inventory"] is None


def test_scan_with_explicit_store_prices_at_that_store(client):
    response = client.get(
        "/api/scan",
        params={"code": "http://localhost:8000/p/1", "store_id": 1},
    )
    assert response.status_code == 200
    inventory = response.json()["store_inventory"]
    assert inventory["store_id"] == 1
    assert inventory["price"] == 220.0
    assert inventory["in_stock"] is True


def test_scan_authenticated_uses_saved_store(client, db):
    # The signed-in shopper's saved store prices the scan response, which is
    # how the scan screen and the product page show the same number.
    user_id = db.execute(
        "INSERT INTO users (cognito_sub, email)"
        " VALUES ('scan-saved', 'scan-saved@example.com') RETURNING user_id"
    ).fetchone()["user_id"]
    store_selection.save_selected_store(db, user_id, 1)
    _override_optional_user(user_id)

    response = client.get("/api/scan", params={"code": "http://localhost:8000/p/1"})

    assert response.status_code == 200
    assert response.json()["store_inventory"]["price"] == 220.0


def test_scan_explicit_store_beats_saved_store(client, db):
    user_id = db.execute(
        "INSERT INTO users (cognito_sub, email)"
        " VALUES ('scan-override', 'scan-override@example.com') RETURNING user_id"
    ).fetchone()["user_id"]
    store_selection.save_selected_store(db, user_id, 1)
    _override_optional_user(user_id)

    response = client.get(
        "/api/scan",
        params={"code": "http://localhost:8000/p/1", "store_id": 2},
    )

    assert response.status_code == 200
    # Saved store is 1 (220.00), explicit param is 2 (240.00): the param wins.
    assert response.json()["store_inventory"]["price"] == 240.0


def test_scan_matches_product_details_response(client, db):
    # The exact parity guarantee: same product, same store, same caller —
    # scan and /api/products/{id} must agree, or the price "flickers" between
    # the scan result and the product page opened from it.
    user_id = db.execute(
        "INSERT INTO users (cognito_sub, email)"
        " VALUES ('scan-parity', 'scan-parity@example.com') RETURNING user_id"
    ).fetchone()["user_id"]
    store_selection.save_selected_store(db, user_id, 2)
    _override_optional_user(user_id)

    scanned = client.get("/api/scan", params={"code": "http://localhost:8000/p/1"})
    detail = client.get("/api/products/1")

    assert scanned.status_code == detail.status_code == 200
    assert scanned.json() == detail.json()
