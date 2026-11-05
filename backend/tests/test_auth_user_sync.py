# Tests for the users row created on a first authenticated request.
#
# require_authenticated_user (auth.py) inserts a users row when a Cognito user
# has no row yet. These tests keep both external boundaries local: token
# verification is replaced through FastAPI's dependency override, and the
# cognito-idp client is replaced with a fake that records calls, so no AWS
# request is ever made.

import os
import uuid
from urllib.parse import quote

import psycopg
import pytest
from fastapi.testclient import TestClient
from testcontainers.community.postgres import PostgresContainer

import auth
from conftest import apply_init_sql
from main import app

FAKE_TOKEN = "fake-cognito-access-token"


class FakeCognito:
    """Stands in for the boto3 cognito-idp client so tests never reach AWS."""

    def __init__(self):
        self.email = "shopper@example.com"
        self.calls: list[str] = []

    def get_user(self, AccessToken):
        self.calls.append(AccessToken)
        attributes = (
            [] if self.email is None
            else [{"Name": "email", "Value": self.email}]
        )
        return {"UserAttributes": attributes}


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
    # Capture the raw value (possibly absent) so the environment is restored
    # exactly as found, rather than pinning a resolved fallback URL into it.
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
    """A connection to the test database with an empty users table."""
    with psycopg.connect(db_url, autocommit=True) as conn:
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


def _sign_in(client, sub, token=FAKE_TOKEN):
    """Make the next request look like a request with a verified access token.

    Passing sub=None simulates a token that verified but carries no identity.
    """
    claims = {"token_use": "access", "client_id": auth.COGNITO_CLIENT_ID}
    if sub is not None:
        claims["sub"] = sub
    app.dependency_overrides[auth.verify_access_token] = lambda: {
        "claims": claims,
        "token": token,
    }
    return client.get("/me")


def _new_sub() -> str:
    return f"sub-{uuid.uuid4().hex}"


def _user_count(db) -> int:
    return db.execute("SELECT COUNT(*) FROM users").fetchone()[0]


def test_first_sign_in_creates_user_row(db, cognito, client):
    sub = _new_sub()

    response = _sign_in(client, sub)

    assert response.status_code == 200
    body = response.json()
    assert body["user_id"] > 0
    assert body["cognito_sub"] == sub
    assert body["email"] == cognito.email
    assert body["role"] == "user"
    assert body["permissions"] == []
    assert body["store_ids"] == []
    assert "is_admin" not in body
    assert cognito.calls == [FAKE_TOKEN]

    rows = db.execute(
        "SELECT user_id, cognito_sub, email, role FROM users"
    ).fetchall()
    assert rows == [(body["user_id"], sub, cognito.email, "user")]


def test_second_sign_in_reuses_existing_row(db, cognito, client):
    sub = _new_sub()
    first = _sign_in(client, sub).json()

    second = client.get("/me")

    assert second.status_code == 200
    assert second.json() == first
    assert _user_count(db) == 1
    # The row already existed, so Cognito was never asked for the profile again.
    assert cognito.calls == [FAKE_TOKEN]


def test_changed_cognito_email_does_not_create_duplicate(db, cognito, client):
    sub = _new_sub()
    first = _sign_in(client, sub).json()

    cognito.email = "renamed@example.com"
    second = client.get("/me")

    assert second.status_code == 200
    assert second.json()["user_id"] == first["user_id"]
    assert _user_count(db) == 1
    assert cognito.calls == [FAKE_TOKEN]


def test_missing_email_is_rejected_and_inserts_nothing(db, cognito, client):
    cognito.email = None

    response = _sign_in(client, _new_sub())

    assert response.status_code == 400
    assert _user_count(db) == 0


def test_missing_sub_is_rejected_without_calling_cognito(db, cognito, client):
    response = _sign_in(client, None)

    assert response.status_code == 401
    assert cognito.calls == []
    assert _user_count(db) == 0


def test_new_user_cannot_manage_products(db, cognito, client):
    _sign_in(client, _new_sub())

    response = client.delete("/api/admin/products/-1")

    assert response.status_code == 403
    assert response.json()["detail"] == "Insufficient permissions"


