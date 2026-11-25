-- A color/size can be discontinued at a store on its own (e.g. drop the Black
-- colorway, keep White). Discontinued ones are hidden from shoppers, skipped
-- for low-stock alerts and reorders, and left out of the product's totals.
ALTER TABLE variant_stock
    ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'discontinued'));

CREATE OR REPLACE FUNCTION refresh_inventory_totals(p_product_id INTEGER, p_store_id INTEGER) RETURNS void AS $$
    UPDATE inventory i
       SET quantity = t.quantity,
           price = COALESCE(t.price, i.price),
           updated_at = CURRENT_TIMESTAMP
      FROM (
        SELECT COALESCE(sum(vs.quantity), 0)::INTEGER AS quantity, min(vs.price) AS price
          FROM variant_stock vs
          JOIN product_variants v ON v.variant_id = vs.variant_id
         WHERE v.product_id = p_product_id AND vs.store_id = p_store_id
           AND vs.status = 'active'
      ) t
     WHERE i.product_id = p_product_id AND i.store_id = p_store_id
       AND (i.quantity IS DISTINCT FROM t.quantity
            OR i.price IS DISTINCT FROM COALESCE(t.price, i.price));
$$ LANGUAGE sql;
