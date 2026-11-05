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
    # store_id is a query parameter, not part of the strict body model.
    store_id = body.pop("store_id", None)
    params = {"store_id": store_id} if store_id is not None else None
    return client.post("/api/recommendations", json=body, params=params)


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
    cards = response.json()["best_matches"]
    assert 1 <= len(cards) <= 3
    assert _ids(cards)[0] == _product_id(db, "Hunter")


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


# --- store context (prices shown, never the ranking itself) ---------------


def test_recommendation_cards_carry_store_inventory(client, db):
    _sign_in_as(client, "rec-store")

    response = _recommend(client, product_id=_product_id(db, "Sorel"), store_id=1)

    assert response.status_code == 200
    cards = response.json()["best_matches"]
    assert cards
    for card in cards:
        # Every card is priced at store 1 — a missing join here would leave
        # them null and the client would render "no price".
        assert card["product"]["store_inventory"] is not None
        assert card["product"]["store_inventory"]["store_id"] == 1


def test_recommendation_prices_follow_the_store_parameter(client, db):
    _sign_in_as(client, "rec-store-price")
    sorel = _product_id(db, "Sorel")
    # Product 1 differs across stores (220.00 vs 240.00), so if it appears on
    # a card its price proves which store priced the response. Ask for both
    # stores directly with the same query and compare the whole card set.
    at_one = _recommend(client, text="warm boots for snow", store_id=1).json()
    at_two = _recommend(client, text="warm boots for snow", store_id=2).json()

    for card_one, card_two in zip(at_one["best_matches"], at_two["best_matches"]):
        assert card_one["product"]["product_id"] == card_two["product"]["product_id"]
        inv_one = card_one["product"]["store_inventory"]
        inv_two = card_two["product"]["store_inventory"]
        assert inv_one["store_id"] == 1
        assert inv_two["store_id"] == 2


def test_recommendation_ordering_does_not_change_with_store(client, db):
    # Ranking is store-agnostic on purpose: the engine scores on the
    # catalog-wide baseline, so "Best matches" must not reshuffle when the
    # shopper switches stores. (Prices on the cards do change.)
    _sign_in_as(client, "rec-store-order")
    query = dict(text="warm boots for snow", ranking=PRICE_FIRST)

    at_one = _recommend(client, **query, store_id=1).json()["best_matches"]
    at_two = _recommend(client, **query, store_id=2).json()["best_matches"]
    no_store = _recommend(client, **query).json()["best_matches"]

    assert _ids(at_one) == _ids(at_two) == _ids(no_store)


def test_recommendation_without_store_has_null_prices(client, db):
    _sign_in_as(client, "rec-no-store")

    body = _recommend(client, text="warm boots for snow").json()

    assert body["best_matches"]
    for card in body["best_matches"]:
        assert card["product"]["store_inventory"] is None


# --- price scores from inventory (store-agnostic baseline) -----------------


def _temporary_product(db, name: str) -> int:
    return db.execute(
        "INSERT INTO products (name, product_type, brand, description)"
        " VALUES (%s, 'Boot', 'Temp Brand', 'temporary score-fixture boot')"
        " RETURNING product_id",
        (name,),
    ).fetchone()["product_id"]


def test_product_without_inventory_gets_neutral_price_score(client, db):
    # Every seeded product has inventory after §1.1, so the no-inventory case
    # needs a temporary product. Missing price data must score 0.5 (neutral),
    # not break the rebuild or default the product to "worst price".
    product_id = _temporary_product(db, "Temporary Unpriced Boot")
    try:
        refresh_recommendation_data()
        row = db.execute(
            "SELECT price_score FROM product_scores WHERE product_id = %s",
            (product_id,),
        ).fetchone()
        assert row is not None
        assert row["price_score"] == 0.5
    finally:
        db.execute("DELETE FROM products WHERE product_id = %s", (product_id,))
        refresh_recommendation_data()


def test_price_scores_use_averaged_inventory_prices(client, db):
    # Two temporary boots: A priced 200.00 at one store; B priced 100.00 at
    # store 1 and 300.00 at store 2, averaging 200.00. Equal average prices
    # must produce equal price scores — a join that read one store's price
    # (or MIN/MAX) instead of the average breaks the tie and fails this.
    single_store = _temporary_product(db, "Temporary Single-Store Boot")
    two_store = _temporary_product(db, "Temporary Two-Store Boot")
    db.execute(
        "INSERT INTO inventory (product_id, store_id, quantity, price)"
        " VALUES (%s, 1, 5, 200.00), (%s, 1, 5, 100.00), (%s, 2, 5, 300.00)",
        (single_store, two_store, two_store),
    )
    try:
        refresh_recommendation_data()
        scores = db.execute(
            "SELECT product_id, price_score FROM product_scores"
            " WHERE product_id IN (%s, %s)",
            (single_store, two_store),
        ).fetchall()
        by_product = {row["product_id"]: row["price_score"] for row in scores}
        assert by_product[single_store] == by_product[two_store]
    finally:
        db.execute(
            "DELETE FROM inventory WHERE product_id IN (%s, %s)",
            (single_store, two_store),
        )
        db.execute(
            "DELETE FROM products WHERE product_id IN (%s, %s)",
            (single_store, two_store),
        )
        refresh_recommendation_data()
        
def test_unrelated_text_returns_no_matches(client, db):
    _sign_in_as(client, "rec-unrelated")

    response = _recommend(client, text="laptop")

    assert response.status_code == 200
    assert response.json()["best_matches"] == []
    assert response.json()["for_you"] is None

# --- how advanced-search text was read (task 12) ---------------------------


def test_text_request_says_how_it_was_read(client):
    _sign_in_as(client, "rec-understood")

    response = _recommend(client, text="waterproof boots under $150", ranking=NOTHING_RANKED)

    assert response.status_code == 200
    body = response.json()
    assert body["understood"]["max_price"] == 150
    assert body["understood"]["requirements"] == ["waterproof"]
    # The results follow the limit the shopper sees
    assert all(card["product"]["price"] is None or card["product"]["price"] <= 150 for card in body["best_matches"])


def test_product_only_request_has_nothing_to_read(client, db):
    _sign_in_as(client, "rec-understood-product")

    response = _recommend(client, product_id=_product_id(db, "Sorel"), ranking=NOTHING_RANKED)

    assert response.status_code == 200
    assert response.json()["understood"] is None