@pytest.mark.parametrize("role,permissions,can_manage_products", [
    ("user", [], False),
    ("store_buyer", ["manage_stock"], False),
    ("store_admin", ["manage_inventory", "manage_stock", "manage_store_buyers"], False),
    ("system_admin", [
        "aggregate_reviews", "manage_all_stores", "manage_inventory",
        "manage_products", "manage_stock", "manage_store_admins", "manage_store_buyers",
    ], True),
])
def test_role_permissions_are_read_from_database(
    db, cognito, client, role, permissions, can_manage_products,
):
    sub = _new_sub()
    signed_in = _sign_in(client, sub).json()

    expected_store_ids = []
    db.execute("UPDATE users SET role = %s WHERE cognito_sub = %s", (role, sub))
    if role in ("store_buyer", "store_admin"):
        store_id = db.execute(
            "INSERT INTO stores (name, address) VALUES ('Role test', 'Test') RETURNING store_id"
        ).fetchone()[0]
        db.execute(
            "INSERT INTO user_stores (user_id, store_id) VALUES (%s, %s)",
            (signed_in["user_id"], store_id),
        )
        expected_store_ids = [store_id]
    response = client.get("/me")

    assert response.status_code == 200
    body = response.json()
    assert body["user_id"] == signed_in["user_id"]
    assert body["role"] == role
    assert body["permissions"] == permissions
    assert body["store_ids"] == expected_store_ids
    # Use a nonexistent product so an allowed request cannot delete real data.
    # A 404 here means authorization passed and the product lookup ran.
    protected_response = client.delete("/api/admin/products/-1")
    assert protected_response.status_code == (404 if can_manage_products else 403)
    # Role changes use the existing identity; no second Cognito lookup happens.
    assert cognito.calls == [FAKE_TOKEN]


def test_demotion_revokes_product_permission_on_next_request(db, cognito, client):
    sub = _new_sub()
    _sign_in(client, sub)
    db.execute("UPDATE users SET role = 'system_admin' WHERE cognito_sub = %s", (sub,))
    assert client.delete("/api/admin/products/-1").status_code == 404

    db.execute("UPDATE users SET role = 'user' WHERE cognito_sub = %s", (sub,))
    assert client.delete("/api/admin/products/-1").status_code == 403
    body = client.get("/me").json()
    assert body["role"] == "user"
    assert body["permissions"] == []
    assert cognito.calls == [FAKE_TOKEN]


def test_me_returns_only_current_users_assigned_stores(db, cognito, client):
    signed_in = _sign_in(client, _new_sub()).json()
    other_user_id = db.execute(
        "INSERT INTO users (cognito_sub, email, role) VALUES (%s, %s, 'store_buyer') "
        "RETURNING user_id",
        (_new_sub(), "other@example.com"),
    ).fetchone()[0]
    store_ids = []
    for name in ("Assigned A", "Assigned B", "Other user's store"):
        store_ids.append(db.execute(
            "INSERT INTO stores (name, address) VALUES (%s, 'Test address') "
            "RETURNING store_id", (name,),
        ).fetchone()[0])

    try:
        db.execute("UPDATE users SET role = 'store_admin' WHERE user_id = %s", (signed_in["user_id"],))
        # Insert in reverse order to check that /me sorts the assignments.
        for store_id in reversed(store_ids[:2]):
            db.execute(
                "INSERT INTO user_stores (user_id, store_id) VALUES (%s, %s)",
                (signed_in["user_id"], store_id),
            )
        db.execute(
            "INSERT INTO user_stores (user_id, store_id) VALUES (%s, %s)",
            (other_user_id, store_ids[2]),
        )

        response = client.get("/me")
        assert response.status_code == 200
        assert response.json()["store_ids"] == sorted(store_ids[:2])
        assert response.json()["role"] == "store_admin"
        assert "store_roles" not in response.json()
        assert cognito.calls == [FAKE_TOKEN]
    finally:
        db.execute("DELETE FROM stores WHERE store_id = ANY(%s)", (store_ids,))
