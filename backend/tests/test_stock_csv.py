# End-of-day stock update by CSV: export a store's stock, edit the stock
# column, preview the import, then apply it.

import csv
import io
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
EXPORT = "/api/admin/inventory/stock.csv"
PREVIEW = "/api/admin/inventory/stock-import/preview"
IMPORT = "/api/admin/inventory/stock-import"


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


def _export_rows(client, store_id=1) -> list[dict]:
    response = client.get(EXPORT, params={"store_id": store_id})
    assert response.status_code == 200
    return list(csv.DictReader(io.StringIO(response.text)))


def _to_csv(rows: list[dict]) -> str:
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=list(rows[0].keys()))
    writer.writeheader()
    writer.writerows(rows)
    return out.getvalue()


def _with_stock(rows, changes: dict[int, str]) -> str:
    for row in rows:
        if int(row["product_id"]) in changes:
            row["stock"] = changes[int(row["product_id"])]
    return _to_csv(rows)


# --- export ---------------------------------------------------------------


def test_export_lists_the_store_products_with_their_stock(client, db):
    _sign_in_as(client, db, "store_clerk", [1])

    rows = _export_rows(client)

    assert list(rows[0].keys()) == ["product_id", "name", "brand", "stock"]
    by_id = {int(row["product_id"]): row for row in rows}
    assert by_id[1]["stock"] == "12"
    assert by_id[2]["stock"] == "20"
    names = [row["name"].lower() for row in rows]
    assert names == sorted(names)


def test_export_leaves_out_products_the_store_does_not_sell(client, db):
    db.execute("UPDATE inventory SET status = 'discontinued' WHERE product_id = 3 AND store_id = 1")
    _sign_in_as(client, db, "store_clerk", [1])

    ids = {int(row["product_id"]) for row in _export_rows(client)}

    assert 3 not in ids
    assert 1 in ids


def test_cannot_export_another_store(client, db):
    _sign_in_as(client, db, "store_clerk", [1])

    assert client.get(EXPORT, params={"store_id": 2}).status_code == 403


def test_shoppers_cannot_export(client, db):
    _sign_in_as(client, db, "user")

    assert client.get(EXPORT, params={"store_id": 1}).status_code == 403


# --- preview --------------------------------------------------------------


def test_preview_lists_changes_and_saves_nothing(client, db):
    _sign_in_as(client, db, "store_clerk", [1])
    text = _with_stock(_export_rows(client), {1: "5", 2: "20"})

    response = client.post(PREVIEW, json={"store_id": 1, "csv": text})

    assert response.status_code == 200
    body = response.json()
    assert [(c["product_id"], c["old_quantity"], c["new_quantity"]) for c in body["changes"]] == [(1, 12, 5)]
    assert body["errors"] == []
    assert body["unchanged"] == len(_export_rows(client)) - 1
    assert _quantity(db, 1) == 12


def test_preview_reports_problem_rows(client, db):
    _sign_in_as(client, db, "store_clerk", [1])
    rows = _export_rows(client)
    text = _with_stock(rows, {1: "-3", 2: "lots", 4: "2.5"})
    text += "999999,Not ours,,4\nabc,Bad id,,4\n"

    body = client.post(PREVIEW, json={"store_id": 1, "csv": text}).json()

    messages = " | ".join(problem["message"] for problem in body["errors"])
    assert len(body["errors"]) == 5
    assert "cannot be negative" in messages
    assert "'lots'" in messages
    assert "'2.5'" in messages
    assert "isn't sold at this store" in messages
    assert "'abc' is not a product id" in messages


def test_a_product_listed_twice_is_a_problem(client, db):
    _sign_in_as(client, db, "store_clerk", [1])

    text = "product_id,stock\n1,5\n1,6\n"
    body = client.post(PREVIEW, json={"store_id": 1, "csv": text}).json()

    assert body["errors"] == [{"row": 3, "message": "Product 1 is in the file twice"}]


