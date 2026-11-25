-- A color/size can have its own low-stock level at a store (popular sizes
-- run out faster). NULL means it uses the product's level on inventory.
ALTER TABLE variant_stock
    ADD COLUMN low_stock_threshold INTEGER CHECK (low_stock_threshold >= 0);
