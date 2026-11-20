# Multiple images per product: the extra-photo gallery behind the product
# detail page, and the admin screen that maintains it.

import os
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import quote

import psycopg
import pytest
from fastapi.testclient import TestClient
from testcontainers.community.postgres import PostgresContainer

import auth
import routers.product_images
import routers.products
from conftest import apply_init_sql
from main import app

# A real PNG signature followed by filler: enough for the upload type sniffing,
# and small enough that the 5 MB limit is never approached.
PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"0" * 64
# An ISO base media file format header: a size, the "ftyp" box, then the brand.
# AVIF and HEIC differ only in that brand, which is the whole point of the pair.
AVIF_BYTES = b"\x00\x00\x00\x1cftypavif" + b"0" * 64
HEIC_BYTES = b"\x00\x00\x00\x18ftypheic" + b"0" * 64
SECOND_IMAGE = "https://example.test/sole.jpg"
THIRD_IMAGE = "/static/products/brooks-ghost-15.png"


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
        yield conn


@pytest.fixture(autouse=True)
def _fakes(monkeypatch, tmp_path):
    monkeypatch.setattr(auth, "cognito_client", FakeCognito())
    # Rebuilding the recommendation data is slow and not what these tests check.
    monkeypatch.setattr(routers.products, "refresh_recommendation_data", lambda: None)
    # Uploads land here instead of the checked-in backend/static/products.
    monkeypatch.setattr(routers.product_images, "PRODUCT_IMAGES_DIR", tmp_path)
    yield
    app.dependency_overrides.pop(auth.verify_access_token, None)


@pytest.fixture
def images_dir(tmp_path) -> Path:
    return tmp_path


def _sign_in_as(client, db, role, store_ids=(), token=None) -> dict:
    token = token or f"images-{role}-{'-'.join(map(str, store_ids))}"
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


def _owned_product(client, db, store_id=1) -> int:
    """A product owned by one store, so ownership rules have something to test."""
    _sign_in_as(client, db, "store_admin", [store_id], token=f"creator-{store_id}")
    return client.post(
        "/api/admin/products",
        json={"name": f"Gallery Shoe {store_id}", "product_type": "Boot", "store_id": store_id},
    ).json()["product_id"]


def _add(client, product_id, url):
    return client.post(f"/api/admin/products/{product_id}/images", json={"image_url": url})


def _add_upload(client, product_id, content=PNG_BYTES, name="photo.png"):
    return client.post(
        f"/api/admin/products/{product_id}/images/upload",
        files={"file": (name, content, "image/png")},
    )


# --- reading --------------------------------------------------------------


def test_added_images_are_listed_in_the_order_they_were_added(client, db):
    product_id = _owned_product(client, db)

    assert _add(client, product_id, SECOND_IMAGE).status_code == 201
    assert _add(client, product_id, THIRD_IMAGE).status_code == 201

    # The shopper read is public: no sign-in, like the product itself.
    app.dependency_overrides.pop(auth.verify_access_token, None)
    response = client.get(f"/api/products/{product_id}/images")

    assert response.status_code == 200
    assert [image["image_url"] for image in response.json()] == [SECOND_IMAGE, THIRD_IMAGE]
    # A relative /static path comes back untouched, so the client resolves it.
    assert response.json()[1]["image_url"].startswith("/static/")


def test_a_product_with_no_extra_images_has_an_empty_gallery(client):
    assert client.get("/api/products/1/images").json() == []


def test_images_of_a_missing_product_are_404(client, db):
    _sign_in_as(client, db, "system_admin")

    assert client.get("/api/products/999999/images").status_code == 404
    assert client.get("/api/admin/products/999999/images").status_code == 404
    assert _add(client, 999999, SECOND_IMAGE).status_code == 404


def test_admin_list_matches_the_shopper_list(client, db):
    product_id = _owned_product(client, db)
    _add(client, product_id, SECOND_IMAGE)

    admin = client.get(f"/api/admin/products/{product_id}/images")
    shopper = client.get(f"/api/products/{product_id}/images")

    assert admin.status_code == 200
    assert admin.json() == shopper.json()


