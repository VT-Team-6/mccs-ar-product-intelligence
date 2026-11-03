"""Review provider backed by the filtered Amazon Reviews 2023 files."""

import json
import re
from collections import defaultdict
from difflib import SequenceMatcher
from pathlib import Path

from .base import ReviewProvider
from .models import ReviewCandidate, ReviewData


class AmazonDatasetProvider(ReviewProvider):
    source = "amazon"

    def __init__(self, catalog_path: str | Path, reviews_path: str | Path):
        # Read the files once, not on every admin request.
        self.catalog = self._load_catalog(catalog_path)
        self.reviews_by_asin = self._load_reviews(reviews_path)

    @staticmethod
    def _load_catalog(path: str | Path) -> list[dict]:
        with Path(path).open("r", encoding="utf-8") as file:
            data = json.load(file)

        return data["products"]

    @staticmethod
    def _load_reviews(path: str | Path) -> dict[str, list[ReviewData]]:
        # Group review objects by the Amazon parent ASIN.
        reviews_by_asin = defaultdict(list)

        with Path(path).open("r", encoding="utf-8") as file:
            for line in file:
                if not line.strip():
                    continue

                data = json.loads(line)
                asin = data["source_product_id"]
                reviews_by_asin[asin].append(ReviewData.model_validate(data))

        return dict(reviews_by_asin)

    @staticmethod
    def _similarity(query: str, title: str) -> float:
        # Combine word overlap and fuzzy matching so word order matters less.
        query_words = set(re.findall(r"[a-z0-9]+", query.casefold()))
        title_words = set(re.findall(r"[a-z0-9]+", title.casefold()))
        if not query_words or not title_words:
            return 0.0

        overlap = len(query_words & title_words) / len(query_words | title_words)
        fuzzy = SequenceMatcher(None, query.casefold(), title.casefold()).ratio()
        return 0.6 * overlap + 0.4 * fuzzy

    async def search_products(self, query: str) -> list[ReviewCandidate]:
        query = query.strip()
        if not query:
            return []

        matches = []
        for product in self.catalog:
            suggested_targets = product.get("suggested_targets") or []
            amazon_title = product.get("amazon_title") or ""

            # The catalog was generated for specific target shoes, but the
            # Amazon title may help match other search wording.
            titles = [*suggested_targets, amazon_title]
            score = max(
                (self._similarity(query, title) for title in titles if title),
                default=0.0,
            )
            if score < 0.4:
                continue

            asin = product["source_product_id"]
            matches.append(
                (
                    score,
                    ReviewCandidate(
                        source_product_id=asin,
                        title=(
                            max(suggested_targets, key=lambda title: self._similarity(query, title))
                            if suggested_targets else amazon_title
                        ),
                        description=amazon_title or None,
                        url=f"https://www.amazon.com/dp/{asin}",
                        review_count=len(self.reviews_by_asin.get(asin, [])),
                    ),
                )
            )

        matches.sort(key=lambda match: match[0], reverse=True)
        return [candidate for _, candidate in matches[:10]]

    async def get_reviews(self, source_product_id: str) -> list[ReviewData]:
        # Return the reviews for one selected listing, without changing storage.
        return list(self.reviews_by_asin.get(source_product_id, []))
