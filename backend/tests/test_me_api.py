# Tests for the shopper likes/history service and the /api/me routes.
#
# Two layers are covered:
#   1. user_products.* called directly with an explicit user_id.
#   2. /api/me endpoints through TestClient, with token verification replaced by
#      a dependency override and the cognito-idp client replaced by a fake, so
#      neither layer ever reaches AWS.

import os
from urllib.parse import quote

import psycopg
import pytest
from fastapi.testclient import TestClient
from testcontainers.community.postgres import PostgresContainer

import auth
import user_products
from conftest import apply_init_sql
from main import app


class FakeCognito:
    """Stands in for the boto3 cognito-idp client so tests never reach AWS."""

    def get_user(self, AccessToken):
        # The token doubles as the user's sub, so one fake serves every test.
        return {
            "UserAttributes": [{"Name": "email", "Value": f"{AccessToken}@example.com"}]
        }


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
    """A connection with no users, so every test starts from empty likes/history."""
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


def _new_product(conn, name="Test Product", brand="Test Brand", **columns) -> int:
    """Insert a product and return its id, so tests never depend on seed data."""
    fields = {"name": name, "brand": brand, "product_type": "Test", **columns}
    assignments = ", ".join(fields)
    placeholders = ", ".join(["%s"] * len(fields))
    return conn.execute(
        f"INSERT INTO products ({assignments}) VALUES ({placeholders}) RETURNING product_id",
        tuple(fields.values()),
    ).fetchone()["product_id"]


def _history(conn, user_id) -> list[str]:
    return [
        row["interaction"]
        for row in conn.execute(
            "SELECT interaction::text AS interaction FROM user_product_history"
            " WHERE user_id = %s ORDER BY history_id",
            (user_id,),
        ).fetchall()
    ]


# --- service layer: explicit user_id, no HTTP ------------------------------


def test_service_like_creates_row_and_one_event(db):
    user_id = _sign_in_as_direct(db)
    product_id = _new_product(db)

    result = user_products.set_liked(db, user_id, product_id, True)

    assert result["is_liked"] is True
    assert _history(db, user_id) == ["liked"]


def test_service_like_is_idempotent(db):
    user_id = _sign_in_as_direct(db)
    product_id = _new_product(db)

    user_products.set_liked(db, user_id, product_id, True)
    user_products.set_liked(db, user_id, product_id, True)

    assert _history(db, user_id) == ["liked"]


def test_service_unlike_keeps_history(db):
    user_id = _sign_in_as_direct(db)
    product_id = _new_product(db)

    user_products.set_liked(db, user_id, product_id, True)
    result = user_products.set_liked(db, user_id, product_id, False)

    assert result["is_liked"] is False
    # The earlier 'liked' event survives; the unlike is recorded as its own event
    # so History stays a faithful log.
    assert _history(db, user_id) == ["liked", "unliked"]
    assert (
        db.execute(
            "SELECT COUNT(*) AS count FROM user_product_likes WHERE user_id = %s",
            (user_id,),
        ).fetchone()["count"]
        == 0
    )


def test_service_unlike_without_like_is_a_no_op(db):
    user_id = _sign_in_as_direct(db)
    product_id = _new_product(db)

    user_products.set_liked(db, user_id, product_id, False)

    assert _history(db, user_id) == []


def test_service_lists_only_the_given_users_likes(db):
    first = _sign_in_as_direct(db)
    second = _sign_in_as_direct(db)
    liked_by_first = _new_product(db, name="First Choice")
    liked_by_second = _new_product(db, name="Second Choice")

    user_products.set_liked(db, first, liked_by_first, True)
    user_products.set_liked(db, second, liked_by_second, True)

    items, _ = user_products.list_liked_products(db, first, None, "recent", 20, None)

    assert [item["name"] for item in items] == ["First Choice"]
    assert items[0]["liked_at"] is not None


def test_service_lists_history_newest_first_with_current_like_state(db):
    user_id = _sign_in_as_direct(db)
    product_id = _new_product(db, name="Scanned Twice")

    user_products.record_interaction(db, user_id, product_id, "scanned")
    user_products.record_interaction(db, user_id, product_id, "viewed")
    user_products.set_liked(db, user_id, product_id, True)
    user_products.set_liked(db, user_id, product_id, False)

    items, _ = user_products.list_product_history(db, user_id, None, 20, None)

    assert [item["interaction"] for item in items] == [
        "unliked",
        "liked",
        "viewed",
        "scanned",
    ]
    # The product appears repeatedly, and state is the *current* one (unliked),
    # not the state at the time of each event.
    assert all(item["product"]["product_id"] == product_id for item in items)
    assert all(item["product"]["is_liked"] is False for item in items)


