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
    assert body["is_admin"] is False
    assert cognito.calls == [FAKE_TOKEN]

    rows = db.execute(
        "SELECT user_id, cognito_sub, email, is_admin FROM users"
    ).fetchall()
    assert rows == [(body["user_id"], sub, cognito.email, False)]


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


def test_new_user_is_not_admin(db, cognito, client):
    _sign_in(client, _new_sub())

    response = client.get("/admin_test")

    assert response.status_code == 403


def test_promoted_user_can_access_admin_route(db, cognito, client):
    sub = _new_sub()
    signed_in = _sign_in(client, sub).json()

    db.execute("UPDATE users SET is_admin = TRUE WHERE cognito_sub = %s", (sub,))
    response = client.get("/admin_test")

    assert response.status_code == 200
    body = response.json()
    assert body["user_id"] == signed_in["user_id"]
    assert body["is_admin"] is True
    # Promotion is read from the database; no second Cognito lookup happens.
    assert cognito.calls == [FAKE_TOKEN]
