"""Restore admin-approved Amazon reviews from a version-controlled snapshot.

Run from backend/:
    python -m scripts.import_approved_reviews
    python -m scripts.import_approved_reviews --apply
"""

import argparse
import json
from datetime import datetime
from pathlib import Path

from database import get_connection


SNAPSHOT = (
    Path(__file__).resolve().parents[1]
    / "data"
    / "approved_reviews"
    / "approved_reviews.json"
)


def load_snapshot():
    with SNAPSHOT.open("r", encoding="utf-8") as file:
        data = json.load(file)

    if data.get("version") != 1 or not isinstance(data.get("products"), list):
        raise ValueError("Unsupported approved-review snapshot")

    seen_products = set()

    for product in data["products"]:
        key = (
            product["name"],
            product["brand"],
            product["product_type"],
        )
        if key in seen_products:
            raise ValueError(f"Duplicate product in snapshot: {key}")
        seen_products.add(key)

        if not product["name"] or not product["product_type"]:
            raise ValueError("Product name and type are required")

        sources = product["sources"]
        if not isinstance(sources, list) or not sources:
            raise ValueError(f"No approved sources for {key}")

        seen_asins = set()

        for source in sources:
            if source["source"] != "amazon":
                raise ValueError("Only approved Amazon sources are supported")

            asin = source["source_product_id"]
            if not isinstance(asin, str) or not asin or len(asin) > 255:
                raise ValueError("Invalid Amazon source product ID")
            if asin in seen_asins:
                raise ValueError(f"Duplicate Amazon listing: {asin}")
            seen_asins.add(asin)

            reviews = source["reviews"]
            if not isinstance(reviews, list) or not reviews:
                raise ValueError(f"No imported reviews for listing {asin}")

            seen_ids = set()

            for review in reviews:
                review_id = review["source_review_id"]
                if (
                    not isinstance(review_id, str)
                    or not review_id
                    or len(review_id) > 255
                    or review_id.startswith("seed-")
                ):
                    raise ValueError(f"Invalid review ID for {asin}")

                if review_id in seen_ids:
                    raise ValueError(f"Duplicate review ID: {review_id}")
                seen_ids.add(review_id)

                body = review["body"]
                if not isinstance(body, str) or not body.strip():
                    raise ValueError(f"Empty review body: {review_id}")

                rating = review["rating"]
                if rating is not None:
                    if (
                        isinstance(rating, bool)
                        or not isinstance(rating, (int, float))
                        or not 0 <= rating <= 5
                        or round(rating, 1) != rating
                    ):
                        raise ValueError(f"Invalid rating: {review_id}")

                date = review["review_date"]
                if date is not None:
                    datetime.fromisoformat(date)

    return data["products"]


def find_product(conn, product):
    rows = conn.execute(
        """
        SELECT product_id
        FROM products
        WHERE name = %s
          AND brand IS NOT DISTINCT FROM %s
          AND product_type = %s
          AND deleted_at IS NULL
        """,
        (
            product["name"],
            product["brand"],
            product["product_type"],
        ),
    ).fetchall()

    if len(rows) != 1:
        raise ValueError(
            f"Expected exactly one matching product for "
            f"{product['name']}, found {len(rows)}. "
            "Database was not updated."
        )

    return rows[0]["product_id"]


