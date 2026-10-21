-- Which shopping criteria matter most to a user, set on the Preferences screen.
-- Each column holds that criterion's rank: 1 = matters most, 2 = next, and so on.
-- 0 = not ranked (default). Unranked criteria still count a little, all equally.
-- The API makes sure ranks are 1, 2, 3, ... with no repeats or gaps.
-- One row per user. A user with no row has nothing ranked.
CREATE TABLE user_preferences (
    user_id     INTEGER PRIMARY KEY,
    price       SMALLINT NOT NULL DEFAULT 0 CHECK (price BETWEEN 0 AND 6),
    rating      SMALLINT NOT NULL DEFAULT 0 CHECK (rating BETWEEN 0 AND 6),
    brand       SMALLINT NOT NULL DEFAULT 0 CHECK (brand BETWEEN 0 AND 6),
    quality     SMALLINT NOT NULL DEFAULT 0 CHECK (quality BETWEEN 0 AND 6),
    durability  SMALLINT NOT NULL DEFAULT 0 CHECK (durability BETWEEN 0 AND 6),
    comfort     SMALLINT NOT NULL DEFAULT 0 CHECK (comfort BETWEEN 0 AND 6),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);