-- Who a shoe is sized for. A men's 7, a women's 7 and a kids' 7 are different
-- shoes, so a shoe sold for more than one is a separate product per fit (the
-- way Foot Locker and Nike list them). Unisex shoes (Crocs, Converse) are
-- listed as men's, since they're sized in men's sizes.
-- Only shoes have a fit; other categories leave it null.
ALTER TABLE products
    ADD COLUMN fit VARCHAR(10) CHECK (fit IN ('mens', 'womens', 'kids'));
