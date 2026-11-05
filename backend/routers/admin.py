from fastapi import APIRouter, Depends, HTTPException, Query, status

from auth import ROLE_PERMISSIONS, require_authenticated_user
from database import get_connection
from schemas import (
    StaffAccessUpdate,
    StaffOptions,
    StaffUser,
    StaffUserResults,
)

router = APIRouter(prefix="/api/admin", tags=["admin"])

def require_staff_manager(user=Depends(require_authenticated_user)):
    permissions = ROLE_PERMISSIONS.get(user["role"], set())

    if not permissions.intersection({
        "manage_store_buyers",
        "manage_store_admins",
    }):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Staff management access required",
        )

    return user

def _allowed_roles(user) -> list[str]:
    permissions = ROLE_PERMISSIONS.get(user["role"], set())
    roles = []

    if "manage_store_buyers" in permissions:
        roles.append("store_buyer")

    if "manage_store_admins" in permissions:
        roles.append("store_admin")

    return roles

def _store_scope(conn, user) -> tuple[bool, list[int]]:
    permissions = ROLE_PERMISSIONS.get(user["role"], set())
    all_stores = "manage_all_stores" in permissions

    rows = conn.execute(
        """
        SELECT store_id
        FROM user_stores
        WHERE user_id = %s
        ORDER BY store_id
        """,
        (user["user_id"],),
    ).fetchall()

    return all_stores, [row["store_id"] for row in rows]

_USER_SELECT = """
    SELECT
        u.user_id,
        u.email,
        u.role,
        ARRAY(
            SELECT us.store_id
            FROM user_stores us
            WHERE us.user_id = u.user_id
            ORDER BY us.store_id
        ) AS store_ids
    FROM users u
"""

def _read_user(conn, user_id: int):
    user = conn.execute(
        _USER_SELECT + " WHERE u.user_id = %s",
        (user_id,),
    ).fetchone()

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    return user

def _lock_target(conn, actor, user_id: int):
    if user_id == actor["user_id"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You cannot change your own staff access",
        )

    # Serialize staff changes for this user. All staff mutation endpoints
    # must take this lock before changing their role or assignments.
    target = conn.execute(
        """
        SELECT user_id, email, role
        FROM users
        WHERE user_id = %s
        FOR UPDATE
        """,
        (user_id,),
    ).fetchone()

    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    return target

def _check_target_access(conn, actor, target):
    # Check the existing role, not just the requested new role.
    if (
        target["role"] != "user"
        and target["role"] not in _allowed_roles(actor)
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You cannot manage this user's current role",
        )

    all_stores, manageable_ids = _store_scope(conn, actor)

    current = conn.execute(
        """
        SELECT store_id
        FROM user_stores
        WHERE user_id = %s
        """,
        (target["user_id"],),
    ).fetchall()

    current_ids = {row["store_id"] for row in current}

    # Role is global. Do not let a scoped admin change someone who also
    # holds assignments outside that admin's authority.
    if not all_stores and not current_ids.issubset(set(manageable_ids)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This user has assignments outside your store access",
        )

    return all_stores, manageable_ids

@router.get("/staff/options", response_model=StaffOptions)
def get_staff_options(user=Depends(require_staff_manager)):
    """Roles and stores the caller may assign."""
    with get_connection() as conn:
        all_stores, store_ids = _store_scope(conn, user)

        stores = conn.execute(
            """
            SELECT store_id, name, address
            FROM stores
            WHERE %s OR store_id = ANY(%s::integer[])
            ORDER BY name, store_id
            """,
            (all_stores, store_ids),
        ).fetchall()

    return {
        "allowed_roles": _allowed_roles(user),
        "stores": stores,
    }

@router.get("/staff/candidates", response_model=StaffUserResults)
def search_staff_candidates(
    q: str = Query(min_length=2, max_length=150),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user=Depends(require_staff_manager),
):
    """Find ordinary users who can be granted staff access."""
    query = q.strip()

    if len(query) < 2:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Enter at least two characters",
        )

    with get_connection() as conn:
        all_stores, store_ids = _store_scope(conn, user)

        # No stores means a scoped manager cannot assign anyone.
        if not all_stores and not store_ids:
            return {"users": [], "limit": limit, "offset": offset}

        users = conn.execute(
            _USER_SELECT + """
            WHERE u.role = 'user'
              AND u.user_id <> %s
              AND STRPOS(LOWER(u.email), LOWER(%s)) > 0
              AND (
                  %s OR NOT EXISTS (
                      SELECT 1
                      FROM user_stores us
                      WHERE us.user_id = u.user_id
                        AND NOT (
                            us.store_id = ANY(%s::integer[])
                        )
                  )
              )
            ORDER BY u.email, u.user_id
            LIMIT %s OFFSET %s
            """,
            (
                user["user_id"],
                query,
                all_stores,
                store_ids,
                limit,
                offset,
            ),
        ).fetchall()

    return {"users": users, "limit": limit, "offset": offset}

