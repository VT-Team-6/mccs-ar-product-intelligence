# Tests for the inventory API: public stock reads, admin-only writes, the
# pending -> active push flow, and the way a status change reaches shoppers.
#
# One Postgres 17 container per module. Every write test starts from the
# committed seed values, re-applied by the `fresh_inventory` fixture, so a
# write can never leak into a later read assertion.
#
# Authorisation is exercised for real: token verification is overridden and the
# cognito-idp client is faked, so no AWS call is made, but `require_permission`
# runs exactly as it does in production.

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


class FakeCognito:
    """Stands in for the boto3 cognito-idp client so tests never reach AWS."""

    def get_user(self, AccessToken):
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


@pytest.fixture(autouse=True)
def fake_cognito(monkeypatch):
    """No test may reach AWS; the fake is swapped in for every test."""
    monkeypatch.setattr(auth, "cognito_client", FakeCognito())


@pytest.fixture
def db(db_url):
    with psycopg.connect(
        db_url, autocommit=True, row_factory=psycopg.rows.dict_row
    ) as conn:
        conn.execute("TRUNCATE users RESTART IDENTITY CASCADE")
        yield conn


@pytest.fixture(autouse=True)
def fresh_inventory(db):
    """Restore the seeded stock before each test, so writes cannot leak."""
    db.execute("DELETE FROM inventory")
    db.execute(SEED.read_text())
    yield


@pytest.fixture(autouse=True)
def _reset_auth_override():
    yield
    app.dependency_overrides.pop(auth.verify_access_token, None)


# --- helpers --------------------------------------------------------------


def _sign_in(client, token) -> dict:
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
    return client.get("/me").json()


def _sign_in_as_admin(client, db, token="stock-admin") -> dict:
    """Sign in and promote to system_admin, the only globally-scoped role."""
    user = _sign_in(client, token)
    db.execute(
        "UPDATE users SET role = 'system_admin' WHERE user_id = %s", (user["user_id"],)
    )
    return client.get("/me").json()


def _sign_in_as(client, db, role, token=None) -> dict:
    """Sign in as a specific role."""
    user = _sign_in(client, token or f"stock-{role}")
    db.execute("UPDATE users SET role = %s WHERE user_id = %s", (role, user["user_id"]))
    return client.get("/me").json()


def _new_product(client, db=None) -> int:
    """A catalog product with no inventory rows anywhere.

    Every seeded product already has stock at both stores, so the
    "no entry yet" cases need a product nobody has stocked. Inserted directly
    when a connection is given: creating a product is a catalog permission
    (`manage_products`), which store roles deliberately do not hold, so going
    through the API would test the wrong thing.
    """
    if db is not None:
        return db.execute(
            "INSERT INTO products (name, product_type) VALUES (%s, %s)"
            " RETURNING product_id",
            ("Test Pushed Sneaker", "Sneaker"),
        ).fetchone()["product_id"]

    response = client.post(
        "/api/admin/products",
        json={"name": "Test Pushed Sneaker", "product_type": "Sneaker"},
    )
    assert response.status_code == 201, response.text
    return response.json()["product_id"]


# --- public reads ---------------------------------------------------------


def test_product_stock_lists_every_active_store(client):
    body = client.get("/api/products/1/stock").json()

    assert body["product_id"] == 1
    assert body["name"]
    assert [store["store_id"] for store in body["stores"]] == [1, 2]
    # Product 1 is the seed fixture with a different price per store.
    assert body["stores"][0]["price"] == 220.0
    assert body["stores"][1]["price"] == 240.0
    assert body["stores"][1]["quantity"] == 0
    assert body["stores"][1]["in_stock"] is False


def test_product_stock_carries_store_coordinates(client):
    """The client measures distance, so each entry needs the store's location."""
    body = client.get("/api/products/1/stock").json()

    for store in body["stores"]:
        # Both seeded stores have coordinates; the fields must be present so a
        # store without them can be told apart from one at (0, 0).
        assert "latitude" in store
        assert "longitude" in store
        assert isinstance(store["latitude"], float)
        assert isinstance(store["longitude"], float)

    assert body["stores"][0]["latitude"] == pytest.approx(38.5221, abs=1e-4)
    assert body["stores"][0]["longitude"] == pytest.approx(-77.3052, abs=1e-4)


def test_product_stock_is_public(client):
    # No token, no ?store_id=: stock must never require auth.
    assert client.get("/api/products/1/stock").status_code == 200


def test_product_stock_lists_zero_quantity_rather_than_hiding_it(client):
    body = client.get("/api/products/2/stock").json()

    assert [store["quantity"] for store in body["stores"]] == [20, 0]
    assert body["stores"][1]["in_stock"] is False


