"""
Two routers, the same split as routers/reviews.py:

* router        - the shopper read (public, like the product itself)
* admin_router  - add and remove, following product ownership: the app admin,
                  or the store that added the product

Uploads are written into backend/static/products, the folder the seed photos
already live in, so main.py's existing /static mount serves them
"""

from pathlib import Path
from uuid import uuid4
import logging

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
import psycopg

from auth import require_permission
from database import get_connection
from product_access import require_product_owner
from schemas import ProductImage, ProductImageCreate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/products", tags=["product-images"])
admin_router = APIRouter(prefix="/api/admin/products", tags=["admin-product-images"])

# Where uploaded photos are written, and the prefix the app resolves them with.
# Kept as module constants so tests can point them at a temporary folder.
PRODUCT_IMAGES_DIR = Path(__file__).resolve().parent.parent / "static" / "products"
PUBLIC_IMAGES_PREFIX = "/static/products/"

# Max size for image uploads.
MAX_UPLOAD_BYTES = 5 * 1024 * 1024

# How many leading bytes _image_extension() needs to recognise every supported
# format.
SIGNATURE_BYTES = 12

# The formats the app is allowed to store, matched on their magic numbers rather
# than the file extension, which is easy to spoof.
_SIGNATURES = (
    (b"\x89PNG\r\n\x1a\n", "png"),
    (b"\xff\xd8\xff", "jpg"),
)

# ISO base media file format containers (HEIC, AVIF) all start with an "ftyp"
# box, so the brand at bytes 8-12 is what tells them apart.
_ISOBMFF_BRANDS = ((b"avif", "avif"),)


def _image_extension(header: bytes) -> str | None:
    """The extension for a supported image, or None for anything else.

    `header` must be at least SIGNATURE_BYTES long; the call site slices that
    many bytes from the upload.
    """
    for signature, extension in _SIGNATURES:
        if header.startswith(signature):
            return extension
    # WebP is a RIFF container whose type field (bytes 8-12) spells WEBP.
    if header[:4] == b"RIFF" and header[8:12] == b"WEBP":
        return "webp"
    # AVIF: an "ftyp" box whose brand (bytes 8-12) is "avif".
    if header[4:8] == b"ftyp":
        for brand, extension in _ISOBMFF_BRANDS:
            if header[8:12] == brand:
                return extension
    return None


def _gallery(conn, product_id: int) -> list[dict]:
    """One product's extra images, in the order they were added."""
    return conn.execute(
        """
        SELECT image_id, image_url
        FROM product_images
        WHERE product_id = %s
        ORDER BY image_id
        """,
        (product_id,),
    ).fetchall()


def _require_product(conn, product_id: int) -> None:
    if conn.execute(
        "SELECT 1 FROM products WHERE product_id = %s", (product_id,)
    ).fetchone() is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Product {product_id} not found",
        )


def _require_new_url(conn, product_id: int, image_url: str) -> None:
    """409 when this link would add nothing (the featured photo, or a repeat)."""
    featured_image = conn.execute(
        "SELECT image_url FROM products WHERE product_id = %s", (product_id,)
    ).fetchone()
    if featured_image is not None and featured_image["image_url"] == image_url:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That is already the product's featured image",
        )
    existing = conn.execute(
        """
        SELECT 1 FROM product_images
        WHERE product_id = %s AND image_url = %s
        """,
        (product_id, image_url),
    ).fetchone()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That image is already in this product's gallery",
        )


def _insert_image(conn, product_id: int, image_url: str, source: str) -> dict:
    return conn.execute(
        """
        INSERT INTO product_images (product_id, image_url, source)
        VALUES (%s, %s, %s)
        RETURNING image_id, image_url
        """,
        (product_id, image_url, source),
    ).fetchone()


def _remove_uploaded_file(image_url: str) -> None:
    """Delete a file this API wrote. Never touches a link we did not create.

    Only the file name is used, and only for our own /static/products/ links,
    so a stored value can never reach outside the images folder. The database
    row is already gone by now, so a failure here is logged rather than raised:
    the gallery must not keep listing a photo the admin removed.
    """
    if not image_url.startswith(PUBLIC_IMAGES_PREFIX):
        return
    name = image_url[len(PUBLIC_IMAGES_PREFIX):]
    if not name or "/" in name or "\\" in name or name.startswith("."):
        return
    try:
        (PRODUCT_IMAGES_DIR / name).unlink(missing_ok=True)
    except OSError:
        logger.warning("Could not delete uploaded image %s", image_url, exc_info=True)


# --- Shopper read ---------------------------------------------------------


@router.get("/{product_id}/images", response_model=list[ProductImage])
def list_product_images(product_id: int) -> list[dict]:
    """The product's extra photos, in the order they were added.

    Separate from the product response on purpose: search, recommendations and
    compare share that query, and none of them show a gallery.
    """
    with get_connection() as conn:
        _require_product(conn, product_id)
        return _gallery(conn, product_id)


# --- Admin add/remove -----------------------------------------------------


@admin_router.get("/{product_id}/images", response_model=list[ProductImage])
def list_images_for_admin(
    product_id: int,
    user=Depends(require_permission("create_products")),
) -> list[dict]:
    """The same list the image screen reloads after each change."""
    with get_connection() as conn:
        require_product_owner(conn, user, product_id)
        return _gallery(conn, product_id)


