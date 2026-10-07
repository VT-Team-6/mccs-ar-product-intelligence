from fastapi import FastAPI, HTTPException, Response, Depends
from fastapi.middleware.cors import CORSMiddleware
from database import get_product
from qr import make_qr_png
from pathlib import Path

from fastapi.staticfiles import StaticFiles

from routers import products
import auth

app = FastAPI()

# Lets the app's browser version call this API during development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(products.router)

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

@app.get("/admin_test")
def admin_test(user=Depends(auth.require_admin)):
    return user