def test_product_stock_unknown_product_is_404(client):
    assert client.get("/api/products/999999/stock").status_code == 404


def test_store_stock_lists_products(client):
    body = client.get("/api/stores/1/stock").json()

    assert body["store_id"] == 1
    assert body["name"]
    assert body["items"]
    assert all(item["store_id"] == 1 for item in body["items"])
    assert [item["product_id"] for item in body["items"]] == sorted(
        item["product_id"] for item in body["items"]
    )


def test_store_stock_unknown_store_is_404(client):
    assert client.get("/api/stores/999999/stock").status_code == 404


def test_store_stock_pages_without_duplicates_or_gaps(client):
    first = client.get("/api/stores/1/stock", params={"limit": 5}).json()
    assert len(first["items"]) == 5
    assert first["next_cursor"]

    second = client.get(
        "/api/stores/1/stock", params={"limit": 5, "cursor": first["next_cursor"]}
    ).json()

    first_ids = [item["product_id"] for item in first["items"]]
    second_ids = [item["product_id"] for item in second["items"]]
    assert set(first_ids).isdisjoint(second_ids)
    assert second_ids[0] > first_ids[-1]


def test_store_stock_cursor_is_bound_to_its_store(client):
    cursor = client.get("/api/stores/1/stock", params={"limit": 2}).json()["next_cursor"]

    response = client.get("/api/stores/2/stock", params={"cursor": cursor})

    assert response.status_code == 400


# --- admin writes ---------------------------------------------------------


def test_update_quantity_only_keeps_price(client, db):
    _sign_in_as_admin(client, db)

    body = client.put(
        "/api/admin/inventory/1/1", json={"quantity": 99}
    ).json()

    assert body["quantity"] == 99
    assert body["price"] == 220.0
    assert body["in_stock"] is True


def test_update_price_only_keeps_quantity(client, db):
    _sign_in_as_admin(client, db)

    body = client.put("/api/admin/inventory/1/1", json={"price": 199.99}).json()

    assert body["price"] == 199.99
    assert body["quantity"] == 12


def test_update_creates_a_missing_entry(client, db):
    _sign_in_as_admin(client, db)
    product_id = _new_product(client)

    created = client.put(
        f"/api/admin/inventory/{product_id}/1", json={"quantity": 3, "price": 10.5}
    )

    assert created.status_code == 200
    assert created.json()["quantity"] == 3
    assert (
        client.get(f"/api/products/{product_id}/stock").json()["stores"][0]["quantity"]
        == 3
    )


def test_update_with_price_only_creates_at_zero_quantity(client, db):
    _sign_in_as_admin(client, db)
    product_id = _new_product(client)

    body = client.put(
        f"/api/admin/inventory/{product_id}/2", json={"price": 10.5}
    ).json()

    assert body["quantity"] == 0
    assert body["in_stock"] is False


def test_update_quantity_only_on_a_missing_entry_is_rejected(client, db):
    _sign_in_as_admin(client, db)
    product_id = _new_product(client)

    response = client.put(f"/api/admin/inventory/{product_id}/1", json={"quantity": 4})

    assert response.status_code == 422


def test_update_with_nothing_to_change_is_rejected(client, db):
    _sign_in_as_admin(client, db)

    assert client.put("/api/admin/inventory/1/1", json={}).status_code == 422


@pytest.mark.parametrize(
    "payload",
    [
        {"quantity": -1},
        {"price": -0.01},
        {"price": 9.999},
    ],
)
def test_update_rejects_invalid_values(client, db, payload):
    _sign_in_as_admin(client, db)

    assert client.put("/api/admin/inventory/1/1", json=payload).status_code == 422


def test_update_unknown_product_leaves_values_unchanged(client, db):
    _sign_in_as_admin(client, db)

    response = client.put("/api/admin/inventory/999999/1", json={"quantity": 1})

    assert response.status_code == 404
    assert client.get("/api/products/1/stock").json()["stores"][0]["quantity"] == 12


def test_update_unknown_store_is_404(client, db):
    _sign_in_as_admin(client, db)

    assert client.put("/api/admin/inventory/1/999999", json={"quantity": 1}).status_code == 404


def test_update_advances_updated_at(client, db):
    _sign_in_as_admin(client, db)
    before = client.get("/api/products/1/stock").json()["stores"][0]

    after = client.put("/api/admin/inventory/1/1", json={"quantity": 1}).json()

    assert after["updated_at"] >= before["updated_at"]


# --- batch ----------------------------------------------------------------


