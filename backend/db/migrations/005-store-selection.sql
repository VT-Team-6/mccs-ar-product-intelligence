-- Store selection: the product is global; price and availability are local.
--
-- products.price is dropped: per-store inventory.price is the only source of
-- truth. 001-init.sql always said the column was temporary ("moves to inventory
-- when per-store pricing is added"); this migration is what retires it. Editing
-- 001 instead would only change fresh databases, so existing dev databases
-- would keep the column and every select would break in one environment and
-- not another.

ALTER TABLE products DROP COLUMN price;

-- The store a shopper is currently shopping at, if they picked one.
-- One row per user. Losing a store clears the *current* selection (the client
-- falls back to "no store selected") but must not rewrite anything else, hence
-- ON DELETE CASCADE — unlike user_product_history.store_id below.
CREATE TABLE user_store_selection (
    user_id    INTEGER PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
    store_id   INTEGER NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- History is an audit trail: deleting a store must not delete or block past
-- events, so the store reference becomes NULL instead (ON DELETE SET NULL).
-- price_at_interaction snapshots what the shopper saw, when a store was active.
ALTER TABLE user_product_history
    ADD COLUMN store_id INT REFERENCES stores(store_id) ON DELETE SET NULL,
    ADD COLUMN price_at_interaction NUMERIC(10, 2);

-- A NULL quantity is indistinguishable from 0 for availability, so three-valued
-- logic only exists to be forgotten: quantity is now NOT NULL DEFAULT 0.
-- Seeded rows all carry a literal quantity, so this constraint holds everywhere.
ALTER TABLE inventory ALTER COLUMN quantity SET DEFAULT 0;
ALTER TABLE inventory ALTER COLUMN quantity SET NOT NULL;
