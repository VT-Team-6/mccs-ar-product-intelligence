"""Reliability tests.

Run from backend/:
    .\.venv\Scripts\python.exe -m scripts.check_review_reliability
"""

from collections import Counter

from database import get_connection
from services.review_reliability import (
    score_reviews,
    select_reviews,
    reliability_summary,
)

PRODUCT_LIMIT = 10
CANDIDATE_LIMIT = 300
AI_REVIEW_LIMIT = 50


def rating_group(rating):
    if rating is None:
        return "unrated"

    star = max(1, min(5, int(float(rating) + 0.5)))

    if star <= 2:
        return "negative"
    if star == 3:
        return "neutral"
    return "positive"


def percentages(counts):
    total = sum(counts.values())
    return {
        group: round(100 * counts.get(group, 0) / total, 1)
        if total else 0
        for group in ("negative", "neutral", "positive", "unrated")
    }


def main():
    with get_connection() as conn:
        # Select ten products with enough reviews for meaningful testing.
        products = conn.execute(
            """
            SELECT p.product_id, p.name,
                   COUNT(r.review_id)::int AS review_count
            FROM products p
            JOIN reviews r ON r.product_id = p.product_id
            WHERE p.deleted_at IS NULL
            GROUP BY p.product_id, p.name
            HAVING COUNT(r.review_id) >= 10
            ORDER BY COUNT(r.review_id) DESC, p.product_id
            LIMIT %s
            """,
            (PRODUCT_LIMIT,),
        ).fetchall()

        if not products:
            print("No products with at least 10 reviews found.")
            return

        reports = []

        for product in products:
            product_id = product["product_id"]

            reviews = conn.execute(
                """
                SELECT r.review_id, r.rating, r.title,
                       r.body, r.review_date
                FROM reviews r
                JOIN product_review_sources prs
                  ON prs.review_source_id = r.review_source_id
                WHERE r.product_id = %s
                ORDER BY
                    r.review_date DESC NULLS LAST,
                    prs.source,
                    prs.source_product_id NULLS FIRST,
                    r.source_review_id NULLS FIRST,
                    r.review_id
                LIMIT %s
                """,
                (product_id, CANDIDATE_LIMIT),
            ).fetchall()

            ratings = conn.execute(
                """
                SELECT rating, COUNT(*)::int AS count
                FROM reviews
                WHERE product_id = %s
                  AND rating IS NOT NULL
                GROUP BY rating
                """,
                (product_id,),
            ).fetchall()

            distribution = {
                str(star): 0 for star in range(5, 0, -1)
            }

            for row in ratings:
                star = max(
                    1,
                    min(5, int(float(row["rating"]) + 0.5)),
                )
                distribution[str(star)] += row["count"]

            scored = score_reviews(reviews)
            selected = select_reviews(
                reviews,
                limit=AI_REVIEW_LIMIT,
                rating_distribution=distribution,
            )

            full_groups = Counter()
            for star, count in distribution.items():
                full_groups[rating_group(int(star))] += count

            full_groups["unrated"] = (
                product["review_count"] - sum(distribution.values())
            )

            selected_groups = Counter(
                rating_group(review["rating"])
                for review, _ in selected
            )

            full_pct = percentages(full_groups)
            selected_pct = percentages(selected_groups)

            # Largest absolute difference between overall and selected
            # rating-group proportions (in percentage points).
            max_deviation = max(
                abs(full_pct[group] - selected_pct[group])
                for group in full_pct
            )

            reports.append({
                "product_id": product_id,
                "name": product["name"],
                "stored": product["review_count"],
                "candidates": len(reviews),
                "selected": len(selected),
                "stats": reliability_summary(scored),
                "full_pct": full_pct,
                "selected_pct": selected_pct,
                "max_deviation": max_deviation,
            })

    print("\n" + "=" * 105)
    print("MCCS REVIEW RELIABILITY REPORT")
    print("=" * 105)

    for report in reports:
        print(
            f"\nProduct {report['product_id']}: "
            f"{report['name']}"
        )
        print(
            f"Reviews: {report['stored']} stored | "
            f"{report['candidates']} candidates | "
            f"{report['selected']} selected for AI"
        )

        print(
            f"Average reliability score: "
            f"{report['stats']['average_score']}/100"
        )

        flags = report["stats"]["flag_counts"]
        print(
            "Reliability flags:",
            flags if flags else "None detected",
        )

        print("\nRating group          All reviews    AI selection")
        for group in ("negative", "neutral", "positive", "unrated"):
            label = group.capitalize()
            print(
                f"{label:<21}"
                f"{report['full_pct'][group]:>6.1f}%"
                f"{report['selected_pct'][group]:>16.1f}%"
            )

        print(
            f"Maximum distribution difference: "
            f"{report['max_deviation']:.1f} percentage points"
        )
        print("-" * 105)

    print("\nOVERALL SUMMARY")
    print(f"Products checked: {len(reports)}")

    average_score = sum(
        report["stats"]["average_score"]
        for report in reports
    ) / len(reports)

    print(
        f"Average reliability across product averages: "
        f"{average_score:.2f}/100"
    )

    print(
        "Largest rating-distribution difference: "
        f"{max(report['max_deviation'] for report in reports):.1f} "
        "percentage points"
    )

    flag_totals = Counter()
    for report in reports:
        flag_totals.update(report["stats"]["flag_counts"])

    print("Combined reliability flags:", dict(flag_totals))


if __name__ == "__main__":
    main()
