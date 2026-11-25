-- Colors and sizes for the seeded catalog (see migrations/023-product-variants.sql).
--
--   * shoes: sizes 7 to 12; a few also come in a second or third color
--   * coffee and shampoo: the size in the product name plus a bigger bag/bottle,
--     and the size moves out of the name ("Pike Place Ground Coffee" in 12 oz and 24 oz)
--   * a few backpacks and headphones come in more than one color
--   * everything else keeps its single default variant
--
-- A product's stock at each store is split across its sizes/colors (more in
-- the middle sizes and the first color), so store totals don't change and
-- the smallest/largest sizes sell out first.
-- Colors are on one showcase product per type (Air Force 1, JanSport
-- SuperBreak, Sony WH-1000XM4C), each with photos per color (008-product-photos.sql);
-- a color without its own photos would just show the main photo. Folgers
-- Classic Roast and Dove Daily Moisture are the size showcases, with the sizes
-- really sold.

-- Products loaded by the seeds get their default variant and its stock
-- (the trigger only covers products added after the migration ran).
INSERT INTO product_variants (product_id, sku)
SELECT product_id, 'P' || product_id FROM products
ON CONFLICT DO NOTHING;

INSERT INTO variant_stock (variant_id, store_id, quantity, price)
SELECT v.variant_id, i.store_id, COALESCE(i.quantity, 0), i.price
  FROM inventory i JOIN product_variants v ON v.product_id = i.product_id
ON CONFLICT (variant_id, store_id) DO NOTHING;

DO $$
DECLARE
    product        RECORD;
    size_list      TEXT[];
    color_name     TEXT;
    color_hex      TEXT;
    size_name      TEXT;
    base_amount    NUMERIC;
    unit           TEXT;
    ci             INTEGER;
    si             INTEGER;
    new_variant    INTEGER;
    shoe_sizes     TEXT[] := ARRAY['7','8','9','10','11','12'];

    -- Products that come in more than one color: name -> {{color, hex}, ...}
    colors_for     JSONB := '{
        "Nike Air Force 1 Low":             [["White", "#F5F5F5"], ["Black", "#1A1A1A"], ["White/Black", "#F5F5F5", "#1A1A1A"]],
        "JanSport SuperBreak One Backpack": [["Black", "#1A1A1A"], ["Navy", "#1F2A44"], ["Red", "#B3261E"]],
        "Sony WH-1000XM4C Wireless Headphones": [["Black", "#1A1A1A"], ["Lavender", "#B9A7D0"], ["Platinum Silver", "#C9C9C9"]]
    }';
    -- Showcase products with their real sizes: name -> {{size, price x}, ...}.
    -- Every other coffee/shampoo gets its own size plus a made-up double size.
    real_sizes     JSONB := '{
        "Folgers Classic Roast Ground Coffee, 11.3 oz": [["25.9 oz", 1], ["40.3 oz", 1.45]],
        "Dove Daily Moisture Shampoo, 12 fl oz": [["8.5 fl oz", 1], ["28 fl oz", 2.5]]
    }';
    factor         NUMERIC;
    color_hex_2    TEXT;
    pair           JSONB;
