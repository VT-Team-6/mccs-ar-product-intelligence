-- Low-stock level and buyer for each product at each store.
--
-- low_stock_threshold: the product counts as low on stock at this store when
-- its quantity is at or below this number.
-- buyer_user_id: the store buyer who restocks it here. Empty until a manager
-- assigns one.
--
-- Both live on the store's inventory row, so each store sets its own. The bulk
-- editor and the single-product screen both write these same columns.
ALTER TABLE inventory
    ADD COLUMN low_stock_threshold INTEGER NOT NULL DEFAULT 10
        CHECK (low_stock_threshold >= 0),
    ADD COLUMN buyer_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL;
