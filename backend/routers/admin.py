from fastapi import APIRouter, Depends, HTTPException, Query

from auth import get_user_access, require_authenticated_user
from database import get_connection
from schemas import (
    StaffAccessUpdate, StaffAssignment, StaffAssignmentResults,
    StaffOptions, StaffUserResults,
)

router = APIRouter(prefix="/api/admin", tags=["admin"])


def require_staff_manager(user=Depends(require_authenticated_user)):
    if not {"manage_store_buyers", "manage_store_admins"}.intersection(user["permissions"]):
        raise HTTPException(403, "Staff management access required")
    return user


def _allowed_roles(actor, store_id):
    if actor["role"] == "system_admin":
        return ["store_buyer", "store_admin"]
    if actor["role"] == "store_admin" and store_id in actor["store_ids"]:
        return ["store_buyer"]
    raise HTTPException(403, "You cannot manage staff at this store")


def _actor(conn, user, target_id=None):
    # Lock actor and target in a consistent order on writes. This also makes
    # revocations and simultaneous assignment changes serialize safely.
    if target_id is not None:
        rows = conn.execute(
            "SELECT user_id, email, role FROM users WHERE user_id = ANY(%s) "
            "ORDER BY user_id FOR UPDATE",
            ([user["user_id"], target_id],),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT user_id, email, role FROM users WHERE user_id = %s",
            (user["user_id"],),
        ).fetchall()
    current = next((r for r in rows if r["user_id"] == user["user_id"]), None)
    if current is None:
        raise HTTPException(403, "Staff management access required")
    return get_user_access(conn, current)


def _check_store(conn, store_id):
    if conn.execute(
        "SELECT store_id FROM stores WHERE store_id = %s FOR KEY SHARE", (store_id,)
    ).fetchone() is None:
        raise HTTPException(404, "Store not found")


def _check_target(conn, actor, user_id, store_id, allowed):
    if user_id == actor["user_id"]:
        raise HTTPException(403, "You cannot change your own staff access")
    target = conn.execute(
        "SELECT role, email FROM users WHERE user_id = %s", (user_id,)
    ).fetchone()
    if target is None:
        raise HTTPException(404, "User not found")
    if target["role"] != "user" and target["role"] not in allowed:
        raise HTTPException(403, "You cannot manage this user's current role")
    assignment = conn.execute(
        "SELECT store_id FROM user_stores WHERE user_id = %s AND store_id = %s",
        (user_id, store_id),
    ).fetchone()
    return target, assignment


@router.get("/staff/options", response_model=StaffOptions)
def get_staff_options(user=Depends(require_staff_manager)):
    with get_connection() as conn:
        actor = _actor(conn, user)
        all_stores = actor["role"] == "system_admin"
        ids = actor["store_ids"] if actor["role"] == "store_admin" else []
        stores = conn.execute(
            "SELECT store_id, name, address FROM stores "
            "WHERE %s OR store_id = ANY(%s::integer[]) ORDER BY name, store_id",
            (all_stores, ids),
        ).fetchall()
        return {"stores": [
            {**store, "allowed_roles": _allowed_roles(actor, store["store_id"])}
            for store in stores
        ]}


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
        actor = _actor(conn, user)
        allowed = _allowed_roles(actor, store_id)
        _check_store(conn, store_id)
        # Staff at other stores remain eligible. Only an assignment at the
        # selected store excludes someone from the Add search.
        users = conn.execute(
            """
            SELECT u.user_id, u.email, u.role FROM users u
            WHERE (u.role = 'user' OR u.role = ANY(%s::text[])) AND u.user_id <> %s
              AND STRPOS(LOWER(u.email), LOWER(%s)) > 0
              AND NOT EXISTS (
                  SELECT 1 FROM user_stores us
                  WHERE us.user_id = u.user_id AND us.store_id = %s
              )
            ORDER BY u.email, u.user_id LIMIT %s OFFSET %s
            """,
            (allowed, actor["user_id"], query, store_id, limit, offset),
        ).fetchall()
    return {"users": users, "limit": limit, "offset": offset}


@router.get("/staff", response_model=StaffAssignmentResults)
def list_staff(
    store_id: int = Query(gt=0),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user=Depends(require_staff_manager),
):
    with get_connection() as conn:
        actor = _actor(conn, user)
        allowed = _allowed_roles(actor, store_id)
        _check_store(conn, store_id)
        assignments = conn.execute(
            """
            SELECT u.user_id, u.email, us.store_id, u.role
            FROM user_stores us JOIN users u ON u.user_id = us.user_id
            WHERE us.store_id = %s AND u.role = ANY(%s::text[])
              AND u.user_id <> %s
            ORDER BY u.email, u.user_id LIMIT %s OFFSET %s
            """,
            (store_id, allowed, actor["user_id"], limit, offset),
        ).fetchall()
    return {"assignments": assignments, "limit": limit, "offset": offset}


@router.put("/staff/{user_id}/stores/{store_id}", response_model=StaffAssignment)
def set_staff_access(
    body: StaffAccessUpdate,
    user_id: int,
    store_id: int,
    user=Depends(require_staff_manager),
):
    with get_connection() as conn:
        actor = _actor(conn, user, target_id=user_id)
        allowed = _allowed_roles(actor, store_id)
        _check_store(conn, store_id)
        target, _ = _check_target(conn, actor, user_id, store_id, allowed)
        if body.role not in allowed:
            raise HTTPException(403, "You cannot assign this role")
        if target["role"] != body.role and actor["role"] != "system_admin":
            outside_scope = conn.execute(
                "SELECT 1 FROM user_stores WHERE user_id = %s "
                "AND NOT (store_id = ANY(%s::integer[])) LIMIT 1",
                (user_id, actor["store_ids"]),
            ).fetchone()
            if outside_scope:
                raise HTTPException(403, "Changing this global role requires a system admin because the user has assignments outside your stores")
        conn.execute(
            """
            INSERT INTO user_stores (user_id, store_id) VALUES (%s, %s)
            ON CONFLICT (user_id, store_id) DO NOTHING
            """,
            (user_id, store_id),
        )
        conn.execute(
            "UPDATE users SET role = %s, updated_at = CURRENT_TIMESTAMP WHERE user_id = %s",
            (body.role, user_id),
        )
        email = target["email"]
    return {"user_id": user_id, "email": email, "store_id": store_id, "role": body.role}


@router.delete("/staff/{user_id}/stores/{store_id}", response_model=StaffAssignment)
def remove_staff_assignment(
    user_id: int,
    store_id: int,
    user=Depends(require_staff_manager),
):
    with get_connection() as conn:
        actor = _actor(conn, user, target_id=user_id)
        allowed = _allowed_roles(actor, store_id)
        _check_store(conn, store_id)
        target, assignment = _check_target(conn, actor, user_id, store_id, allowed)
        if assignment is None:
            raise HTTPException(404, "Staff assignment not found")
        email = target["email"]
        conn.execute(
            "DELETE FROM user_stores WHERE user_id = %s AND store_id = %s",
            (user_id, store_id),
        )
        remaining = conn.execute(
            "SELECT 1 FROM user_stores WHERE user_id = %s LIMIT 1", (user_id,),
        ).fetchone()
        if remaining is None:
            conn.execute(
                "UPDATE users SET role = 'user', updated_at = CURRENT_TIMESTAMP WHERE user_id = %s",
                (user_id,),
            )
    return {"user_id": user_id, "email": email, "store_id": store_id, "role": target["role"]}
