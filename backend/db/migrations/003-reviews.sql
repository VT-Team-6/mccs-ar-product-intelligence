CREATE TABLE reviews (
    review_id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id          INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    rating              NUMERIC(2,1) CHECK (rating BETWEEN 0 AND 5),
    source              VARCHAR(50) NOT NULL,
    source_review_id    VARCHAR(255),
    title               TEXT,
    body                TEXT NOT NULL,
    review_date         TIMESTAMPTZ,
    fetched_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE product_review_sources (
    review_source_id    INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id          INTEGER NOT NULL REFERENCES products(product_id),
    source              VARCHAR(50) NOT NULL,
    source_product_id   VARCHAR(255),
    source_url          TEXT,
    last_fetched_at     TIMESTAMPTZ,
    UNIQUE (product_id, source)
);