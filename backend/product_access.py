"""Who may change a product: the app admin, or an admin of the store that added it."""

from fastapi import HTTPException, status


def can_manage_store(user: dict, store_id: int) -> bool:
    return "manage_all_stores" in user["permissions"] or store_id in user["store_ids"]


def require_product_owner(conn, user: dict, product_id: int) -> None:
    """404 if the product doesn't exist, 403 if this user can't change it."""
    row = conn.execute(
        "SELECT created_by_store_id FROM products WHERE product_id = %s",
        (product_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Product {product_id} not found",
        )
    if "manage_products" in user["permissions"]:
        return
    owner = row["created_by_store_id"]
    if owner is None or owner not in user["store_ids"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the store that added this product can change it",
        )
