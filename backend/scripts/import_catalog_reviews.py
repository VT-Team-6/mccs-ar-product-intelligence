"""Import reviews for the curated Amazon catalog additions from the SQLite archive.

catalog-additions.json lists each added product's Amazon listing (its ASIN).
This approves that listing as the product's review source and imports its
reviews from the archive, the same way an admin does from the product page.

Run from backend/ with the archive in data/reviews/ (or AMAZON_REVIEW_DB set):
    python -m scripts.import_catalog_reviews            # dry run: what would change
    python -m scripts.import_catalog_reviews --apply    # import and refresh scores

Then share the reviews with the team, who may not have the archive:
    python -m scripts.export_approved_reviews
Teammates restore them with: python -m scripts.import_approved_reviews --apply
"""

import argparse
import asyncio
import json
from pathlib import Path

from database import get_connection

CATALOG = Path(__file__).resolve().parents[1] / "db" / "seeds" / "catalog-additions.json"


def load_catalog(path: Path = CATALOG) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))["products"]


def find_product(conn, item: dict) -> int | None:
    rows = conn.execute(
        """
        SELECT product_id FROM products
        WHERE name = %s AND brand IS NOT DISTINCT FROM %s AND product_type = %s
          AND deleted_at IS NULL
        """,
        (item["name"], item.get("brand"), item["product_type"]),
    ).fetchall()
    return rows[0]["product_id"] if len(rows) == 1 else None


def approve_source(conn, product_id: int, item: dict) -> None:
    conn.execute(
        """
        INSERT INTO product_review_sources (product_id, source, source_product_id, source_url)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (product_id, source, source_product_id) DO NOTHING
        """,
        (product_id, item["source"], item["source_product_id"], item.get("source_url")),
    )


async def import_all(items: list[dict], apply: bool) -> dict:
    """Imports each product's reviews. Returns counts for the summary."""
    from services.reviews.importer import ReviewImporter  # needs the archive

    importer = ReviewImporter()
    summary = {"products": 0, "reviews": 0, "missing": [], "failed": []}
    for item in items:
        with get_connection() as conn:
            product_id = find_product(conn, item)
            if product_id is None:
                summary["missing"].append(item["name"])
                continue
            if not apply:
                summary["products"] += 1
                continue
            approve_source(conn, product_id, item)
            conn.commit()
            try:
                result = await importer.import_product_reviews(conn, product_id)
            except ValueError as error:
                summary["failed"].append(f"{item['name']}: {error}")
                continue
        summary["products"] += 1
        summary["reviews"] += result.imported_reviews
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--apply", action="store_true", help="import (default is a dry run)")
    args = parser.parse_args()

    items = load_catalog()
    summary = asyncio.run(import_all(items, args.apply))

    verb = "Imported" if args.apply else "Would import"
    print(f"{verb} reviews for {summary['products']} of {len(items)} catalog products"
          + (f" ({summary['reviews']} reviews)" if args.apply else ""))
    for name in summary["missing"]:
        print(f"  Not in the database (skipped): {name}")
    for problem in summary["failed"]:
        print(f"  Failed: {problem}")

    if args.apply:
        from product_features import refresh_product_scores

        print(f"Recommendation scores refreshed for {refresh_product_scores()} products.")
        print("Next: python -m scripts.export_approved_reviews  (shares them through Git)")
    else:
        print("Dry run: nothing changed. Add --apply to import.")


if __name__ == "__main__":
    main()
