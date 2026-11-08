"""Import saved AI Product Analyses without calling VT ARC.

Run from backend/:
    python -m scripts.import_product_analyses
    python -m scripts.import_product_analyses --apply

Import approved reviews BEFORE importing analyses.
"""

import argparse
import json
import re
from datetime import datetime
from pathlib import Path

from psycopg.types.json import Jsonb

from database import get_connection
from services.product_analysis_cache import review_fingerprint


SNAPSHOT = (
    Path(__file__).resolve().parents[1]
    / "data"
    / "approved_reviews"
    / "product_analyses.json"
)

HASH_PATTERN = re.compile(r"^[0-9a-f]{64}$")


def load_snapshot():
    with SNAPSHOT.open("r", encoding="utf-8") as file:
        data = json.load(file)

    if (
        data.get("version") != 1
        or not isinstance(data.get("products"), list)
    ):
        raise ValueError("Unsupported AI Analysis")

    seen = set()

    for product in data["products"]:
        key = (
            product["name"],
            product["brand"],
            product["product_type"],
        )

        if key in seen:
            raise ValueError(f"Duplicate product: {key}")

        seen.add(key)

        analysis = product["analysis"]

        required = (
            "summary",
            "pros",
            "cons",
            "review_count",
            "total_review_count",
            "average_rating",
            "rating_distribution",
            "sources",
            "review_fingerprint",
            "generated_at",
        )

        for field in required:
            if field not in analysis:
                raise ValueError(
                    f"Missing {field} for {product['name']}"
                )

        fingerprint = analysis["review_fingerprint"]

        if (
            not isinstance(fingerprint, str)
            or not HASH_PATTERN.fullmatch(fingerprint)
        ):
            raise ValueError(
                f"Invalid review fingerprint: {product['name']}"
            )

        if not isinstance(analysis["summary"], str):
            raise ValueError(
                f"Invalid summary: {product['name']}"
            )

        if not isinstance(analysis["pros"], list):
            raise ValueError(
                f"Invalid pros: {product['name']}"
            )

        if not isinstance(analysis["cons"], list):
            raise ValueError(
                f"Invalid cons: {product['name']}"
            )

        if not isinstance(analysis["rating_distribution"], dict):
            raise ValueError(
                f"Invalid rating distribution: {product['name']}"
            )

        if not isinstance(analysis["sources"], (list, dict)):
            raise ValueError(
                f"Invalid review sources: {product['name']}"
            )

        datetime.fromisoformat(analysis["generated_at"])

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
            f"Expected exactly one product matching "
            f"{product['name']}, found {len(rows)}"
        )

    return rows[0]["product_id"]


def main():
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--apply",
        action="store_true",
        help="Save analyses into PostgreSQL",
    )

    args = parser.parse_args()

    products = load_snapshot()

    print(f"Snapshot AI analyses: {len(products)}")

    if not products:
        print("No analyses to import.")
        return

    with get_connection() as conn:

        # Validate every product and fingerprint BEFORE
        # changing any database records.
        matches = []

        for product in products:
            product_id = find_product(conn, product)
            analysis = product["analysis"]

            current_hash, _ = review_fingerprint(product_id)
            expected_hash = analysis["review_fingerprint"]

            if current_hash != expected_hash:
                raise ValueError(
                    f"Review data mismatch for {product['name']}.\n"
                    "Import the approved reviews first, "
                    "and check that local seed reviews match.\n"
                    "No AI analyses were imported."
                )

            matches.append((product_id, product))

        print(
            f"Validated {len(matches)} matching products "
            "and review fingerprints."
        )

        if not args.apply:
            print("\nPREVIEW ONLY - no database changes.")
            print("Run with --apply to import.")
            return

        for product_id, product in matches:
            analysis = product["analysis"]

            conn.execute(
                """
                INSERT INTO product_ai_analyses (
                    product_id,
                    summary,
                    pros,
                    cons,
                    review_count,
                    total_review_count,
                    average_rating,
                    rating_distribution,
                    sources,
                    review_fingerprint,
                    generated_at,
                    is_stale
                )
                VALUES (
                    %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, FALSE
                )
                ON CONFLICT (product_id)
                DO UPDATE SET
                    summary = EXCLUDED.summary,
                    pros = EXCLUDED.pros,
                    cons = EXCLUDED.cons,
                    review_count = EXCLUDED.review_count,
                    total_review_count =
                        EXCLUDED.total_review_count,
                    average_rating = EXCLUDED.average_rating,
                    rating_distribution =
                        EXCLUDED.rating_distribution,
                    sources = EXCLUDED.sources,
                    review_fingerprint =
                        EXCLUDED.review_fingerprint,
                    generated_at = EXCLUDED.generated_at,
                    is_stale = FALSE
                """,
                (
                    product_id,
                    analysis["summary"],
                    Jsonb(analysis["pros"]),
                    Jsonb(analysis["cons"]),
                    analysis["review_count"],
                    analysis["total_review_count"],
                    analysis["average_rating"],
                    Jsonb(analysis["rating_distribution"]),
                    Jsonb(analysis["sources"]),
                    analysis["review_fingerprint"],
                    datetime.fromisoformat(
                        analysis["generated_at"]
                    ),
                ),
            )

            print(f"Imported: {product['name']}")

        # Commit all analyses together.
        conn.commit()

    print(
        f"\nSuccessfully imported "
        f"{len(matches)} AI analyses."
    )
    print("No VT ARC requests were made.")


if __name__ == "__main__":
    main()