def test_batch_updates_every_row(client, db):
    _sign_in_as_admin(client, db)

    response = client.put(
        "/api/admin/inventory",
        json={
            "items": [
                {"product_id": 1, "store_id": 1, "quantity": 5, "price": 1.00},
                {"product_id": 2, "store_id": 1, "quantity": 6, "price": 2.00},
            ]
        },
    )

    assert response.status_code == 200
    assert [row["quantity"] for row in response.json()] == [5, 6]


def test_batch_is_all_or_nothing(client, db):
    _sign_in_as_admin(client, db)

    response = client.put(
        "/api/admin/inventory",
        json={
            "items": [
                {"product_id": 1, "store_id": 1, "quantity": 5},
                {"product_id": 999999, "store_id": 1, "quantity": 6},
            ]
        },
    )

    assert response.status_code == 404
    # The first entry must not have been committed.
    assert client.get("/api/products/1/stock").json()["stores"][0]["quantity"] == 12


def test_batch_rejects_duplicate_pairs(client, db):
    _sign_in_as_admin(client, db)

    response = client.put(
        "/api/admin/inventory",
        json={
            "items": [
                {"product_id": 1, "store_id": 1, "quantity": 5},
                {"product_id": 1, "store_id": 1, "quantity": 6},
            ]
        },
    )

    assert response.status_code == 422


def test_batch_rejects_empty_list(client, db):
    _sign_in_as_admin(client, db)

    assert client.put("/api/admin/inventory", json={"items": []}).status_code == 422


# --- delete ---------------------------------------------------------------


def test_delete_removes_the_entry(client, db):
    _sign_in_as_admin(client, db)

    assert client.delete("/api/admin/inventory/1/2").status_code == 200
    stores = client.get("/api/products/1/stock").json()["stores"]
    assert [store["store_id"] for store in stores] == [1]


def test_delete_missing_entry_is_404(client, db):
    _sign_in_as_admin(client, db)
    assert client.delete("/api/admin/inventory/1/1").status_code == 200

    # Deleting it twice: the second call has nothing to remove.
    assert client.delete("/api/admin/inventory/1/1").status_code == 404


# --- status ---------------------------------------------------------------


def test_discontinued_status_is_stored_and_returned(client, db):
    _sign_in_as_admin(client, db)

    body = client.put(
        "/api/admin/inventory/1/1", json={"status": "discontinued"}
    ).json()

    assert body["status"] == "discontinued"
    assert body["in_stock"] is False

    listed = client.get(
        "/api/admin/inventory", params={"store_id": 1, "entry_status": "discontinued"}
    ).json()
    assert 1 in [item["product_id"] for item in listed["items"]]


def test_pending_status_is_stored_and_returned(client, db):
    _sign_in_as_admin(client, db)

    body = client.put("/api/admin/inventory/1/1", json={"status": "pending"}).json()

    assert body["status"] == "pending"
    pending = client.get(
        "/api/admin/inventory", params={"store_id": 1, "entry_status": "pending"}
    ).json()
    assert 1 in [item["product_id"] for item in pending["items"]]


def test_active_without_a_price_is_rejected(client, db):
    _sign_in_as_admin(client, db)
    # A pending entry is the only kind that may have no price, so start there.
    db.execute(
        "UPDATE inventory SET status = 'pending', price = NULL"
        " WHERE product_id = 1 AND store_id = 1"
    )

    response = client.put("/api/admin/inventory/1/1", json={"status": "active"})

    assert response.status_code == 422


def test_unknown_status_is_rejected(client, db):
    _sign_in_as_admin(client, db)

    assert (
        client.put("/api/admin/inventory/1/1", json={"status": "gone"}).status_code == 422
    )


# --- shopper suppression --------------------------------------------------


def test_discontinued_product_disappears_from_store_search(client, db):
    _sign_in_as_admin(client, db)
    # Product 4 is 'Adidas Ultraboost Light' in the seed.
    client.put("/api/admin/inventory/4/1", json={"status": "discontinued"})

    with_store = client.get(
        "/api/search", params={"q": "adidas", "store_id": 1}
    ).json()
    assert all(row["product_id"] != 4 for row in with_store)
    # The other Adidas products at store 1 are unaffected.
    assert with_store

    # Still findable when no store is resolved: suppression is store-scoped.
    without_store = client.get("/api/search", params={"q": "adidas"}).json()
    assert any(row["product_id"] == 4 for row in without_store)


