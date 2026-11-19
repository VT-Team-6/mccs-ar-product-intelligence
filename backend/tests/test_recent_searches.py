# Recent searches: saved for signed-in shoppers, newest first, no repeats, newest 10 kept.

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
RECENT = "/api/me/recent-searches"


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


def _queries(client) -> list[str]:
    response = client.get(RECENT)
    assert response.status_code == 200
    return [row["query"] for row in response.json()]


def test_searches_are_listed_newest_first(client, db):
    _sign_in_as(client, db, "user")

    for query in ["running shoes", "dark roast coffee", "backpack"]:
        assert client.post(RECENT, json={"query": query}).status_code == 204

    assert _queries(client) == ["backpack", "dark roast coffee", "running shoes"]


def test_searching_again_moves_it_to_the_top_instead_of_repeating(client, db):
    _sign_in_as(client, db, "user")
    client.post(RECENT, json={"query": "running shoes"})
    client.post(RECENT, json={"query": "backpack"})

    client.post(RECENT, json={"query": "Running  Shoes"})  # different case and spacing

    assert _queries(client) == ["Running Shoes", "backpack"]


def test_only_the_newest_ten_are_kept(client, db):
    _sign_in_as(client, db, "user")

    for n in range(12):
        client.post(RECENT, json={"query": f"search {n}"})

    queries = _queries(client)
    assert len(queries) == 10
    assert queries[0] == "search 11"
    assert "search 0" not in queries and "search 1" not in queries


def test_one_letter_searches_are_not_saved(client, db):
    _sign_in_as(client, db, "user")

    client.post(RECENT, json={"query": " a "})

    assert _queries(client) == []


def test_remove_one_and_clear_all(client, db):
    _sign_in_as(client, db, "user")
    client.post(RECENT, json={"query": "running shoes"})
    client.post(RECENT, json={"query": "backpack"})
    first = client.get(RECENT).json()[0]

    assert client.delete(f"{RECENT}/{first['search_id']}").status_code == 204
    assert _queries(client) == ["running shoes"]

    assert client.delete(RECENT).status_code == 204
    assert _queries(client) == []


def test_each_person_sees_only_their_own(client, db):
    _sign_in_as(client, db, "user", token="shopper-one")
    client.post(RECENT, json={"query": "running shoes"})
    mine = client.get(RECENT).json()[0]

    _sign_in_as(client, db, "user", token="shopper-two")

    assert _queries(client) == []
    assert client.delete(f"{RECENT}/{mine['search_id']}").status_code == 404


def test_guests_have_no_recent_searches(client, db):
    app.dependency_overrides.pop(auth.verify_access_token, None)

    assert client.get(RECENT).status_code in (401, 403)
    assert client.post(RECENT, json={"query": "running shoes"}).status_code in (401, 403)