BEGIN
    FOR product IN
        SELECT p.product_id, p.name, p.category FROM products p
         ORDER BY p.product_id
    LOOP
        size_list := NULL;

        IF product.category = 'shoes' THEN
            size_list := shoe_sizes;
        ELSIF product.category IN ('coffee', 'shampoo') THEN
            unit := CASE WHEN product.category = 'coffee' THEN 'oz' ELSE 'fl oz' END;
            base_amount := substring(product.name FROM ', ([0-9.]+) (?:fl )?oz$')::NUMERIC;
            IF real_sizes ? product.name THEN
                size_list := ARRAY(SELECT value ->> 0 FROM jsonb_array_elements(real_sizes -> product.name));
                UPDATE products
                   SET name = regexp_replace(name, ', [0-9.]+ (fl )?oz$', '')
                 WHERE product_id = product.product_id;
            ELSIF base_amount IS NOT NULL THEN
                -- 12 -> "12 oz", 12.5 -> "12.5 oz"; the bigger size is double
                size_list := ARRAY[
                    regexp_replace(round(base_amount, 1)::TEXT, '\.0$', '') || ' ' || unit,
                    regexp_replace(round(base_amount * 2, 1)::TEXT, '\.0$', '') || ' ' || unit
                ];
                UPDATE products
                   SET name = regexp_replace(name, ', [0-9.]+ (fl )?oz$', '')
                 WHERE product_id = product.product_id;
            END IF;
        END IF;

        -- No options: keep the default variant
        IF size_list IS NULL AND NOT colors_for ? product.name THEN
            CONTINUE;
        END IF;

        ci := 0;
        FOR pair IN
            SELECT value FROM jsonb_array_elements(
                COALESCE(colors_for -> product.name, '[[null, null]]'::JSONB))
        LOOP
            ci := ci + 1;
            color_name := pair ->> 0;
            color_hex := pair ->> 1;
            -- A third value is the second swatch color of a two-tone colorway
            color_hex_2 := pair ->> 2;
            si := 0;
            FOREACH size_name IN ARRAY COALESCE(size_list, ARRAY[NULL::TEXT]) LOOP
                si := si + 1;
                INSERT INTO product_variants
                    (product_id, color, color_hex, color_hex_2, size, color_order, size_order, sku)
                VALUES (
                    product.product_id, color_name, color_hex, color_hex_2, size_name, ci, si,
                    upper(concat_ws('-', 'P' || product.product_id,
                        regexp_replace(color_name, '[^A-Za-z0-9]+', '', 'g'),
                        regexp_replace(size_name, '[^A-Za-z0-9.]+', '', 'g')))
                )
                RETURNING variant_id INTO new_variant;

                -- A bigger bag/bottle costs more (stock is split below)
                factor := COALESCE((real_sizes -> product.name -> (si - 1) ->> 1)::NUMERIC,
                                   CASE WHEN product.category IN ('coffee', 'shampoo') AND si = 2
                                        THEN 1.7 END);
                IF factor IS NOT NULL AND factor <> 1 THEN
                    UPDATE variant_stock SET price = round(price * factor, 2)
                     WHERE variant_id = new_variant;
                END IF;
            END LOOP;
        END LOOP;

        -- Split each store's stock across the new variants by weight; the
        -- rounding leftover goes to the heaviest one. The default variant still
        -- holds the whole amount, so inventory.quantity is the store total here.
        UPDATE variant_stock vs
           SET quantity = d.base + CASE WHEN d.rn = 1 THEN d.total - d.base_sum ELSE 0 END
          FROM (
              SELECT x.*, sum(x.base) OVER (PARTITION BY x.store_id) AS base_sum
                FROM (
                    SELECT v.variant_id, i.store_id, i.quantity AS total,
                           floor(i.quantity * w.weight
                                 / sum(w.weight) OVER (PARTITION BY i.store_id))::INTEGER AS base,
                           row_number() OVER (PARTITION BY i.store_id
                               ORDER BY w.weight DESC, v.color_order, v.size_order) AS rn
                      FROM product_variants v
                      JOIN inventory i ON i.product_id = v.product_id
                     CROSS JOIN LATERAL (SELECT
                           (CASE WHEN product.category = 'shoes'
                                 THEN (ARRAY[1, 2, 3, 3, 2, 1])[v.size_order]
                                 WHEN v.size IS NOT NULL THEN 3 - v.size_order
                                 ELSE 1 END)
                         * (CASE WHEN v.color_order = 1 THEN 2 ELSE 1 END) AS weight) w
                     WHERE v.product_id = product.product_id
                       AND (v.color IS NOT NULL OR v.size IS NOT NULL)
                ) x
          ) d
         WHERE vs.variant_id = d.variant_id AND vs.store_id = d.store_id;

        -- Low stock is checked per size/color, so the level is per size too:
        -- flag a size when it's down to its last one.
        UPDATE inventory SET low_stock_threshold = 1
         WHERE product_id = product.product_id;

        -- The options replace the default variant (its stock goes with it)
        DELETE FROM product_variants
         WHERE product_id = product.product_id AND color IS NULL AND size IS NULL;
    END LOOP;
END $$;

-- The product's existing photos are of its first size (coffee, shampoo) or
-- first color; tag them so other sizes/colors don't show the wrong package.
-- Photos for the other options are added in the admin editor.
UPDATE product_images pi
   SET size = v.size
  FROM products p
  JOIN product_variants v ON v.product_id = p.product_id AND v.size_order = 1
 WHERE pi.product_id = p.product_id AND p.category IN ('coffee', 'shampoo')
   AND v.size IS NOT NULL AND pi.size IS NULL;

-- Fit for the seeded shoes (migrations/024-product-fit.sql): from the name
-- when it says, otherwise men's.
UPDATE products
   SET fit = CASE
           WHEN name ~* '\m(women''s|womens)\M' THEN 'womens'
           WHEN name ~* '\m(kids''?|youth|toddler|boys''?|girls''?)\M' THEN 'kids'
           ELSE 'mens'
       END
 WHERE category = 'shoes' AND fit IS NULL;
