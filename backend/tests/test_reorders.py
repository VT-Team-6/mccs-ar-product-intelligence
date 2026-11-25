# Reorders: products dropping to their low-stock level notify the store's
# managers, a manager sends low products to a buyer as one order request, the
# buyer marks each product ordered or unavailable, and restocking clears it.

import os
from concurrent.futures import ThreadPoolExecutor
from time import monotonic, sleep
from urllib.parse import quote

import psycopg
import pytest
from fastapi.testclient import TestClient
from testcontainers.community.postgres import PostgresContainer

import auth
import reorders
from stock import InventoryError
from conftest import DB_DIR, apply_init_sql
from main import app

SEED = DB_DIR / "seeds" / "003-inventory.sql"
SETTINGS = "/api/admin/inventory/low-stock-settings"
BUYERS = "/api/admin/inventory/buyers"
REORDERS = "/api/reorders"
REQUESTS = "/api/order-requests"
MESSAGES = "/api/messages"


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
        conn.execute("DELETE FROM messages")
        conn.execute("DELETE FROM order_requests")
        conn.execute("DELETE FROM low_stock_alerts")
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


# Seeded stock at store 1: product 1 has 12, product 2 has 20, product 3 has 8,
# product 4 has 7. Every product starts low at 10.


@pytest.fixture
def staff(client, db):
    """Two managers and a buyer at store 1, a manager at store 2; signed in as manager one."""
    people = {
        "buyer": _sign_in_as(client, db, "store_buyer", [1], token="buyer"),
        "other_buyer": _sign_in_as(client, db, "store_buyer", [1], token="buyer-two"),
        "other_manager": _sign_in_as(client, db, "store_admin", [1], token="manager-two"),
        "far_manager": _sign_in_as(client, db, "store_admin", [2], token="manager-far"),
        "manager": _sign_in_as(client, db, "store_admin", [1], token="manager-one"),
    }
    # Start with no alerts, so each test sees only what it causes
    db.execute("DELETE FROM low_stock_alerts")
    db.execute("DELETE FROM messages")
    return people


def _as(client, db, token, role, store_ids):
    return _sign_in_as(client, db, role, store_ids, token=token)


def _set_stock(client, product_id, quantity, store_id=1):
    response = client.put(f"/api/admin/inventory/{product_id}/{store_id}", json={"quantity": quantity})
    assert response.status_code == 200


def _notifications(client):
    return client.get(MESSAGES).json()


def _reorders(client, store_id=1):
    response = client.get(REORDERS, params={"store_id": store_id})
    assert response.status_code == 200
    return response.json()


def _product(client, product_id):
    return next(p for p in _reorders(client)["products"] if p["product_id"] == product_id)


def _send(client, staff, product_ids, quantity=16, buyer="buyer", note="", **extra):
    by_id = {p["product_id"]: p for p in _reorders(client)["products"]}
    return client.post(f"{REORDERS}/send", json={
        "store_id": 1,
        "buyer_user_id": staff[buyer]["user_id"],
        "items": [{"alert_id": by_id[p]["alert_id"], "quantity": quantity} for p in product_ids],
        "note": note,
        **extra,
    })


# --- alerts ----------------------------------------------------------------


def test_dropping_to_the_level_notifies_every_manager_of_the_store(client, db, staff):
    _set_stock(client, 1, 4)

    assert _product(client, 1)["status"] == "open"
    mine = _notifications(client)
    assert mine["unread"] == 1
    assert mine["messages"][0]["kind"] == "low_stock"

    _as(client, db, "manager-two", "store_admin", [1])
    assert _notifications(client)["unread"] == 1
    _as(client, db, "manager-far", "store_admin", [2])
    assert _notifications(client)["unread"] == 0


def test_staying_low_does_not_alert_again(client, db, staff):
    _set_stock(client, 1, 4)
    _set_stock(client, 1, 3)

    assert len(_reorders(client)["products"]) == 1
    assert _notifications(client)["unread"] == 1


def test_one_csv_import_sends_one_notification(client, db, staff):
    client.post("/api/admin/inventory/stock-import", json={
        "store_id": 1, "csv": "product_id,stock\n1,2\n2,5\n",
    })

    messages = _notifications(client)["messages"]
    assert len(messages) == 1
    assert messages[0]["subject"].startswith("2 items are low on stock")