@router.get("/staff", response_model=StaffUserResults)
def list_staff(
    store_id: int | None = Query(default=None, gt=0),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user=Depends(require_staff_manager),
):
    """List staff whose role and complete assignments are manageable."""
    with get_connection() as conn:
        all_stores, store_ids = _store_scope(conn, user)

        if (
            store_id is not None
            and not all_stores
            and store_id not in store_ids
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You cannot manage this store",
            )

        users = conn.execute(
            _USER_SELECT + """
            WHERE u.user_id <> %s
              AND u.role = ANY(%s::text[])
              AND (
                  %s OR (
                      EXISTS (
                          SELECT 1
                          FROM user_stores us
                          WHERE us.user_id = u.user_id
                            AND us.store_id = ANY(%s::integer[])
                      )
                      AND NOT EXISTS (
                          SELECT 1
                          FROM user_stores us
                          WHERE us.user_id = u.user_id
                            AND NOT (
                                us.store_id = ANY(%s::integer[])
                            )
                      )
                  )
              )
              AND (
                  %s::integer IS NULL OR EXISTS (
                      SELECT 1
                      FROM user_stores us
                      WHERE us.user_id = u.user_id
                        AND us.store_id = %s
                  )
              )
            ORDER BY u.email, u.user_id
            LIMIT %s OFFSET %s
            """,
            (
                user["user_id"],
                _allowed_roles(user),
                all_stores,
                store_ids,
                store_ids,
                store_id,
                store_id,
                limit,
                offset,
            ),
        ).fetchall()

    return {"users": users, "limit": limit, "offset": offset}

@router.put("/staff/{user_id}", response_model=StaffUser)
def set_staff_access(
    user_id: int,
    body: StaffAccessUpdate,
    user=Depends(require_staff_manager),
):
    """Replace the target's complete role and store assignments."""
    with get_connection() as conn:
        target = _lock_target(conn, user, user_id)
        all_stores, manageable_ids = _check_target_access(
            conn, user, target
        )

        if body.role not in _allowed_roles(user):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You cannot assign this role",
            )

        requested_ids = set(body.store_ids)

        if (
            not all_stores
            and not requested_ids.issubset(set(manageable_ids))
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You cannot assign one or more of these stores",
            )

        # Lock selected stores against deletion until assignments are saved.
        existing = conn.execute(
            """
            SELECT store_id
            FROM stores
            WHERE store_id = ANY(%s::integer[])
            FOR KEY SHARE
            """,
            (body.store_ids,),
        ).fetchall()

        if {row["store_id"] for row in existing} != requested_ids:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="One or more stores do not exist",
            )

        conn.execute(
            """
            UPDATE users
            SET role = %s, updated_at = CURRENT_TIMESTAMP
            WHERE user_id = %s
            """,
            (body.role, user_id),
        )

        conn.execute(
            "DELETE FROM user_stores WHERE user_id = %s",
            (user_id,),
        )

        for store_id in body.store_ids:
            conn.execute(
                """
                INSERT INTO user_stores (user_id, store_id)
                VALUES (%s, %s)
                """,
                (user_id, store_id),
            )

        result = _read_user(conn, user_id)

    return result

@router.delete(
    "/staff/{user_id}/stores/{store_id}",
    response_model=StaffUser,
)
def remove_staff_assignment(
    user_id: int,
    store_id: int,
    user=Depends(require_staff_manager),
):
    """Remove one assignment; preserve the user's shopper account."""
    with get_connection() as conn:
        target = _lock_target(conn, user, user_id)
        all_stores, manageable_ids = _check_target_access(
            conn, user, target
        )

        if not all_stores and store_id not in manageable_ids:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You cannot manage this store",
            )

        deleted = conn.execute(
            """
            DELETE FROM user_stores
            WHERE user_id = %s AND store_id = %s
            RETURNING store_id
            """,
            (user_id, store_id),
        ).fetchone()

        if deleted is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Staff assignment not found",
            )

        remaining = conn.execute(
            "SELECT 1 FROM user_stores WHERE user_id = %s LIMIT 1",
            (user_id,),
        ).fetchone()

        conn.execute(
            """
            UPDATE users
            SET role = %s, updated_at = CURRENT_TIMESTAMP
            WHERE user_id = %s
            """,
            (target["role"] if remaining else "user", user_id),
        )

        result = _read_user(conn, user_id)

    return result