def test_service_rejects_forged_like_interaction(db):
    user_id = _sign_in_as_direct(db)
    product_id = _new_product(db)

    with pytest.raises(user_products.UserProductError):
        user_products.record_interaction(db, user_id, product_id, "liked")


def test_service_missing_product_raises_not_found(db):
    user_id = _sign_in_as_direct(db)

    with pytest.raises(user_products.UserProductError) as error:
        user_products.set_liked(db, user_id, 999999, True)

    assert error.value.status == 404


def _sign_in_as_direct(conn) -> int:
    """Create a user row and return its id for direct service calls."""
    token = os.urandom(8).hex()
    return conn.execute(
        "INSERT INTO users (cognito_sub, email) VALUES (%s, %s) RETURNING user_id",
        (f"sub-{token}", f"{token}@example.com"),
    ).fetchone()["user_id"]


# --- HTTP layer -----------------------------------------------------------


def test_routes_require_authentication(client):
    for method, path in (
        ("get", "/api/me/liked-products"),
        ("get", "/api/me/product-history"),
        ("get", "/api/me/products/1"),
        ("put", "/api/me/liked-products/1"),
        ("delete", "/api/me/liked-products/1"),
    ):
        response = getattr(client, method)(path)
        assert response.status_code == 401, f"{method.upper()} {path}"


def test_like_then_list_liked_products(client, db, cognito):
    user_id = _sign_in_as(client, "liked-list")
    product_id = _new_product(db, name="Likeable Lamp")

    liked = client.put(f"/api/me/liked-products/{product_id}")
    assert liked.status_code == 200
    assert liked.json()["is_liked"] is True

    body = client.get("/api/me/liked-products").json()
    assert [item["product_id"] for item in body["items"]] == [product_id]
    assert body["items"][0]["liked_at"]
    assert body["next_cursor"] is None

    assert _history(db, user_id) == ["liked"]


def test_repeated_like_adds_no_second_event(client, db, cognito):
    user_id = _sign_in_as(client, "repeat-like")
    product_id = _new_product(db)

    client.put(f"/api/me/liked-products/{product_id}")
    second = client.put(f"/api/me/liked-products/{product_id}")

    assert second.status_code == 200
    assert _history(db, user_id) == ["liked"]


def test_unlike_removes_from_likes_but_not_history(client, db, cognito):
    user_id = _sign_in_as(client, "unlike")
    product_id = _new_product(db)
    client.put(f"/api/me/liked-products/{product_id}")

    response = client.delete(f"/api/me/liked-products/{product_id}")

    assert response.status_code == 200
    assert response.json()["is_liked"] is False
    assert client.get("/api/me/liked-products").json()["items"] == []
    # Unliking adds an 'unliked' event but never deletes the earlier 'liked' one.
    assert _history(db, user_id) == ["liked", "unliked"]
    events = client.get("/api/me/product-history").json()["items"]
    assert [event["interaction"] for event in events] == ["unliked", "liked"]


def test_users_cannot_see_each_others_data(client, db, cognito):
    _sign_in_as(client, "user-one")
    product_id = _new_product(db, name="Only For One")
    client.put(f"/api/me/liked-products/{product_id}")
    client.post(
        "/api/me/product-interactions",
        json={"product_id": product_id, "interaction": "scanned"},
    )

    _sign_in_as(client, "user-two")

    assert client.get("/api/me/liked-products").json()["items"] == []
    assert client.get("/api/me/product-history").json()["items"] == []
    assert client.get(f"/api/me/products/{product_id}").json()["is_liked"] is False


def test_likes_search_only_matches_own_likes(client, db, cognito):
    _sign_in_as(client, "likes-search")
    wanted = _new_product(db, name="Blue Running Shoe", brand="Acme")
    _new_product(db, name="Blue Running Shoe Not Liked", brand="Acme")
    client.put(f"/api/me/liked-products/{wanted}")

    body = client.get("/api/me/liked-products", params={"q": "blue"}).json()

    assert [item["product_id"] for item in body["items"]] == [wanted]
    assert (
        client.get("/api/me/liked-products", params={"q": "zzzzz"}).json()["items"]
        == []
    )


def test_likes_can_be_sorted(client, db, cognito):
    _sign_in_as(client, "likes-sort")
    for name, price, rating in (
        ("C Item", 30, 3.0),
        ("A Item", 10, 5.0),
        ("B Item", 20, 4.0),
    ):
        product_id = _new_product(db, name=name, price=price, rating=rating)
        client.put(f"/api/me/liked-products/{product_id}")

    def names(sort):
        return [
            item["name"]
            for item in client.get(
                "/api/me/liked-products", params={"sort": sort}
            ).json()["items"]
        ]

    assert names("name") == ["A Item", "B Item", "C Item"]
    assert names("price") == ["A Item", "B Item", "C Item"]
    assert names("rating") == ["A Item", "B Item", "C Item"]