# --- rejecting duplicates and junk ----------------------------------------


def test_the_featured_image_cannot_be_added_again(client, db):
    product_id = _owned_product(client, db)
    assert client.put(
        f"/api/admin/products/{product_id}", json={"image_url": SECOND_IMAGE}
    ).status_code == 200

    response = _add(client, product_id, SECOND_IMAGE)

    assert response.status_code == 409
    assert "featured image" in response.json()["detail"]


def test_the_same_image_cannot_be_added_twice(client, db):
    product_id = _owned_product(client, db)
    assert _add(client, product_id, SECOND_IMAGE).status_code == 201

    response = _add(client, product_id, SECOND_IMAGE)

    assert response.status_code == 409
    assert len(client.get(f"/api/admin/products/{product_id}/images").json()) == 1


@pytest.mark.parametrize(
    "url", ["not-a-link", "https://", "javascript:alert(1)", "/media/photo.png"]
)
def test_a_malformed_link_is_rejected(client, db, url):
    product_id = _owned_product(client, db)

    response = _add(client, product_id, url)

    assert response.status_code == 422, url
    assert client.get(f"/api/admin/products/{product_id}/images").json() == []


# --- who may change the gallery -------------------------------------------


def test_another_store_cannot_change_the_gallery(client, db):
    product_id = _owned_product(client, db, store_id=1)
    _add(client, product_id, SECOND_IMAGE)
    image_id = client.get(f"/api/admin/products/{product_id}/images").json()[0]["image_id"]

    _sign_in_as(client, db, "store_admin", [2])

    assert client.get(f"/api/admin/products/{product_id}/images").status_code == 403
    assert _add(client, product_id, THIRD_IMAGE).status_code == 403
    assert _add_upload(client, product_id).status_code == 403
    assert client.delete(
        f"/api/admin/products/{product_id}/images/{image_id}"
    ).status_code == 403
    # Nothing changed.
    assert len(client.get(f"/api/products/{product_id}/images").json()) == 1


def test_the_app_admin_can_change_any_products_gallery(client, db):
    product_id = _owned_product(client, db, store_id=1)
    _sign_in_as(client, db, "system_admin")

    assert _add(client, product_id, SECOND_IMAGE).status_code == 201
    assert _add_upload(client, product_id).status_code == 201


def test_roles_without_product_access_cannot_manage_images(client, db):
    product_id = _owned_product(client, db, store_id=1)
    _sign_in_as(client, db, "user")

    assert _add(client, product_id, SECOND_IMAGE).status_code == 403
    assert _add_upload(client, product_id).status_code == 403


def test_managing_images_requires_a_signed_in_user(client, db):
    product_id = _owned_product(client, db, store_id=1)
    app.dependency_overrides.pop(auth.verify_access_token, None)

    # 401 from the token check; some Starlette versions answer 403 for a missing
    # header before the dependency runs.
    assert _add(client, product_id, SECOND_IMAGE).status_code in (401, 403)


# --- uploads --------------------------------------------------------------


def test_uploaded_image_is_stored_in_the_products_folder(client, db, images_dir):
    product_id = _owned_product(client, db)

    response = _add_upload(client, product_id)

    assert response.status_code == 201
    image = response.json()
    assert image["image_url"].startswith("/static/products/product-")
    assert image["image_url"].endswith(".png")
    # The bytes are on disk under the name the URL points at.
    stored = images_dir / image["image_url"].removeprefix("/static/products/")
    assert stored.read_bytes() == PNG_BYTES
    assert [entry["image_id"] for entry in client.get(
        f"/api/admin/products/{product_id}/images"
    ).json()] == [image["image_id"]]


def test_the_stored_type_comes_from_the_bytes_not_the_name(client, db, images_dir):
    product_id = _owned_product(client, db)

    response = _add_upload(client, product_id, content=PNG_BYTES, name="photo.jpg")

    # A PNG named .jpg is stored as a PNG, so the served MIME type is right.
    assert response.json()["image_url"].endswith(".png")


