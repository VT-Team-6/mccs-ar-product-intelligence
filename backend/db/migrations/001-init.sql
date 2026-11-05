CREATE TABLE users (
    user_id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cognito_sub     VARCHAR(255) UNIQUE NOT NULL,
    email           VARCHAR(255) UNIQUE NOT NULL,
    role            VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'branch_admin', 'store_buyer', 'store_admin')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE products (
    product_id      INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,  -- the ID stored in the QR code
    name            VARCHAR(200) NOT NULL,
    brand           VARCHAR(100),
    product_type    VARCHAR(100) NOT NULL,
    price           NUMERIC(10,2) CHECK (price >= 0),  -- temporary: moves to inventory when per-store pricing is added
    description     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    image_url       VARCHAR(500) -- a link to the image, not the image itself
);

CREATE TABLE stores (
    store_id        INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name            VARCHAR(200) NOT NULL,
    address         VARCHAR(300) NOT NULL,
    latitude        NUMERIC(10,8) CHECK (latitude BETWEEN -90 AND 90),
    longitude       NUMERIC(11,8) CHECK (longitude BETWEEN -180 AND 180)
);

CREATE TABLE user_stores (
    user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    store_id INTEGER NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, store_id)
);

CREATE TABLE inventory (
    inventory_id    INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id      INTEGER NOT NULL,
    store_id        INTEGER NOT NULL,
    quantity        INTEGER CHECK (quantity >= 0),
    price           NUMERIC(10,2) NOT NULL CHECK (price >= 0),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE,
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE,
    UNIQUE (product_id, store_id)
);

-- Index high-frequency search columns for faster lookups
CREATE INDEX idx_products_name ON products(name);
CREATE INDEX idx_inventory_product_id ON inventory(product_id);
CREATE INDEX idx_inventory_store_id ON inventory(store_id);