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
import store_selection
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
    app.dependency_overrides.pop(auth.optional_user, None)


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
    """Insert a product and return its id, so tests never depend on seed data.

    Only real product columns may be passed: price lives in inventory and
    rating comes from reviews, so those fixtures have their own helpers.
    """
    fields = {"name": name, "brand": brand, "product_type": "Test", **columns}
    assignments = ", ".join(fields)
    placeholders = ", ".join(["%s"] * len(fields))
    return conn.execute(
        f"INSERT INTO products ({assignments}) VALUES ({placeholders}) RETURNING product_id",
        tuple(fields.values()),
    ).fetchone()["product_id"]


def _add_inventory(conn, product_id, store_id, quantity, price) -> None:
    """Price a product at a store, since products no longer carry a price."""
    conn.execute(
        "INSERT INTO inventory (product_id, store_id, quantity, price)"
        " VALUES (%s, %s, %s, %s)",
        (product_id, store_id, quantity, price),
    )


def _add_review(conn, product_id, rating) -> None:
    """Give a product a rating, which comes from reviews (not a column)."""
    source_id = conn.execute(
        "INSERT INTO product_review_sources (product_id, source)"
        " VALUES (%s, 'test') RETURNING review_source_id",
        (product_id,),
    ).fetchone()["review_source_id"]
    conn.execute(
        "INSERT INTO reviews (product_id, rating, review_source_id, body)"
        " VALUES (%s, %s, %s, 'test review body')",
        (product_id, rating, source_id),
    )


def _save_store(client, store_id) -> None:
    """Persist the signed-in user's store selection."""
    response = client.put("/api/me/store", json={"store_id": store_id})
    assert response.status_code == 200, response.text


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


# --- store selection resolution -------------------------------------------


@pytest.mark.parametrize(
    "user_has_row,explicit,expected",
    [
        pytest.param(True, 2, 2, id="explicit-param-beats-saved-store"),
        pytest.param(True, None, 1, id="saved-store-applies-when-no-param"),
        pytest.param(False, 3, 3, id="explicit-param-without-saved-store"),
        pytest.param(False, None, None, id="signed-in-without-saved-store"),
        pytest.param(None, None, None, id="anonymous-without-param"),
        pytest.param(None, 3, 3, id="anonymous-with-explicit-param"),
    ],
)
def test_resolve_store_id_priority(db, user_has_row, explicit, expected):
    # One table-driven test for the whole resolution rule, so a future edit
    # cannot make one route drift from another (they all share this call).
    user_id = None if user_has_row is None else _sign_in_as_direct(db)
    if user_has_row:
        store_selection.save_selected_store(db, user_id, 1)

    assert store_selection.resolve_store_id(db, user_id, explicit) == expected


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
        product_id = _new_product(db, name=name)
        _add_inventory(db, product_id, 1, 5, price)
        _add_review(db, product_id, rating)
        client.put(f"/api/me/liked-products/{product_id}")

    def names(sort, **params):
        return [
            item["name"]
            for item in client.get(
                "/api/me/liked-products", params={"sort": sort, **params}
            ).json()["items"]
        ]

    assert names("name") == ["A Item", "B Item", "C Item"]
    # Price sorting is store-scoped: it needs a resolved store, and the
    # explicit ?store_id= counts as one.
    assert names("price", store_id=1) == ["A Item", "B Item", "C Item"]
    assert names("rating") == ["A Item", "B Item", "C Item"]


def test_likes_price_sort_requires_a_store(client, db, cognito):
    _sign_in_as(client, "likes-price-no-store")

    response = client.get("/api/me/liked-products", params={"sort": "price"})

    assert response.status_code == 400
    assert response.json()["detail"] == "Select a store to sort by price."


def test_likes_price_sort_with_saved_store(client, db, cognito):
    _sign_in_as(client, "likes-price-saved")
    _save_store(client, 1)
    product_ids = [
        _new_product(db, name="Cheap"),       # priced 5.00 at store 1
        _new_product(db, name="Pricey"),      # priced 50.00 at store 1
        _new_product(db, name="Middle"),      # priced 25.00 at store 1
    ]
    for product_id, price in zip(product_ids, (5.00, 50.00, 25.00)):
        _add_inventory(db, product_id, 1, 5, price)
        client.put(f"/api/me/liked-products/{product_id}")

    body = client.get("/api/me/liked-products", params={"sort": "price"}).json()

    assert [item["name"] for item in body["items"]] == ["Cheap", "Middle", "Pricey"]