def test_a_file_that_is_not_an_image_is_refused(client, db, images_dir):
    product_id = _owned_product(client, db)

    response = _add_upload(client, product_id, content=b"<html>not an image</html>")

    assert response.status_code == 415
    # The rejected upload left nothing behind.
    assert list(images_dir.iterdir()) == []


def test_an_avif_image_is_accepted(client, db, images_dir):
    product_id = _owned_product(client, db)

    response = _add_upload(
        client, product_id, content=AVIF_BYTES, name="photo.avif"
    )

    assert response.status_code == 201
    image = response.json()
    assert image["image_url"].startswith("/static/products/product-")
    assert image["image_url"].endswith(".avif")
    # The extension is what StaticFiles turns into the Content-Type, so the
    # bytes must be on disk under exactly the name the URL points at.
    stored = images_dir / image["image_url"].removeprefix("/static/products/")
    assert stored.read_bytes() == AVIF_BYTES
    assert [entry["image_id"] for entry in client.get(
        f"/api/admin/products/{product_id}/images"
    ).json()] == [image["image_id"]]


def test_a_heic_image_is_still_refused(client, db, images_dir):
    # AVIF and HEIC share the ISO-BMFF container and differ only in the brand.
    # The app asks iOS for a compatible (JPEG) representation instead, so HEIC
    # stays out: this pins that decision against a future "accept all ftyp" change.
    product_id = _owned_product(client, db)

    response = _add_upload(
        client, product_id, content=HEIC_BYTES, name="photo.heic"
    )

    assert response.status_code == 415
    assert list(images_dir.iterdir()) == []


def test_an_oversized_image_is_refused(client, db, images_dir):
    product_id = _owned_product(client, db)
    too_big = PNG_BYTES + b"0" * (5 * 1024 * 1024)

    response = _add_upload(client, product_id, content=too_big)

    assert response.status_code == 413
    assert list(images_dir.iterdir()) == []


def test_an_empty_upload_is_refused(client, db):
    product_id = _owned_product(client, db)

    assert _add_upload(client, product_id, content=b"").status_code == 422


# --- removing -------------------------------------------------------------


def test_deleting_an_image_removes_its_row(client, db):
    product_id = _owned_product(client, db)
    image_id = _add(client, product_id, SECOND_IMAGE).json()["image_id"]

    response = client.delete(f"/api/admin/products/{product_id}/images/{image_id}")

    assert response.status_code == 200
    assert response.json() == {"deleted": True, "image_id": image_id}
    assert client.get(f"/api/admin/products/{product_id}/images").json() == []
    # A second delete finds nothing.
    assert client.delete(
        f"/api/admin/products/{product_id}/images/{image_id}"
    ).status_code == 404


def test_deleting_an_upload_deletes_the_file(client, db, images_dir):
    product_id = _owned_product(client, db)
    image = _add_upload(client, product_id).json()
    stored = images_dir / image["image_url"].removeprefix("/static/products/")
    assert stored.exists()

    assert client.delete(
        f"/api/admin/products/{product_id}/images/{image['image_id']}"
    ).status_code == 200

    assert not stored.exists()


def test_deleting_a_linked_image_never_touches_the_file(client, db, images_dir):
    product_id = _owned_product(client, db)
    # A file that happens to sit in the images folder but was not uploaded
    # through this API: e.g. a checked-in seed photo.
    checked_in = images_dir / "brooks-ghost-15.png"
    checked_in.write_bytes(PNG_BYTES)
    image = _add(client, product_id, "/static/products/brooks-ghost-15.png").json()

    assert client.delete(
        f"/api/admin/products/{product_id}/images/{image['image_id']}"
    ).status_code == 200

    assert checked_in.exists()


def test_an_image_belonging_to_another_product_is_404(client, db):
    first = _owned_product(client, db, store_id=1)
    image_id = _add(client, first, SECOND_IMAGE).json()["image_id"]
    second = _owned_product(client, db, store_id=1)

    response = client.delete(f"/api/admin/products/{second}/images/{image_id}")

    assert response.status_code == 404
    assert len(client.get(f"/api/products/{first}/images").json()) == 1