def test_products_already_low_are_found_on_startup(client, db, staff):
    found = reorders.check_all_stores(db)

    assert found > 0
    low = {p["product_id"] for p in _reorders(client)["products"]}
    assert {3, 4} <= low  # 8 and 7 left, low at 10
    assert len(_notifications(client)["messages"]) == 1  # one per store
    assert reorders.check_all_stores(db) == 0  # and never twice


def test_assigning_a_buyer_also_checks(client, db, staff):
    client.put(SETTINGS, json={"store_id": 1, "product_ids": [3], "buyer_user_id": staff["buyer"]["user_id"]})

    assert _product(client, 3)["status"] == "open"


def test_raising_the_level_can_make_a_product_low(client, db, staff):
    client.put(SETTINGS, json={"store_id": 1, "product_ids": [2], "low_stock_threshold": 25})

    assert _product(client, 2)["status"] == "open"


def test_restocked_products_leave_the_list(client, db, staff):
    _set_stock(client, 1, 4)
    _set_stock(client, 1, 30)

    assert _reorders(client)["products"] == []


# --- example buyers --------------------------------------------------------


def test_example_buyers_show_when_there_is_no_real_buyer(client, db):
    _sign_in_as(client, db, "store_buyer", [1], token="demo")  # demo@example.com
    _sign_in_as(client, db, "store_admin", [1], token="boss")

    emails = [b["email"] for b in client.get(BUYERS, params={"store_id": 1}).json()]

    assert emails == ["demo@example.com"]


def test_only_real_buyers_show_next_to_example_ones(client, db):
    _sign_in_as(client, db, "store_buyer", [1], token="demo")
    db.execute("UPDATE users SET email = 'real@gmail.com' WHERE email = 'demo@example.com'")
    _sign_in_as(client, db, "store_buyer", [1], token="sample")
    _sign_in_as(client, db, "store_admin", [1], token="boss")

    emails = [b["email"] for b in client.get(BUYERS, params={"store_id": 1}).json()]

    assert emails == ["real@gmail.com"]


# --- the reorders list and sending -----------------------------------------


def test_the_list_counts_each_status(client, db, staff):
    _set_stock(client, 1, 4)
    _set_stock(client, 2, 5)
    _send(client, staff, [1])

    body = _reorders(client)

    assert body["counts"] == {"open": 1, "requested": 1, "ordered": 0, "unavailable": 0}
    sent = _product(client, 1)
    assert sent["requested_quantity"] == 16
    assert sent["requested_from"] == "buyer@example.com"


def test_groups_list_products_by_buyer(client, db, staff):
    client.put(SETTINGS, json={"store_id": 1, "product_ids": [1, 2], "buyer_user_id": staff["buyer"]["user_id"]})
    _set_stock(client, 1, 4)
    _set_stock(client, 2, 6)
    _set_stock(client, 4, 3)  # no buyer

    groups = client.get(f"{REORDERS}/groups", params={"store_id": 1}).json()

    assert [g["buyer_email"] for g in groups] == ["buyer@example.com", None]
    assert sorted(i["product_id"] for i in groups[0]["items"]) == [1, 2]
    assert next(i for i in groups[0]["items"] if i["product_id"] == 1)["suggested_quantity"] == 16


def test_sending_makes_one_formal_order_request(client, db, staff):
    _set_stock(client, 1, 4)
    _set_stock(client, 2, 6)

    response = _send(client, staff, [1, 2], quantity=20, note="Needed before Saturday.")

    assert response.status_code == 200
    _as(client, db, "buyer", "store_buyer", [1])
    notification = _notifications(client)["messages"][0]
    assert notification["kind"] == "order_request"
    assert notification["subject"] == "Order Request — MCCS Main Exchange (2 products)"

    request = client.get(f"{REQUESTS}/{response.json()['request_id']}").json()
    assert "MCCS Main Exchange (100 Sample Ave, Quantico, VA 22134)" in request["message"]
    assert "20 units (4 currently in stock)" in request["message"]
    assert "Needed before Saturday." in request["message"]
    assert request["message"].startswith("Hello,")
    assert request["summary"]["pending"] == 2


