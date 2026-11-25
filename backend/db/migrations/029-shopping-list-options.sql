-- Shopping list rows per color and size, with a quantity. A list can now hold
-- the Air Force 1 in White size 10 and in Black size 9 as separate rows; adding
-- the same product, color and size again adds to that row's quantity.
--   color:    the color picked, also when no size is (Black, any size)
--   quantity: how many, 1 to 99
ALTER TABLE shopping_list_items
    ADD COLUMN color    VARCHAR(40),
    ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 99);

UPDATE shopping_list_items i SET color = v.color
  FROM product_variants v WHERE v.variant_id = i.variant_id;

-- One row per product + size/color (variant) + color, instead of per product
ALTER TABLE shopping_list_items DROP CONSTRAINT uq_shopping_list_product;
CREATE UNIQUE INDEX uq_shopping_list_item
    ON shopping_list_items (shopping_list_id, product_id, (COALESCE(variant_id, 0)), (COALESCE(lower(color), '')));
