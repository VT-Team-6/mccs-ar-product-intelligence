CREATE TABLE products (
    product_id      INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,  -- the ID stored in the QR code
    name            VARCHAR(200) NOT NULL,
    brand           VARCHAR(100),
    product_type    VARCHAR(100) NOT NULL,
    rating          NUMERIC(2,1) CHECK (rating BETWEEN 0 AND 5),
    description     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
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

INSERT INTO products (name, brand, product_type, rating, description) VALUES
    ('Trail Running Shoe', 'Acme Sports', 'Running Shoe', 4.3, 'Lightweight mesh shoe with grippy soles for trails.'),
    ('Everyday Sneaker', 'Acme Sports', 'Sneaker', 4.0, 'Cushioned sneaker for daily wear.'),
    ('Leather Boot', 'Acme Boots', 'Boot', 4.6, 'Waterproof leather boot for cold weather.');


INSERT INTO stores (name, address, latitude, longitude) VALUES
    ('MCCS Main Exchange',  '100 Sample Ave, Quantico, VA 22134', 38.52210000, -77.30520000),
    ('MCCS Outlet Store',   '250 Example Rd, Arlington, VA 22204', 38.86810000, -77.08270000);

-- One row per product per store: how many are in stock and what it costs there
INSERT INTO inventory (product_id, store_id, quantity, price) VALUES
    (1, 1, 12,  89.99),
    (1, 2,  5,  84.99),
    (2, 1, 20,  64.50),
    (2, 2,  0,  59.99),
    (3, 1,  8, 129.00);