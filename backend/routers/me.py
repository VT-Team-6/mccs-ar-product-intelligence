"""User-only routes for the signed-in user's likes and product history.

The endpoints are intentionally thin: they take the caller's ``user_id`` from the
verified access token, hand it to ``user_products``, and translate a
``UserProductError`` into an HTTP response. No route accepts a user id from the
client, and no query in ``user_products`` can reach another user's rows.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status

import auth
import preferences
import store_selection
import user_products
from database import get_connection
from schemas import (
    HistoryItem,
    HistoryPage,
    InteractionCreate,
    LikedProduct,
    LikedProductPage,
    MyProduct,
    Preferences,
    StoreSelection,
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
    store_id: int | None = Query(default=None),
    user=Depends(auth.require_authenticated_user),
):
    """The product plus whether this user currently likes it."""
    with get_connection() as conn:
        resolved = store_selection.resolve_store_id(conn, user["user_id"], store_id)
        try:
            return user_products.get_product_for_user(
                conn, user["user_id"], product_id, resolved
            )
        except UserProductError as error:
            raise _http_error(error) from error


@router.get("/liked-products", response_model=LikedProductPage)
def list_liked_products(
    q: str | None = Query(default=None, max_length=100),
    sort: user_products.LikedSort = "recent",
    limit: int = Query(default=DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
    cursor: str | None = None,
    store_id: int | None = Query(default=None),
    user=Depends(auth.require_authenticated_user),
):
    """This user's Likes, newest first unless another sort is chosen."""
    with get_connection() as conn:
        resolved = store_selection.resolve_store_id(conn, user["user_id"], store_id)
        try:
            items, next_cursor = user_products.list_liked_products(
                conn, user["user_id"], q, sort, limit, cursor, resolved
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
    store_id: int | None = Query(default=None),
    user=Depends(auth.require_authenticated_user),
):
    """This user's interaction events, newest first. Repeats are expected."""
    with get_connection() as conn:
        resolved = store_selection.resolve_store_id(conn, user["user_id"], store_id)
        try:
            items, next_cursor = user_products.list_product_history(
                conn, user["user_id"], q, limit, cursor, resolved
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
    store_id: int | None = Query(default=None),
    user=Depends(auth.require_authenticated_user),
):
    """Like a product. Repeating this is a no-op and adds no extra history."""
    with get_connection() as conn:
        resolved = store_selection.resolve_store_id(conn, user["user_id"], store_id)
        try:
            return user_products.set_liked(conn, user["user_id"], product_id, True, resolved)
        except UserProductError as error:
            raise _http_error(error) from error


@router.delete("/liked-products/{product_id}", response_model=MyProduct)
def unlike_product(
    product_id: int,
    store_id: int | None = Query(default=None),
    user=Depends(auth.require_authenticated_user),
):
    """Remove a like. History keeps the earlier interaction."""
    with get_connection() as conn:
        resolved = store_selection.resolve_store_id(conn, user["user_id"], store_id)
        try:
            return user_products.set_liked(conn, user["user_id"], product_id, False, resolved)
        except UserProductError as error:
            raise _http_error(error) from error


@router.post(
    "/product-interactions",
    status_code=status.HTTP_201_CREATED,
)
def record_interaction(
    body: InteractionCreate,
    store_id: int | None = Query(default=None),
    user=Depends(auth.require_authenticated_user),
):
    """Record a user interaction with a product, stamped with the active store
    and the price at that store (clients do not send a store; the saved store
    applies)."""
    with get_connection() as conn:
        resolved = store_selection.resolve_store_id(conn, user["user_id"], store_id)
        try:
            return user_products.record_interaction(
                conn, user["user_id"], body.product_id, body.interaction, resolved
            )
        except UserProductError as error:
            raise _http_error(error) from error


@router.get("/store", response_model=StoreSelection)
def read_store(user=Depends(auth.require_authenticated_user)):
    """The shopper's active store, or null if they have not picked one."""
    with get_connection() as conn:
        return {
            "store_id": store_selection.get_selected_store(conn, user["user_id"])
        }


@router.put("/store", response_model=StoreSelection)
def save_store(
    body: StoreSelection,
    user=Depends(auth.require_authenticated_user),
):
    """Save the shopper's active store, clear it on null, or 404 if unknown."""
    with get_connection() as conn:
        if body.store_id is None:
            store_selection.clear_selected_store(conn, user["user_id"])
            return {"store_id": None}
        exists = conn.execute(
            "SELECT 1 FROM stores WHERE store_id = %s", (body.store_id,)
        ).fetchone()
        if exists is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Store {body.store_id} not found",
            )
        store_selection.save_selected_store(conn, user["user_id"], body.store_id)
        return {"store_id": body.store_id}


@router.get("/preferences", response_model=Preferences)
def read_preferences(user=Depends(auth.require_authenticated_user)):
    """This user's preferences, or the defaults if they have not saved any."""
    with get_connection() as conn:
        return preferences.get_preferences(conn, user["user_id"])


@router.put("/preferences", response_model=Preferences)
def save_preferences(
    body: Preferences,
    user=Depends(auth.require_authenticated_user),
):
    """Replace this user's preferences. Sending the same values again is a no-op."""
    with get_connection() as conn:
        return preferences.save_preferences(
            conn, user["user_id"], body.model_dump()
        )