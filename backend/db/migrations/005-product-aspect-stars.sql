-- Average review stars (1-5) per aspect, before any scaling, so products of
-- different types can be compared directly (task 7). NULL = not enough reviews.
ALTER TABLE product_scores
    ADD COLUMN quality_stars    REAL CHECK (quality_stars BETWEEN 1 AND 5),
    ADD COLUMN durability_stars REAL CHECK (durability_stars BETWEEN 1 AND 5),
    ADD COLUMN comfort_stars    REAL CHECK (comfort_stars BETWEEN 1 AND 5);