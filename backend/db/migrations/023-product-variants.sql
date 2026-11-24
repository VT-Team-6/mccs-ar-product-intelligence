-- Colors and sizes. A product (the Air Force 1, the coffee) has one or more
-- variants: one per color/size combination it comes in. Stock and price are
-- kept per variant per store.
--
-- Every product has at least one variant. A product with no options (most
-- headphones) has a single "default" variant with no color and no size, so
-- nothing ever needs a special case for products without options.
--
-- inventory stays one row per product per store. It still owns the store's
-- status (pending/active/discontinued), approval, buyer and low-stock level,
-- and its quantity and price become the product's totals: quantity is the sum
-- of the variants' stock and price is the lowest variant price ("from $90").
-- Triggers keep those totals in step, so search, recommendations and every
-- other product-level read keep working unchanged.

CREATE TABLE product_variants (
    variant_id  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id  INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    color       VARCHAR(40),
    -- The swatch shown for the color, e.g. #1A1A1A
    color_hex   VARCHAR(7) CHECK (color_hex IS NULL OR color_hex ~ '^#[0-9A-Fa-f]{6}$'),
    size        VARCHAR(20),
    -- Where the size sorts (7, 7.5, 8 ... or 12 oz, 24 oz), and where the color sorts
    size_order  INTEGER NOT NULL DEFAULT 0,
    color_order INTEGER NOT NULL DEFAULT 0,
    -- The stock-keeping unit staff and sales reports use, e.g. P12-BLACK-10.5
    sku         VARCHAR(60) NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_product_variant UNIQUE NULLS NOT DISTINCT (product_id, color, size)
);
CREATE INDEX idx_product_variants_product ON product_variants (product_id);

CREATE TABLE variant_stock (
    variant_id  INTEGER NOT NULL REFERENCES product_variants(variant_id) ON DELETE CASCADE,
    store_id    INTEGER NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
    quantity    INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    price       NUMERIC(10,2) CHECK (price >= 0),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (variant_id, store_id)
);
CREATE INDEX idx_variant_stock_store ON variant_stock (store_id);

-- Photos can belong to a color (shoes, backpacks, headphones) or a size
-- (coffee and shampoo packaging). Neither set means the photo is shared.
ALTER TABLE product_images
    ADD COLUMN color VARCHAR(40),
    ADD COLUMN size  VARCHAR(20);

-- Which size/color the shopper wants. NULL means any.
ALTER TABLE shopping_list_items
    ADD COLUMN variant_id INTEGER REFERENCES product_variants(variant_id) ON DELETE SET NULL;

-- Stock history, low-stock alerts and reorders are per variant. Removing a
-- color or size keeps their history (the variant becomes NULL there).
ALTER TABLE stock_changes
    ADD COLUMN variant_id INTEGER REFERENCES product_variants(variant_id) ON DELETE SET NULL;
ALTER TABLE low_stock_alerts
    ADD COLUMN variant_id INTEGER REFERENCES product_variants(variant_id) ON DELETE SET NULL;
ALTER TABLE order_request_items
    ADD COLUMN variant_id INTEGER REFERENCES product_variants(variant_id) ON DELETE SET NULL,
    -- The color and size as they were when ordered, kept if the variant is removed later
    ADD COLUMN color VARCHAR(40),
    ADD COLUMN size  VARCHAR(20);


-- ---------------------------------------------------------------------------
-- Keeping the tables in step
-- ---------------------------------------------------------------------------

-- A new product gets its default variant.
CREATE FUNCTION product_default_variant() RETURNS trigger AS $$
BEGIN
    INSERT INTO product_variants (product_id, sku) VALUES (NEW.product_id, 'P' || NEW.product_id)
    ON CONFLICT DO NOTHING;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_product_default_variant
    AFTER INSERT ON products
    FOR EACH ROW EXECUTE FUNCTION product_default_variant();

