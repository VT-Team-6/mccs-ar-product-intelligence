"""Export cached AI Product Analyses.

Run from backend/:
    python -m scripts.export_product_analyses
"""

import json
from datetime import datetime
from decimal import Decimal
from pathlib import Path

from database import get_connection
from services.product_analysis_cache import review_fingerprint


OUTPUT = (
    Path(__file__).resolve().parents[1]
    / "data"
    / "approved_reviews"
    / "product_analyses.json"
)


def serialize(value):
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


def export_product_analyses():
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT
                p.product_id,
                p.name,
                p.brand,
                p.product_type,
                a.summary,
                a.pros,
                a.cons,
                a.review_count,
                a.total_review_count,
                a.average_rating,
                a.rating_distribution,
                a.sources,
                a.review_fingerprint,
                a.generated_at,
                a.is_stale
            FROM product_ai_analyses a
            JOIN products p
              ON p.product_id = a.product_id
            WHERE p.deleted_at IS NULL
            ORDER BY p.name, p.brand, p.product_type
            """
        ).fetchall()

    products = []

    for row in rows:
        current_hash, _ = review_fingerprint(row["product_id"])

        # Never export an outdated analysis.
        if row["is_stale"] or row["review_fingerprint"] != current_hash:
            print(f"Skipping stale analysis: {row['name']}")
            continue

        products.append({
            "name": row["name"],
            "brand": row["brand"],
            "product_type": row["product_type"],
            "analysis": {
                "summary": row["summary"],
                "pros": row["pros"],
                "cons": row["cons"],
                "review_count": row["review_count"],
                "total_review_count": row["total_review_count"],
                "average_rating": serialize(row["average_rating"]),
                "rating_distribution": row["rating_distribution"],
                "sources": row["sources"],
                "review_fingerprint": row["review_fingerprint"],
                "generated_at": serialize(row["generated_at"]),
            },
        })

    snapshot = {
        "version": 1,
        "products": products,
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(
        json.dumps(snapshot, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    print(f"Exported {len(products)} AI analyses.")
    print(f"Saved to: {OUTPUT}")


if __name__ == "__main__":
    export_product_analyses()
