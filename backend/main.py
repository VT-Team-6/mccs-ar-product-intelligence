from fastapi import FastAPI, HTTPException, Response

from database import get_product
from qr import make_qr_png

from routers import products

app = FastAPI()

app.include_router(products.router)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/products/{product_id}/qr")
def product_qr(product_id: int):
    # Only make a code for a product that actually exists
    if get_product(product_id) is None:
        raise HTTPException(status_code=404, detail="Product not found")
    return Response(content=make_qr_png(product_id), media_type="image/png")