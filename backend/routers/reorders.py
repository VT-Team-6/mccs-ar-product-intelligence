"""Reorders, order requests and notifications.

Managers (manage_inventory) see their stores' low products with each one's
reorder status, and send them to buyers as order requests. A buyer lists the
requests sent to them and marks products ordered or unavailable. Everyone
signed in reads their own notifications.
"""

from fastapi import APIRouter, Depends, HTTPException, Query

import auth
import reorders
import stock
from auth import require_permission
from database import get_connection
from product_access import can_manage_store
from schemas import (
    ReorderCatalog,
    ReorderLine,
    MarkRead,
    MessageList,
    OrderRequest,
    OrderRequestListEntry,
    OrderRequestSend,
    OrderRequestUpdate,
    OrderRequestReassign,
    BuyerItem,
    ReorderGroup,
    ReorderList,
)

manager_router = APIRouter(prefix="/api/reorders", tags=["reorders"])
requests_router = APIRouter(prefix="/api/order-requests", tags=["reorders"])
messages_router = APIRouter(prefix="/api/messages", tags=["messages"])


def _require_store_access(user: dict, store_id: int) -> None:
    if not can_manage_store(user, store_id):
        raise HTTPException(403, "You don't manage this store")


def _http_error(error: stock.InventoryError) -> HTTPException:
    return HTTPException(status_code=error.status, detail=error.detail)


# --- managers --------------------------------------------------------------


@manager_router.get("", response_model=ReorderList)
def read_reorders(
    store_id: int = Query(gt=0),
    user=Depends(require_permission("manage_inventory")),
) -> dict:
    """The store's low products with their reorder status, and how many have each status."""
    _require_store_access(user, store_id)
    with get_connection() as conn:
        try:
            return {
                "products": reorders.list_products(conn, store_id),
                "counts": reorders.status_counts(conn, store_id),
            }
        except stock.InventoryError as error:
            raise _http_error(error) from error


@manager_router.get("/catalog", response_model=ReorderCatalog)
def read_reorder_catalog(
    store_id: int = Query(gt=0),
    user=Depends(require_permission("manage_inventory")),
) -> dict:
    """Every product on sale at the store, one row each, with its low sizes and reorder statuses."""
    _require_store_access(user, store_id)
    with get_connection() as conn:
        try:
            return reorders.catalog(conn, store_id)
        except stock.InventoryError as error:
            raise _http_error(error) from error


@manager_router.get("/lines", response_model=list[ReorderLine])
def read_reorder_lines(
    store_id: int = Query(gt=0),
    product_id: list[int] = Query(min_length=1, max_length=500),
    user=Depends(require_permission("manage_inventory")),
) -> list[dict]:
    """Every size/color of these products, for the send screen."""
    _require_store_access(user, store_id)
    with get_connection() as conn:
        try:
            return reorders.lines(conn, store_id, product_id)
        except stock.InventoryError as error:
            raise _http_error(error) from error


@manager_router.get("/groups", response_model=list[ReorderGroup])
def read_reorder_groups(
    store_id: int = Query(gt=0),
    user=Depends(require_permission("manage_inventory")),
) -> list[dict]:
    """Products that can be sent (needs reorder or unavailable), grouped by buyer."""
    _require_store_access(user, store_id)
    with get_connection() as conn:
        try:
            return reorders.reorder_groups(conn, store_id)
        except stock.InventoryError as error:
            raise _http_error(error) from error


@manager_router.post("/send")
def send_order_request(
    body: OrderRequestSend,
    user=Depends(require_permission("manage_inventory")),
) -> dict:
    """Send these products to one buyer as a single order request."""
    _require_store_access(user, body.store_id)
    with get_connection() as conn:
        try:
            return reorders.send_request(
                conn,
                body.store_id,
                body.buyer_user_id,
                [item.model_dump() for item in body.items],
                body.note,
                user["user_id"],
                remember_buyer=body.remember_buyer,
            )
        except stock.InventoryError as error:
            raise _http_error(error) from error


# --- order requests --------------------------------------------------------


def _is_request_buyer(request: dict, user: dict) -> bool:
    return (
        request["buyer_is_eligible"]
        and request["buyer_user_id"] == user["user_id"]
    )