def test_a_product_cannot_be_sent_twice(client, db, staff):
    _set_stock(client, 1, 4)
    alert = _product(client, 1)["alert_id"]
    send = {"store_id": 1, "buyer_user_id": staff["buyer"]["user_id"], "items": [{"alert_id": alert, "quantity": 5}]}

    assert client.post(f"{REORDERS}/send", json=send).status_code == 200
    assert client.post(f"{REORDERS}/send", json=send).status_code == 409

    # A mixed second request must leave the fresh alert available.
    _set_stock(client, 3, 5)
    assert _send(client, staff, [1, 3]).status_code == 409
    assert _send(client, staff, [3]).status_code == 200


def test_concurrent_sends_can_only_claim_an_alert_once(client, db, db_url, staff):
    _set_stock(client, 3, 5)
    alert_id = _product(client, 3)["alert_id"]
    items = [{"alert_id": alert_id, "quantity": 16}]
    buyer_id = staff["buyer"]["user_id"]

    def send_again():
        with psycopg.connect(
            db_url, row_factory=psycopg.rows.dict_row,
            application_name="concurrent-reorder", options="-c lock_timeout=10000",
        ) as conn:
            reorders.send_request(conn, 1, buyer_id, items, "", staff["other_manager"]["user_id"])

    with ThreadPoolExecutor(max_workers=1) as pool:
        with psycopg.connect(db_url, row_factory=psycopg.rows.dict_row) as conn:
            reorders.send_request(conn, 1, buyer_id, items, "", staff["manager"]["user_id"])
            contender = pool.submit(send_again)
            deadline = monotonic() + 5
            while monotonic() < deadline:
                if db.execute(
                    "SELECT 1 FROM pg_stat_activity WHERE application_name = 'concurrent-reorder'"
                    " AND wait_event_type = 'Lock'"
                ).fetchone():
                    break
                sleep(0.01)
            else:
                pytest.fail("The second send never reached the lock held by the first send")

        with pytest.raises(InventoryError) as rejected:
            contender.result(timeout=5)
        assert rejected.value.status == 409

    assert db.execute(
        "SELECT count(*) AS count FROM order_request_items WHERE alert_id = %s", (alert_id,)
    ).fetchone()["count"] == 1


def test_only_a_buyer_at_the_store_can_be_sent_to(client, db, staff):
    _set_stock(client, 1, 4)

    assert _send(client, staff, [1], buyer="other_manager").status_code == 422


def test_remember_buyer_saves_it_on_products_without_one(client, db, staff):
    _set_stock(client, 4, 3)

    _send(client, staff, [4], remember_buyer=True)

    row = db.execute("SELECT buyer_user_id FROM inventory WHERE product_id = 4 AND store_id = 1").fetchone()
    assert row["buyer_user_id"] == staff["buyer"]["user_id"]


# --- the buyer's side ------------------------------------------------------


def test_removed_default_buyer_can_be_replaced_when_sending_an_order(client, db, staff):
    _set_stock(client, 1, 4)
    former_buyer = staff["buyer"]["user_id"]
    db.execute("UPDATE inventory SET buyer_user_id=%s WHERE product_id=1 AND store_id=1", (former_buyer,))
    db.execute("DELETE FROM user_stores WHERE user_id=%s", (former_buyer,))

    groups = client.get(f"{REORDERS}/groups", params={"store_id": 1}).json()
    assert groups[0]["buyer_user_id"] is None
    assert _send(client, staff, [1], buyer="other_buyer", remember_buyer=True).status_code == 200
    entry = db.execute("SELECT buyer_user_id FROM inventory WHERE product_id=1 AND store_id=1").fetchone()
    assert entry["buyer_user_id"] == staff["other_buyer"]["user_id"]


def test_the_buyer_lists_their_requests(client, db, staff):
    _set_stock(client, 1, 4)
    request_id = _send(client, staff, [1]).json()["request_id"]
    _as(client, db, "buyer", "store_buyer", [1])

    requests = client.get(REQUESTS).json()

    assert [(r["request_id"], r["product_count"], r["unread"]) for r in requests] == [(request_id, 1, True)]
    client.get(f"{REQUESTS}/{request_id}")  # opening it marks it read
    assert client.get(REQUESTS).json()[0]["unread"] is False