def restore_product(conn, product_id, product):
    inserted_sources = 0
    changed_reviews = 0
    removed_reviews = 0

    for source in product["sources"]:
        asin = source["source_product_id"]

        existing = conn.execute(
            """
            SELECT review_source_id
            FROM product_review_sources
            WHERE product_id = %s
              AND source = 'amazon'
              AND source_product_id = %s
            """,
            (product_id, asin),
        ).fetchone()

        if existing is None:
            inserted_sources += 1

        source_row = conn.execute(
            """
            INSERT INTO product_review_sources (
                product_id, source, source_product_id, source_url
            )
            VALUES (%s, 'amazon', %s, %s)
            ON CONFLICT (product_id, source, source_product_id)
            DO UPDATE SET source_url = EXCLUDED.source_url
            RETURNING review_source_id
            """,
            (
                product_id,
                asin,
                source.get("source_url"),
            ),
        ).fetchone()

        source_id = source_row["review_source_id"]
        review_ids = []

        for review in source["reviews"]:
            review_id = review["source_review_id"]
            review_ids.append(review_id)

            result = conn.execute(
                """
                INSERT INTO reviews (
                    product_id,
                    review_source_id,
                    source_review_id,
                    rating,
                    title,
                    body,
                    review_date
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (review_source_id, source_review_id)
                    WHERE source_review_id IS NOT NULL
                DO UPDATE SET
                    rating = EXCLUDED.rating,
                    title = EXCLUDED.title,
                    body = EXCLUDED.body,
                    review_date = EXCLUDED.review_date
                WHERE (
                    reviews.rating,
                    reviews.title,
                    reviews.body,
                    reviews.review_date
                ) IS DISTINCT FROM (
                    EXCLUDED.rating,
                    EXCLUDED.title,
                    EXCLUDED.body,
                    EXCLUDED.review_date
                )
                """,
                (
                    product_id,
                    source_id,
                    review_id,
                    review["rating"],
                    review["title"],
                    review["body"],
                    review["review_date"],
                ),
            )
            changed_reviews += result.rowcount

        # Remove reviews for that listing, not for other listings.
        deleted = conn.execute(
            """
            DELETE FROM reviews
            WHERE product_id = %s
              AND review_source_id = %s
              AND NOT (source_review_id = ANY(%s::text[]))
            """,
            (product_id, source_id, review_ids),
        )
        removed_reviews += deleted.rowcount

    # Remove synthetic reviews ONLY after real reviews are present.
    real_count = conn.execute(
        """
        SELECT COUNT(*) AS count
        FROM reviews r
        JOIN product_review_sources prs
          ON prs.review_source_id = r.review_source_id
        WHERE r.product_id = %s
          AND prs.source = 'amazon'
          AND prs.source_product_id IS NOT NULL
          AND r.source_review_id NOT LIKE 'seed-%%'
        """,
        (product_id,),
    ).fetchone()["count"]

    if real_count > 0:
        deleted = conn.execute(
            """
            DELETE FROM reviews
            WHERE product_id = %s
              AND source_review_id LIKE 'seed-%%'
            """,
            (product_id,),
        )
        removed_reviews += deleted.rowcount

    return inserted_sources, changed_reviews, removed_reviews


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually write approved reviews into PostgreSQL",
    )
    args = parser.parse_args()

    products = load_snapshot()
    review_count = sum(
        len(source["reviews"])
        for product in products
        for source in product["sources"]
    )

    print(f"Snapshot products: {len(products)}")
    print(f"Snapshot reviews: {review_count}")

    if not products:
        print("Nothing to import.")
        return

    with get_connection() as conn:
        # Validate EVERY product match before changing anything.
        matches = [
            (find_product(conn, product), product)
            for product in products
        ]

        if not args.apply:
            print("\nPREVIEW ONLY - no database changes.")
            for product_id, product in matches:
                print(f"  Product {product_id}: {product['name']}")
            print("\nRun again with --apply to import.")
            return

        total_sources = 0
        total_changed = 0
        total_removed = 0

        # One transaction for the entire snapshot.
        for product_id, product in matches:
            sources, changed, removed = restore_product(
                conn, product_id, product
            )
            total_sources += sources
            total_changed += changed
            total_removed += removed
            print(f"Restored: {product['name']}")

        conn.commit()

    print("\nImport completed.")
    print(f"New source mappings: {total_sources}")
    print(f"Inserted/updated reviews: {total_changed}")
    print(f"Removed stale/synthetic reviews: {total_removed}")


if __name__ == "__main__":
    main()
