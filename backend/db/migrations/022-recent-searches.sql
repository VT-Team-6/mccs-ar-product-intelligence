-- Recent searches for signed-in shoppers, shown on the search screen.
-- One row per distinct search (case-insensitive); searching it again moves it
-- back to the top. Only the newest 10 per person are kept.
CREATE TABLE recent_searches (
    search_id    INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    query        VARCHAR(200) NOT NULL,
    searched_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX uq_recent_searches_query ON recent_searches(user_id, lower(query));
CREATE INDEX idx_recent_searches_user ON recent_searches(user_id, searched_at DESC);
