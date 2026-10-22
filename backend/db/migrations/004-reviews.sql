CREATE TABLE product_review_sources (
    review_source_id    INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id          INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    source              VARCHAR(50) NOT NULL,
    source_product_id   VARCHAR(255),
    source_url          TEXT,
    last_fetched_at     TIMESTAMPTZ,
    UNIQUE NULLS NOT DISTINCT (product_id, source, source_product_id)
);

CREATE TABLE reviews (
    review_id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id          INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    rating              NUMERIC(2,1) CHECK (rating BETWEEN 0 AND 5),
    review_source_id    INTEGER NOT NULL 
        REFERENCES product_review_sources(review_source_id) 
        ON DELETE CASCADE,
    source_review_id    VARCHAR(255),
    title               TEXT,
    body                TEXT NOT NULL,
    review_date         TIMESTAMPTZ,
    fetched_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX reviews_source_id_unique
ON reviews (review_source_id, source_review_id)
WHERE source_review_id IS NOT NULL;