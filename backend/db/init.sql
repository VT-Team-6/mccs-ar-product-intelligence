CREATE TABLE users (
    user_id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cognito_sub     VARCHAR(255) UNIQUE NOT NULL,
    email           VARCHAR(255) UNIQUE NOT NULL,
    is_admin        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE products (
    product_id      INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,  -- the ID stored in the QR code
    name            VARCHAR(200) NOT NULL,
    brand           VARCHAR(100),
    product_type    VARCHAR(100) NOT NULL,
    price           NUMERIC(10,2) CHECK (price >= 0),  -- temporary: moves to inventory when per-store pricing is added
    rating          NUMERIC(2,1) CHECK (rating BETWEEN 0 AND 5),
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

INSERT INTO products (name, brand, product_type, price, rating, description, image_url) VALUES
    ('Timberland 6" Premium Waterproof Boots', 'Timberland', 'Boot', 220.00, 4.5, 'Waterproof leather boot with a padded collar and a rugged lug sole.', '/static/products/timberland-6-inch-boot.png'),
    ('Nike Air Force 1 Low', 'Nike', 'Sneaker', 90.00, 4.6, 'Classic low-top leather sneaker with Air cushioning.', '/static/products/nike-air-force-1-low.png'),
    ('Crocs Classic Clogs', 'Crocs', 'Clog', 50.00, 4.8, 'Lightweight foam clog with ventilation holes and a pivoting heel strap.', '/static/products/crocs-classic-clog.png');


INSERT INTO stores (name, address, latitude, longitude) VALUES
    ('MCCS Main Exchange',  '100 Sample Ave, Quantico, VA 22134', 38.52210000, -77.30520000),
    ('MCCS Outlet Store',   '250 Example Rd, Arlington, VA 22204', 38.86810000, -77.08270000);

-- One row per product per store: how many are in stock and what it costs there
INSERT INTO inventory (product_id, store_id, quantity, price) VALUES
    (1, 1, 12, 220.00),
    (1, 2,  5, 220.00),
    (2, 1, 20,  90.00),
    (2, 2,  0,  90.00),
    (3, 1,  8,  50.00);