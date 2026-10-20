-- How much each shopping criterion matters to a user, set on the Preferences screen.
-- 0 = Skip, 1 = Low, 2 = Medium (default), 3 = High.
-- The recommendation engine uses these as weights when ranking products.
-- One row per user. A user with no row uses the defaults (all Medium).
CREATE TABLE user_preferences (
    user_id     INTEGER PRIMARY KEY,
    price       SMALLINT NOT NULL DEFAULT 2 CHECK (price BETWEEN 0 AND 3),
    rating      SMALLINT NOT NULL DEFAULT 2 CHECK (rating BETWEEN 0 AND 3),
    brand       SMALLINT NOT NULL DEFAULT 2 CHECK (brand BETWEEN 0 AND 3),
    quality     SMALLINT NOT NULL DEFAULT 2 CHECK (quality BETWEEN 0 AND 3),
    durability  SMALLINT NOT NULL DEFAULT 2 CHECK (durability BETWEEN 0 AND 3),
    comfort     SMALLINT NOT NULL DEFAULT 2 CHECK (comfort BETWEEN 0 AND 3),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);