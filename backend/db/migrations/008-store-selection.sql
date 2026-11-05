-- Store selection: the product is global; price and availability are local.

-- products.price is dropped: per-store inventory.price is the only source of
-- truth.
ALTER TABLE products DROP COLUMN price;

-- The store a shopper is currently shopping at, if they picked one.
-- One row per user. On store deletion, fallsback to NULL (no store selected).
CREATE TABLE user_store_selection (
    user_id    INTEGER PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
    store_id   INTEGER NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- store deletion keeps history rows, setting store_id to NULL to preserve history.
ALTER TABLE user_product_history
    ADD COLUMN store_id INT REFERENCES stores(store_id) ON DELETE SET NULL,
    ADD COLUMN price_at_interaction NUMERIC(10, 2);

-- require quantity to have value.
ALTER TABLE inventory ALTER COLUMN quantity SET DEFAULT 0;
ALTER TABLE inventory ALTER COLUMN quantity SET NOT NULL;