def test_likes_price_sort_second_page_under_same_store(client, db, cognito):
    _sign_in_as(client, "likes-price-page2")
    _save_store(client, 1)
    names_prices = [("A", 1.00), ("B", 2.00), ("C", 3.00), ("D", 4.00)]
    for name, price in names_prices:
        product_id = _new_product(db, name=name)
        _add_inventory(db, product_id, 1, 5, price)
        client.put(f"/api/me/liked-products/{product_id}")

    first = client.get(
        "/api/me/liked-products", params={"sort": "price", "limit": 2}
    ).json()
    assert [item["name"] for item in first["items"]] == ["A", "B"]
    assert first["next_cursor"]

    second = client.get(
        "/api/me/liked-products",
        params={"sort": "price", "limit": 2, "cursor": first["next_cursor"]},
    ).json()
    assert [item["name"] for item in second["items"]] == ["C", "D"]
    assert second["next_cursor"] is None


def test_likes_price_sort_rejects_cross_store_cursor(client, db, cognito):
    _sign_in_as(client, "likes-price-cross-store")
    _save_store(client, 1)
    product_ids = [_new_product(db, name=f"P{i}") for i in range(3)]
    for i, product_id in enumerate(product_ids):
        _add_inventory(db, product_id, 1, 5, 10.00 + i)
        _add_inventory(db, product_id, 2, 5, 90.00 + i)
        client.put(f"/api/me/liked-products/{product_id}")

    first = client.get(
        "/api/me/liked-products",
        params={"sort": "price", "limit": 2, "store_id": 1},
    ).json()

    # The same cursor under a different store would resume at the wrong
    # position (or skip rows), so it is rejected instead of mispaginating.
    response = client.get(
        "/api/me/liked-products",
        params={"sort": "price", "limit": 2, "store_id": 2, "cursor": first["next_cursor"]},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Cursor does not match the selected store."


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


# --- store selection (/api/me/store) ---------------------------------------


def test_store_routes_require_authentication(client):
    assert client.get("/api/me/store").status_code == 401
    assert client.put("/api/me/store", json={"store_id": 1}).status_code == 401


def test_store_selection_round_trip_and_repeat_save(client, db, cognito):
    _sign_in_as(client, "store-round-trip")

    assert client.get("/api/me/store").json() == {"store_id": None}

    first = client.put("/api/me/store", json={"store_id": 1})
    assert first.status_code == 200
    assert client.get("/api/me/store").json() == {"store_id": 1}

    # A repeat PUT with a different store must change the value (a bare
    # ON CONFLICT DO NOTHING would leave store 1 here and fail this test).
    second = client.put("/api/me/store", json={"store_id": 2})
    assert second.status_code == 200
    assert client.get("/api/me/store").json() == {"store_id": 2}

    cleared = client.put("/api/me/store", json={"store_id": None})
    assert cleared.status_code == 200
    assert client.get("/api/me/store").json() == {"store_id": None}


def test_store_selection_rejects_unknown_store(client, db, cognito):
    _sign_in_as(client, "store-unknown")

    response = client.put("/api/me/store", json={"store_id": 999999})

    assert response.status_code == 404


def test_store_selection_is_per_user(client, db, cognito):
    _sign_in_as(client, "store-one")
    client.put("/api/me/store", json={"store_id": 1})

    _sign_in_as(client, "store-two")

    assert client.get("/api/me/store").json() == {"store_id": None}


# --- optional_user + saved-store resolution on shopper endpoints ----------


def test_shopper_endpoints_use_saved_store_without_param(client, db, cognito):
    _sign_in_as(client, "saved-store")
    _save_store(client, 1)
    # Seeded product 1: 220.00 at store 1, 240.00 (out of stock) at store 2.
    client.put("/api/me/liked-products/1")

    detail = client.get("/api/me/products/1").json()
    assert detail["store_inventory"]["price"] == 220.0

    likes = client.get("/api/me/liked-products", params={"sort": "price"}).json()
    assert likes["items"][0]["store_inventory"]["price"] == 220.0

    # An explicit store_id always wins over the saved store.
    override = client.get("/api/me/products/1", params={"store_id": 2}).json()
    assert override["store_inventory"]["price"] == 240.0


def test_optional_user_invalid_token_is_rejected(client, db):
    # optional_user must not quietly downgrade a bad token to anonymous (the
    # verify_access_token override does not apply to it: it is called as a
    # plain function inside optional_user, so this exercises the real one).
    response = client.get(
        "/api/products/1", headers={"Authorization": "Bearer not-a-real-token"}
    )
    assert response.status_code == 401


def test_optional_user_valid_token_applies_saved_store(client, db, cognito):
    # /api/me/* routes authenticate via verify_access_token, which the
    # _sign_in_as override satisfies. But /api/products/{id} authenticates
    # through optional_user, which calls verify_access_token as a plain
    # function — the override does not reach it. Overriding optional_user
    # directly is the only way to authenticate a shopper on those routes.
    user_id = _sign_in_as(client, "optional-user")
    _save_store(client, 1)
    app.dependency_overrides[auth.optional_user] = lambda: {
        "user_id": user_id,
        "cognito_sub": "optional-user",
        "email": "optional-user@example.com",
        "is_admin": False,
    }

    response = client.get("/api/products/1")

    assert response.status_code == 200
    # Seeded product 1: the saved store (1) prices it, not just an explicit
    # ?store_id=.
    assert response.json()["store_inventory"]["price"] == 220.0


# --- interactions + history stamped with store context ---------------------


def test_interaction_stamps_store_and_price(client, db, cognito):
    _sign_in_as(client, "interaction-stamp")
    _save_store(client, 1)
    product_id = _new_product(db, name="Stamped Boots")
    _add_inventory(db, product_id, 1, 5, 44.99)

    response = client.post(
        "/api/me/product-interactions",
        json={"product_id": product_id, "interaction": "scanned"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["store_id"] == 1
    assert body["price_at_interaction"] == 44.99

    history = client.get("/api/me/product-history").json()["items"]
    assert history[0]["store_id"] == 1
    assert history[0]["store_name"]  # seeded store 1 has a name
    assert history[0]["price_at_interaction"] == 44.99


def test_interaction_at_store_without_inventory_records_null_price(
    client, db, cognito
):
    _sign_in_as(client, "interaction-null-price")
    _save_store(client, 2)
    product_id = _new_product(db, name="Not At Store 2")

    response = client.post(
        "/api/me/product-interactions",
        json={"product_id": product_id, "interaction": "scanned"},
    )

    assert response.status_code == 201
    body = response.json()
    # The store is still recorded even though it carries no row for the
    # product: "we know where they were, there was no price to see".
    assert body["store_id"] == 2
    assert body["price_at_interaction"] is None


def test_history_flat_store_fields_differ_from_nested_store_inventory(
    client, db, cognito
):
    _sign_in_as(client, "history-flat-vs-nested")
    _save_store(client, 1)
    product_id = _new_product(db, name="Flat vs Nested")
    _add_inventory(db, product_id, 1, 5, 10.00)
    _add_inventory(db, product_id, 2, 5, 20.00)
    client.post(
        "/api/me/product-interactions",
        json={"product_id": product_id, "interaction": "scanned"},
    )

    # Read history with the *other* store resolved: the flat fields keep the
    # viewing context (store 1, 10.00), while the nested product reflects the
    # current store (store 2, 20.00). A response that copies one into the
    # other fails this test.
    history = client.get(
        "/api/me/product-history", params={"store_id": 2}
    ).json()["items"]

    (item,) = history
    assert item["store_id"] == 1
    assert item["price_at_interaction"] == 10.0
    assert item["product"]["store_inventory"]["price"] == 20.0
    assert item["product"]["store_inventory"]["store_id"] == 2
