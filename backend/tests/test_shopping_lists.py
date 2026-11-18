# Tests for shopping lists: the shopping_lists service and the
# /api/me/shopping-lists routes, including checking items off after a scan.
#
# Like test_preferences.py, this uses a throwaway Postgres container, replaces
# token verification with a dependency override, and replaces the cognito-idp
# client with a fake, so nothing ever reaches AWS.

import os
from urllib.parse import quote

import psycopg
import pytest
from fastapi.testclient import TestClient
from testcontainers.community.postgres import PostgresContainer

import auth
import shopping_lists
from conftest import apply_init_sql
from main import app


class FakeCognito:
    """Stands in for the boto3 cognito-idp client so tests never reach AWS."""

    def get_user(self, AccessToken):
        return {
            "UserAttributes": [{"Name": "email", "Value": f"{AccessToken}@example.com"}]
        }


def _connection_url(pg):
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
    """A connection with no users, so every test starts with no lists."""
    with psycopg.connect(db_url, autocommit=True, row_factory=psycopg.rows.dict_row) as conn:
        conn.execute("TRUNCATE users RESTART IDENTITY CASCADE")
        yield conn


@pytest.fixture
def cognito(monkeypatch):
    fake = FakeCognito()
    monkeypatch.setattr(auth, "cognito_client", fake)
    return fake


@pytest.fixture(autouse=True)
def _reset_auth_override():
    yield
    app.dependency_overrides.pop(auth.verify_access_token, None)


# --- helpers --------------------------------------------------------------


def _sign_in_as(client, token):
    """Make the next requests look like they carry this verified token."""
    claims = {
        "token_use": "access",
        "client_id": auth.COGNITO_CLIENT_ID,
        "sub": token,
    }
    app.dependency_overrides[auth.verify_access_token] = lambda: {
        "claims": claims,
        "token": token,
    }
    return client.get("/me").json()["user_id"]


def _new_user(conn) -> int:
    token = os.urandom(8).hex()
    return conn.execute(
        "INSERT INTO users (cognito_sub, email) VALUES (%s, %s) RETURNING user_id",
        (f"sub-{token}", f"{token}@example.com"),
    ).fetchone()["user_id"]


def _new_product(conn, name="Test Product") -> int:
    return conn.execute(
        "INSERT INTO products (name, brand, product_type)"
        " VALUES (%s, 'Test Brand', 'Test') RETURNING product_id",
        (name,),
    ).fetchone()["product_id"]


def _items(shopping_list) -> dict[int, bool]:
    """product_id -> is_completed, for short assertions."""
    return {item["product_id"]: item["is_completed"] for item in shopping_list["items"]}


# --- lists -----------------------------------------------------------------


def test_new_list_is_active_and_replaces_the_old_active_one(db):
    user_id = _new_user(db)

    first = shopping_lists.create_list(db, user_id, "Groceries")
    second = shopping_lists.create_list(db, user_id, "Camping")

    lists = {row["shopping_list_id"]: row["is_active"] for row in shopping_lists.list_lists(db, user_id)}
    assert lists == {first["shopping_list_id"]: False, second["shopping_list_id"]: True}


def test_adding_the_same_product_twice_keeps_one_item(db):
    user_id = _new_user(db)
    product_id = _new_product(db)
    list_id = shopping_lists.create_list(db, user_id, "Groceries")["shopping_list_id"]

    shopping_lists.add_item(db, user_id, list_id, product_id)
    result = shopping_lists.add_item(db, user_id, list_id, product_id)

    assert result["total_items"] == 1


def test_other_users_list_is_not_found(db):
    owner = _new_user(db)
    stranger = _new_user(db)
    list_id = shopping_lists.create_list(db, owner, "Groceries")["shopping_list_id"]

    with pytest.raises(shopping_lists.ShoppingListError) as error:
        shopping_lists.get_list(db, stranger, list_id)
    assert error.value.status == 404


# --- checking off after a scan --------------------------------------------


def test_scan_checks_off_product_on_active_list(db):
    user_id = _new_user(db)
    product_id = _new_product(db)
    list_id = shopping_lists.create_list(db, user_id, "Groceries")["shopping_list_id"]
    shopping_lists.add_item(db, user_id, list_id, product_id)

    result = shopping_lists.check_off_scanned(db, user_id, product_id)

    assert result["status"] == "checked_off"
    assert _items(result["list"]) == {product_id: True}
    assert result["list"]["completed_items"] == 1


