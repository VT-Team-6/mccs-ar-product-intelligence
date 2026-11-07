-- Product ownership: a product a store adds belongs to that store, so any
-- admin of the store can edit it. NULL means an MCCS catalog product, which
-- only the app admin edits. If the store is deleted, the app admin takes over.
ALTER TABLE products
    ADD COLUMN created_by_store_id INTEGER REFERENCES stores(store_id) ON DELETE SET NULL;