def test_likes_use_a_cursor_for_the_next_page(client, db, cognito):
    _sign_in_as(client, "likes-paging")
    names = ["A Item", "B Item", "C Item"]
    for name in names:
        product_id = _new_product(db, name=name)
        client.put(f"/api/me/liked-products/{product_id}")

    first = client.get("/api/me/liked-products", params={"limit": 2, "sort": "name"}).json()
    assert [item["name"] for item in first["items"]] == ["A Item", "B Item"]
    assert first["next_cursor"]

    second = client.get(
        "/api/me/liked-products",
        params={"limit": 2, "sort": "name", "cursor": first["next_cursor"]},
    ).json()
    assert [item["name"] for item in second["items"]] == ["C Item"]
    assert second["next_cursor"] is None


def test_likes_page_by_like_time_without_repeats(client, db, cognito):
    _sign_in_as(client, "likes-paging-recent")
    for name in ["First", "Second", "Third"]:
        product_id = _new_product(db, name=name)
        client.put(f"/api/me/liked-products/{product_id}")

    seen: list[str] = []
    cursor = None
    for _ in range(3):
        body = client.get(
            "/api/me/liked-products",
            params={"limit": 2, "sort": "recent", **({"cursor": cursor} if cursor else {})},
        ).json()
        seen.extend(item["name"] for item in body["items"])
        cursor = body["next_cursor"]
        if not cursor:
            break

    assert seen == ["Third", "Second", "First"]
    assert len(seen) == len(set(seen))


def test_likes_reject_an_invalid_cursor(client, db, cognito):
    _sign_in_as(client, "bad-cursor")

    response = client.get("/api/me/liked-products", params={"cursor": "not-a-cursor"})

    assert response.status_code == 400


def test_history_records_client_interactions(client, db, cognito):
    user_id = _sign_in_as(client, "history-record")
    product_id = _new_product(db)

    for interaction in ("scanned", "viewed", "viewed-from-search"):
        response = client.post(
            "/api/me/product-interactions",
            json={"product_id": product_id, "interaction": interaction},
        )
        assert response.status_code == 201
        assert response.json()["interaction"] == interaction

    body = client.get("/api/me/product-history").json()
    assert [item["interaction"] for item in body["items"]] == [
        "viewed-from-search",
        "viewed",
        "scanned",
    ]
    assert _history(db, user_id) == ["scanned", "viewed", "viewed-from-search"]


def test_history_rejects_forged_like_events(client, db, cognito):
    _sign_in_as(client, "history-forged")
    product_id = _new_product(db)

    response = client.post(
        "/api/me/product-interactions",
        json={"product_id": product_id, "interaction": "liked"},
    )

    assert response.status_code == 422


def test_history_search_and_paging(client, db, cognito):
    _sign_in_as(client, "history-paging")
    shoe = _new_product(db, name="Trail Shoe", brand="Acme")
    for _ in range(3):
        client.post(
            "/api/me/product-interactions",
            json={"product_id": shoe, "interaction": "scanned"},
        )
    other = _new_product(db, name="Rain Jacket", brand="Other")
    client.post(
        "/api/me/product-interactions",
        json={"product_id": other, "interaction": "viewed"},
    )

    filtered = client.get("/api/me/product-history", params={"q": "shoe"}).json()
    # Repeats are expected: history is a list of events, not products.
    assert [item["interaction"] for item in filtered["items"]] == ["scanned"] * 3

    first = client.get("/api/me/product-history", params={"limit": 2}).json()
    assert len(first["items"]) == 2
    assert first["next_cursor"]

    second = client.get(
        "/api/me/product-history", params={"limit": 2, "cursor": first["next_cursor"]}
    ).json()
    seen = [item["history_id"] for item in first["items"] + second["items"]]
    assert len(seen) == len(set(seen)) == 4


def test_my_product_returns_like_state_and_404s(client, db, cognito):
    _sign_in_as(client, "my-product")
    product_id = _new_product(db, name="Detail Product")

    before = client.get(f"/api/me/products/{product_id}")
    assert before.status_code == 200
    assert before.json()["is_liked"] is False
    assert before.json()["name"] == "Detail Product"

    client.put(f"/api/me/liked-products/{product_id}")
    assert client.get(f"/api/me/products/{product_id}").json()["is_liked"] is True

    assert client.get("/api/me/products/999999").status_code == 404


def test_liking_a_missing_product_returns_404(client, db, cognito):
    _sign_in_as(client, "missing-product")

    assert client.put("/api/me/liked-products/999999").status_code == 404
    assert client.delete("/api/me/liked-products/999999").status_code == 404
