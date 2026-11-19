-- Preserve buyer responses and assignment history when an open request moves buyers.
BEGIN;

ALTER TABLE order_request_items
    ADD COLUMN updated_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL;

-- Existing responses were made before per-item attribution was recorded.
UPDATE order_request_items i
SET updated_by = r.buyer_user_id
FROM order_requests r
WHERE i.request_id = r.request_id AND i.updated_at IS NOT NULL;

CREATE TABLE order_request_reassignments (
    reassignment_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    request_id INTEGER NOT NULL REFERENCES order_requests(request_id) ON DELETE CASCADE,
    from_buyer_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    to_buyer_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    changed_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_order_request_reassignments_request
    ON order_request_reassignments(request_id, reassignment_id);

COMMIT;
