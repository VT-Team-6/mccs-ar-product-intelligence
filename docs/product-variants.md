# Colors and sizes (product variants)

A product (a sneaker, a bag of coffee) comes in one or more **variants**, one
for each color/size combination. Stock and price are kept per variant per store.

| Category | Colors | Sizes | Photos follow |
|---|---|---|---|
| Shoes | ✓ | ✓ | color |
| Backpacks, headphones | ✓ | | color |
| Coffee, shampoo | | ✓ | size (a bigger bag is a different package) |

The category rules live in `backend/variants.py` (`OPTIONS`, `PHOTO_OPTION`) and
`mobile/src/constants/variants.ts`; keep the two in step.

## Database (`migrations/023-product-variants.sql`)

- `product_variants`: `product_id`, `color`, `color_hex` (swatch), `size`, display
  order, and a unique `sku` (e.g. `P2-BLACK-10.5`). Every product has at least one;
  a product without options has a single **default variant** (no color, no size).
- `variant_stock`: `quantity` and `price` per variant per store.
- `inventory` stays one row per product per store and still owns the status,
  approval, buyer and low-stock level. Its `quantity` is the sum of the variants and
  its `price` the lowest ("from $90"). Triggers keep these in step, so search,
  recommendations and compare didn't change.
- `product_images.color` / `.size`: which option a photo shows; neither means shared.
- `shopping_list_items.variant_id`: the size/color the shopper picked (null = any).
- `stock_changes`, `low_stock_alerts`, `order_request_items` carry `variant_id`.

Writes to `inventory.quantity`/`price` from older code still work: for a product
without options they flow down to its one variant; for a product with options a
price change applies to every variant ("same price for all"), and a total quantity
is refused (`stock.py`), since stock is counted per size.

## How each part works

- **Admin, Manage Products → product → Colors & sizes**: add colors (presets or
  custom with a swatch) and sizes (category presets or custom). Every color comes in
  every size; tap a size under a color to switch that combination off. Saving keeps
  the stock of combinations that stay; removed ones lose their stock. New ones start
  at 0 at each store, at the product's price there.
- **Admin, Manage images**: pick which color (or size) a photo is for when adding
  it, or tap "For: …" on a photo to change it.
- **Product page**: color swatches and size chips. Sold-out sizes are crossed out.
  The gallery shows the picked color's/size's photos, falling back to the featured
  photo; photos of other options are hidden. Price and availability follow the pick;
  with nothing picked the price reads "From $X" when sizes cost different amounts.
  Add to Shopping List saves the pick.
- **Inventory (staff)**: the list shows totals and "2 of 11 low"; a product's screen
  lists every size/color with its own stock (and price for managers).
- **Stock CSV**: one row per variant: `sku, product_id, name, brand, color, size,
  stock`. Import matches on `sku`; a `product_id` row only works for products
  without options.
- **Low stock and reorders**: each size/color is checked against the product's
  level, so a sold-out size 10 is flagged even when other sizes are plentiful.
  Reorder items list "Product:", "Color:" and "Size:" on separate lines.
- **QR codes** stay per product (a shelf tag); the shopper picks a size after scanning.

## Seed data (`seeds/007-product-variants.sql`)

Every shoe gets sizes 7–12; coffee and shampoo get the size from their name plus a
double size at 1.7× the price, and the size moves out of the name. Each store's stock
is split across the sizes so totals stay the same, and the low-stock level becomes 1
per size. Colors are on one showcase product per type (Nike Air Force 1: White, Black, and two-tone White/Black;
JanSport SuperBreak; Sony WH-1000XM4C), since each color needs its own photos. Existing
photos of coffee and shampoo are tagged with their first size.

The tests use products 1–4 as plain stock fixtures, so `conftest.apply_init_sql`
gives them back a single default variant after seeding (`keep_options=True` keeps the
seeded sizes, as the variant tests do).

## Fit (shoes only, `migrations/024-product-fit.sql`)

`products.fit` is `mens`, `womens` or `kids`, and only shoes have one. A shoe sold
to more than one is a separate product per fit, since a men's 7 and a women's 7
are different shoes (how Foot Locker and Nike list them). Unisex shoes like Crocs
are listed as men's because they're sized in men's sizes. The fit shows next to
the brand ("Nike · Men's · Sneaker") and in compare, and the size presets in the
Colors & sizes editor follow it (kids run 10.5C–13.5C, then 1Y–7Y).
