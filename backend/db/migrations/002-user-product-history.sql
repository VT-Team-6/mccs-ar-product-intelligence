-- Shouldn't delete products, but we want to be able to mark them as deleted for historical purposes
ALTER TABLE products ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- History to track user interactions with products (scans, views, purchases, likes, dislikes)
CREATE TABLE user_product_history (
    history_id      INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id      INTEGER NOT NULL,
    user_id         INTEGER NOT NULL,
    action          VARCHAR(50) NOT NULL CHECK (action IN ('scanned', 'viewed', 'purchased', 'liked', 'disliked')),
    occured_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE RESTRICT,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- Index user's most recent product history for faster lookups
CREATE INDEX idx_user_product_history_recent ON user_product_history(user_id, occured_at DESC, history_id DESC);

-- Current state of user likes. Absense means not liked.
CREATE TABLE user_product_likes (
    product_id      INTEGER NOT NULL,
    user_id         INTEGER NOT NULL,
    liked_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE RESTRICT,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    PRIMARY KEY (user_id , product_id),
);

CREATE INDEX idx_user_product_likes_recent ON user_product_likes(user_id, liked_at DESC);   -- User's most recent likes
CREATE INDEX idx_user_product_likes_product ON user_product_likes(product_id);              -- Product likes lookup