-- Every product belongs to a category, which decides the shopping criteria that
-- make sense for it (categories.py) and keeps recommendations in the same kind
-- of product. Must match CATEGORIES in categories.py.
ALTER TABLE products
    ADD COLUMN category VARCHAR(20)
        CHECK (category IN ('shoes', 'backpacks', 'headphones', 'shampoo', 'coffee'));

CREATE INDEX idx_products_category ON products (category);
