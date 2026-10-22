"""Import reviews from admin-approved provider listings into PostgreSQL.

The provider registry supplies standardized ReviewData objects; this module
alone handles review selection and database persistence.

Pass a psycopg/psycopg2 DB-API connection to import_product_reviews(). The
method commits on success and rolls back on failure, so give it ownership of
that connection/transaction.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from hashlib import sha256
from typing import Any

from .models import ReviewData
from .registry import get_provider


@dataclass(frozen=True)
class ImportResult:
    product_id: int
    source_count: int
    available_reviews: int
    imported_reviews: int


@dataclass(frozen=True)
class _Source:
    review_source_id: int
    source: str
    source_product_id: str


class ReviewImporter:
    async def import_product_reviews(
        self,
        conn: Any,
        product_id: int,
        *,
        max_reviews: int = 100,
        remove_seed_reviews: bool = True,
    ) -> ImportResult:
        """Refresh reviews from all approved listings for one app product.

        An approved listing has a non-NULL source_product_id in
        product_review_sources. Placeholder search URLs are ignored.

        Retrieving reviews happens before modifying the tables. Once retrieval
        succeeds, the existing reviews for approved listings are replaced in
        one transaction. The source rows themselves are preserved.
        """
        if product_id < 1:
            raise ValueError("product_id must be a positive integer")
        if max_reviews < 1:
            raise ValueError("max_reviews must be at least 1")

        try:
            # Find approved listings, skipping placeholder source rows.
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT review_source_id, source, source_product_id
                    FROM product_review_sources
                    WHERE product_id = %s
                      AND source_product_id IS NOT NULL
                    ORDER BY review_source_id
                    """,
                    (product_id,),
                )
                sources = [
                    _Source(
                        review_source_id=row["review_source_id"],
                        source=row["source"],
                        source_product_id=row["source_product_id"],
                    )
                    for row in cursor.fetchall()
                ]

            if not sources:
                raise ValueError(
                    f"Product {product_id} has no approved review listings"
                )

            # Retrieve reviews from each listing through its provider.
            buckets: list[deque[tuple[int, ReviewData]]] = []
            for source in sources:
                provider = get_provider(source.source)
                reviews = await provider.get_reviews(source.source_product_id)
                buckets.append(
                    deque(
                        (source.review_source_id, review)
                        for review in reviews
                        if review.body.strip()
                    )
                )

            available_reviews = sum(len(bucket) for bucket in buckets)
            if available_reviews == 0:
                raise ValueError(
                    f"No reviews available for product {product_id}; existing reviews were kept"
                )
            # Deduplicate and select up to max_reviews across all listings.
            selected = self._select_reviews(buckets, max_reviews)

            # Replace existing imports after retrieval has succeeded.
            with conn.cursor() as cursor:
                # Remove previously imported reviews, but only for approved
                # listing records. Removed listings cascade through the FK.
                cursor.execute(
                    """
                    DELETE FROM reviews
                    WHERE product_id = %s
                      AND review_source_id IN (
                          SELECT review_source_id
                          FROM product_review_sources
                          WHERE product_id = %s
                            AND source_product_id IS NOT NULL
                      )
                    """,
                    (product_id, product_id),
                )

                if remove_seed_reviews:
                    cursor.execute(
                        """
                        DELETE FROM reviews
                        WHERE product_id = %s
                          AND source_review_id LIKE 'seed-%%'
                        """,
                        (product_id,),
                    )

                inserted = 0
                for review_source_id, review in selected:
                    source_review_id = self._review_id(review)
                    cursor.execute(
                        """
                        INSERT INTO reviews (
                            product_id, review_source_id, source_review_id,
                            rating, title, body, review_date
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT DO NOTHING
                        """,
                        (
                            product_id,
                            review_source_id,
                            source_review_id,
                            review.rating,
                            review.title,
                            review.body,
                            review.review_date,
                        ),
                    )
                    inserted += cursor.rowcount

                # Track when each selected listing was last imported.
                for source in sources:
                    cursor.execute(
                        """
                        UPDATE product_review_sources
                        SET last_fetched_at = CURRENT_TIMESTAMP
                        WHERE review_source_id = %s AND product_id = %s
                        """,
                        (source.review_source_id, product_id),
                    )

            conn.commit()
            return ImportResult(
                product_id=product_id,
                source_count=len(sources),
                available_reviews=available_reviews,
                imported_reviews=inserted,
            )
        except Exception:
            conn.rollback()
            raise

    @staticmethod
    def _review_id(review: ReviewData) -> str:
        """Use a stable fallback ID when a provider supplies no review ID."""
        if review.source_review_id:
            return review.source_review_id
        material = "\x1f".join(
            (
                review.title or "",
                review.body,
                str(review.rating),
                review.review_date.isoformat() if review.review_date else "",
            )
        )
        return "generated-" + sha256(material.encode("utf-8")).hexdigest()

    @staticmethod
    def _select_reviews(
        buckets: list[deque[tuple[int, ReviewData]]], max_reviews: int
    ) -> list[tuple[int, ReviewData]]:
        """Round-robin across listings and remove repeated IDs/content."""
        selected: list[tuple[int, ReviewData]] = []
        seen_ids: set[tuple[int, str]] = set()
        seen_content: set[str] = set()

        while len(selected) < max_reviews and any(buckets):
            for bucket in buckets:
                if not bucket:
                    continue
                review_source_id, review = bucket.popleft()
                source_key = (review_source_id, ReviewImporter._review_id(review))

                # Dedupe substantial identical review text across listings.
                # Don't merge very short/generic reviews like "Great!".
                normalized_body = " ".join(review.body.casefold().split())
                content_key = (
                    sha256(normalized_body.encode("utf-8")).hexdigest()
                    if len(normalized_body) >= 40
                    else None
                )
                if source_key in seen_ids or (
                    content_key is not None and content_key in seen_content
                ):
                    continue
                seen_ids.add(source_key)
                if content_key is not None:
                    seen_content.add(content_key)
                selected.append((review_source_id, review))
                if len(selected) >= max_reviews:
                    break

        return selected