def test_the_buyer_marks_some_products_ordered(client, db, staff):
    _set_stock(client, 1, 4)
    _set_stock(client, 2, 6)
    request_id = _send(client, staff, [1, 2]).json()["request_id"]
    _as(client, db, "buyer", "store_buyer", [1])

    response = client.post(f"{REQUESTS}/{request_id}/items", json={"product_ids": [1], "status": "ordered"})

    assert response.status_code == 200
    assert response.json()["summary"] == {
        "pending": 1, "ordered": 1, "unavailable": 0, "received": 0, "finished": False,
    }
    _as(client, db, "manager-one", "store_admin", [1])
    assert _product(client, 1)["status"] == "ordered"
    assert _product(client, 2)["status"] == "requested"


def test_unavailable_needs_a_reason_and_tells_every_manager(client, db, staff):
    _set_stock(client, 1, 4)
    request_id = _send(client, staff, [1]).json()["request_id"]
    _as(client, db, "buyer", "store_buyer", [1])

    no_reason = client.post(f"{REQUESTS}/{request_id}/items", json={"product_ids": [1], "status": "unavailable"})
    assert no_reason.status_code == 422

    client.post(f"{REQUESTS}/{request_id}/items", json={
        "product_ids": [1], "status": "unavailable", "reason": "Out of stock at supplier",
    })

    for manager in ("manager-one", "manager-two"):
        _as(client, db, manager, "store_admin", [1])
        update = next(m for m in _notifications(client)["messages"] if m["kind"] == "order_update")
        assert "Out of stock at supplier" in update["body"]
    product = _product(client, 1)
    assert product["status"] == "unavailable"
    assert product["reason"] == "Out of stock at supplier"


def test_an_unavailable_product_can_be_sent_again(client, db, staff):
    _set_stock(client, 1, 4)
    first = _send(client, staff, [1]).json()["request_id"]
    _as(client, db, "buyer", "store_buyer", [1])
    client.post(f"{REQUESTS}/{first}/items", json={"product_ids": [1], "status": "unavailable", "reason": "Gone"})
    _as(client, db, "manager-one", "store_admin", [1])

    second = _send(client, staff, [1], buyer="other_buyer")

    assert second.status_code == 200
    assert _product(client, 1)["status"] == "requested"
    assert _product(client, 1)["requested_from"] == "buyer-two@example.com"

    # The first buyer changing their old request doesn't override the new one
    _as(client, db, "buyer", "store_buyer", [1])
    client.post(f"{REQUESTS}/{first}/items", json={"product_ids": [1], "status": "ordered"})
    _as(client, db, "manager-one", "store_admin", [1])
    assert _product(client, 1)["status"] == "requested"


def test_a_request_finishes_when_its_ordered_products_arrive(client, db, staff):
    _set_stock(client, 1, 4)
    request_id = _send(client, staff, [1]).json()["request_id"]
    _as(client, db, "buyer", "store_buyer", [1])
    client.post(f"{REQUESTS}/{request_id}/items", json={"product_ids": [1], "status": "ordered"})
    _as(client, db, "manager-one", "store_admin", [1])

    _set_stock(client, 1, 25)

    _as(client, db, "buyer", "store_buyer", [1])
    assert client.get(REQUESTS).json() == []
    finished = client.get(REQUESTS, params={"include_finished": True}).json()[0]
    assert finished["summary"]["received"] == 1
    assert finished["summary"]["finished"] is True


def test_products_not_in_the_request_are_rejected(client, db, staff):
    _set_stock(client, 1, 4)
    request_id = _send(client, staff, [1]).json()["request_id"]
    _as(client, db, "buyer", "store_buyer", [1])

    response = client.post(f"{REQUESTS}/{request_id}/items", json={"product_ids": [2], "status": "ordered"})

    assert response.status_code == 404


# --- who can do what -------------------------------------------------------


def test_managers_can_view_a_request_but_not_update_it(client, db, staff):
    _set_stock(client, 1, 4)
    request_id = _send(client, staff, [1]).json()["request_id"]

    assert client.get(f"{REQUESTS}/{request_id}").status_code == 200
    response = client.post(f"{REQUESTS}/{request_id}/items", json={"product_ids": [1], "status": "ordered"})
    assert response.status_code == 403


def test_other_stores_and_buyers_are_kept_out(client, db, staff):
    _set_stock(client, 1, 4)
    request_id = _send(client, staff, [1]).json()["request_id"]

    _as(client, db, "manager-far", "store_admin", [2])
    assert client.get(REORDERS, params={"store_id": 1}).status_code == 403
    assert client.get(f"{REQUESTS}/{request_id}").status_code == 403

    _as(client, db, "buyer-two", "store_buyer", [1])
    assert client.get(f"{REQUESTS}/{request_id}").status_code == 403
    assert client.get(REORDERS, params={"store_id": 1}).status_code == 403


