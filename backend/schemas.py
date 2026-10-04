from datetime import datetime

from pydantic import BaseModel, Field


class ProductCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    product_type: str = Field(min_length=1, max_length=100)
    brand: str | None = Field(default=None, max_length=100)
    price: float | None = Field(default=None, ge=0)
    rating: float | None = Field(default=None, ge=0, le=5)
    description: str | None = None


class ProductUpdate(BaseModel):
    """Partial update: omitted fields keep their current value."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    product_type: str | None = Field(default=None, min_length=1, max_length=100)
    brand: str | None = Field(default=None, max_length=100)
    price: float | None = Field(default=None, ge=0)
    rating: float | None = Field(default=None, ge=0, le=5)
    description: str | None = None


class Product(BaseModel):
    product_id: int
    name: str
    brand: str | None
    price: float | None
    product_type: str
    rating: float | None
    description: str | None
    created_at: datetime
    updated_at: datetime
