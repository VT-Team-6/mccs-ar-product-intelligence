CREATE TABLE products (
    product_id   INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,  -- the ID stored in the QR code
    name         VARCHAR(200) NOT NULL,
    product_type VARCHAR(100) NOT NULL,
    price        NUMERIC(10,2) NOT NULL,
    rating       NUMERIC(2,1),
    description  TEXT
);

INSERT INTO products (name, product_type, price, rating, description) VALUES
    ('Trail Running Shoe', 'Running Shoe', 89.99, 4.3, 'Lightweight mesh shoe with grippy soles for trails.'),
    ('Everyday Sneaker',   'Sneaker',      64.50, 4.0, 'Cushioned sneaker for daily wear.'),
    ('Leather Boot',       'Boot',        129.00, 4.6, 'Waterproof leather boot for cold weather.');