def _request_for(conn, request_id: int, user: dict, *, lock: bool = False) -> dict:
    """The request, if this user is its buyer or a manager of its store."""
    if lock:
        # Reassignments and buyer responses must serialize on the same request.
        conn.execute("SELECT request_id FROM order_requests WHERE request_id = %s FOR UPDATE", (request_id,))
    request = reorders.get_request(conn, request_id)
    if request is None:
        raise HTTPException(404, "Order request not found")
    is_manager = "manage_inventory" in user["permissions"] and can_manage_store(user, request["store_id"])
    if not (is_manager or _is_request_buyer(request, user)):
        raise HTTPException(403, "This order request isn't yours")
    return request


@requests_router.get("", response_model=list[OrderRequestListEntry])
def read_order_requests(
    store_id: int | None = Query(default=None, gt=0),
    include_finished: bool = False,
    user=Depends(auth.require_authenticated_user),
) -> list[dict]:
    """Order requests, newest first: a store's (for its managers, with store_id)
    or the ones sent to the signed-in buyer."""
    if store_id is not None:
        if "manage_inventory" not in user["permissions"] or not can_manage_store(user, store_id):
            raise HTTPException(403, "You don't manage this store")
    elif user["role"] != "store_buyer":
        raise HTTPException(403, "Only buyers can list their assigned order requests")
    with get_connection() as conn:
        return reorders.list_requests(conn, user["user_id"], store_id, include_finished)


@requests_router.get("/items", response_model=list[BuyerItem])
def read_my_order_items(user=Depends(auth.require_authenticated_user)) -> list[dict]:
    """Every product in the signed-in buyer's unfinished order requests."""
    if user["role"] != "store_buyer":
        raise HTTPException(403, "Only buyers can list their assigned order items")
    with get_connection() as conn:
        return reorders.list_items_for_buyer(conn, user["user_id"])


@requests_router.get("/{request_id}", response_model=OrderRequest)
def read_order_request(request_id: int, user=Depends(auth.require_authenticated_user)) -> dict:
    with get_connection() as conn:
        request = _request_for(conn, request_id, user)
        reorders.mark_read(conn, user["user_id"], request_id=request_id)
        return request


@requests_router.post("/{request_id}/items", response_model=OrderRequest)
def update_order_request_items(
    request_id: int,
    body: OrderRequestUpdate,
    user=Depends(auth.require_authenticated_user),
) -> dict:
    """The buyer marks some of the request's products ordered or unavailable."""
    with get_connection() as conn:
        request = _request_for(conn, request_id, user, lock=True)
        if "manage_all_stores" not in user["permissions"] and not _is_request_buyer(request, user):
            raise HTTPException(403, "Only the buyer can update this order request")
        try:
            if body.alert_ids is None and not body.product_ids:
                raise HTTPException(422, "Pick at least one item")
            return reorders.update_items(
                conn, request, body.product_ids, body.status, body.reason, user,
                alert_ids=body.alert_ids,
            )
        except stock.InventoryError as error:
            raise _http_error(error) from error


@requests_router.put("/{request_id}/buyer", response_model=OrderRequest)
def reassign_order_request(
    request_id: int, body: OrderRequestReassign,
    user=Depends(require_permission("manage_inventory")),
) -> dict:
    with get_connection() as conn:
        request = _request_for(conn, request_id, user, lock=True)
        try:
            return reorders.reassign_request(conn, request, body.buyer_user_id, user["user_id"])
        except stock.InventoryError as error:
            raise _http_error(error) from error


# --- notifications ---------------------------------------------------------


@messages_router.get("", response_model=MessageList)
def read_messages(user=Depends(auth.require_authenticated_user)) -> dict:
    """The signed-in user's notifications, newest first, and how many are unread."""
    with get_connection() as conn:
        return {
            "messages": reorders.list_messages(conn, user["user_id"]),
            "unread": reorders.unread_count(conn, user["user_id"]),
            "unread_by_store": reorders.unread_by_store(conn, user["user_id"]),
        }


@messages_router.post("/read")
def mark_messages_read(body: MarkRead, user=Depends(auth.require_authenticated_user)) -> dict:
    with get_connection() as conn:
        marked = reorders.mark_read(
            conn, user["user_id"], body.message_ids, body.request_id, body.store_id
        )
    return {"marked": marked}
