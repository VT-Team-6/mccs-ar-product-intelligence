# Tests for a shopper's preferences: the preferences service and the
# GET/PUT /api/me/preferences routes.
#
# Like test_me_api.py, this uses a throwaway Postgres container, replaces token
# verification with a dependency override, and replaces the cognito-idp client
# with a fake, so nothing ever reaches AWS.

import os
from urllib.parse import quote

import psycopg
import pytest
from fastapi.testclient import TestClient
from testcontainers.community.postgres import PostgresContainer

import auth
import preferences
from conftest import apply_init_sql
from main import app

ALL_MEDIUM = {c: 2 for c in preferences.CRITERIA}


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
    """A connection with no users, so every test starts with no saved preferences."""
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


# --- service layer: explicit user_id, no HTTP ------------------------------


def test_service_new_user_gets_defaults(db):
    user_id = _new_user(db)

    assert preferences.get_preferences(db, user_id) == ALL_MEDIUM


def test_service_save_then_read(db):
    user_id = _new_user(db)
    chosen = {**ALL_MEDIUM, "price": 3, "brand": 0, "comfort": 1}

    saved = preferences.save_preferences(db, user_id, chosen)

    assert saved == chosen
    assert preferences.get_preferences(db, user_id) == chosen


def test_service_save_again_replaces_and_keeps_one_row(db):
    user_id = _new_user(db)

    preferences.save_preferences(db, user_id, {**ALL_MEDIUM, "price": 3})
    preferences.save_preferences(db, user_id, {**ALL_MEDIUM, "price": 1})

    assert preferences.get_preferences(db, user_id)["price"] == 1
    count = db.execute(
        "SELECT COUNT(*) AS n FROM user_preferences WHERE user_id = %s", (user_id,)
    ).fetchone()["n"]
    assert count == 1


def test_service_users_are_separate(db):
    first = _new_user(db)
    second = _new_user(db)

    preferences.save_preferences(db, first, {**ALL_MEDIUM, "quality": 3})

    assert preferences.get_preferences(db, second) == ALL_MEDIUM


def test_database_rejects_out_of_range_value(db):
    user_id = _new_user(db)

    with pytest.raises(psycopg.errors.CheckViolation):
        db.execute(
            "INSERT INTO user_preferences (user_id, price) VALUES (%s, 4)", (user_id,)
        )


# --- HTTP layer -----------------------------------------------------------


def test_routes_require_authentication(client):
    assert client.get("/api/me/preferences").status_code == 401
    assert client.put("/api/me/preferences", json=ALL_MEDIUM).status_code == 401


def test_get_returns_defaults_before_anything_is_saved(client, db, cognito):
    _sign_in_as(client, "prefs-new")

    response = client.get("/api/me/preferences")

    assert response.status_code == 200
    assert response.json() == ALL_MEDIUM


def test_put_then_get_round_trip(client, db, cognito):
    _sign_in_as(client, "prefs-round-trip")
    chosen = {**ALL_MEDIUM, "price": 3, "rating": 0}

    saved = client.put("/api/me/preferences", json=chosen)

    assert saved.status_code == 200
    assert saved.json() == chosen
    assert client.get("/api/me/preferences").json() == chosen


def test_put_twice_is_idempotent(client, db, cognito):
    _sign_in_as(client, "prefs-twice")
    chosen = {**ALL_MEDIUM, "durability": 3}

    client.put("/api/me/preferences", json=chosen)
    second = client.put("/api/me/preferences", json=chosen)

    assert second.status_code == 200
    assert second.json() == chosen


def test_put_rejects_out_of_range_value(client, db, cognito):
    _sign_in_as(client, "prefs-bad-value")

    response = client.put("/api/me/preferences", json={**ALL_MEDIUM, "price": 4})

    assert response.status_code == 422
    assert client.get("/api/me/preferences").json() == ALL_MEDIUM


def test_put_rejects_unknown_criterion(client, db, cognito):
    _sign_in_as(client, "prefs-unknown")

    response = client.put("/api/me/preferences", json={**ALL_MEDIUM, "color": 3})

    assert response.status_code == 422


def test_one_users_preferences_do_not_leak_to_another(client, db, cognito):
    _sign_in_as(client, "prefs-alice")
    client.put("/api/me/preferences", json={**ALL_MEDIUM, "price": 3})

    _sign_in_as(client, "prefs-bob")

    assert client.get("/api/me/preferences").json() == ALL_MEDIUM