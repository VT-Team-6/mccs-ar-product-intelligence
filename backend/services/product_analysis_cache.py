"""Store and refresh ARC product analyses only when reviews change."""

import hashlib
import json
from datetime import datetime, timezone

from psycopg.types.json import Jsonb

from database import get_connection
from review_analysis import analyze_product_reviews


def review_fingerprint(product_id: int) -> tuple[str, int]:
    """Hash stable review content and approved source selections."""
    with get_connection() as conn:
        sources = conn.execute(
            """
            SELECT source, source_product_id
            FROM product_review_sources
            WHERE product_id = %s
              AND source_product_id IS NOT NULL
            ORDER BY source, source_product_id
            """,
            (product_id,),
        ).fetchall()

        reviews = conn.execute(
            """
            SELECT
                prs.source,
                prs.source_product_id,
                r.source_review_id,
                r.rating,
                r.title,
                r.body,
                r.review_date
            FROM reviews r
            JOIN product_review_sources prs
              ON prs.review_source_id = r.review_source_id
            WHERE r.product_id = %s
            """,
            (product_id,),
        ).fetchall()

    source_data = [
        [row["source"], row["source_product_id"]]
        for row in sources
    ]

    review_data = [
        {
            "source": row["source"],
            "source_product_id": row["source_product_id"],
            "source_review_id": row["source_review_id"],
            "rating": (
                str(row["rating"])
                if row["rating"] is not None else None
            ),
            "title": row["title"],
            "body": row["body"],
            "review_date": (
                row["review_date"].isoformat()
                if row["review_date"] is not None else None
            ),
        }
        for row in reviews
    ]

    # Ignore database-generated IDs and fetched_at timestamps.
    # Sorting ensures identical reviews produce identical hashes.
    review_data.sort(
        key=lambda item: json.dumps(
            item, sort_keys=True, ensure_ascii=False
        )
    )

    payload = json.dumps(
        {"sources": source_data, "reviews": review_data},
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
    )

    fingerprint = hashlib.sha256(
        payload.encode("utf-8")
    ).hexdigest()

    return fingerprint, len(reviews)


def _format_saved(row):
    if row is None:
        return None

    return {
        "product_id": row["product_id"],
        "summary": row["summary"],
        "pros": row["pros"],
        "cons": row["cons"],
        "review_count": row["review_count"],
        "total_review_count": row["total_review_count"],
        "average_rating": (
            float(row["average_rating"])
            if row["average_rating"] is not None else None
        ),
        "rating_distribution": row["rating_distribution"],
        "sources": row["sources"],
        "generated_at": row["generated_at"].isoformat(),
        "is_stale": row["is_stale"],
    }


def get_saved_analysis(product_id: int):
    """Read cached analysis without contacting ARC."""
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT *
            FROM product_ai_analyses
            WHERE product_id = %s
            """,
            (product_id,),
        ).fetchone()

    if row is None:
        return {
            "product_id": product_id,
            "summary": None,
            "pros": [],
            "cons": [],
            "review_count": 0,
            "total_review_count": 0,
            "average_rating": None,
            "rating_distribution": {
                str(star): 0 for star in range(5, 0, -1)
            },
            "sources": [],
            "message": "AI analysis has not been generated yet.",
            "is_stale": False,
        }

    current_fingerprint, _ = review_fingerprint(product_id)

    if row["is_stale"] or (
        row["review_fingerprint"] != current_fingerprint
    ):
        # Do not expose an outdated summary to customers.
        return {
            "product_id": product_id,
            "summary": None,
            "pros": [],
            "cons": [],
            "review_count": 0,
            "total_review_count": 0,
            "average_rating": None,
            "rating_distribution": {
                str(star): 0 for star in range(5, 0, -1)
            },
            "sources": [],
            "message": "AI analysis needs to be regenerated.",
            "is_stale": True,
        }

    return _format_saved(row)


def mark_analysis_stale(product_id: int):
    with get_connection() as conn:
        conn.execute(
            """
            UPDATE product_ai_analyses
            SET is_stale = TRUE
            WHERE product_id = %s
            """,
            (product_id,),
        )


def refresh_product_analysis(product_id: int, force: bool = False):
    """Generate only when missing, changed, or explicitly forced."""
    before_hash, review_count = review_fingerprint(product_id)

    with get_connection() as conn:
        saved = conn.execute(
            """
            SELECT review_fingerprint, is_stale
            FROM product_ai_analyses
            WHERE product_id = %s
            """,
            (product_id,),
        ).fetchone()

    if review_count == 0:
        # Nothing to analyze; discard any obsolete summary.
        with get_connection() as conn:
            conn.execute(
                """
                DELETE FROM product_ai_analyses
                WHERE product_id = %s
                """,
                (product_id,),
            )
        return {"status": "no_reviews", "product_id": product_id}

    if (
        not force
        and saved is not None
        and saved["review_fingerprint"] == before_hash
    ):
        if saved["is_stale"]:
            with get_connection() as conn:
                conn.execute(
                    """
                    UPDATE product_ai_analyses
                    SET is_stale = FALSE
                    WHERE product_id = %s
                      AND review_fingerprint = %s
                    """,
                    (product_id, before_hash),
                )
        return {"status": "unchanged", "product_id": product_id}

    if saved is not None:
        mark_analysis_stale(product_id)

    # This is the only step that calls VT ARC.
    analysis = analyze_product_reviews(product_id)

    # Do not save an analysis if reviews changed during generation.
    after_hash, _ = review_fingerprint(product_id)

    if before_hash != after_hash:
        raise RuntimeError(
            "Reviews changed during generation; retry analysis."
        )

    if analysis["summary"] is None:
        raise ValueError("No review summary was generated.")

    generated_at = datetime.now(timezone.utc)

    with get_connection() as conn:
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
                total_review_count = EXCLUDED.total_review_count,
                average_rating = EXCLUDED.average_rating,
                rating_distribution = EXCLUDED.rating_distribution,
                sources = EXCLUDED.sources,
                review_fingerprint = EXCLUDED.review_fingerprint,
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
                before_hash,
                generated_at,
            ),
        )

    return {"status": "generated", "product_id": product_id}
