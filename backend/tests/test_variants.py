# Colors and sizes: the variants a product comes in, each one's stock and price
# at a store, and how they reach the product page, the staff inventory screen,
# the stock CSV, low-stock alerts, photos and the shopping list.
#
# Each test makes its own products, so the seeded catalog never changes under
# another test.

import os
from urllib.parse import quote

import psycopg
import pytest
from fastapi.testclient import TestClient
from testcontainers.community.postgres import PostgresContainer

import auth
from conftest import apply_init_sql
from main import app


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
            apply_init_sql(conn, keep_options=True)
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
        yield conn


@pytest.fixture(autouse=True)
def _fake_cognito(monkeypatch):
    monkeypatch.setattr(auth, "cognito_client", FakeCognito())
    yield
    app.dependency_overrides.pop(auth.verify_access_token, None)


def _sign_in(client, db, role="system_admin", token="variants-admin", store_ids=(1, 2)) -> dict:
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


def _new_product(db, category="shoes", price=100, quantity=5, stores=(1,)) -> int:
    product_id = db.execute(
        "INSERT INTO products (name, product_type, category) VALUES (%s, %s, %s) RETURNING product_id",
        (f"Test {category}", category.title(), category),
    ).fetchone()["product_id"]
    for store_id in stores:
        db.execute(
            "INSERT INTO inventory (product_id, store_id, quantity, price) VALUES (%s, %s, %s, %s)",
            (product_id, store_id, quantity, price),
        )
    return product_id


def _inventory(db, product_id, store_id=1) -> dict:
    return db.execute(
        "SELECT quantity, price FROM inventory WHERE product_id = %s AND store_id = %s",
        (product_id, store_id),
    ).fetchone()


def _variants(client, product_id, store_id=1) -> list[dict]:
    response = client.get(f"/api/products/{product_id}/variants?store_id={store_id}")
    assert response.status_code == 200, response.text
    return response.json()