@admin_router.post(
    "/{product_id}/images",
    response_model=ProductImage,
    status_code=status.HTTP_201_CREATED,
)
def add_product_image(
    product_id: int,
    image: ProductImageCreate,
    user=Depends(require_permission("create_products")),
) -> dict:
    """Add a photo by link. Storage is the client's: nothing is downloaded."""
    with get_connection() as conn:
        require_product_owner(conn, user, product_id)
        _require_new_url(conn, product_id, image.image_url)
        try:
            return _insert_image(conn, product_id, image.image_url, "url")
        except psycopg.errors.UniqueViolation:
            # Two adds racing on the same link: the constraint decides, and the
            # caller still gets the same answer as the check above.
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="That image is already in this product's gallery",
            ) from None


@admin_router.post(
    "/{product_id}/images/upload",
    response_model=ProductImage,
    status_code=status.HTTP_201_CREATED,
)
async def upload_product_image(
    product_id: int,
    file: UploadFile = File(...),
    user=Depends(require_permission("create_products")),
) -> dict:
    """Store a photo picked on the admin's device in backend/static/products."""
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if not content:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Choose an image file",
        )
    # read() is capped one byte past the limit, so an oversized file is
    # rejected without loading all of it.
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="Images must be 5 MB or smaller",
        )
    extension = _image_extension(content[:SIGNATURE_BYTES])
    if extension is None:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Use a PNG, JPEG, WebP, or AVIF image",
        )

    # The file is written inside the transaction's lifetime and removed again if
    # anything after it fails, so a rejected or rolled-back upload leaves no
    # orphan in static/products.
    name = None
    try:
        with get_connection() as conn:
            # Ownership first: a rejected upload must never leave a file behind.
            require_product_owner(conn, user, product_id)
            PRODUCT_IMAGES_DIR.mkdir(parents=True, exist_ok=True)
            # A fresh name each time
            name = f"product-{product_id}-{uuid4().hex}.{extension}"
            (PRODUCT_IMAGES_DIR / name).write_bytes(content)
            stored = _insert_image(
                conn, product_id, f"{PUBLIC_IMAGES_PREFIX}{name}", "upload"
            )
    except Exception:
        if name is not None:
            (PRODUCT_IMAGES_DIR / name).unlink(missing_ok=True)
        raise
    return stored


@admin_router.put("/{product_id}/images/{image_id}/featured", response_model=list[ProductImage])
def make_product_image_featured(
    product_id: int,
    image_id: int,
    user=Depends(require_permission("create_products")),
) -> list[dict]:
    """Promote one extra image to be the product's featured image.

    This is a swap, not a copy: the promoted photo leaves the gallery and the
    photo it replaces takes its place there. Keeping both would mean the same
    photo is listed twice, and removing the gallery copy would then delete the
    file the featured image points at — see _remove_uploaded_file.
    """
    with get_connection() as conn:
        require_product_owner(conn, user, product_id)

        chosen = conn.execute(
            """
            SELECT image_url
            FROM product_images
            WHERE product_id = %s AND image_id = %s
            """,
            (product_id, image_id),
        ).fetchone()
        if chosen is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Image {image_id} not found on product {product_id}",
            )

        outgoing = conn.execute(
            "SELECT image_url FROM products WHERE product_id = %s",
            (product_id,),
        ).fetchone()["image_url"]

        # Remove first: it frees the name for the outgoing image below (the
        # unique constraint) and guarantees the featured image is never also a
        # gallery row.
        conn.execute(
            "DELETE FROM product_images WHERE product_id = %s AND image_id = %s",
            (product_id, image_id),
        )
        conn.execute(
            """
            UPDATE products
            SET image_url = %s, updated_at = CURRENT_TIMESTAMP
            WHERE product_id = %s
            """,
            (chosen["image_url"], product_id),
        )

        if outgoing:
            # The old featured image becomes an extra image, so the admin can
            # put it back with one more tap. Its file ownership follows from the
            # link: anything we serve from our own folder may have been written
            # by an upload, so it must still be deletable as one.
            #
            # ON CONFLICT: editing a product can already point image_url at a
            # photo that is also in the gallery, so the outgoing link may be
            # listed there. That state is left as it is rather than failing the
            # swap the admin asked for.
            conn.execute(
                """
                INSERT INTO product_images (product_id, image_url, source)
                VALUES (%s, %s, %s)
                ON CONFLICT (product_id, image_url) DO NOTHING
                """,
                (
                    product_id,
                    outgoing,
                    "upload"
                    if outgoing.startswith(PUBLIC_IMAGES_PREFIX)
                    else "url",
                ),
            )

        return _gallery(conn, product_id)


@admin_router.delete("/{product_id}/images/{image_id}")
def delete_product_image(
    product_id: int,
    image_id: int,
    user=Depends(require_permission("create_products")),
) -> dict:
    """Remove one photo. An uploaded file goes with its row."""
    with get_connection() as conn:
        require_product_owner(conn, user, product_id)
        deleted = conn.execute(
            """
            DELETE FROM product_images
            WHERE product_id = %s AND image_id = %s
            RETURNING image_url, source
            """,
            (product_id, image_id),
        ).fetchone()
        if deleted is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Image {image_id} not found on product {product_id}",
            )
    if deleted["source"] == "upload":
        _remove_uploaded_file(deleted["image_url"])
    return {"deleted": True, "image_id": image_id}
