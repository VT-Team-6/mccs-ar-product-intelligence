-- What each review talks about (comfort, durability, quality), saved because
-- finding it runs every phrase through the embedding model: about 7 minutes
-- for 9,000 reviews. A score refresh only works it out for reviews without a
-- row here, or whose category's example phrases changed (topics_version).
-- Re-importing reviews replaces them, which removes their rows here too.
CREATE TABLE review_topics (
    review_id      INTEGER PRIMARY KEY REFERENCES reviews(review_id) ON DELETE CASCADE,
    topics         TEXT[] NOT NULL,
    topics_version VARCHAR(16) NOT NULL
);