def _set_options(client, product_id, colors=(), sizes=(), skip=()) -> list[dict]:
    response = client.put(
        f"/api/admin/products/{product_id}/variants",
        json={"colors": list(colors), "sizes": list(sizes), "skip": list(skip)},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _set_stock(client, variant_id, store_id=1, **body):
    return client.put(f"/api/admin/inventory/variants/{variant_id}/{store_id}", json=body)


# --- every product has a variant -------------------------------------------


def test_a_new_product_has_one_default_variant_carrying_its_stock(client, db):
    product_id = _new_product(db, quantity=7, price=55)

    [variant] = _variants(client, product_id)

    assert variant["color"] is None and variant["size"] is None
    assert variant["sku"] == f"P{product_id}"
    assert variant["quantity"] == 7 and float(variant["price"]) == 55
    assert variant["in_stock"] is True


def test_seeded_shoes_come_in_sizes_and_some_in_colors(client, db):
    shoe = db.execute(
        "SELECT product_id FROM products WHERE name = 'Nike Air Force 1 Low'"
    ).fetchone()["product_id"]

    variants = _variants(client, shoe)

    assert {v["color"] for v in variants} == {"White", "Black", "White/Black"}
    assert {v["color_hex_2"] for v in variants if v["color"] == "White/Black"} == {"#1A1A1A"}
    assert [v["size"] for v in variants if v["color"] == "White"][:3] == ["7", "8", "9"]
    total = sum(v["quantity"] for v in variants)
    assert _inventory(db, shoe)["quantity"] == total


def test_seeded_coffee_moves_its_size_out_of_the_name(db):
    rows = db.execute(
        "SELECT p.name, array_agg(v.size ORDER BY v.size_order) AS sizes"
        " FROM products p JOIN product_variants v USING (product_id)"
        " WHERE p.category = 'coffee' AND p.name LIKE 'Starbucks Pike Place%%' GROUP BY p.name"
    ).fetchall()

    assert rows == [{"name": "Starbucks Pike Place Ground Coffee", "sizes": ["12 oz", "24 oz"]}]


# --- setting colors and sizes ----------------------------------------------


def test_options_make_every_combination_except_skipped_ones(client, db):
    _sign_in(client, db)
    product_id = _new_product(db)

    variants = _set_options(
        client, product_id,
        colors=[{"name": "Black", "hex": "#1A1A1A"}, {"name": "White", "hex": "#F5F5F5"}],
        sizes=["9", "10"],
        skip=[{"color": "White", "size": "9"}],
    )

    assert [(v["color"], v["size"]) for v in variants] == [
        ("Black", "9"), ("Black", "10"), ("White", "10"),
    ]
    assert variants[0]["sku"] == f"P{product_id}-BLACK-9"
    # The default variant is gone, and the new ones start at 0 with the store price
    stocked = _variants(client, product_id)
    assert all(v["quantity"] == 0 and float(v["price"]) == 100 for v in stocked)
    assert _inventory(db, product_id) == {"quantity": 0, "price": 100}


def test_editing_options_keeps_the_stock_of_combinations_that_stay(client, db):
    _sign_in(client, db)
    product_id = _new_product(db)
    first = _set_options(client, product_id, colors=[{"name": "Black"}], sizes=["9", "10"])
    nine = next(v for v in first if v["size"] == "9")
    assert _set_stock(client, nine["variant_id"], quantity=6).status_code == 200

    after = _set_options(client, product_id, colors=[{"name": "Black"}], sizes=["9", "11"])

    assert [v["size"] for v in after] == ["9", "11"]
    kept = next(v for v in _variants(client, product_id) if v["size"] == "9")
    assert kept["variant_id"] == nine["variant_id"] and kept["quantity"] == 6
    assert _inventory(db, product_id)["quantity"] == 6


def test_removing_every_option_goes_back_to_one_default_variant(client, db):
    _sign_in(client, db)
    product_id = _new_product(db)
    _set_options(client, product_id, sizes=["9", "10"])

    variants = _set_options(client, product_id)

    assert [(v["color"], v["size"]) for v in variants] == [(None, None)]


def test_options_the_category_does_not_use_are_refused(client, db):
    _sign_in(client, db)
    shampoo = _new_product(db, category="shampoo")
    backpack = _new_product(db, category="backpacks")

    colors = client.put(f"/api/admin/products/{shampoo}/variants", json={"colors": [{"name": "Blue"}]})
    sizes = client.put(f"/api/admin/products/{backpack}/variants", json={"sizes": ["Large"]})

    assert colors.status_code == 422 and "colors" in colors.json()["detail"]
    assert sizes.status_code == 422 and "sizes" in sizes.json()["detail"]


def test_bad_options_are_refused(client, db):
    _sign_in(client, db)
    product_id = _new_product(db)

    twice = client.put(f"/api/admin/products/{product_id}/variants", json={"sizes": ["9", "9"]})
    bad_hex = client.put(
        f"/api/admin/products/{product_id}/variants", json={"colors": [{"name": "Red", "hex": "red"}]}
    )
    all_off = client.put(
        f"/api/admin/products/{product_id}/variants",
        json={"sizes": ["9"], "skip": [{"size": "9"}]},
    )

    assert twice.status_code == 422
    assert bad_hex.status_code == 422
    assert all_off.status_code == 422


def test_store_staff_cannot_change_a_catalog_products_options(client, db):
    _sign_in(client, db, role="store_admin", token="variants-store-admin", store_ids=(1,))
    product_id = _new_product(db)

    response = client.put(f"/api/admin/products/{product_id}/variants", json={"sizes": ["9"]})

    assert response.status_code == 403


# --- stock and price per variant -------------------------------------------


def test_variant_stock_and_prices_roll_up_to_the_product(client, db):
    _sign_in(client, db)
    product_id = _new_product(db, category="coffee", price=10)
    small, large = _set_options(client, product_id, sizes=["12 oz", "24 oz"])

    assert _set_stock(client, small["variant_id"], quantity=4).status_code == 200
    response = _set_stock(client, large["variant_id"], quantity=3, price="17.50")

    assert response.status_code == 200
    assert response.json()["quantity"] == 3 and float(response.json()["price"]) == 17.5
    # quantity is the sum, price the lowest ("from $10")
    assert _inventory(db, product_id) == {"quantity": 7, "price": 10}


def test_setting_a_products_total_stock_is_refused_once_it_has_options(client, db):
    _sign_in(client, db)
    product_id = _new_product(db)
    _set_options(client, product_id, sizes=["9", "10"])

    response = client.put(f"/api/admin/inventory/{product_id}/1", json={"quantity": 9})

    assert response.status_code == 422
    assert "each one" in response.json()["detail"]


def test_a_product_price_change_applies_to_every_size(client, db):
    _sign_in(client, db)
    product_id = _new_product(db, price=80)
    _set_options(client, product_id, sizes=["9", "10"])

    response = client.put(f"/api/admin/inventory/{product_id}/1", json={"price": "95.00"})

    assert response.status_code == 200, response.text
    assert {float(v["price"]) for v in _variants(client, product_id)} == {95.0}


def test_a_product_without_options_still_takes_a_total_stock(client, db):
    _sign_in(client, db)
    product_id = _new_product(db, category="headphones", quantity=2)

    response = client.put(f"/api/admin/inventory/{product_id}/1", json={"quantity": 9})

    assert response.status_code == 200
    assert _variants(client, product_id)[0]["quantity"] == 9


def test_clerks_count_stock_but_cannot_change_prices(client, db):
    _sign_in(client, db)
    product_id = _new_product(db)
    nine, _ = _set_options(client, product_id, sizes=["9", "10"])
    _sign_in(client, db, role="store_clerk", token="variants-clerk", store_ids=(1,))

    counted = _set_stock(client, nine["variant_id"], quantity=3)
    priced = _set_stock(client, nine["variant_id"], price="1.00")

    assert counted.status_code == 200
    assert priced.status_code == 403


def test_staff_screen_lists_variants_with_low_stock_flags(client, db):
    _sign_in(client, db)
    product_id = _new_product(db)
    nine, ten = _set_options(client, product_id, colors=[{"name": "Black"}], sizes=["9", "10"])
    _set_stock(client, nine["variant_id"], quantity=20)

    rows = client.get(f"/api/admin/inventory/1/products/{product_id}/variants").json()

    assert [(r["label"], r["low_stock"]) for r in rows] == [("Black / 9", False), ("Black / 10", True)]
    listed = client.get("/api/admin/inventory?store_id=1&limit=200").json()
    # (the staff list pages by product id; the test product is among the newest)
    entry = next((e for e in listed["items"] if e["product_id"] == product_id), None)
    if entry is not None:
        assert entry["variant_count"] == 2 and entry["low_variant_count"] == 1 and entry["low_stock"]


# --- low stock per variant --------------------------------------------------


def test_each_size_gets_its_own_low_stock_alert(client, db):
    _sign_in(client, db)
    product_id = _new_product(db)
    nine, ten = _set_options(client, product_id, sizes=["9", "10"])
    _set_stock(client, nine["variant_id"], quantity=30)
    _set_stock(client, ten["variant_id"], quantity=30)

    _set_stock(client, ten["variant_id"], quantity=2)

    alerts = db.execute(
        "SELECT variant_id FROM low_stock_alerts WHERE product_id = %s AND status <> 'resolved'",
        (product_id,),
    ).fetchall()
    assert alerts == [{"variant_id": ten["variant_id"]}]
    listed = client.get("/api/reorders?store_id=1").json()
    items = [(i["name"], i["color"], i["size"]) for i in listed["products"] if i["product_id"] == product_id]
    assert items == [("Test shoes", None, "10")]

    _set_stock(client, ten["variant_id"], quantity=30)
    assert db.execute(
        "SELECT count(*) AS n FROM low_stock_alerts WHERE product_id = %s AND status <> 'resolved'",
        (product_id,),
    ).fetchone()["n"] == 0


# --- stock CSV --------------------------------------------------------------


def test_csv_lists_one_row_per_variant_and_imports_by_sku(client, db):
    _sign_in(client, db)
    product_id = _new_product(db, category="coffee", price=10)
    small, large = _set_options(client, product_id, sizes=["12 oz", "24 oz"])

    exported = client.get("/api/admin/inventory/stock.csv?store_id=1").text
    header = exported.splitlines()[0]
    assert header == "sku,product_id,name,brand,color,size,stock"
    assert f"{large['sku']},{product_id},Test coffee,,,24 oz,0" in exported

    text = f"sku,stock\n{large['sku']},12\n"
    preview = client.post("/api/admin/inventory/stock-import/preview", json={"store_id": 1, "csv": text})
    assert preview.status_code == 200, preview.text
    assert [(c["name"], c["size"]) for c in preview.json()["changes"]] == [("Test coffee", "24 oz")]

    applied = client.post("/api/admin/inventory/stock-import", json={"store_id": 1, "csv": text})
    assert applied.status_code == 200, applied.text
    assert next(v for v in _variants(client, product_id) if v["size"] == "24 oz")["quantity"] == 12
    assert _inventory(db, product_id)["quantity"] == 12


def test_csv_product_id_rows_need_a_sku_once_a_product_has_options(client, db):
    _sign_in(client, db)
    product_id = _new_product(db)
    _set_options(client, product_id, sizes=["9", "10"])

    preview = client.post(
        "/api/admin/inventory/stock-import/preview",
        json={"store_id": 1, "csv": f"product_id,stock\n{product_id},4\n"},
    )

    assert preview.status_code == 200
    assert "SKU" in preview.json()["errors"][0]["message"]


# --- photos -----------------------------------------------------------------


def test_photos_can_be_tagged_with_a_color_or_size(client, db):
    _sign_in(client, db)
    product_id = _new_product(db)
    added = client.post(
        f"/api/admin/products/{product_id}/images",
        json={"image_url": "https://example.com/black.png", "color": "Black"},
    )
    assert added.status_code == 201, added.text
    assert added.json()["color"] == "Black"

    image_id = added.json()["image_id"]
    retagged = client.put(
        f"/api/admin/products/{product_id}/images/{image_id}/option", json={"color": "White"}
    )

    assert retagged.status_code == 200
    assert client.get(f"/api/products/{product_id}/images").json() == [
        {"image_id": image_id, "image_url": "https://example.com/black.png", "color": "White", "size": None}
    ]


# --- shopping list ----------------------------------------------------------


def test_shopping_list_items_remember_the_picked_size(client, db):
    _sign_in(client, db, role="user", token="variants-shopper", store_ids=())
    product_id = _new_product(db)
    variant_id = db.execute(
        "INSERT INTO product_variants (product_id, size, sku) VALUES (%s, '10', %s) RETURNING variant_id",
        (product_id, f"P{product_id}-10-TEST"),
    ).fetchone()["variant_id"]
    list_id = client.post("/api/me/shopping-lists", json={"name": "Shoes"}).json()["shopping_list_id"]

    added = client.post(
        f"/api/me/shopping-lists/{list_id}/items",
        json={"product_id": product_id, "variant_id": variant_id},
    )
    other = client.post(
        f"/api/me/shopping-lists/{list_id}/items", json={"product_id": product_id, "variant_id": 999999}
    )

    assert added.status_code == 200, added.text
    [item] = added.json()["items"]
    assert item["variant_id"] == variant_id and item["variant_size"] == "10"
    assert other.status_code == 404


def test_order_messages_spell_out_product_color_and_size():
    import reorders

    text = reorders.formal_message(
        {"name": "MCCS Main Exchange"},
        [
            {"name": "Nike Dunk Low", "color": "Black", "size": "10", "quantity": 6, "current_quantity": 1},
            {"name": "Pike Place Coffee", "color": None, "size": "24 oz", "quantity": 4, "current_quantity": 0},
            {"name": "Timberland Boots", "color": None, "size": None, "quantity": 2, "current_quantity": 3},
        ],
        "",
        "manager@example.com",
    )

    assert "• Product: Nike Dunk Low\n  Color: Black\n  Size: 10\n  Quantity: 6 units" in text
    assert "• Product: Pike Place Coffee\n  Size: 24 oz\n  Quantity: 4 units" in text
    assert "• Product: Timberland Boots\n  Quantity: 2 units" in text


# --- fit (shoes only) --------------------------------------------------------


def test_seeded_shoes_have_a_fit_and_other_products_dont(db):
    # The seeded catalog only: other tests add shoes of their own
    rows = db.execute("SELECT category, fit FROM products WHERE product_id <= 150").fetchall()

    assert all(row["fit"] in ("mens", "womens", "kids") for row in rows if row["category"] == "shoes")
    assert all(row["fit"] is None for row in rows if row["category"] != "shoes")
    womens = db.execute(
        "SELECT fit FROM products WHERE name = 'Kamik Women''s Jennifer Rain Boots'"
    ).fetchone()
    assert womens["fit"] == "womens"


def test_a_shoe_keeps_its_fit_and_anything_else_drops_it(client, db):
    _sign_in(client, db)

    shoe = client.post("/api/admin/products", json={
        "name": "Fit shoe", "product_type": "Sneaker", "category": "shoes", "fit": "womens",
    })
    coffee = client.post("/api/admin/products", json={
        "name": "Fit coffee", "product_type": "Ground Coffee", "category": "coffee", "fit": "mens",
    })

    assert shoe.status_code == 201, shoe.text
    assert shoe.json()["fit"] == "womens"
    assert coffee.json()["fit"] is None
    moved = client.put(f"/api/admin/products/{shoe.json()['product_id']}", json={"category": "backpacks"})
    assert moved.json()["fit"] is None
    assert client.put(f"/api/admin/products/{shoe.json()['product_id']}", json={"fit": "unisex"}).status_code == 422


# --- reordering any size, from a list with one row per product --------------


def _buyer(db, store_id=1) -> int:
    user_id = db.execute(
        "INSERT INTO users (cognito_sub, email, role) VALUES ('variants-buyer', 'vb@example.com', 'store_buyer')"
        " ON CONFLICT (cognito_sub) DO UPDATE SET role = 'store_buyer' RETURNING user_id"
    ).fetchone()["user_id"]
    db.execute("INSERT INTO user_stores (user_id, store_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
               (user_id, store_id))
    return user_id


def _sized_shoe(client, db, stock_by_size):
    product_id = _new_product(db, quantity=0)
    db.execute("UPDATE inventory SET low_stock_threshold = 1 WHERE product_id = %s", (product_id,))
    variants = _set_options(client, product_id, sizes=list(stock_by_size))
    for variant in variants:
        assert _set_stock(client, variant["variant_id"], quantity=stock_by_size[variant["size"]]).status_code == 200
    return product_id, {v["size"]: v["variant_id"] for v in variants}


def test_the_catalog_has_one_row_per_product_with_its_low_sizes(client, db):
    _sign_in(client, db)
    product_id, _ = _sized_shoe(client, db, {"9": 0, "10": 5, "11": 1})

    body = client.get("/api/reorders/catalog?store_id=1").json()

    [row] = [p for p in body["products"] if p["product_id"] == product_id]
    assert (row["variant_count"], row["low_count"], row["quantity"]) == (3, 2, 6)
    assert row["status"] == "open" and row["statuses"] == ["open"]
    assert body["counts"]["all"] == len(body["products"])
    assert body["counts"]["open"] >= 1


def test_any_size_can_be_ordered_ahead_and_closes_when_the_order_arrives(client, db):
    _sign_in(client, db)
    buyer = _buyer(db)
    product_id, sizes = _sized_shoe(client, db, {"9": 0, "10": 5})

    lines = client.get(f"/api/reorders/lines?store_id=1&product_id={product_id}").json()
    assert [(l["size"], l["low"], l["status"], l["sendable"]) for l in lines] == [
        ("9", True, "open", True), ("10", False, None, True),
    ]
    sent = client.post("/api/reorders/send", json={
        "store_id": 1, "buyer_user_id": buyer,
        "items": [{"variant_id": sizes["9"], "quantity": 4}, {"variant_id": sizes["10"], "quantity": 10}],
    })
    assert sent.status_code == 200, sent.text

    row = next(p for p in client.get("/api/reorders/catalog?store_id=1").json()["products"]
               if p["product_id"] == product_id)
    assert row["statuses"] == ["requested"]
    again = client.post("/api/reorders/send", json={
        "store_id": 1, "buyer_user_id": buyer, "items": [{"variant_id": sizes["10"], "quantity": 1}],
    })
    assert again.status_code == 409

    # Selling one doesn't close the size-10 order; the delivery does
    _set_stock(client, sizes["10"], quantity=4)
    assert _active_alert(db, sizes["10"]) == "requested"
    _set_stock(client, sizes["10"], quantity=14)
    assert _active_alert(db, sizes["10"]) is None


def _active_alert(db, variant_id):
    row = db.execute(
        "SELECT status FROM low_stock_alerts WHERE variant_id = %s AND status <> 'resolved'", (variant_id,)
    ).fetchone()
    return row and row["status"]


# --- reorder messages are saved encrypted ------------------------------------


def test_reorder_notes_reasons_and_notifications_are_saved_encrypted(client, db):
    import reorders
    import secure_text

    manager = _sign_in(client, db)
    buyer = _buyer(db)
    product_id, sizes = _sized_shoe(client, db, {"9": 0, "10": 5})

    sent = client.post("/api/reorders/send", json={
        "store_id": 1, "buyer_user_id": buyer, "note": "Needed before Black Friday",
        "items": [{"variant_id": sizes["9"], "quantity": 4}],
    })
    assert sent.status_code == 200, sent.text
    request_id = db.execute("SELECT max(request_id) AS id FROM order_requests").fetchone()["id"]
    request = reorders.get_request(db, request_id)
    reorders.update_items(db, request, [], "unavailable", "Supplier is out until January",
                          {"user_id": buyer, "email": "vb@example.com", "role": "store_buyer",
                           "permissions": [], "store_ids": [1]},
                          alert_ids=[item["alert_id"] for item in request["items"]])

    # In the database: scrambled
    raw_note = db.execute("SELECT note FROM order_requests WHERE request_id = %s", (request_id,)).fetchone()
    raw_reason = db.execute(
        "SELECT reason FROM order_request_items WHERE request_id = %s", (request_id,)
    ).fetchone()
    raw_messages = db.execute(
        "SELECT subject, body FROM messages WHERE request_id = %s OR recipient_user_id = %s",
        (request_id, manager["user_id"]),
    ).fetchall()
    assert raw_note["note"].startswith(secure_text.TOKEN_PREFIX)
    assert "Black Friday" not in raw_note["note"]
    assert raw_reason["reason"].startswith(secure_text.TOKEN_PREFIX)
    assert raw_messages and all(m["subject"].startswith(secure_text.TOKEN_PREFIX) for m in raw_messages)

    # Through the app: readable
    shown = reorders.get_request(db, request_id)
    assert shown["note"] == "Needed before Black Friday"
    assert "Needed before Black Friday" in shown["message"]
    assert {item["reason"] for item in shown["items"]} == {"Supplier is out until January"}
    titles = [m["subject"] for m in reorders.list_messages(db, buyer)]
    assert any("Order request" in title or "order" in title.lower() for title in titles)
    update = db.execute(
        "SELECT recipient_user_id FROM messages WHERE request_id = %s AND kind = 'order_update' LIMIT 1",
        (request_id,),
    ).fetchone()
    bodies = " ".join(m["body"] for m in reorders.list_messages(db, update["recipient_user_id"]))
    assert "Supplier is out until January" in bodies


def test_messages_saved_before_encryption_get_encrypted_once(db):
    import secure_text

    user_id = db.execute("SELECT min(user_id) AS id FROM users").fetchone()["id"]
    db.execute(
        "INSERT INTO messages (recipient_user_id, kind, subject, body) VALUES (%s, 'low_stock', %s, %s)",
        (user_id, "Old plain title", "Old plain body"),
    )

    assert secure_text.encrypt_existing(db) >= 2
    assert secure_text.encrypt_existing(db) == 0  # already done: nothing changes
    row = db.execute("SELECT subject, body FROM messages ORDER BY message_id DESC LIMIT 1").fetchone()
    assert secure_text.decrypt(row["subject"]) == "Old plain title"
    assert secure_text.decrypt(row["body"]) == "Old plain body"


def test_a_message_from_another_key_shows_a_notice_not_an_error():
    from cryptography.fernet import Fernet

    import secure_text

    other = Fernet(Fernet.generate_key()).encrypt(b"secret").decode()
    assert secure_text.decrypt(other) == secure_text.UNREADABLE
    assert secure_text.encrypt("") == "" and secure_text.decrypt("") == ""


def test_without_a_key_the_shared_development_key_is_used(monkeypatch):
    import secure_text

    monkeypatch.delenv("MESSAGE_KEY", raising=False)
    secure_text._keys.cache_clear()
    try:
        token = secure_text.encrypt("hello")
        from cryptography.fernet import Fernet

        assert Fernet(secure_text.DEVELOPMENT_KEY).decrypt(token.encode()) == b"hello"
    finally:
        secure_text._keys.cache_clear()


def test_showcase_products_have_their_real_options(db):
    def options(name):
        return db.execute(
            "SELECT v.color, v.size, vs.price FROM product_variants v JOIN products p USING (product_id)"
            " JOIN variant_stock vs ON vs.variant_id = v.variant_id AND vs.store_id = 1"
            " WHERE p.name = %s ORDER BY v.color_order, v.size_order", (name,),
        ).fetchall()

    folgers = options("Folgers Classic Roast Ground Coffee")
    assert [row["size"] for row in folgers] == ["25.9 oz", "40.3 oz"]
    assert folgers[1]["price"] > folgers[0]["price"]
    assert [row["size"] for row in options("Dove Daily Moisture Shampoo")] == ["8.5 fl oz", "28 fl oz"]
    sony = options("Sony WH-1000XM4C Wireless Headphones")
    assert [row["color"] for row in sony] == ["Black", "Lavender", "Platinum Silver"]


def test_a_two_tone_color_keeps_both_swatch_colors(client, db):
    _sign_in(client, db)
    product_id = _new_product(db)

    variants = _set_options(client, product_id, colors=[
        {"name": "White", "hex": "#F5F5F5"},
        {"name": "White/Black", "hex": "#F5F5F5", "hex2": "#1A1A1A"},
    ], sizes=["9"])

    assert {(v["color"], v["color_hex"], v["color_hex_2"]) for v in variants} == {
        ("White", "#F5F5F5", None), ("White/Black", "#F5F5F5", "#1A1A1A"),
    }
    bad = client.put(f"/api/admin/products/{product_id}/variants", json={
        "colors": [{"name": "Odd", "hex2": "#1A1A1A"}], "sizes": ["9"],
    })
    assert bad.status_code == 422


def test_a_like_remembers_its_color_and_shows_that_colors_photo(client, db):
    user = _sign_in(client, db)
    shoe = db.execute("SELECT product_id FROM products WHERE name = 'Nike Air Force 1 Low'").fetchone()["product_id"]
    db.execute(
        "INSERT INTO product_images (product_id, image_url, color) VALUES (%s, '/static/af1-black-1.jpg', 'Black')",
        (shoe,),
    )

    assert client.put(f"/api/me/liked-products/{shoe}?color=Black").status_code == 200
    liked = next(i for i in client.get("/api/me/liked-products").json()["items"] if i["product_id"] == shoe)
    assert liked["liked_color"] == "Black"
    assert liked["image_url"] == "/static/af1-black-1.jpg"

    # Liked again in another color: the color switches, still one like
    client.put(f"/api/me/liked-products/{shoe}?color=White")
    rows = db.execute(
        "SELECT color FROM user_product_likes WHERE user_id = %s AND product_id = %s", (user["user_id"], shoe)
    ).fetchall()
    assert [r["color"] for r in rows] == ["White"]


def test_the_shopping_list_keeps_each_color_and_size_with_a_quantity(client, db):
    _sign_in(client, db)
    shoe = db.execute("SELECT product_id FROM products WHERE name = 'Nike Air Force 1 Low'").fetchone()["product_id"]
    by_pick = {
        (v["color"], v["size"]): v["variant_id"] for v in client.get(f"/api/products/{shoe}/variants").json()
    }
    list_id = client.post("/api/me/shopping-lists", json={"name": "Shoes"}).json()["shopping_list_id"]
    items = f"/api/me/shopping-lists/{list_id}/items"

    client.post(items, json={"product_id": shoe, "variant_id": by_pick[("White", "10")], "quantity": 2})
    client.post(items, json={"product_id": shoe, "variant_id": by_pick[("Black", "9")]})
    client.post(items, json={"product_id": shoe, "color": "White/Black"})
    # The same pick again adds to its row, never past 99
    client.post(items, json={"product_id": shoe, "variant_id": by_pick[("White", "10")], "quantity": 98})
    rows = client.get(f"/api/me/shopping-lists/{list_id}").json()["items"]

    picks = {(r["variant_color"], r["variant_size"]): r for r in rows}
    assert set(picks) == {("White", "10"), ("Black", "9"), ("White/Black", None)}
    assert picks[("White", "10")]["quantity"] == 99
    assert picks[("White/Black", None)]["quantity"] == 1
    assert client.post(items, json={"product_id": shoe, "color": "Purple"}).status_code == 404

    black = picks[("Black", "9")]["shopping_list_item_id"]
    changed = client.patch(f"{items}/{black}", json={"quantity": 3}).json()["items"]
    assert next(r for r in changed if r["shopping_list_item_id"] == black)["quantity"] == 3
    left = client.delete(f"{items}/{black}").json()["items"]
    assert {(r["variant_color"], r["variant_size"]) for r in left} == {("White", "10"), ("White/Black", None)}


def test_one_scan_checks_off_every_color_of_the_product(client, db):
    _sign_in(client, db)
    shoe = db.execute("SELECT product_id FROM products WHERE name = 'Nike Air Force 1 Low'").fetchone()["product_id"]
    list_id = client.post("/api/me/shopping-lists", json={"name": "Store run"}).json()["shopping_list_id"]
    client.put(f"/api/me/shopping-lists/{list_id}/activate")
    for color in ("White", "Black"):
        client.post(f"/api/me/shopping-lists/{list_id}/items", json={"product_id": shoe, "color": color})

    scanned = client.post("/api/me/shopping-lists/active/scan", json={"product_id": shoe}).json()

    assert scanned["status"] == "checked_off"
    assert all(item["is_completed"] for item in scanned["list"]["items"] if item["product_id"] == shoe)