def test_discontinued_product_leaves_public_stock_reads(client, db):
    _sign_in_as_admin(client, db)
    client.put("/api/admin/inventory/1/1", json={"status": "discontinued"})

    stores = client.get("/api/products/1/stock").json()["stores"]
    assert [store["store_id"] for store in stores] == [2]


def test_scan_returns_discontinued_status(client, db):
    _sign_in_as_admin(client, db)
    client.put("/api/admin/inventory/1/1", json={"status": "discontinued"})

    body = client.get(
        "/api/scan", params={"code": "http://localhost:8000/p/1", "store_id": 1}
    ).json()

    assert body["store_inventory"]["status"] == "discontinued"
    assert body["store_inventory"]["in_stock"] is False


def test_pending_product_is_invisible_to_shoppers(client, db):
    _sign_in_as_admin(client, db)
    client.put("/api/admin/inventory/1/1", json={"status": "pending"})

    scan = client.get(
        "/api/scan", params={"code": "http://localhost:8000/p/1", "store_id": 1}
    ).json()
    assert scan["store_inventory"] is None

    found = client.get("/api/search", params={"q": "adidas", "store_id": 1}).json()
    assert all(row["product_id"] != 1 for row in found)


# --- push and approve -----------------------------------------------------


def test_push_creates_a_pending_entry_without_a_price(client, db):
    _sign_in_as_admin(client, db)
    product_id = _new_product(client)

    response = client.post(
        "/api/admin/inventory/push",
        json={"product_ids": [product_id], "store_ids": [1]},
    )

    assert response.status_code == 200
    pushed = response.json()[0]
    assert pushed["status"] == "pending"
    assert pushed["price"] is None
    assert pushed["quantity"] == 0
    assert pushed["already_present"] is False


def test_pushed_product_is_pending_until_approved(client, db):
    _sign_in_as_admin(client, db)
    product_id = _new_product(client)
    client.post(
        "/api/admin/inventory/push",
        json={"product_ids": [product_id], "store_ids": [1]},
    )

    queue = client.get(
        "/api/admin/inventory", params={"store_id": 1, "entry_status": "pending"}
    ).json()
    assert product_id in [item["product_id"] for item in queue["items"]]

    # A shopper cannot see it yet.
    assert client.get(f"/api/products/{product_id}/stock").json()["stores"] == []

    approved = client.post(
        f"/api/admin/inventory/{product_id}/1/approve",
        json={"price": 42.0, "quantity": 2},
    )
    assert approved.status_code == 200
    assert approved.json()["status"] == "active"

    # Now it is on sale.
    stores = client.get(f"/api/products/{product_id}/stock").json()["stores"]
    assert stores[0]["price"] == 42.0


def test_approval_stamps_the_approver(client, db):
    admin = _sign_in_as_admin(client, db)
    product_id = _new_product(client)
    client.post(
        "/api/admin/inventory/push",
        json={"product_ids": [product_id], "store_ids": [1]},
    )
    client.post(
        f"/api/admin/inventory/{product_id}/1/approve", json={"price": 42.0}
    )

    row = db.execute(
        "SELECT approved_at, approved_by FROM inventory"
        " WHERE product_id = %s AND store_id = 1",
        (product_id,),
    ).fetchone()

    assert row["approved_at"] is not None
    assert row["approved_by"] == admin["user_id"]


def test_approval_without_a_price_is_rejected(client, db):
    _sign_in_as_admin(client, db)
    product_id = _new_product(client)
    client.post(
        "/api/admin/inventory/push",
        json={"product_ids": [product_id], "store_ids": [1]},
    )

    response = client.post(
        f"/api/admin/inventory/{product_id}/1/approve", json={"quantity": 3}
    )

    assert response.status_code == 422
    still_pending = client.get(
        "/api/admin/inventory", params={"store_id": 1, "entry_status": "pending"}
    ).json()["items"]
    assert [item["status"] for item in still_pending if item["product_id"] == product_id] == [
        "pending"
    ]


def test_approving_a_non_pending_entry_is_rejected(client, db):
    _sign_in_as_admin(client, db)

    # 1/1 is active in the seed.
    response = client.post("/api/admin/inventory/1/1/approve", json={"price": 5.0})

    assert response.status_code == 422


def test_repush_does_not_reset_an_active_entry(client, db):
    _sign_in_as_admin(client, db)

    body = client.post(
        "/api/admin/inventory/push", json={"product_ids": [1], "store_ids": [1]}
    ).json()[0]

    assert body["already_present"] is True
    assert body["status"] == "active"
    assert body["price"] == 220.0


def test_push_unknown_product_is_404_and_writes_nothing(client, db):
    _sign_in_as_admin(client, db)

    response = client.post(
        "/api/admin/inventory/push", json={"product_ids": [999999], "store_ids": [1]}
    )

    assert response.status_code == 404


