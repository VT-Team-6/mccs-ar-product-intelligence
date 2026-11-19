-- Low-stock alerts, order requests and notifications.
--
-- The flow: a stock change drops a product to its low-stock level, which opens
-- an alert and notifies the store's managers. A manager sends low products to a
-- buyer as one order request. The buyer marks each product ordered or
-- unavailable (with a reason), which notifies the managers. When a product's
-- stock goes back above its level, its alert is resolved and it leaves the
-- Reorders list.

-- One alert per time a product drops to its low-stock level at a store. Its
-- status is the product's reorder status:
--   open         needs reorder (not sent to a buyer yet)
--   requested    in an order request, waiting for the buyer
--   ordered      the buyer ordered it
--   unavailable  the buyer couldn't order it; the manager can reorder it
--   resolved     its stock went back above the low-stock level
CREATE TABLE low_stock_alerts (
    alert_id      INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id    INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    store_id      INTEGER NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
    quantity      INTEGER NOT NULL,
    threshold     INTEGER NOT NULL,
    status        VARCHAR(12) NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'requested', 'ordered', 'unavailable', 'resolved')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at   TIMESTAMPTZ
);

-- At most one alert that isn't resolved per product per store.
CREATE UNIQUE INDEX uq_low_stock_alerts_active
    ON low_stock_alerts(product_id, store_id) WHERE status <> 'resolved';
CREATE INDEX idx_low_stock_alerts_store ON low_stock_alerts(store_id, status);

-- One order request per "Send" to a buyer. Its status is worked out from its items.
CREATE TABLE order_requests (
    request_id    INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    store_id      INTEGER NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
    buyer_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    sent_by       INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    note          TEXT NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Each product in a request: how many, and what the buyer did with it.
CREATE TABLE order_request_items (
    request_id    INTEGER NOT NULL REFERENCES order_requests(request_id) ON DELETE CASCADE,
    alert_id      INTEGER NOT NULL REFERENCES low_stock_alerts(alert_id) ON DELETE CASCADE,
    product_id    INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    quantity      INTEGER NOT NULL CHECK (quantity > 0),
    status        VARCHAR(12) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'ordered', 'unavailable')),
    reason        TEXT NOT NULL DEFAULT '',
    updated_at    TIMESTAMPTZ,
    PRIMARY KEY (request_id, product_id)
);

CREATE INDEX idx_order_request_items_alert ON order_request_items(alert_id);

-- Notifications, for the banner and the unread count.
--   low_stock      to managers: products just went low
--   order_request  to a buyer: a new order request (request_id)
--   order_update   to managers: a buyer marked products ordered or unavailable
CREATE TABLE messages (
    message_id        INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    recipient_user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    store_id          INTEGER REFERENCES stores(store_id) ON DELETE CASCADE,
    kind              VARCHAR(20) NOT NULL
                      CHECK (kind IN ('low_stock', 'order_request', 'order_update')),
    subject           VARCHAR(200) NOT NULL,
    body              TEXT NOT NULL DEFAULT '',
    request_id        INTEGER REFERENCES order_requests(request_id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    read_at           TIMESTAMPTZ
);

CREATE INDEX idx_messages_recipient ON messages(recipient_user_id, created_at DESC);
