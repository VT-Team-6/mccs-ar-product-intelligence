"""Read-only review provider for archives made by build_amazon_sqlite.py."""

import asyncio
from contextlib import closing
from difflib import SequenceMatcher
from pathlib import Path
import re
import sqlite3

from .base import ReviewProvider
from .models import ReviewCandidate, ReviewData


class AmazonDatasetProvider(ReviewProvider):
    source = "amazon"
    SEARCH_POOL_SIZE = 250
    RESULT_LIMIT = 10
    _STOP_WORDS = {"a", "an", "and", "for", "in", "of", "the", "to", "with"}

    def __init__(self, database_path: str | Path):
        self.database_path = Path(database_path).expanduser().resolve()
        if not self.database_path.is_file():
            raise FileNotFoundError(
                f"Amazon review archive not found: {self.database_path}. "
                "Run python scripts/build_amazon_sqlite.py short from backend/, "
                "or set AMAZON_REVIEW_DB in backend/.env to an existing archive."
            )
        # Validate once, without reading or caching the catalog/review contents.
        try:
            with closing(self._connect()) as conn:
                conn.execute(
                    "SELECT parent_asin,title,brand,description,source_url,source_rating_count,image_url "
                    "FROM products LIMIT 0"
                )
                conn.execute(
                    "SELECT review_id,parent_asin,rating,title,body,review_date FROM reviews LIMIT 0"
                )
        except sqlite3.DatabaseError as exc:
            raise ValueError(
                f"Invalid Amazon SQLite archive: {self.database_path}. "
                "Expected products/reviews tables from build_amazon_sqlite.py."
            ) from exc

    def _connect(self) -> sqlite3.Connection:
        # New connections per operation are safe across FastAPI worker threads.
        # mode=ro prevents accidental writes or creation of an empty database.
        conn = sqlite3.connect(self.database_path.as_uri() + "?mode=ro", uri=True, timeout=5)
        conn.row_factory = sqlite3.Row
        return conn

    @staticmethod
    def _tokens(text: str) -> list[str]:
        # Join model-number punctuation: WH-1000XM4 matches WH1000XM4.
        text = re.sub(r"(?<=[a-z0-9])[-_/](?=[a-z0-9])", "", text.casefold())
        return re.findall(r"[a-z0-9]+", text)

    @classmethod
    def _similarity(cls, query: str, title: str) -> float:
        query_words, title_words = set(cls._tokens(query)), set(cls._tokens(title))
        if not query_words or not title_words:
            return 0.0
        compact_title = "".join(cls._tokens(title))
        coverage = sum(word in title_words or (len(word) >= 4 and word in compact_title)
                       for word in query_words) / len(query_words)
        overlap = len(query_words & title_words) / len(query_words | title_words)
        fuzzy = SequenceMatcher(None, " ".join(cls._tokens(query)), " ".join(cls._tokens(title))).ratio()
        # Query coverage matters more than title length: real Amazon titles can
        # be much longer than an app product name.
        return .65 * coverage + .10 * overlap + .25 * fuzzy

    async def search_products(self, query: str) -> list[ReviewCandidate]:
        query = query.strip()[:200]
        if not query:
            return []
        return await asyncio.to_thread(self._search_products, query)

    def _search_products(self, query: str) -> list[ReviewCandidate]:
        tokens = list(dict.fromkeys(word for word in self._tokens(query)
                                   if word not in self._STOP_WORDS))[:12]
        if not tokens:
            return []
        search_query = " ".join(tokens)
        # Scan only product metadata, not review text. SQLite narrows the pool
        # before Python fuzzy-ranks at most SEARCH_POOL_SIZE candidates. This
        # also works on existing archives without creating an FTS sidecar/index.
        text = "lower(title || ' ' || coalesce(brand,''))"
        compact = f"replace(replace(replace(replace({text},'-',''),' ',''),'_',''),'/','')"
        terms = [f"CASE WHEN instr({text},?)>0 OR instr({compact},?)>0 THEN 1 ELSE 0 END"
                 for _ in tokens]
        params = [part for token in tokens for part in (token, token)]
        sql = f"""
            WITH candidates AS (
                SELECT parent_asin,title,brand,description,source_url,source_rating_count,image_url,
                       ({' + '.join(terms)}) AS token_matches
                FROM products p
                WHERE EXISTS (SELECT 1 FROM reviews r WHERE r.parent_asin=p.parent_asin)
            )
            SELECT * FROM candidates
            WHERE token_matches>0 OR parent_asin=?
            ORDER BY (parent_asin=?) DESC, token_matches DESC,
                     coalesce(source_rating_count,0) DESC, parent_asin
            LIMIT ?
        """
        with closing(self._connect()) as conn:
            rows = conn.execute(sql, [*params, query.upper(), query.upper(), self.SEARCH_POOL_SIZE]).fetchall()
            matches = []
            for row in rows:
                exact_asin = row["parent_asin"].casefold() == query.casefold()
                title = row["title"]
                score = 1.0 if exact_asin else self._similarity(search_query, title + " " + (row["brand"] or ""))
                if score >= .4:
                    matches.append((score, row))
            matches.sort(key=lambda item: (-item[0], -(item[1]["source_rating_count"] or 0), item[1]["parent_asin"]))
            results = []
            for _, row in matches[:self.RESULT_LIMIT]:
                review_count = conn.execute(
                    "SELECT count(*) FROM reviews WHERE parent_asin=?", (row["parent_asin"],)
                ).fetchone()[0]
                results.append(ReviewCandidate(
                    source_product_id=row["parent_asin"], title=row["title"],
                    description=row["description"] or None,
                    url=row["source_url"] or f"https://www.amazon.com/dp/{row['parent_asin']}",
                    review_count=review_count,
                    image_url=row["image_url"] or None,
                ))
            return results

    async def get_reviews(self, source_product_id: str) -> list[ReviewData]:
        return await asyncio.to_thread(self._get_reviews, source_product_id.strip())

    def _get_reviews(self, source_product_id: str) -> list[ReviewData]:
        with closing(self._connect()) as conn:
            rows = conn.execute(
                """
                SELECT review_id AS source_review_id,rating,title,body,review_date
                FROM reviews WHERE parent_asin=?
                ORDER BY review_date IS NULL, review_date DESC, review_id
                """,
                (source_product_id,),
            ).fetchall()
        return [ReviewData.model_validate(dict(row)) for row in rows]
