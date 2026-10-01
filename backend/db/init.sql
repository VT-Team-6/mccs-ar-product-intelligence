CREATE TABLE products (
    product_id   INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,  -- the ID stored in the QR code
    name         VARCHAR(200) NOT NULL,
    brand        VARCHAR(100),
    product_type VARCHAR(100) NOT NULL,
    rating       NUMERIC(2,1),
    description  TEXT
);

CREATE TABLE stores (
    store_id    INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        VARCHAR(200) NOT NULL,
    address    VARCHAR(300) NOT NULL,
    latitude   NUMERIC(10,8),
    longitude  NUMERIC(11,8)
);

CREATE TABLE inventory (
    inventory_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id   INTEGER NOT NULL ON DELETE CASCADE,
    store_id     INTEGER NOT NULL ON DELETE CASCADE,
    quantity     INTEGER NOT NULL CHECK (quantity >= 0),
    in_stock     BOOLEAN NOT NULL DEFAULT FALSE,
    price        NUMERIC(10,2) NOT NULL CHECK (price >= 0),
    FOREIGN KEY (product_id) REFERENCES products(product_id),
    FOREIGN KEY (store_id) REFERENCES stores(store_id)
);



INSERT INTO products (name, brand, product_type, rating, description) VALUES
    ('Trail Running Shoe', 'Acme Sports', 'Running Shoe', 4.3, 'Lightweight mesh shoe with grippy soles for trails.'),
    ('Everyday Sneaker', 'Acme Sports', 'Sneaker', 4.0, 'Cushioned sneaker for daily wear.'),
    ('Leather Boot', 'Acme Boots', 'Boot', 4.6, 'Waterproof leather boot for cold weather.');