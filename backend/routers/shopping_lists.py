from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

import auth
import shopping_lists
from database import get_connection

router = APIRouter(
    prefix="/api/me/shopping-lists",
    tags=["shopping-lists"],
)

class CreateShoppingList(BaseModel):
    name: str = Field(min_length=1, max_length=100)

class AddShoppingListItem(BaseModel):
    product_id: int = Field(gt=0)
    # The color/size picked on the product page; None means any
    variant_id: int | None = Field(default=None, gt=0)

class UpdateShoppingListItem(BaseModel):
    is_completed: bool

class ScannedProduct(BaseModel):
    product_id: int = Field(gt=0)

def _http_error(error: shopping_lists.ShoppingListError):
    return HTTPException(
        status_code=error.status,
        detail=error.detail,
    )

@router.get("")
def read_lists(
    user=Depends(auth.require_authenticated_user),
):
    """List all shopping lists belonging to the signed-in customer."""
    with get_connection() as conn:
        return shopping_lists.list_lists(conn, user["user_id"])

@router.post("", status_code=status.HTTP_201_CREATED)
def create_list(
    body: CreateShoppingList,
    user=Depends(auth.require_authenticated_user),
):
    """Create a named shopping list."""
    with get_connection() as conn:
        try:
            return shopping_lists.create_list(
                conn, user["user_id"], body.name
            )
        except shopping_lists.ShoppingListError as error:
            raise _http_error(error) from error

# The two /active routes come before /{list_id}, so "active" is never read as a list id.

@router.post("/active/scan")
def check_off_scanned(
    body: ScannedProduct,
    user=Depends(auth.require_authenticated_user),
):
    """After a scan, check the product off the active list if it is on it."""
    with get_connection() as conn:
        return shopping_lists.check_off_scanned(
            conn, user["user_id"], body.product_id
        )

@router.get("/active/products/{product_id}")
def read_active_status(
    product_id: int,
    user=Depends(auth.require_authenticated_user),
):
    """Whether a product is on the active list, and if it's checked off."""
    with get_connection() as conn:
        return shopping_lists.active_list_status(
            conn, user["user_id"], product_id
        )

@router.get("/{list_id}")
def read_list(
    list_id: int,
    user=Depends(auth.require_authenticated_user),
):
    """Retrieve an owned list with all its products."""
    with get_connection() as conn:
        try:
            return shopping_lists.get_list(
                conn, user["user_id"], list_id
            )
        except shopping_lists.ShoppingListError as error:
            raise _http_error(error) from error

@router.put("/{list_id}/activate")
def activate_list(
    list_id: int,
    user=Depends(auth.require_authenticated_user),
):
    """Select the customer's active shopping list."""
    with get_connection() as conn:
        try:
            return shopping_lists.activate_list(
                conn, user["user_id"], list_id
            )
        except shopping_lists.ShoppingListError as error:
            raise _http_error(error) from error

@router.post("/{list_id}/items")
def add_item(
    list_id: int,
    body: AddShoppingListItem,
    user=Depends(auth.require_authenticated_user),
):
    """Add an existing MCCS catalog product."""
    with get_connection() as conn:
        try:
            return shopping_lists.add_item(
                conn,
                user["user_id"],
                list_id,
                body.product_id,
                body.variant_id,
            )
        except shopping_lists.ShoppingListError as error:
            raise _http_error(error) from error

@router.patch("/{list_id}/items/{product_id}")
def update_item(
    list_id: int,
    product_id: int,
    body: UpdateShoppingListItem,
    user=Depends(auth.require_authenticated_user),
):
    """Manually check or uncheck a product."""
    with get_connection() as conn:
        try:
            return shopping_lists.set_item_completion(
                conn,
                user["user_id"],
                list_id,
                product_id,
                body.is_completed,
            )
        except shopping_lists.ShoppingListError as error:
            raise _http_error(error) from error

@router.delete("/{list_id}/items/{product_id}")
def delete_item(
    list_id: int,
    product_id: int,
    user=Depends(auth.require_authenticated_user),
):
    """Remove an item and return the updated list."""
    with get_connection() as conn:
        try:
            return shopping_lists.remove_item(
                conn,
                user["user_id"],
                list_id,
                product_id,
            )
        except shopping_lists.ShoppingListError as error:
            raise _http_error(error) from error