def test_scanning_again_says_already_checked(db):
    user_id = _new_user(db)
    product_id = _new_product(db)
    list_id = shopping_lists.create_list(db, user_id, "Groceries")["shopping_list_id"]
    shopping_lists.add_item(db, user_id, list_id, product_id)

    shopping_lists.check_off_scanned(db, user_id, product_id)
    result = shopping_lists.check_off_scanned(db, user_id, product_id)

    assert result["status"] == "already_checked"


def test_scan_of_product_not_on_list_changes_nothing(db):
    user_id = _new_user(db)
    on_list = _new_product(db, "On the list")
    elsewhere = _new_product(db, "Not on the list")
    list_id = shopping_lists.create_list(db, user_id, "Groceries")["shopping_list_id"]
    shopping_lists.add_item(db, user_id, list_id, on_list)

    result = shopping_lists.check_off_scanned(db, user_id, elsewhere)

    assert result["status"] == "not_on_list"
    assert _items(result["list"]) == {on_list: False}


def test_scan_without_active_list(db):
    user_id = _new_user(db)
    product_id = _new_product(db)

    result = shopping_lists.check_off_scanned(db, user_id, product_id)

    assert result == {"status": "no_active_list", "product_id": product_id, "list": None}


def test_scan_only_touches_the_active_list(db):
    user_id = _new_user(db)
    product_id = _new_product(db)
    old_id = shopping_lists.create_list(db, user_id, "Old")["shopping_list_id"]
    shopping_lists.add_item(db, user_id, old_id, product_id)
    new_id = shopping_lists.create_list(db, user_id, "New")["shopping_list_id"]
    shopping_lists.add_item(db, user_id, new_id, product_id)

    shopping_lists.check_off_scanned(db, user_id, product_id)

    assert _items(shopping_lists.get_list(db, user_id, new_id)) == {product_id: True}
    assert _items(shopping_lists.get_list(db, user_id, old_id)) == {product_id: False}


def test_scan_never_checks_off_another_users_list(db):
    owner = _new_user(db)
    shopper = _new_user(db)
    product_id = _new_product(db)
    list_id = shopping_lists.create_list(db, owner, "Groceries")["shopping_list_id"]
    shopping_lists.add_item(db, owner, list_id, product_id)

    result = shopping_lists.check_off_scanned(db, shopper, product_id)

    assert result["status"] == "no_active_list"
    assert _items(shopping_lists.get_list(db, owner, list_id)) == {product_id: False}


# --- product page status ---------------------------------------------------


def test_active_list_status(db):
    user_id = _new_user(db)
    product_id = _new_product(db)

    assert shopping_lists.active_list_status(db, user_id, product_id)["on_list"] is False

    list_id = shopping_lists.create_list(db, user_id, "Groceries")["shopping_list_id"]
    shopping_lists.add_item(db, user_id, list_id, product_id)
    status = shopping_lists.active_list_status(db, user_id, product_id)
    assert status == {
        "list_id": list_id,
        "list_name": "Groceries",
        "on_list": True,
        "is_completed": False,
    }

    shopping_lists.check_off_scanned(db, user_id, product_id)
    assert shopping_lists.active_list_status(db, user_id, product_id)["is_completed"] is True


# --- HTTP routes -------------------------------------------------------------


def test_scan_route_checks_off_and_status_route_reports_it(client, db, cognito):
    _sign_in_as(client, "shopper")
    product_id = _new_product(db)
    created = client.post("/api/me/shopping-lists", json={"name": "Groceries"})
    assert created.status_code == 201, created.text
    list_id = created.json()["shopping_list_id"]
    added = client.post(f"/api/me/shopping-lists/{list_id}/items", json={"product_id": product_id})
    assert added.status_code == 200, added.text

    scanned = client.post("/api/me/shopping-lists/active/scan", json={"product_id": product_id})

    assert scanned.status_code == 200, scanned.text
    assert scanned.json()["status"] == "checked_off"
    status = client.get(f"/api/me/shopping-lists/active/products/{product_id}")
    assert status.status_code == 200, status.text
    assert status.json()["is_completed"] is True


def test_scan_route_rejects_bad_product_id(client, db, cognito):
    _sign_in_as(client, "shopper")

    response = client.post("/api/me/shopping-lists/active/scan", json={"product_id": 0})

    assert response.status_code == 422