def test_deleting_a_product_removes_its_gallery_rows(client, db):
    product_id = _owned_product(client, db, store_id=1)
    _add(client, product_id, SECOND_IMAGE)
    _sign_in_as(client, db, "system_admin")

    assert client.delete(f"/api/admin/products/{product_id}").status_code == 200

    assert db.execute(
        "SELECT count(*) AS n FROM product_images WHERE product_id = %s", (product_id,)
    ).fetchone()["n"] == 0


# --- making an image featured ----------------------------------------------


def _set_featured_url(client, product_id, url):
    assert client.put(
        f"/api/admin/products/{product_id}", json={"image_url": url}
    ).status_code == 200


def _featured_url(client, product_id):
    return client.get(f"/api/admin/products/{product_id}").json()["image_url"]


def _owned_product_id(db, store_id=1) -> int:
    """The product id that _owned_product just created for this store."""
    return db.execute(
        "SELECT max(product_id) AS id FROM products WHERE created_by_store_id = %s",
        (store_id,),
    ).fetchone()["id"]


def _gallery_urls(client, product_id):
    # Re-sign-in as the product's owner: the helper is called after tests that
    # switch identity (e.g. to prove another store is refused).
    response = client.get(f"/api/admin/products/{product_id}/images")
    assert response.status_code == 200, response.text
    return [image["image_url"] for image in response.json()]


def _make_featured(client, product_id, image_id):
    return client.put(
        f"/api/admin/products/{product_id}/images/{image_id}/featured"
    )


def test_making_an_image_featured_swaps_it_with_the_previous_one(client, db):
    product_id = _owned_product(client, db)
    _set_featured_url(client, product_id, SECOND_IMAGE)
    promoted = _add(client, product_id, THIRD_IMAGE).json()

    response = _make_featured(client, product_id, promoted["image_id"])

    assert response.status_code == 200
    # The promoted photo is now the featured image...
    assert _featured_url(client, product_id) == THIRD_IMAGE
    # ...and it is no longer duplicated in the gallery.
    assert promoted["image_url"] not in _gallery_urls(client, product_id)
    # The photo it replaced is still available as an extra image.
    assert _gallery_urls(client, product_id) == [SECOND_IMAGE]
    # The endpoint answers with the gallery the screen reloads.
    assert [image["image_url"] for image in response.json()] == [SECOND_IMAGE]


def test_promotion_fails_if_the_gallery_row_disappears_before_it_is_claimed(client, db, monkeypatch):
    product_id = _owned_product(client, db)
    _set_featured_url(client, product_id, SECOND_IMAGE)
    photo = _add(client, product_id, THIRD_IMAGE).json()
    get_connection = routers.product_images.get_connection

    @contextmanager
    def connection():
        with get_connection() as conn:
            class RemoveBeforeClaim:
                def execute(self, query, params=()):
                    if query.lstrip().startswith("DELETE FROM product_images"):
                        db.execute("DELETE FROM product_images WHERE image_id = %s", (photo["image_id"],))
                    return conn.execute(query, params)

            yield RemoveBeforeClaim()

    monkeypatch.setattr(routers.product_images, "get_connection", connection)
    assert _make_featured(client, product_id, photo["image_id"]).status_code == 404
    assert _featured_url(client, product_id) == SECOND_IMAGE


def test_deleting_a_gallery_copy_preserves_the_featured_upload(client, db, images_dir):
    product_id = _owned_product(client, db)
    photo = _add_upload(client, product_id).json()
    _set_featured_url(client, product_id, photo["image_url"])

    response = client.delete(f"/api/admin/products/{product_id}/images/{photo['image_id']}")

    assert response.status_code == 200
    assert (images_dir / photo["image_url"].removeprefix("/static/products/")).exists()
    assert _featured_url(client, product_id) == photo["image_url"]


