-- Category for every seeded product. All the original products are shoes; the
-- curated Amazon additions (catalog-additions.json) add the other four.
UPDATE products
SET category = CASE product_type
    WHEN 'Backpack' THEN 'backpacks'
    WHEN 'Headphones' THEN 'headphones'
    WHEN 'Shampoo' THEN 'shampoo'
    WHEN 'Ground Coffee' THEN 'coffee'
    ELSE 'shoes'
END
WHERE category IS NULL;
