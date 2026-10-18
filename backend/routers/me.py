"""User-only routes for the signed-in user's likes and product history.

The endpoints are intentionally thin: they take the caller's ``user_id`` from the
verified access token, hand it to ``user_products``, and translate a
``UserProductError`` into an HTTP response. No route accepts a user id from the
client, and no query in ``user_products`` can reach another user's rows.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status

import auth
import user_products
from database import get_connection
from schemas import (
    HistoryItem,
    HistoryPage,
    InteractionCreate,
    LikedProduct,
    LikedProductPage,
    MyProduct,
)
from user_products import UserProductError

router = APIRouter(prefix="/api/me", tags=["me"])

DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 100


def _http_error(error: UserProductError) -> HTTPException:
    """Translate a service problem into the HTTP response the client sees."""
    return HTTPException(status_code=error.status, detail=error.detail)


@router.get("/products/{product_id}", response_model=MyProduct)
def read_my_product(
    product_id: int,
    user=Depends(auth.require_authenticated_user),
):
    """The product plus whether this user currently likes it."""
    with get_connection() as conn:
        try:
            return user_products.get_product_for_user(
                conn, user["user_id"], product_id
            )
        except UserProductError as error:
            raise _http_error(error) from error


@router.get("/liked-products", response_model=LikedProductPage)
def list_liked_products(
    q: str | None = Query(default=None, max_length=100),
    sort: user_products.LikedSort = "recent",
    limit: int = Query(default=DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
    cursor: str | None = None,
    user=Depends(auth.require_authenticated_user),
):
    """This user's Likes, newest first unless another sort is chosen."""
    with get_connection() as conn:
        try:
            items, next_cursor = user_products.list_liked_products(
                conn, user["user_id"], q, sort, limit, cursor
            )
        except UserProductError as error:
            raise _http_error(error) from error
    return LikedProductPage(
        items=[LikedProduct(**item) for item in items],
        next_cursor=next_cursor,
    )


@router.get("/product-history", response_model=HistoryPage)
def list_product_history(
    q: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
    cursor: str | None = None,
    user=Depends(auth.require_authenticated_user),
):
    """This user's interaction events, newest first. Repeats are expected."""
    with get_connection() as conn:
        try:
            items, next_cursor = user_products.list_product_history(
                conn, user["user_id"], q, limit, cursor
            )
        except UserProductError as error:
            raise _http_error(error) from error
    return HistoryPage(
        items=[HistoryItem(**item) for item in items],
        next_cursor=next_cursor,
    )


@router.put("/liked-products/{product_id}", response_model=MyProduct)
def like_product(
    product_id: int,
    user=Depends(auth.require_authenticated_user),
):
    """Like a product. Repeating this is a no-op and adds no extra history."""
    with get_connection() as conn:
        try:
            return user_products.set_liked(conn, user["user_id"], product_id, True)
        except UserProductError as error:
            raise _http_error(error) from error


@router.delete("/liked-products/{product_id}", response_model=MyProduct)
def unlike_product(
    product_id: int,
    user=Depends(auth.require_authenticated_user),
):
    """Remove a like. History keeps the earlier interaction."""
    with get_connection() as conn:
        try:
            return user_products.set_liked(conn, user["user_id"], product_id, False)
        except UserProductError as error:
            raise _http_error(error) from error


@router.post(
    "/product-interactions",
    status_code=status.HTTP_201_CREATED,
)
def record_interaction(
    body: InteractionCreate,
    user=Depends(auth.require_authenticated_user),
):
    """Record a user interaction with a product."""
    with get_connection() as conn:
        try:
            return user_products.record_interaction(
                conn, user["user_id"], body.product_id, body.interaction
            )
        except UserProductError as error:
            raise _http_error(error) from error
