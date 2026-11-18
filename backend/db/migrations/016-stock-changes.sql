-- Every change to a product's stock at a store: who changed it, when, from what
-- to what, and how. Low-stock alerts and replenishment build on this log.
--
-- source says how the change was made: 'csv' from the end-of-day stock import,
-- 'manual' from editing one product in the app.
CREATE TABLE stock_changes (
    change_id     INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id    INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    store_id      INTEGER NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
    old_quantity  INTEGER,
    new_quantity  INTEGER NOT NULL CHECK (new_quantity >= 0),
    source        VARCHAR(10) NOT NULL CHECK (source IN ('csv', 'manual')),
    changed_by    INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    changed_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_stock_changes_store ON stock_changes(store_id, changed_at DESC);
