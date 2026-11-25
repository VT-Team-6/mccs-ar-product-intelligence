from fastapi import FastAPI, HTTPException, Response, Depends
from fastapi.middleware.cors import CORSMiddleware
from database import get_product
from qr import make_qr_png
from pathlib import Path
from contextlib import asynccontextmanager
from product_features import refresh_recommendation_data
from database import get_connection
import reorders as reorder_alerts
import secure_text

from fastapi.staticfiles import StaticFiles
from routers import me, products, scan, search, shopper_products, reviews, analysis, recommendations, stores, inventory, admin, compare, reorders
from routers import product_images, review_images, shopping_lists, variants
import auth


def check_low_stock() -> None:
    try:
        with get_connection() as conn:
            found = reorder_alerts.check_all_stores(conn)
        if found:
            print(f"Low stock: {found} product(s) need reordering")
    except Exception as error:  # never keep the backend from starting
        print(f"Low stock check skipped: {error}")


def encrypt_old_messages() -> None:
    """Encrypts reorder messages saved before encryption was added."""
    try:
        with get_connection() as conn:
            changed = secure_text.encrypt_existing(conn)
        if changed:
            print(f"Encrypted {changed} reorder message field(s) saved before encryption")
    except secure_text.MissingKey:
        raise
    except Exception as error:  # e.g. the database isn't up yet; the next start retries
        print(f"Encrypting old messages skipped: {error}")


@asynccontextmanager
async def lifespan(app):
    secure_text.check_key()  # a broken MESSAGE_KEY stops startup; a missing one uses the dev key
    encrypt_old_messages()
    refresh_recommendation_data()  # build scores (and later the models) when the backend starts
    check_low_stock()  # alerts for products that were already low (e.g. from the seed data)
    yield


app = FastAPI(lifespan=lifespan)

# Lets the app's browser version call this API during development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(products.router)
app.include_router(scan.router)
app.include_router(search.router)
app.include_router(shopper_products.router)
app.include_router(product_images.router)
app.include_router(product_images.admin_router)
app.include_router(stores.router)
app.include_router(me.router)
app.include_router(shopping_lists.router)
app.include_router(reviews.router)
app.include_router(reviews.admin_router)
app.include_router(review_images.router)
app.include_router(analysis.router)
app.include_router(recommendations.router)
app.include_router(compare.router)
app.include_router(inventory.product_stock_router)
app.include_router(inventory.store_stock_router)
app.include_router(variants.inventory_router)
app.include_router(inventory.writer_router)
app.include_router(variants.public_router)
app.include_router(variants.admin_router)
app.include_router(admin.router)
app.include_router(reorders.manager_router)
app.include_router(reorders.requests_router)
app.include_router(reorders.messages_router)

# Serves the files in backend/static, such as product images
app.mount("/static", StaticFiles(directory=Path(__file__).parent / "static"), name="static")

@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/products/{product_id}/qr")
def product_qr(product_id: int):
    # Only make a code for a product that actually exists
    if get_product(product_id) is None:
        raise HTTPException(status_code=404, detail="Product not found")
    return Response(content=make_qr_png(product_id), media_type="image/png")

@app.get("/me")
def get_me(user=Depends(auth.require_authenticated_user)):
    return user
