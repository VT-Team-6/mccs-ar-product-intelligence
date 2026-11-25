-- A second swatch color for two-tone colorways (an Air Force 1 in
-- "White/Black"): the color dot on the product page is split diagonally between
-- color_hex and color_hex_2. Null for one-color options.
ALTER TABLE product_variants
    ADD COLUMN color_hex_2 VARCHAR(7) CHECK (color_hex_2 ~ '^#[0-9A-Fa-f]{6}$');
