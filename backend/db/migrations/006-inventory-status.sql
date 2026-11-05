-- Inventory lifecycle: a product goes to a store as pending, is approved to
-- active, and can be discontinued there.

ALTER TABLE inventory
    ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('pending', 'active', 'discontinued'));

-- Only a pending entry may have no price: the store sets it when it approves.
ALTER TABLE inventory ALTER COLUMN price DROP NOT NULL;

-- Replaces the lost NOT NULL for every other status, so an active or
-- discontinued entry can never lose its price.
ALTER TABLE inventory
    ADD CONSTRAINT inventory_active_requires_price
    CHECK (status = 'pending' OR price IS NOT NULL);

ALTER TABLE inventory
    ADD COLUMN approved_at TIMESTAMPTZ,
    -- Foreign key would cause circular dependency with users table, so we just store the ID.
    ADD COLUMN approved_by INTEGER;

-- The pending queue and the public stock reads both filter on status.
CREATE INDEX idx_inventory_store_status ON inventory (store_id, status);
