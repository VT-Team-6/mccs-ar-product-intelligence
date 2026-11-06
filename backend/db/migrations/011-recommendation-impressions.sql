-- Learning to rank (task 9): every recommendation card shown to a signed-in
-- shopper, with the signals the "Recommended for You" pick uses. A card counts
-- as clicked when the shopper opens that product from recommendations soon
-- after (a 'viewed-from-recommendation' row in user_product_history).
CREATE TABLE recommendation_impressions (
    impression_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    product_id    INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    slot          VARCHAR(10) NOT NULL CHECK (slot IN ('best', 'for_you')),
    similarity    REAL NOT NULL,
    preference    REAL NOT NULL,
    likes         REAL NOT NULL,
    shown_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_recommendation_impressions_user_product
    ON recommendation_impressions (user_id, product_id, shown_at);
