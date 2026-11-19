from fastapi import APIRouter, Depends, HTTPException, Query

from auth import require_authenticated_user
from database import get_connection
from product_access import can_manage_store
from schemas import StaffAccessUpdate, StaffAssignment, StaffOptions, StaffUser, StaffUserResults

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _allowed_roles(user) -> list[str]:
    roles = []
    if "manage_store_staff" in user["permissions"]:
        roles.extend(["store_clerk", "store_buyer"])
    if "manage_store_admins" in user["permissions"]:
        roles.append("store_admin")
    return roles


def require_staff_manager(user=Depends(require_authenticated_user)):
    if not _allowed_roles(user):
        raise HTTPException(403, "Staff management access required")
    return user


def _require_store(conn, user, store_id):
    if not can_manage_store(user, store_id):
        raise HTTPException(403, "You cannot manage this store")
    if conn.execute(
        "SELECT 1 FROM stores WHERE store_id = %s FOR KEY SHARE", (store_id,),
    ).fetchone() is None:
        raise HTTPException(404, "Store not found")


def _lock_target(conn, user, user_id):
    if user_id == user["user_id"]:
        raise HTTPException(403, "You cannot change your own staff access")
    target = conn.execute(
        "SELECT user_id, email, role FROM users WHERE user_id = %s FOR UPDATE",
        (user_id,),
    ).fetchone()
    if target is None:
        raise HTTPException(404, "User not found")
    if target["role"] != "user" and target["role"] not in _allowed_roles(user):
        raise HTTPException(403, "You cannot manage this user's current role")
    return target


@router.get("/staff/options", response_model=StaffOptions)
def get_staff_options(user=Depends(require_staff_manager)):
    with get_connection() as conn:
        stores = conn.execute(
            "SELECT store_id, name, address FROM stores"
            " WHERE %s OR store_id = ANY(%s::integer[]) ORDER BY name, store_id",
            ("manage_all_stores" in user["permissions"], user["store_ids"]),
        ).fetchall()
    return {"stores": [{**store, "allowed_roles": _allowed_roles(user)} for store in stores]}


@router.get("/staff/candidates", response_model=StaffUserResults)
def search_staff_candidates(
    store_id: int = Query(gt=0),
    q: str = Query(min_length=2, max_length=150),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user=Depends(require_staff_manager),
):
    query = q.strip()
    if len(query) < 2:
        raise HTTPException(422, "Enter at least two characters")
    with get_connection() as conn:
        _require_store(conn, user, store_id)
        users = conn.execute(
            """
            SELECT u.user_id, u.email, u.role FROM users u
            WHERE u.user_id <> %s
              AND (u.role = 'user' OR u.role = ANY(%s::text[]))
              AND STRPOS(LOWER(u.email), LOWER(%s)) > 0
              AND NOT EXISTS (
                  SELECT 1 FROM user_stores us
                  WHERE us.user_id = u.user_id AND us.store_id = %s
              )
              AND (u.role <> 'user' OR %s OR NOT EXISTS (
                  SELECT 1 FROM user_stores us WHERE us.user_id = u.user_id
                    AND NOT (us.store_id = ANY(%s::integer[]))
              ))
            ORDER BY u.email, u.user_id LIMIT %s OFFSET %s
            """,
            (user["user_id"], _allowed_roles(user), query, store_id,
             "manage_all_stores" in user["permissions"], user["store_ids"], limit, offset),
        ).fetchall()
    return {"users": users, "limit": limit, "offset": offset}


@router.get("/staff", response_model=StaffUserResults)
def list_staff(
    store_id: int = Query(gt=0),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user=Depends(require_staff_manager),
):
    with get_connection() as conn:
        _require_store(conn, user, store_id)
        users = conn.execute(
            "SELECT u.user_id, u.email, u.role FROM users u"
            " JOIN user_stores us USING (user_id)"
            " WHERE us.store_id = %s AND u.user_id <> %s AND u.role = ANY(%s::text[])"
            " ORDER BY u.email, u.user_id LIMIT %s OFFSET %s",
            (store_id, user["user_id"], _allowed_roles(user), limit, offset),
        ).fetchall()
    return {"users": users, "limit": limit, "offset": offset}


@router.put("/staff/{user_id}/stores/{store_id}", response_model=StaffAssignment)
def set_staff_access(
    user_id: int,
    store_id: int,
    body: StaffAccessUpdate,
    user=Depends(require_staff_manager),
):
    """Assign one store, preserving all other assignments. The role is global."""
    with get_connection() as conn:
        _require_store(conn, user, store_id)
        target = _lock_target(conn, user, user_id)
        if body.role not in _allowed_roles(user):
            raise HTTPException(403, "You cannot assign this role")
        if body.role != target["role"] and "manage_all_stores" not in user["permissions"]:
            outside = conn.execute(
                "SELECT 1 FROM user_stores WHERE user_id = %s"
                " AND NOT (store_id = ANY(%s::integer[])) LIMIT 1",
                (user_id, user["store_ids"]),
            ).fetchone()
            if outside:
                raise HTTPException(403, "Changing the global role would affect stores you do not manage")
        conn.execute(
            "UPDATE users SET role = %s, updated_at = CURRENT_TIMESTAMP WHERE user_id = %s",
            (body.role, user_id),
        )
        conn.execute(
            "INSERT INTO user_stores (user_id, store_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
            (user_id, store_id),
        )
    return {**target, "role": body.role, "store_id": store_id}


@router.delete("/staff/{user_id}/stores/{store_id}", response_model=StaffUser)
def remove_staff_assignment(user_id: int, store_id: int, user=Depends(require_staff_manager)):
    """Remove one store; return to shopper only when the last assignment is removed."""
    with get_connection() as conn:
        _require_store(conn, user, store_id)
        _lock_target(conn, user, user_id)
        deleted = conn.execute(
            "DELETE FROM user_stores WHERE user_id = %s AND store_id = %s RETURNING store_id",
            (user_id, store_id),
        ).fetchone()
        if deleted is None:
            raise HTTPException(404, "Staff assignment not found")
        result = conn.execute(
            "UPDATE users SET role = CASE WHEN EXISTS ("
            " SELECT 1 FROM user_stores WHERE user_id = %s) THEN role ELSE 'user' END,"
            " updated_at = CURRENT_TIMESTAMP WHERE user_id = %s RETURNING user_id, email, role",
            (user_id, user_id),
        ).fetchone()
    return result