-- A product's totals at a store, from its variants.
CREATE FUNCTION refresh_inventory_totals(p_product_id INTEGER, p_store_id INTEGER) RETURNS void AS $$
    UPDATE inventory i
       SET quantity = t.quantity,
           price = COALESCE(t.price, i.price),
           updated_at = CURRENT_TIMESTAMP
      FROM (
        SELECT COALESCE(sum(vs.quantity), 0)::INTEGER AS quantity, min(vs.price) AS price
          FROM variant_stock vs
          JOIN product_variants v ON v.variant_id = vs.variant_id
         WHERE v.product_id = p_product_id AND vs.store_id = p_store_id
      ) t
     WHERE i.product_id = p_product_id AND i.store_id = p_store_id
       AND (i.quantity IS DISTINCT FROM t.quantity
            OR i.price IS DISTINCT FROM COALESCE(t.price, i.price));
$$ LANGUAGE sql;

CREATE FUNCTION variant_stock_changed() RETURNS trigger AS $$
DECLARE
    row_variant INTEGER := COALESCE(NEW.variant_id, OLD.variant_id);
    row_store   INTEGER := COALESCE(NEW.store_id, OLD.store_id);
    row_product INTEGER;
BEGIN
    SELECT product_id INTO row_product FROM product_variants WHERE variant_id = row_variant;
    IF row_product IS NOT NULL THEN
        PERFORM refresh_inventory_totals(row_product, row_store);
    END IF;
    RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_variant_stock_changed
    AFTER INSERT OR UPDATE OR DELETE ON variant_stock
    FOR EACH ROW EXECUTE FUNCTION variant_stock_changed();

-- A product added to a store gets a stock row for each of its variants. The
-- inventory row's quantity goes to its first variant (the only one, for a
-- product without options), so the product's total is unchanged.
CREATE FUNCTION inventory_added() RETURNS trigger AS $$
BEGIN
    INSERT INTO variant_stock (variant_id, store_id, quantity, price)
    SELECT v.variant_id, NEW.store_id,
           CASE WHEN row_number() OVER (ORDER BY v.color_order, v.size_order, v.variant_id) = 1
                THEN COALESCE(NEW.quantity, 0) ELSE 0 END,
           NEW.price
      FROM product_variants v
     WHERE v.product_id = NEW.product_id
    -- Leftover rows (inventory emptied with TRUNCATE, which skips the delete
    -- trigger) are reset, so a re-added product never brings back old counts
    ON CONFLICT (variant_id, store_id) DO UPDATE
        SET quantity = EXCLUDED.quantity, price = EXCLUDED.price, updated_at = CURRENT_TIMESTAMP;
    RETURN NULL;
END $$ LANGUAGE plpgsql;

-- A product taken out of a store takes its variants' stock there with it.
CREATE FUNCTION inventory_removed() RETURNS trigger AS $$
BEGIN
    DELETE FROM variant_stock vs
     USING product_variants v
     WHERE v.variant_id = vs.variant_id AND v.product_id = OLD.product_id
       AND vs.store_id = OLD.store_id;
    RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_inventory_removed
    AFTER DELETE ON inventory
    FOR EACH ROW EXECUTE FUNCTION inventory_removed();

-- TRUNCATE skips row triggers (TRUNCATE users CASCADE reaches inventory
-- through buyer_user_id), so empty the stock with it.
CREATE FUNCTION inventory_truncated() RETURNS trigger AS $$
BEGIN
    TRUNCATE variant_stock;
    RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_inventory_truncated
    AFTER TRUNCATE ON inventory
    FOR EACH STATEMENT EXECUTE FUNCTION inventory_truncated();

CREATE TRIGGER trg_inventory_added
    AFTER INSERT ON inventory
    FOR EACH ROW EXECUTE FUNCTION inventory_added();

-- A direct edit of a product's quantity or price (older code paths, tests,
-- "same price for all sizes") flows down to its variants:
--   * one variant: it gets the quantity and the price
--   * several: they all get the price; quantity has to be set per variant
-- Edits made by the totals refresh itself are skipped (trigger depth > 1).
CREATE FUNCTION inventory_edited() RETURNS trigger AS $$
DECLARE
    variants INTEGER;
