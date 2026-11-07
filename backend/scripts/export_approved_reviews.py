"""Export approved, imported Amazon reviews for sharing through Git.

Run from backend/:
    python -m scripts.export_approved_reviews
    
"""

import json
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

from database import get_connection

OUTPUT = (
    Path(__file__).resolve().parents[1]
    / "data"
    / "approved_reviews"
    / "approved_reviews.json"
)

def serialize(value):
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value

def export_approved_reviews():
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT
                p.name AS product_name,
                p.brand AS product_brand,
                p.product_type,
                prs.source,
                prs.source_product_id,
                prs.source_url,
                r.source_review_id,
                r.rating,
                r.title,
                r.body,
                r.review_date
            FROM reviews r
            JOIN product_review_sources prs
                ON prs.review_source_id = r.review_source_id
            JOIN products p
                ON p.product_id = r.product_id
            WHERE prs.source = 'amazon'
              AND prs.source_product_id IS NOT NULL
              AND r.source_review_id IS NOT NULL
              AND r.source_review_id NOT LIKE 'seed-%%'
              AND p.deleted_at IS NULL
            ORDER BY
                p.name,
                p.brand NULLS FIRST,
                p.product_type,
                prs.source_product_id,
                r.source_review_id
            """
        ).fetchall()

    products = {}

    for row in rows:
        product_key = (
            row["product_name"],
            row["product_brand"],
            row["product_type"],
        )

        if product_key not in products:
            products[product_key] = {
                "name": row["product_name"],
                "brand": row["product_brand"],
                "product_type": row["product_type"],
                "sources": {},
            }

        asin = row["source_product_id"]
        sources = products[product_key]["sources"]

        if asin not in sources:
            sources[asin] = {
                "source": row["source"],
                "source_product_id": asin,
                "source_url": row["source_url"],
                "reviews": [],
            }

        sources[asin]["reviews"].append(
            {
                "source_review_id": row["source_review_id"],
                "rating": serialize(row["rating"]),
                "title": row["title"],
                "body": row["body"],
                "review_date": serialize(row["review_date"]),
            }
        )

    snapshot = {
        "version": 1,
        "products": [
            {
                "name": product["name"],
                "brand": product["brand"],
                "product_type": product["product_type"],
                "sources": list(product["sources"].values()),
            }
            for product in products.values()
        ],
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(
        json.dumps(snapshot, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    print(f"Exported {len(snapshot['products'])} products.")
    print(f"Total reviews: {len(rows)}")
    print(f"Saved to: {OUTPUT}")

if __name__ == "__main__":
    export_approved_reviews()
