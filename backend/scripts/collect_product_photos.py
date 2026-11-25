"""Collect up to 4 photos per product (different angles) and load them into the app.

Two steps, run from backend/:

  1. python scripts/collect_product_photos.py find
     Reads the Amazon Reviews 2023 product metadata (the same public dataset our
     reviews came from) and writes data/product_photos.csv: one row per photo,
     main photo first, then the listing's other angles. Running it again only
     replaces the photos it finds; rows you added (colors, sizes) are kept.
       - Products in db/seeds/catalog-additions.json already know their Amazon
         listing, so their rows are marked "ok".
       - The original shoes don't, so the best listing match by brand and name
         is used and marked "check": skim those, and delete the rows of any
         wrong match (amazon_title shows what it matched).
       - Colorways: add rows yourself with the color filled in, e.g.
             Nike Air Force 1 Low,Black,,1,https://...
         and photos of one size (coffee, shampoo) with the size filled in:
             Pike Place Roast Ground Coffee,,24 oz,1,https://...
         The color or size must match its name in Colors & sizes exactly.
       - Photos you picked yourself (say from a brand's site): write "manual"
         in the check column. Those rows are kept, and a product with any
         manual row gets no photos from Amazon.
     To try one product first:  find --only "Nike Air Force 1 Low"
     (a product with a saved listing stops reading as soon as it's found).
     The metadata files are large (several GB in total) and are streamed, not
     saved. If you already have the .jsonl.gz files, pass --files DIR to use them.

  2. python scripts/collect_product_photos.py download
     Downloads every photo in the CSV to static/products/photos/ (trimmed and
     centered on a 500 x 500 white square, as JPEG to keep the repo small) and
     writes db/seeds/008-product-photos.sql, which puts them in the app on a
     fresh database:
       - photos with a color or size show when that one is picked (the page
         starts on the first color/size); untagged photos show for every one,
         so add a photo shared by all (a size chart, say) just once
       - the main photo (search results, lists) is the product's untagged
         photo 1, or else the first photo 1 in the file (its first color/size)
     Photos already downloaded are skipped; --force downloads them again.
     --only "Product name" downloads just that product's photos (and the seed
     then has only those, for a test; run it without --only for everything).

Image rights: these are the brands' listing photos, used for a non-commercial
class demo; the listing for each is in the CSV. A real deployment would use the
photos MCCS gets from its vendors.
"""

import argparse
import csv
import gzip
import io
import json
import re
import sys
from pathlib import Path
from urllib.request import Request, urlopen

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from download_product_images import HEADERS, trim  # noqa: E402

BACKEND = Path(__file__).resolve().parent.parent
CSV_PATH = BACKEND / "data" / "product_photos.csv"
PHOTO_DIR = BACKEND / "static" / "products" / "photos"
SEED_PATH = BACKEND / "db" / "seeds" / "008-product-photos.sql"
PRODUCTS_SEED = BACKEND / "db" / "seeds" / "001-products.sql"
ADDITIONS = BACKEND / "db" / "seeds" / "catalog-additions.json"

META_URL = "https://mcauleylab.ucsd.edu/public_datasets/data/amazon_2023/raw/meta_categories/meta_{}.jsonl.gz"
# Which metadata file each category's listings are in
SOURCES = {
    "shoes": "Clothing_Shoes_and_Jewelry",
    "backpacks": "Clothing_Shoes_and_Jewelry",
    "headphones": "Electronics",
    "shampoo": "Beauty_and_Personal_Care",
    "ground_coffee": "Grocery_and_Gourmet_Food",
}

PHOTOS_PER_PRODUCT = 4
SIZE = 500
MARGIN = 20
COLUMNS = ["product", "color", "size", "angle", "image_url", "amazon_title", "source_asin", "check"]

# 007-product-variants moves a coffee/shampoo size out of the name
SIZE_IN_NAME = re.compile(r", [0-9.]+ (fl )?oz$")
# Words that don't tell two shoes apart
COMMON_WORDS = {"shoe", "shoes", "boot", "boots", "sneaker", "sneakers", "men", "mens", "women", "womens",
                "the", "and", "with", "for", "s"}

