-- Reorder any size/color, not just low ones (a popular shoe before Black
-- Friday). A manager's order for a size that isn't low gets a 'manual' alert,
-- so it's tracked like the rest (requested -> ordered/unavailable) and shows on
-- the Reorders list. A low alert resolves when stock goes back above the level;
-- a manual one when stock rises above what it was when it was ordered (the
-- order arrived) or the product is taken off sale.
ALTER TABLE low_stock_alerts
    ADD COLUMN kind VARCHAR(10) NOT NULL DEFAULT 'low' CHECK (kind IN ('low', 'manual'));