# --- notifications ---------------------------------------------------------


def test_marking_notifications_read(client, db, staff):
    _set_stock(client, 1, 4)
    _set_stock(client, 2, 5)

    first = _notifications(client)["messages"][0]["message_id"]
    client.post(f"{MESSAGES}/read", json={"message_ids": [first]})
    assert _notifications(client)["unread"] == 1

    client.post(f"{MESSAGES}/read", json={"store_id": 1})
    assert _notifications(client)["unread"] == 0


def test_you_only_mark_your_own_notifications(client, db, staff):
    _set_stock(client, 1, 4)
    _as(client, db, "buyer", "store_buyer", [1])

    assert client.post(f"{MESSAGES}/read", json={}).json() == {"marked": 0}
    _as(client, db, "manager-one", "store_admin", [1])
    assert _notifications(client)["unread"] == 1


# --- lists for the Reorders screen -----------------------------------------


def test_managers_list_their_stores_requests(client, db, staff):
    _set_stock(client, 1, 4)
    _set_stock(client, 2, 5)
    _send(client, staff, [1])
    _send(client, staff, [2], buyer="other_buyer")

    requests = client.get(REQUESTS, params={"store_id": 1}).json()

    assert sorted(r["buyer_email"] for r in requests) == ["buyer-two@example.com", "buyer@example.com"]
    _as(client, db, "manager-far", "store_admin", [2])
    assert client.get(REQUESTS, params={"store_id": 1}).status_code == 403
    _as(client, db, "buyer", "store_buyer", [1])
    assert client.get(REQUESTS, params={"store_id": 1}).status_code == 403


def test_the_buyer_lists_every_product_across_requests(client, db, staff):
    _set_stock(client, 1, 4)
    _set_stock(client, 2, 5)
    first = _send(client, staff, [1]).json()["request_id"]
    second = _send(client, staff, [2]).json()["request_id"]
    _as(client, db, "buyer", "store_buyer", [1])

    items = client.get(f"{REQUESTS}/items").json()

    assert {(i["product_id"], i["request_id"]) for i in items} == {(1, first), (2, second)}
    assert all(i["status"] == "pending" and i["store_name"] == "MCCS Main Exchange" for i in items)


def test_unread_is_counted_per_store(client, db, staff):
    _as(client, db, "manager-both", "store_admin", [1, 2])
    _set_stock(client, 1, 4, store_id=1)
    _set_stock(client, 2, 4, store_id=1)
    _set_stock(client, 3, 1, store_id=2)

    mine = _notifications(client)

    assert mine["unread"] == 3
    assert mine["unread_by_store"] == {"1": 2, "2": 1}


# --- role revocation and reassignment --------------------------------------


@pytest.mark.parametrize("role", ["user", "store_clerk", "store_admin"])
def test_demoted_buyer_loses_request_list_detail_and_updates(client, db, staff, role):
    _set_stock(client, 1, 4)
    request_id = _send(client, staff, [1]).json()["request_id"]
    _as(client, db, "buyer", role, [1])
    # A promoted manager may read the store's requests, but not respond as buyer.
    assert client.get(REQUESTS).status_code == 403
    assert client.get(f"{REQUESTS}/items").status_code == 403
    assert client.get(f"{REQUESTS}/{request_id}").status_code == (200 if role == "store_admin" else 403)
    assert client.post(f"{REQUESTS}/{request_id}/items", json={"product_ids": [1], "status": "ordered"}).status_code == 403
    assert client.get(MESSAGES).json()["messages"] == []
    assert client.post(f"{MESSAGES}/read", json={"request_id": request_id}).json() == {"marked": 0}
    _as(client, db, "manager-one", "store_admin", [1])
    assert client.get(f"{REQUESTS}/{request_id}").json()["needs_reassignment"] is True


