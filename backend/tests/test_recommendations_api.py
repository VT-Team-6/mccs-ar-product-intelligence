# Tests for POST /api/recommendations (8.15).
#
# Like test_preferences.py, this uses a throwaway Postgres container (with the
# seed products), replaces token verification with a dependency override, and
# replaces the cognito-idp client with a fake, so nothing ever reaches AWS.
# The ranking engine is the real one, so the first run may download the model.

import os
from urllib.parse import quote

import psycopg
import pytest
from fastapi.testclient import TestClient
from testcontainers.community.postgres import PostgresContainer

import auth
from conftest import apply_init_sql
from main import app
from preferences import CRITERIA
from product_features import refresh_recommendation_data

NOTHING_RANKED = {c: 0 for c in CRITERIA}
PRICE_FIRST = {**NOTHING_RANKED, "price": 1}


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
        # Starting the app builds the scores and the ranking engine from this database
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
def cognito(monkeypatch):
    monkeypatch.setattr(auth, "cognito_client", FakeCognito())


@pytest.fixture(autouse=True)
def _reset_auth_override():
    yield
    app.dependency_overrides.pop(auth.verify_access_token, None)


# --- helpers --------------------------------------------------------------


def _sign_in_as(client, token):
    """Make the next requests look like they carry this verified token."""
    claims = {"token_use": "access", "client_id": auth.COGNITO_CLIENT_ID, "sub": token}
    app.dependency_overrides[auth.verify_access_token] = lambda: {"claims": claims, "token": token}
    return client.get("/me").json()["user_id"]


def _product_id(db, name_part):
    return db.execute(
        "SELECT product_id FROM products WHERE name ILIKE %s", (f"%{name_part}%",)
    ).fetchone()["product_id"]


def _recommend(client, **body):
    return client.post("/api/recommendations", json=body)


def _ids(cards):
    return [card["product"]["product_id"] for card in cards]


# --- tests ----------------------------------------------------------------


def test_requires_sign_in(client):
    assert _recommend(client, text="boots").status_code == 401


def test_product_on_screen_gives_3_matches_with_product_details(client, db):
    _sign_in_as(client, "rec-product")
    sorel = _product_id(db, "Sorel")

    response = _recommend(client, product_id=sorel, ranking=PRICE_FIRST)

    assert response.status_code == 200
    cards = response.json()["best_matches"]
    assert len(cards) == 3
    assert sorel not in _ids(cards)
    for card in cards:
        row = db.execute(
            "SELECT name, product_type FROM products WHERE product_id = %s",
            (card["product"]["product_id"],),
        ).fetchone()
        assert card["product"]["name"] == row["name"]
        assert 1 <= len(card["reasons"]) <= 2


def test_text_only(client, db):
    _sign_in_as(client, "rec-text")

    response = _recommend(client, text="formal shoes for a wedding")

    assert response.status_code == 200
    assert _ids(response.json()["best_matches"])[0] == _product_id(db, "Allen Edmonds")


def test_product_and_text_together(client, db):
    _sign_in_as(client, "rec-both")

    response = _recommend(client, product_id=_product_id(db, "Sorel"), text="for rain")

    assert response.status_code == 200
    assert len(response.json()["best_matches"]) == 3


def test_needs_a_product_or_text(client):
    _sign_in_as(client, "rec-empty")

    assert _recommend(client).status_code == 422
    assert _recommend(client, text="   ").status_code == 422


def test_rejects_an_invalid_ranking(client):
    _sign_in_as(client, "rec-bad-ranking")

    response = _recommend(client, text="boots", ranking={**NOTHING_RANKED, "price": 1, "rating": 1})

    assert response.status_code == 422


def test_unknown_product_is_404(client):
    _sign_in_as(client, "rec-unknown")

    assert _recommend(client, product_id=999999).status_code == 404


def test_no_for_you_without_saved_ranking_or_likes(client):
    _sign_in_as(client, "rec-new-user")

    response = _recommend(client, text="warm boots for snow", ranking=PRICE_FIRST)

    assert response.json()["for_you"] is None


def test_saved_ranking_adds_a_for_you_pick(client):
    _sign_in_as(client, "rec-saved")
    client.put("/api/me/preferences", json={**NOTHING_RANKED, "comfort": 1})

    body = _recommend(client, text="warm boots for snow", ranking=PRICE_FIRST).json()

    assert body["for_you"] is not None
    assert body["for_you"]["product"]["product_id"] not in _ids(body["best_matches"])


def test_liked_products_are_never_the_for_you_pick(client, db):
    _sign_in_as(client, "rec-likes")
    liked = _product_id(db, "Hoka")
    client.put(f"/api/me/liked-products/{liked}")

    body = _recommend(client, text="running shoes for long runs").json()

    assert body["for_you"] is not None  # likes alone are enough for a pick
    assert body["for_you"]["product"]["product_id"] != liked


def test_deleted_products_are_not_recommended(client, db):
    _sign_in_as(client, "rec-deleted")
    timberland = _product_id(db, "Timberland")
    sorel = _product_id(db, "Sorel")
    assert timberland in _ids(_recommend(client, product_id=sorel).json()["best_matches"])

    db.execute("UPDATE products SET deleted_at = CURRENT_TIMESTAMP WHERE product_id = %s", (timberland,))
    try:
        refresh_recommendation_data()
        assert timberland not in _ids(_recommend(client, product_id=sorel).json()["best_matches"])
    finally:
        db.execute("UPDATE products SET deleted_at = NULL WHERE product_id = %s", (timberland,))
        refresh_recommendation_data()