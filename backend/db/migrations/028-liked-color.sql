-- The color a product was liked in (an Air Force 1 liked while viewing Black).
-- The Likes list shows that color's first photo and opens the product on it.
-- One like per product: liking it again in another color switches the color.
ALTER TABLE user_product_likes ADD COLUMN color VARCHAR(40);
