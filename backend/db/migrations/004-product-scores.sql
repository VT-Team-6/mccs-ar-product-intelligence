-- Scores the recommendation engine calculates from product data (0 = worst, 1 = best).
-- Rebuilt automatically, so never edit these by hand.
CREATE TABLE product_scores (
    product_id        INTEGER PRIMARY KEY,
    price_score       REAL NOT NULL DEFAULT 0.5 CHECK (price_score BETWEEN 0 AND 1),
    rating_score      REAL NOT NULL DEFAULT 0.5 CHECK (rating_score BETWEEN 0 AND 1),
    brand_score       REAL NOT NULL DEFAULT 0.5 CHECK (brand_score BETWEEN 0 AND 1),
    quality_score     REAL NOT NULL DEFAULT 0.5 CHECK (quality_score BETWEEN 0 AND 1),
    durability_score  REAL NOT NULL DEFAULT 0.5 CHECK (durability_score BETWEEN 0 AND 1),
    comfort_score     REAL NOT NULL DEFAULT 0.5 CHECK (comfort_score BETWEEN 0 AND 1),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE
);