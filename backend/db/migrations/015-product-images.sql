-- Extra photos for a product, shown on its detail page. The product's main
-- photo stays in products.image_url: the first image the app shows, and the
-- one used on cards and listings. Rows here are the additional views.
--
-- image_url is a link, never the image itself. A relative /static/... path is a
-- file this backend serves from backend/static/products.
--
-- source says who put the file there: 'upload' files were written by the admin
-- image screen, so deleting their row also deletes the file; 'url' rows point at
-- an image we do not own (a store's photo, a checked-in seed file) and their
-- file is never touched.
CREATE TABLE product_images (
    image_id    INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id  INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    image_url   VARCHAR(500) NOT NULL,
    source      VARCHAR(10) NOT NULL DEFAULT 'url'
                CHECK (source IN ('url', 'upload')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Adding the same photo twice is a mistake, not a second gallery entry.
    UNIQUE (product_id, image_url)
);

-- The gallery is always read for one product, in the order it was added.
CREATE INDEX idx_product_images_product ON product_images (product_id, image_id);
