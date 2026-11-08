-- Cache VT ARC-generated product review analyses.
-- Reviews remain in the existing reviews table.

CREATE TABLE IF NOT EXISTS product_ai_analyses (
    product_id INTEGER PRIMARY KEY
        REFERENCES products(product_id) ON DELETE CASCADE,

    summary TEXT NOT NULL,

    pros JSONB NOT NULL DEFAULT '[]'::jsonb,
    cons JSONB NOT NULL DEFAULT '[]'::jsonb,

    review_count INTEGER NOT NULL DEFAULT 0,
    total_review_count INTEGER NOT NULL DEFAULT 0,
    average_rating NUMERIC(3,2),
    rating_distribution JSONB NOT NULL DEFAULT '{}'::jsonb,
    sources JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Hash of the review content used to generate the analysis.
    -- Allows us to detect changes without relying on review IDs.
    review_fingerprint VARCHAR(64) NOT NULL,

    generated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Mark old analysis as outdated if regeneration fails.
    is_stale BOOLEAN NOT NULL DEFAULT FALSE
);