def test_deleting_a_pending_entry_is_the_decline_path(client, db):
    _sign_in_as_admin(client, db)
    product_id = _new_product(client)
    client.post(
        "/api/admin/inventory/push",
        json={"product_ids": [product_id], "store_ids": [1]},
    )

    assert client.delete(f"/api/admin/inventory/{product_id}/1").status_code == 200

    queue = client.get(
        "/api/admin/inventory", params={"store_id": 1, "entry_status": "pending"}
    ).json()
    assert queue["items"] == []


# --- authorisation --------------------------------------------------------


def test_reads_need_no_credentials(client):
    assert client.get("/api/products/1/stock").status_code == 200
    assert client.get("/api/stores/1/stock").status_code == 200


@pytest.mark.parametrize(
    "method,path",
    [
        ("get", "/api/admin/inventory?store_id=1"),
        ("put", "/api/admin/inventory/1/1"),
        ("put", "/api/admin/inventory"),
        ("post", "/api/admin/inventory/push"),
        ("post", "/api/admin/inventory/1/1/approve"),
        ("delete", "/api/admin/inventory/1/1"),
    ],
)
def test_writes_refuse_anonymous_callers(client, method, path):
    response = getattr(client, method)(path)

    assert response.status_code in (401, 403)


def test_writes_refuse_non_admins(client, db):
    _sign_in(client, "plain-shopper")

    response = client.put("/api/admin/inventory/1/1", json={"quantity": 1})

    assert response.status_code == 403
    assert client.get("/api/products/1/stock").json()["stores"][0]["quantity"] == 12


# --- role permissions -----------------------------------------------------
#
# One test per role/route combination that matters, because the failure mode
# here is silent: a route guarded by the wrong permission still returns 200 for
# the roles that happen to hold it, and only breaks for the rest.


def test_single_write_is_allowed_for_store_buyer(client, db):
    # The single-row PUT is the same job as the batch PUT, so holding
    # manage_stock must be enough. Guarding it with manage_products locked
    # every store role out of it.
    _sign_in_as(client, db, "store_buyer")

    response = client.put("/api/admin/inventory/1/1", json={"quantity": 7})

    assert response.status_code == 200
    assert response.json()["quantity"] == 7


def test_single_write_is_allowed_for_store_admin(client, db):
    _sign_in_as(client, db, "store_admin")

    assert (
        client.put("/api/admin/inventory/1/1", json={"quantity": 7}).status_code == 200
    )


def test_store_buyer_cannot_approve_a_pushed_product(client, db):
    # Deciding what the store sells is store_admin work, not buyer work.
    _sign_in_as(client, db, "store_buyer")
    product_id = _new_product(client, db)
    client.post(
        "/api/admin/inventory/push",
        json={"product_ids": [product_id], "store_ids": [1]},
    )

    response = client.post(
        f"/api/admin/inventory/{product_id}/1/approve", json={"price": 5.0}
    )

    assert response.status_code == 403


def test_store_admin_can_approve_a_pushed_product(client, db):
    _sign_in_as(client, db, "store_admin")
    product_id = _new_product(client, db)
    client.post(
        "/api/admin/inventory/push",
        json={"product_ids": [product_id], "store_ids": [1]},
    )

    response = client.post(
        f"/api/admin/inventory/{product_id}/1/approve", json={"price": 5.0}
    )

    assert response.status_code == 200
    assert response.json()["status"] == "active"


def test_store_buyer_can_push_a_product(client, db):
    # The push route never reads the user, so it is guarded by the decorator
    # rather than a parameter; a missing Depends there would not fail loudly.
    _sign_in_as(client, db, "store_buyer")
    product_id = _new_product(client, db)

    response = client.post(
        "/api/admin/inventory/push",
        json={"product_ids": [product_id], "store_ids": [1]},
    )

    assert response.status_code == 200
    assert response.json()[0]["status"] == "pending"


def test_store_buyer_can_delete_an_entry(client, db):
    _sign_in_as(client, db, "store_buyer")

    assert client.delete("/api/admin/inventory/1/1").status_code == 200

    remaining = client.get("/api/products/1/stock").json()["stores"]
    assert [store["store_id"] for store in remaining] == [2]


def test_read_only_role_cannot_push(client, db):
    _sign_in_as(client, db, "user")
    product_id = _new_product(client, db)

    response = client.post(
        "/api/admin/inventory/push",
        json={"product_ids": [product_id], "store_ids": [1]},
    )

    assert response.status_code == 403