def test_removed_buyer_loses_old_requests_and_notifications(client, db, staff):
    _set_stock(client, 1, 4)
    request_id = _send(client, staff, [1]).json()["request_id"]
    _as(client, db, "buyer", "store_buyer", [1])
    db.execute("DELETE FROM user_stores WHERE user_id=%s", (staff["buyer"]["user_id"],))
    assert client.get(REQUESTS).json() == []
    assert client.get(f"{REQUESTS}/items").json() == []
    assert client.get(f"{REQUESTS}/{request_id}").status_code == 403
    assert client.post(f"{REQUESTS}/{request_id}/items", json={"product_ids": [1], "status": "ordered"}).status_code == 403
    messages = client.get(MESSAGES).json()
    assert messages == {"messages": [], "unread": 0, "unread_by_store": {}}
    _as(client, db, "manager-one", "store_admin", [1])
    requests = client.get(REQUESTS, params={"store_id": 1}).json()
    assert requests[0]["needs_reassignment"] is True


def test_reassignment_preserves_progress_and_records_history(client, db, staff):
    for product_id in [1, 2, 3]:
        _set_stock(client, product_id, 4)
    request_id = _send(client, staff, [1, 2, 3]).json()["request_id"]
    _as(client, db, "buyer", "store_buyer", [1])
    client.post(f"{REQUESTS}/{request_id}/items", json={"product_ids": [1], "status": "ordered"})
    client.post(f"{REQUESTS}/{request_id}/items", json={"product_ids": [2], "status": "unavailable", "reason": "Supplier closed"})
    db.execute("DELETE FROM user_stores WHERE user_id=%s", (staff["buyer"]["user_id"],))
    _as(client, db, "manager-one", "store_admin", [1])
    response = client.put(f"{REQUESTS}/{request_id}/buyer", json={"buyer_user_id": staff["other_buyer"]["user_id"]})
    assert response.status_code == 200
    body = response.json()
    assert body["needs_reassignment"] is False
    assert body["buyer_user_id"] == staff["other_buyer"]["user_id"]
    by_id = {item["product_id"]: item for item in body["items"]}
    assert by_id[1]["status"] == "ordered"
    assert by_id[2]["reason"] == "Supplier closed"
    assert by_id[1]["updated_by"] == staff["buyer"]["user_id"]
    assert by_id[3]["status"] == "pending"
    assert body["reassignments"][0]["from_buyer_email"] == "buyer@example.com"
    assert body["reassignments"][0]["to_buyer_email"] == "buyer-two@example.com"
    _as(client, db, "buyer-two", "store_buyer", [1])
    assert client.get(REQUESTS).json()[0]["request_id"] == request_id
    assert client.get(MESSAGES).json()["unread"] == 1
    assert client.post(f"{REQUESTS}/{request_id}/items", json={"product_ids": [1], "status": "unavailable", "reason": "Wrong"}).status_code == 409
    assert client.post(f"{REQUESTS}/{request_id}/items", json={"product_ids": [3], "status": "ordered"}).status_code == 200


def test_reassignment_revokes_previous_buyer_even_when_still_eligible(client, db, staff):
    _set_stock(client, 1, 4)
    request_id = _send(client, staff, [1]).json()["request_id"]
    response = client.put(f"{REQUESTS}/{request_id}/buyer", json={"buyer_user_id": staff["other_buyer"]["user_id"]})
    assert response.status_code == 200
    _as(client, db, "buyer", "store_buyer", [1])
    assert client.get(REQUESTS).json() == []
    assert client.get(f"{REQUESTS}/{request_id}").status_code == 403
    assert client.get(MESSAGES).json()["messages"] == []


@pytest.mark.parametrize("role,token,stores", [
    ("store_buyer", "buyer", [1]), ("store_clerk", "clerk", [1]),
    ("user", "shopper", []), ("store_admin", "manager-far", [2]),
])
def test_only_store_managers_can_reassign(client, db, staff, role, token, stores):
    _set_stock(client, 1, 4)
    request_id = _send(client, staff, [1]).json()["request_id"]
    _as(client, db, token, role, stores)
    response = client.put(f"{REQUESTS}/{request_id}/buyer", json={"buyer_user_id": staff["other_buyer"]["user_id"]})
    assert response.status_code == 403


