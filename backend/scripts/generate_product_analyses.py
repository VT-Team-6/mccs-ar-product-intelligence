"""Generate and cache product AI analyses.

Run from backend/:
    python -m scripts.generate_product_analyses
    python -m scripts.generate_product_analyses --include-synthetic
    python -m scripts.generate_product_analyses --force
"""

import argparse

from database import get_connection
from services.product_analysis_cache import (
    refresh_product_analysis,
    mark_analysis_stale,
)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--include-synthetic",
        action="store_true",
        help="Also analyze products without real imported Amazon reviews.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Regenerate even if the analysis is up to date.",
    )
    args = parser.parse_args()

    with get_connection() as conn:
        products = conn.execute(
            """
            SELECT
                p.product_id,
                p.name,
                EXISTS (
                    SELECT 1
                    FROM reviews r
                    JOIN product_review_sources prs
                      ON prs.review_source_id = r.review_source_id
                    WHERE r.product_id = p.product_id
                      AND prs.source = 'amazon'
                      AND prs.source_product_id IS NOT NULL
                ) AS has_amazon_reviews
            FROM products p
            WHERE p.deleted_at IS NULL
            ORDER BY p.product_id
            """
        ).fetchall()

    generated = 0
    unchanged = 0
    skipped = 0
    failed = 0

    for product in products:
        product_id = product["product_id"]

        if (
            not args.include_synthetic
            and not product["has_amazon_reviews"]
        ):
            skipped += 1
            continue

        print(f"\n[{product_id}] {product['name']}")

        try:
            result = refresh_product_analysis(
                product_id,
                force=args.force,
            )

            print(f"  {result['status']}")

            if result["status"] == "generated":
                generated += 1
            elif result["status"] == "unchanged":
                unchanged += 1
            else:
                skipped += 1

        except Exception as exc:
            mark_analysis_stale(product_id)
            failed += 1
            print(f"  FAILED: {exc}")

    print("\nFinished:")
    print(f"Generated: {generated}")
    print(f"Unchanged: {unchanged}")
    print(f"Skipped:   {skipped}")
    print(f"Failed:    {failed}")


if __name__ == "__main__":
    main()