def test_only_product_id_and_stock_are_needed(client, db):
    _sign_in_as(client, db, "store_clerk", [1])

    text = "﻿Product_ID , Stock\n1, 7 \n2,\n3,8.0\n"  # Excel BOM, spaces, 8.0
    body = client.post(PREVIEW, json={"store_id": 1, "csv": text}).json()

    assert body["errors"] == []
    assert [(c["product_id"], c["new_quantity"]) for c in body["changes"]] == [(1, 7)]
    assert body["unchanged"] == 2  # blank stock and the same stock


def test_a_file_without_the_columns_is_rejected(client, db):
    _sign_in_as(client, db, "store_clerk", [1])

    response = client.post(PREVIEW, json={"store_id": 1, "csv": "id,count\n1,5\n"})

    assert response.status_code == 422
    assert "product_id" in response.json()["detail"]


# --- import ---------------------------------------------------------------


def test_import_updates_stock_and_logs_each_change(client, db):
    user = _sign_in_as(client, db, "store_clerk", [1])
    text = _with_stock(_export_rows(client), {1: "5", 2: "0"})

    response = client.post(IMPORT, json={"store_id": 1, "csv": text})

    assert response.status_code == 200
    assert len(response.json()["changes"]) == 2
    assert _quantity(db, 1) == 5
    assert _quantity(db, 2) == 0
    assert _quantity(db, 1, store_id=2) == 0  # the other store is untouched
    log = db.execute(
        "SELECT product_id, old_quantity, new_quantity, source, changed_by"
        " FROM stock_changes ORDER BY product_id"
    ).fetchall()
    assert log == [
        {"product_id": 1, "old_quantity": 12, "new_quantity": 5, "source": "csv", "changed_by": user["user_id"]},
        {"product_id": 2, "old_quantity": 20, "new_quantity": 0, "source": "csv", "changed_by": user["user_id"]},
    ]


def test_import_with_any_problem_saves_nothing(client, db):
    _sign_in_as(client, db, "store_clerk", [1])
    text = _with_stock(_export_rows(client), {1: "5", 2: "-1"})

    response = client.post(IMPORT, json={"store_id": 1, "csv": text})

    assert response.status_code == 422
    assert _quantity(db, 1) == 12
    assert db.execute("SELECT count(*) AS n FROM stock_changes").fetchone()["n"] == 0


def test_cannot_import_into_another_store(client, db):
    _sign_in_as(client, db, "store_admin", [1])

    response = client.post(IMPORT, json={"store_id": 2, "csv": "product_id,stock\n3,1\n"})

    assert response.status_code == 403
    assert _quantity(db, 3, store_id=2) == 14


@pytest.mark.parametrize("role", ["store_buyer", "user"])
def test_read_only_roles_cannot_use_stock_csv(client, db, role):
    _sign_in_as(client, db, role, [1])
    body = {"store_id": 1, "csv": "product_id,stock\n1,1\n"}
    assert client.get(EXPORT, params={"store_id": 1}).status_code == 403
    assert client.post(PREVIEW, json=body).status_code == 403
    assert client.post(IMPORT, json=body).status_code == 403
    assert _quantity(db, 1) == 12


def test_clerk_csv_preview_and_export_are_store_scoped(client, db):
    _sign_in_as(client, db, "store_clerk", [1])
    body = {"store_id": 2, "csv": "product_id,stock\n3,1\n"}
    assert client.get(EXPORT, params={"store_id": 2}).status_code == 403
    assert client.post(PREVIEW, json=body).status_code == 403
    assert client.post(IMPORT, json=body).status_code == 403


def test_app_admin_can_import_into_any_store(client, db):
    _sign_in_as(client, db, "system_admin")

    response = client.post(IMPORT, json={"store_id": 2, "csv": "product_id,stock\n3,1\n"})

    assert response.status_code == 200
    assert _quantity(db, 3, store_id=2) == 1


# --- manual edits are logged too ------------------------------------------


def test_editing_one_product_logs_a_manual_change(client, db):
    _sign_in_as(client, db, "system_admin")

    client.put("/api/admin/inventory/1/1", json={"quantity": 3})
    client.put("/api/admin/inventory/1/1", json={"price": 199})  # no stock change

    log = db.execute("SELECT old_quantity, new_quantity, source FROM stock_changes").fetchall()
    assert log == [{"old_quantity": 12, "new_quantity": 3, "source": "manual"}]