def test_reassignment_validates_new_buyer_and_is_idempotent(client, db, staff):
    _set_stock(client, 1, 4)
    request_id = _send(client, staff, [1]).json()["request_id"]
    for user_id in [staff["far_manager"]["user_id"], staff["manager"]["user_id"], 999999]:
        assert client.put(f"{REQUESTS}/{request_id}/buyer", json={"buyer_user_id": user_id}).status_code == 422
    new_buyer = staff["other_buyer"]["user_id"]
    for _ in range(2):
        assert client.put(f"{REQUESTS}/{request_id}/buyer", json={"buyer_user_id": new_buyer}).status_code == 200
    assert db.execute("SELECT count(*) AS n FROM order_request_reassignments WHERE request_id=%s", (request_id,)).fetchone()["n"] == 1
    assert db.execute("SELECT count(*) AS n FROM messages WHERE request_id=%s AND recipient_user_id=%s", (request_id, new_buyer)).fetchone()["n"] == 1


def test_requests_without_pending_work_are_not_reassigned(client, db, staff):
    _set_stock(client, 1, 4)
    request_id = _send(client, staff, [1]).json()["request_id"]
    _as(client, db, "buyer", "store_buyer", [1])
    client.post(f"{REQUESTS}/{request_id}/items", json={"product_ids": [1], "status": "ordered"})
    db.execute("DELETE FROM user_stores WHERE user_id=%s", (staff["buyer"]["user_id"],))
    _as(client, db, "manager-one", "store_admin", [1])
    assert client.get(f"{REQUESTS}/{request_id}").json()["needs_reassignment"] is False
    assert client.put(f"{REQUESTS}/{request_id}/buyer", json={"buyer_user_id": staff["other_buyer"]["user_id"]}).status_code == 409


def test_app_admin_can_reassign_without_store_assignment(client, db, staff):
    _set_stock(client, 1, 4)
    request_id = _send(client, staff, [1]).json()["request_id"]
    _as(client, db, "global", "system_admin", [])
    assert client.put(f"{REQUESTS}/{request_id}/buyer", json={"buyer_user_id": staff["other_buyer"]["user_id"]}).status_code == 200


def test_cannot_reassign_to_a_buyer_from_another_store(client, db, staff):
    _set_stock(client, 1, 4)
    request_id = _send(client, staff, [1]).json()["request_id"]
    foreign = _as(client, db, "foreign-buyer", "store_buyer", [2])
    _as(client, db, "manager-one", "store_admin", [1])
    assert client.put(f"{REQUESTS}/{request_id}/buyer", json={"buyer_user_id": foreign["user_id"]}).status_code == 422
    assert client.get(f"{REQUESTS}/{request_id}").json()["buyer_user_id"] == staff["buyer"]["user_id"]
    assert db.execute("SELECT count(*) AS n FROM order_request_reassignments").fetchone()["n"] == 0


def test_demoted_buyer_notifications_do_not_expose_old_order_content(client, db, staff):
    _set_stock(client, 1, 4)
    _send(client, staff, [1])
    _as(client, db, "buyer", "store_clerk", [1])
    assert client.get(MESSAGES).json() == {"messages": [], "unread": 0, "unread_by_store": {}}


def test_reassignment_migration_backfills_existing_responses():
    with PostgresContainer("postgres:17") as pg:
        url = f"postgresql://{quote(pg.username)}:{quote(pg.password)}@{pg.get_container_host_ip()}:{pg.get_exposed_port(5432)}/{pg.dbname}"
        with psycopg.connect(url, autocommit=True) as conn:
            for path in sorted(DB_DIR.rglob("*.sql")):
                if path.name != "021-order-request-reassignment.sql":
                    conn.execute(path.read_text())
            buyer_id = conn.execute("SELECT user_id FROM users LIMIT 1").fetchone()[0]
            alert_id = conn.execute("INSERT INTO low_stock_alerts (product_id,store_id,quantity,threshold) VALUES (1,1,1,10) RETURNING alert_id").fetchone()[0]
            request_id = conn.execute("INSERT INTO order_requests (store_id,buyer_user_id) VALUES (1,%s) RETURNING request_id", (buyer_id,)).fetchone()[0]
            conn.execute("INSERT INTO order_request_items (request_id,alert_id,product_id,quantity,status,updated_at) VALUES (%s,%s,1,5,'ordered',NOW())", (request_id,alert_id))
            conn.execute((DB_DIR / "migrations/021-order-request-reassignment.sql").read_text())
            assert conn.execute("SELECT status,updated_by FROM order_request_items WHERE request_id=%s", (request_id,)).fetchone() == ("ordered",buyer_id)