BEGIN
    IF pg_trigger_depth() > 1 THEN
        RETURN NULL;
    END IF;
    SELECT count(*) INTO variants FROM product_variants WHERE product_id = NEW.product_id;
    IF variants = 1 THEN
        UPDATE variant_stock vs
           SET quantity = COALESCE(NEW.quantity, 0), price = NEW.price, updated_at = CURRENT_TIMESTAMP
          FROM product_variants v
         WHERE v.variant_id = vs.variant_id AND v.product_id = NEW.product_id
           AND vs.store_id = NEW.store_id;
    ELSIF NEW.price IS DISTINCT FROM OLD.price THEN
        UPDATE variant_stock vs
           SET price = NEW.price, updated_at = CURRENT_TIMESTAMP
          FROM product_variants v
         WHERE v.variant_id = vs.variant_id AND v.product_id = NEW.product_id
           AND vs.store_id = NEW.store_id;
    END IF;
    RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_inventory_edited
    AFTER UPDATE OF quantity, price ON inventory
    FOR EACH ROW EXECUTE FUNCTION inventory_edited();

-- A variant added to a product already in stores starts at 0 in each store,
-- at the product's current price there.
CREATE FUNCTION variant_added() RETURNS trigger AS $$
BEGIN
    INSERT INTO variant_stock (variant_id, store_id, quantity, price)
    SELECT NEW.variant_id, i.store_id, 0, i.price
      FROM inventory i
     WHERE i.product_id = NEW.product_id
    ON CONFLICT (variant_id, store_id) DO NOTHING;
    RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_variant_added
    AFTER INSERT ON product_variants
    FOR EACH ROW EXECUTE FUNCTION variant_added();


-- A removed variant takes its stock with it (ON DELETE CASCADE), but by then
-- the variant row is gone, so the stock trigger can't find the product. Refresh
-- the product's totals here instead.
CREATE FUNCTION variant_removed() RETURNS trigger AS $$
BEGIN
    PERFORM refresh_inventory_totals(OLD.product_id, i.store_id)
       FROM inventory i WHERE i.product_id = OLD.product_id;
    RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_variant_removed
    AFTER DELETE ON product_variants
    FOR EACH ROW EXECUTE FUNCTION variant_removed();


-- ---------------------------------------------------------------------------
-- Existing data: a default variant per product, carrying its stock
-- (runs again in seeds/007, after the seed data is loaded)
-- ---------------------------------------------------------------------------
INSERT INTO product_variants (product_id, sku)
SELECT product_id, 'P' || product_id FROM products
ON CONFLICT DO NOTHING;

INSERT INTO variant_stock (variant_id, store_id, quantity, price)
SELECT v.variant_id, i.store_id, COALESCE(i.quantity, 0), i.price
  FROM inventory i JOIN product_variants v ON v.product_id = i.product_id
ON CONFLICT (variant_id, store_id) DO NOTHING;

UPDATE stock_changes c SET variant_id = v.variant_id
  FROM product_variants v WHERE v.product_id = c.product_id AND c.variant_id IS NULL;
UPDATE low_stock_alerts a SET variant_id = v.variant_id
  FROM product_variants v WHERE v.product_id = a.product_id AND a.variant_id IS NULL;
UPDATE order_request_items r SET variant_id = v.variant_id
  FROM product_variants v WHERE v.product_id = r.product_id AND r.variant_id IS NULL;

-- Low-stock alerts are now one per variant per store, and a reorder lists
-- variants, so the keys move from product to variant.
DROP INDEX uq_low_stock_alerts_active;
CREATE UNIQUE INDEX uq_low_stock_alerts_active
    ON low_stock_alerts (variant_id, store_id) WHERE status <> 'resolved';
ALTER TABLE order_request_items DROP CONSTRAINT order_request_items_pkey;
ALTER TABLE order_request_items ADD PRIMARY KEY (request_id, alert_id);