def test_making_the_same_image_featured_again_restores_the_original(client, db):
    product_id = _owned_product(client, db)
    _set_featured_url(client, product_id, SECOND_IMAGE)
    promoted = _add(client, product_id, THIRD_IMAGE).json()
    _make_featured(client, product_id, promoted["image_id"])

    # The swapped-out photo is the only gallery entry; promoting it undoes the swap.
    swapped_back = client.get(
        f"/api/admin/products/{product_id}/images"
    ).json()[0]
    assert _make_featured(client, product_id, swapped_back["image_id"]).status_code == 200

    assert _featured_url(client, product_id) == SECOND_IMAGE
    assert _gallery_urls(client, product_id) == [THIRD_IMAGE]


def test_deleting_a_swapped_in_upload_does_not_delete_the_featured_image(
    client, db, images_dir
):
    # The regression a "copy the url" implementation would hit: the promoted file
    # must survive removing the gallery row that it replaced.
    product_id = _owned_product(client, db)
    _set_featured_url(client, product_id, SECOND_IMAGE)
    promoted = _add_upload(client, product_id).json()
    promoted_file = images_dir / promoted["image_url"].removeprefix("/static/products/")

    assert _make_featured(client, product_id, promoted["image_id"]).status_code == 200

    old_row = client.get(f"/api/admin/products/{product_id}/images").json()[0]
    assert client.delete(
        f"/api/admin/products/{product_id}/images/{old_row['image_id']}"
    ).status_code == 200

    # The featured image's file is untouched, and the product still points at it.
    assert promoted_file.exists()
    assert _featured_url(client, product_id) == promoted["image_url"]


def test_a_swapped_back_upload_keeps_its_file_when_removed(client, db, images_dir):
    # Ownership has to follow the swapped-out photo, not default to "url", or the
    # original upload would be left behind on disk forever.
    product_id = _owned_product(client, db)
    original = _add_upload(client, product_id).json()
    original_file = images_dir / original["image_url"].removeprefix("/static/products/")
    assert _make_featured(client, product_id, original["image_id"]).status_code == 200
    assert _featured_url(client, product_id) == original["image_url"]
    # The product had no featured image, so nothing came back to the gallery.
    assert _gallery_urls(client, product_id) == []

    replacement = _add_upload(client, product_id).json()
    assert _make_featured(client, product_id, replacement["image_id"]).status_code == 200
    # The original is back in the gallery, and its file is still there.
    assert _gallery_urls(client, product_id) == [original["image_url"]]
    assert original_file.exists()

    swapped_back = client.get(f"/api/admin/products/{product_id}/images").json()[0]
    assert client.delete(
        f"/api/admin/products/{product_id}/images/{swapped_back['image_id']}"
    ).status_code == 200

    # It was an upload, so removing its row removes the file.
    assert not original_file.exists()


def test_promoting_an_image_of_another_product_is_404(client, db):
    first = _owned_product(client, db, store_id=1)
    image_id = _add(client, first, SECOND_IMAGE).json()["image_id"]
    _owned_product(client, db, store_id=1)
    second = _owned_product_id(db)
    # Back to the first product's owner: the second creation switched identity.
    _sign_in_as(client, db, "store_admin", [1], token="creator-1")

    assert _make_featured(client, second, image_id).status_code == 404
    # Neither product changed.
    assert _gallery_urls(client, first) == [SECOND_IMAGE]


def test_another_store_cannot_make_an_image_featured(client, db):
    product_id = _owned_product(client, db, store_id=1)
    _set_featured_url(client, product_id, SECOND_IMAGE)
    promoted = _add(client, product_id, THIRD_IMAGE).json()
    _sign_in_as(client, db, "store_admin", [2])

    assert _make_featured(client, product_id, promoted["image_id"]).status_code == 403
    # Back as the owner to read the admin view, which shows nothing changed.
    _sign_in_as(client, db, "store_admin", [1], token="creator-1")
    assert _featured_url(client, product_id) == SECOND_IMAGE
    assert _gallery_urls(client, product_id) == [THIRD_IMAGE]
