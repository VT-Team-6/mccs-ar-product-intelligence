-- Shopping list

CREATE TABLE shopping_lists (
    shopping_list_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    user_id INTEGER NOT NULL
        REFERENCES users(user_id) ON DELETE CASCADE,

    name VARCHAR(100) NOT NULL DEFAULT 'My Shopping List',

    is_active BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT shopping_list_name_not_blank
        CHECK (length(trim(name)) > 0)
);

-- Each customer can have only one active list.
CREATE UNIQUE INDEX idx_shopping_lists_one_active
    ON shopping_lists(user_id)
    WHERE is_active = TRUE;

CREATE INDEX idx_shopping_lists_user
    ON shopping_lists(user_id);


CREATE TABLE shopping_list_items (
    shopping_list_item_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    shopping_list_id INTEGER NOT NULL
        REFERENCES shopping_lists(shopping_list_id)
        ON DELETE CASCADE,

    product_id INTEGER NOT NULL
        REFERENCES products(product_id),

    is_completed BOOLEAN NOT NULL DEFAULT FALSE,

    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_shopping_list_product
        UNIQUE (shopping_list_id, product_id)
);

CREATE INDEX idx_shopping_list_items_list
    ON shopping_list_items(shopping_list_id);