# Amazon photo links can end in a size code ("._AC_UL1500_.jpg") that no longer
# works for older photos ("Bad Request"); the plain link gives the full photo.
SIZE_CODE = re.compile(r"\._[^/]*_(\.[a-zA-Z]+)$")

PARENT_ASIN = re.compile(r'"parent_asin":\s*"([A-Z0-9]+)"')
STORE = re.compile(r'"store":\s*"([^"]*)"')


def normalized(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", str(text or "").lower())).strip()


def slug(text: str) -> str:
    return normalized(text).replace(" ", "-")


def same_product(name: str, wanted: list[str]) -> bool:
    """Whether a product is one of --only's names (with or without its size)."""
    names = {normalized(name), normalized(SIZE_IN_NAME.sub("", name))}
    return any(normalized(w) in names for w in wanted)


# --- the products we have -----------------------------------------------------


def original_shoes() -> list[dict]:
    """The shoes in 001-products.sql's first block (they have no Amazon listing saved)."""
    text = PRODUCTS_SEED.read_text(encoding="utf-8").split("WITH additions", 1)[0]
    shoes = []
    for match in re.finditer(r"^\s*\('((?:[^']|'')*)', '((?:[^']|'')*)'", text, re.M):
        shoes.append({"name": match.group(1).replace("''", "'"), "brand": match.group(2).replace("''", "'")})
    return shoes


def additions() -> list[dict]:
    return json.loads(ADDITIONS.read_text(encoding="utf-8"))["products"]


def plain_link(url: str) -> str:
    return SIZE_CODE.sub(r"\1", url)


def photo_urls(row: dict) -> list[str]:
    """Up to 4 photo links from a listing, main photo first, in the listing's order."""
    images = [i for i in (row.get("images") or []) if isinstance(i, dict)]
    images.sort(key=lambda i: i.get("variant") != "MAIN")  # stable: the rest keep their order
    urls = []
    for image in images:
        url = image.get("hi_res") or image.get("large")
        url = plain_link(url) if url else url
        if url and url not in urls:
            urls.append(url)
    return urls[:PHOTOS_PER_PRODUCT]


def stream(source: str, files: Path | None):
    """Each line of a metadata file, from --files or straight from the dataset."""
    if files:
        path = files / f"meta_{source}.jsonl.gz"
        handle = gzip.open(path, "rt", encoding="utf-8")
    else:
        response = urlopen(Request(META_URL.format(source), headers=HEADERS), timeout=60)
        handle = io.TextIOWrapper(gzip.GzipFile(fileobj=response), encoding="utf-8")
    with handle:
        yield from handle


# --- step 1: find --------------------------------------------------------------


def find(files: Path | None, only: list[str]) -> int:
    known = {item["source_product_id"]: item for item in additions()}
    shoes = original_shoes()
    if only:
        known = {asin: item for asin, item in known.items() if same_product(item["name"], only)}
        shoes = [shoe for shoe in shoes if same_product(shoe["name"], only)]
        if not known and not shoes:
            print(f"No product named {only}. Use the name as it is in the app (or the seed).")
            return 1
    # Shoes by brand, with the words in their name that tell them apart
    by_brand: dict[str, list[dict]] = {}
    for shoe in shoes:
        brand = normalized(shoe["brand"])
        words = set(normalized(shoe["name"]).split()) - set(brand.split()) - COMMON_WORDS
        by_brand.setdefault(brand, []).append({**shoe, "words": words, "best": None})

    found: dict[str, dict] = {}
    sources = sorted({SOURCES[item["category"]] for item in known.values()} | ({SOURCES["shoes"]} if shoes else set()))
    for source in sources:
        # Stop reading a file once everything wanted from it is found (the
        # shoes file is read to the end when shoes are being matched by name)
        wanted_here = {asin for asin, item in known.items() if SOURCES[item["category"]] == source}
        match_shoes_here = bool(shoes) and source == SOURCES["shoes"]
        if not wanted_here and not match_shoes_here:
            continue
        print(f"Reading {source} metadata (large; this takes a while)...", flush=True)
        scanned = 0
        for line in stream(source, files):
            scanned += 1
            if scanned % 500_000 == 0:
                progress = [f"{scanned:,} listings read"]
                if known:
                    progress.append(f"{len(found)}/{len(known)} saved listings found")
                if shoes:
                    matched = sum(1 for g in by_brand.values() for shoe in g if shoe["best"])
                    progress.append(f"{matched}/{len(shoes)} shoes matched so far")
                print("  " + ", ".join(progress), flush=True)
            asin = PARENT_ASIN.search(line)
            store = STORE.search(line)
            brand = normalized(store.group(1)) if store else ""
            wanted = asin and asin.group(1) in known
            if not wanted and brand not in by_brand:
                continue
            row = json.loads(line)
            urls = photo_urls(row)
            if not urls:
                continue
            if wanted:
                found[row["parent_asin"]] = {"title": row.get("title", ""), "urls": urls}
                if not match_shoes_here and wanted_here <= found.keys():
                    break
            # The best listing for each original shoe: every telling word in the
            # title, then the most-rated listing
            title_words = set(normalized(row.get("title", "")).split())
            for shoe in by_brand.get(brand, []):
                if shoe["words"] <= title_words:
                    count = row.get("rating_number") or 0
                    if shoe["best"] is None or count > shoe["best"]["count"]:
                        shoe["best"] = {"title": row.get("title", ""), "asin": row.get("parent_asin"),
                                        "urls": urls, "count": count}

    rows = []
    for asin, item in known.items():
        hit = found.get(asin)
        if not hit:
            rows.append(dict(product=item["name"], color="", size="", angle=1, image_url="", amazon_title="",
                             source_asin=asin, check="not found"))
            continue
        for angle, url in enumerate(hit["urls"], start=1):
            rows.append(dict(product=item["name"], color="", size="", angle=angle, image_url=url,
                             amazon_title=hit["title"], source_asin=asin, check="ok"))
    for group in by_brand.values():
        for shoe in group:
            best = shoe["best"]
            if not best:
                rows.append(dict(product=shoe["name"], color="", size="", angle=1, image_url="", amazon_title="",
                                 source_asin="", check="no match"))
                continue
            for angle, url in enumerate(best["urls"], start=1):
                rows.append(dict(product=shoe["name"], color="", size="", angle=angle, image_url=url,
                                 amazon_title=best["title"], source_asin=best["asin"], check="check"))

    # Keep what's already in the file: rows you added (colorways, sizes,
    # "manual" photos) and other products' rows. Only this run's products'
    # found photos are replaced, and products with manual photos get none.
    kept = []
    if CSV_PATH.exists():
        with CSV_PATH.open(newline="", encoding="utf-8") as handle:
            kept = [{column: old.get(column) or "" for column in COLUMNS} for old in csv.DictReader(handle)]

    def yours(row: dict) -> bool:
        return bool(row["color"].strip() or row["size"].strip() or row["check"].strip().lower() == "manual")

    hand_picked = {row["product"] for row in kept if row["check"].strip().lower() == "manual"}
    rows = [row for row in rows if row["product"] not in hand_picked]
    redone = {row["product"] for row in rows}
    rows += [row for row in kept if yours(row) or row["product"] not in redone]

    rows.sort(key=lambda r: (r["check"] != "check", r["product"].lower(), r["color"], r["size"], int(r["angle"] or 0)))
    CSV_PATH.parent.mkdir(parents=True, exist_ok=True)
    with CSV_PATH.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(rows)

    matched = sum(1 for g in by_brand.values() for s in g if s["best"])
    print(f"\nWrote {CSV_PATH.relative_to(BACKEND)}: {len(rows)} rows")
    if known:
        print(f"  saved listings found: {len(found)}/{len(known)}")
    if shoes:
        print(f"  original shoes matched by name: {matched}/{len(shoes)} (rows marked 'check': skim them)")
    print("Next: add colorway rows if you want them, then run:  python scripts/collect_product_photos.py download")
    return 0


# --- step 2: download ------------------------------------------------------------


def to_square_jpeg(data: bytes) -> Image.Image:
    """Trimmed and centered on a white SIZE x SIZE square."""
    image = trim(Image.open(io.BytesIO(data)).convert("RGBA"))
    image.thumbnail((SIZE - 2 * MARGIN, SIZE - 2 * MARGIN), Image.LANCZOS)
    square = Image.new("RGB", (SIZE, SIZE), (255, 255, 255))
    square.paste(image, ((SIZE - image.width) // 2, (SIZE - image.height) // 2), image)
    return square


def fetch(url: str) -> bytes:
    """The photo; if the link fails, the same link without Amazon's size code."""
    try:
        with urlopen(Request(url, headers=HEADERS), timeout=30) as response:
            return response.read()
    except Exception:
        if plain_link(url) == url:
            raise
        with urlopen(Request(plain_link(url), headers=HEADERS), timeout=30) as response:
            return response.read()


def sql_text(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def download_all(force: bool, only: list[str]) -> int:
    with CSV_PATH.open(newline="", encoding="utf-8") as handle:
        rows = [r for r in csv.DictReader(handle) if (r.get("image_url") or "").strip()]
    if only:
        rows = [r for r in rows if same_product(r["product"], only)]
        if not rows:
            print(f"No photos in {CSV_PATH.relative_to(BACKEND)} for {only}.")
            return 1
    PHOTO_DIR.mkdir(parents=True, exist_ok=True)

    saved, skipped, failed, placed = 0, 0, [], []
    for row in rows:
        product, color = row["product"].strip(), (row.get("color") or "").strip()
        size = (row.get("size") or "").strip()
        angle = int(row["angle"])
        name = "-".join(p for p in (slug(product), slug(color), slug(size), str(angle)) if p) + ".jpg"
        target = PHOTO_DIR / name
        if target.exists() and not force:
            skipped += 1
        else:
            try:
                to_square_jpeg(fetch(row["image_url"].strip())).save(target, "JPEG", quality=85, optimize=True)
                saved += 1
                print(f"  saved   {name}")
            except Exception as error:  # keep going; report every problem at the end
                failed.append((product, angle, error))
                print(f"  FAILED  {product} photo {angle}: {error}")
                continue
        placed.append((SIZE_IN_NAME.sub("", product), color, size, angle, f"/static/products/photos/{name}"))

    lines = [
        "-- Product photos from scripts/collect_product_photos.py (generated: edit",
        "-- data/product_photos.csv and run the script again rather than this file).",
        "-- Photos with a color or size show when that one is picked; untagged ones",
        "-- show for every color/size. The main photo is the untagged photo 1, or the",
        "-- first photo 1 listed.",
        "",
    ]
    def tag(value: str) -> str:
        return sql_text(value) if value else "NULL"

    # The main photo: an untagged photo 1, else the first photo 1 listed
    main_photo: dict[str, str] = {}
    for product, color, size, angle, url in placed:
        if angle == 1 and not color and not size:
            main_photo[product] = url
    for product, color, size, angle, url in placed:
        if angle == 1:
            main_photo.setdefault(product, url)
    for product, url in main_photo.items():
        lines.append(f"UPDATE products SET image_url = {sql_text(url)} WHERE name = {sql_text(product)};")

    for product, color, size, angle, url in placed:
        if angle == 1 and not color and not size:
            continue  # it's the main photo
        else:
            lines.append(
                "INSERT INTO product_images (product_id, image_url, color, size)"
                f" SELECT product_id, {sql_text(url)}, {tag(color)}, {tag(size)}"
                f" FROM products WHERE name = {sql_text(product)} ON CONFLICT DO NOTHING;"
            )
    SEED_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"\n{saved} downloaded, {skipped} already there, {len(failed)} failed")
    print(f"Wrote {SEED_PATH.relative_to(BACKEND)} ({len(placed)} photos). Reset the database to load them:")
    print("  docker compose down -v && docker compose up -d")
    return 1 if failed else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    steps = parser.add_subparsers(dest="step", required=True)
    find_step = steps.add_parser("find", help="write data/product_photos.csv from the Amazon metadata")
    find_step.add_argument("--files", type=Path, help="folder with meta_*.jsonl.gz files already downloaded")
    find_step.add_argument("--only", action="append", default=[], metavar="NAME",
                           help="just this product (repeat for more)")
    download_step = steps.add_parser("download", help="download the photos and write the seed")
    download_step.add_argument("--force", action="store_true", help="download photos that already exist again")
    download_step.add_argument("--only", action="append", default=[], metavar="NAME",
                               help="just this product's photos (repeat for more)")
    args = parser.parse_args()
    if args.step == "find":
        return find(args.files, args.only)
    return download_all(args.force, args.only)


if __name__ == "__main__":
    sys.exit(main())
