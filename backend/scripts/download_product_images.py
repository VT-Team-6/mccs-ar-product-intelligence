"""Download product photos into backend/static/products/ so the app can show them.

How to use (from backend/):
  1. Open data/product_images.csv. For each product, right-click its photo on any
     store page, choose "Copy Image Address", and paste it in the image_url column.
  2. Run:  python scripts/download_product_images.py
  3. Rows with no link, or whose image file already exists, are skipped.
     Add --force to download them again (to replace a photo you don't like).

Each photo is trimmed of its empty border and centered on a 500 x 500 PNG, the
same size as the existing images, and saved under the file name the seed data
expects (for example brooks-ghost-15.png).
"""

import argparse
import csv
import io
import sys
from pathlib import Path
from urllib.request import Request, urlopen

from PIL import Image, ImageChops

BACKEND = Path(__file__).resolve().parent.parent
CSV_PATH = BACKEND / "data" / "product_images.csv"
OUTPUT_DIR = BACKEND / "static" / "products"

SIZE = 500  # final image is SIZE x SIZE
MARGIN = 20  # empty space kept around the shoe

# Some stores only send an image to something that looks like a browser
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    "Accept": "image/png,image/jpeg,image/webp,image/*;q=0.8",
}


def download(url: str) -> bytes:
    with urlopen(Request(url, headers=HEADERS), timeout=30) as response:
        return response.read()


def trim(image: Image.Image) -> Image.Image:
    """Cut off the empty border: transparent pixels, or a plain white background."""
    if image.getextrema()[3][0] < 255:  # has see-through pixels
        box = image.getchannel("A").getbbox()
    else:
        white = Image.new("RGB", image.size, (255, 255, 255))
        difference = ImageChops.difference(image.convert("RGB"), white)
        # Ignore near-white noise (JPEG artifacts) when finding the edges
        box = difference.convert("L").point(lambda value: 255 if value > 12 else 0).getbbox()
    return image.crop(box) if box else image


def to_square_png(data: bytes) -> Image.Image:
    """Trim the photo and center it on a SIZE x SIZE transparent square."""
    image = trim(Image.open(io.BytesIO(data)).convert("RGBA"))
    image.thumbnail((SIZE - 2 * MARGIN, SIZE - 2 * MARGIN), Image.LANCZOS)
    square = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    square.paste(image, ((SIZE - image.width) // 2, (SIZE - image.height) // 2), image)
    return square


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--force", action="store_true", help="replace images that already exist")
    parser.add_argument("--csv", type=Path, default=CSV_PATH, help="CSV with product, file, image_url")
    args = parser.parse_args()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    saved, skipped, failed = 0, 0, []

    with args.csv.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            product, file, url = row["product"], row["file"].strip(), (row.get("image_url") or "").strip()
            target = OUTPUT_DIR / file
            if not url or (target.exists() and not args.force):
                skipped += 1
                continue
            try:
                to_square_png(download(url)).save(target, optimize=True)
                saved += 1
                print(f"  saved   {file}")
            except Exception as error:  # keep going; report every problem at the end
                failed.append((product, error))
                print(f"  FAILED  {product}: {error}")

    print(f"\n{saved} saved, {skipped} skipped (no link or already there), {len(failed)} failed")
    if failed:
        print("For a failed one, try a different photo link (some sites block downloads).")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())