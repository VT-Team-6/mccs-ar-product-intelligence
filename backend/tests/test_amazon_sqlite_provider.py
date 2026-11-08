"""Offline provider/importer regression tests; no PostgreSQL or network needed."""

import asyncio
from contextlib import closing
import hashlib
import importlib
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
from services.reviews.amazon_dataset import AmazonDatasetProvider
from services.reviews.models import ReviewCandidate, ReviewData


class AmazonSQLiteTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "archive with spaces.sqlite"
        with closing(sqlite3.connect(self.path)) as conn:
            conn.executescript("""
                CREATE TABLE products(parent_asin TEXT PRIMARY KEY,title TEXT,brand TEXT,
                    description TEXT,source_url TEXT,source_rating_count INTEGER,image_url TEXT);
                CREATE TABLE reviews(review_id TEXT PRIMARY KEY,parent_asin TEXT,rating REAL,
                    title TEXT,body TEXT,review_date TEXT);
                CREATE INDEX review_lookup ON reviews(parent_asin);
            """)
            conn.executemany("INSERT INTO products(parent_asin,title,brand,description,source_url,source_rating_count) VALUES (?,?,?,?,?,?)", [
                ("SHOE", "Timberland Premium Waterproof Boots for Men, Comfortable Everyday Footwear", "Timberland", "Boot description", "https://example.test/boot", 500),
                ("HEAD", "Sony WH-1000XM4 Wireless Over Ear Noise Canceling Headphones with Microphone", "Sony", "Headphones", None, 1000),
                ("COFFEE", "Medium Roast Ground Coffee 12 Ounce Bag", "Cafe", None, None, 100),
                ("WASH", "Daily Moisturizing Shampoo 400 ml", "Clean", None, None, 150),
                ("PACK", "Laptop Backpack with Storage Pockets", "Bags", None, None, 200),
                ("EMPTY", "Sony WH1000XM4 Headphones Metadata Only", "Sony", None, None, 999999),
            ])
            conn.execute("UPDATE products SET image_url='https://example.test/boot.jpg' WHERE parent_asin='SHOE'")
            conn.executemany("INSERT INTO reviews VALUES (?,?,?,?,?,?)", [
                ("boot-a", "SHOE", 4.5, "Comfortable", "Comfortable on long walks with good support.", "2023-05-01T12:00:00+00:00"),
                ("boot-b", "SHOE", 2.0, None, "The sole wore out after only a few months of use.", None),
                ("head-a", "HEAD", 5, "Sound", "Excellent sound and noise cancellation.", "2023-01-01T00:00:00+00:00"),
                ("coffee-a", "COFFEE", 4, None, "Good coffee", None),
                ("wash-a", "WASH", 3, None, "Ordinary shampoo", None),
                ("pack-a", "PACK", 5, None, "Good backpack", None),
            ])
            conn.commit()
        self.provider = AmazonDatasetProvider(self.path)

    async def test_each_product_type_can_be_found(self):
        for query, asin in [("Timberland boots", "SHOE"), ("Sony WH1000XM4", "HEAD"),
                            ("ground coffee", "COFFEE"), ("shampoo", "WASH"), ("backpack", "PACK")]:
            with self.subTest(query=query):
                rows = await self.provider.search_products(query)
                self.assertTrue(rows)
                self.assertEqual(rows[0].source_product_id, asin)
                self.assertTrue(all(isinstance(r, ReviewCandidate) for r in rows))

    async def test_metadata_only_products_are_not_selectable(self):
        rows = await self.provider.search_products("Sony WH1000XM4")
        self.assertEqual([r.source_product_id for r in rows], ["HEAD"])
        self.assertEqual(rows[0].review_count, 1)

    async def test_exact_asin_and_no_matches(self):
        rows = await self.provider.search_products(" head ")
        self.assertEqual(rows[0].source_product_id, "HEAD")
        for query in ("", "   ", "%_!", "the and for", "zzzzunavailable"):
            self.assertEqual(await self.provider.search_products(query), [])

    async def test_reviews_keep_stable_ids_fractional_rating_and_dates(self):
        rows = await self.provider.get_reviews("SHOE")
        self.assertEqual([r.source_review_id for r in rows], ["boot-a", "boot-b"])
        self.assertTrue(all(isinstance(r, ReviewData) for r in rows))
        self.assertEqual(rows[0].rating, 4.5)
        self.assertEqual(rows[0].review_date.year, 2023)
        self.assertIsNone(rows[1].review_date)
        self.assertIsNone(rows[1].title)
        self.assertEqual(await self.provider.get_reviews("UNKNOWN"), [])
        self.assertEqual(await self.provider.get_reviews("SHOE' OR 1=1 --"), [])

    async def test_same_response_fields_as_existing_frontend_contract(self):
        candidate = (await self.provider.search_products("Timberland boots"))[0]
        self.assertEqual(set(candidate.model_dump()),
                         {"source_product_id", "title", "description", "url", "review_count", "image_url"})
        self.assertEqual(candidate.review_count, 2)
        self.assertEqual(candidate.description, "Boot description")
        self.assertEqual(candidate.image_url,"https://example.test/boot.jpg")
        coffee = (await self.provider.search_products("ground coffee"))[0]
        self.assertIsNone(coffee.description)
        self.assertIsNone(coffee.image_url)
        review = (await self.provider.get_reviews("SHOE"))[0]
        self.assertEqual(set(review.model_dump()),
                         {"source_review_id", "rating", "title", "body", "review_date"})

    async def test_parallel_calls_do_not_share_thread_bound_connections_or_write(self):
        before = hashlib.sha256(self.path.read_bytes()).digest()
        results = await asyncio.gather(*[self.provider.get_reviews("SHOE") for _ in range(12)],
                                       *[self.provider.search_products("ground coffee") for _ in range(12)])
        self.assertTrue(all(results))
        self.assertEqual(hashlib.sha256(self.path.read_bytes()).digest(), before)
        with closing(self.provider._connect()) as conn:
            with self.assertRaises(sqlite3.OperationalError):
                conn.execute("DELETE FROM reviews")

    async def test_search_limit_and_actual_counts(self):
        with closing(sqlite3.connect(self.path)) as conn:
            for n in range(30):
                asin = f"EXTRA{n}"
                conn.execute("INSERT INTO products(parent_asin,title,brand,description,source_url,source_rating_count) VALUES (?,?,?,?,?,?)", (asin, "Daily shampoo", "Clean", None, None, n))
                conn.execute("INSERT INTO reviews VALUES (?,?,?,?,?,?)", (asin, asin, 4, None, "Nice shampoo", None))
            conn.commit()
        rows = await self.provider.search_products("shampoo")
        self.assertEqual(len(rows), 10)
        self.assertTrue(all(r.review_count == 1 for r in rows))

    def test_missing_or_wrong_database_is_clear_and_never_created(self):
        missing = self.path.parent / "missing.sqlite"
        with self.assertRaisesRegex(FileNotFoundError, "AMAZON_REVIEW_DB"):
            AmazonDatasetProvider(missing)
        self.assertFalse(missing.exists())
        bad = self.path.parent / "wrong.sqlite"
        bad.write_text("not SQLite")
        with self.assertRaisesRegex(ValueError, "Invalid Amazon SQLite archive"):
            AmazonDatasetProvider(bad)

    def test_registry_uses_explicit_archive_from_environment(self):
        with patch.dict(os.environ, {"AMAZON_REVIEW_DB": str(self.path)}):
            # Reload so this test works independently of importer test ordering.
            registry = importlib.import_module("services.reviews.registry")
            registry = importlib.reload(registry)
            self.assertEqual(registry.get_provider("amazon").database_path, self.path)
            with self.assertRaisesRegex(ValueError, "Unsupported review source"):
                registry.get_provider("unknown")

    def test_registry_relative_paths_are_based_on_backend_directory(self):
        relative = os.path.relpath(self.path, BACKEND)
        with patch.dict(os.environ, {"AMAZON_REVIEW_DB": relative}):
            registry = importlib.import_module("services.reviews.registry")
            registry = importlib.reload(registry)
            self.assertEqual(registry.get_provider("amazon").database_path, self.path)

    async def test_existing_importer_accepts_sqlite_provider_and_repeat_import(self):
        # Exercise the real importer against an isolated DB-API adapter. Production
        # PostgreSQL, Cognito and the running app are never contacted by this test.
        with patch.dict(os.environ, {"AMAZON_REVIEW_DB": str(self.path)}):
            importer = importlib.import_module("services.reviews.importer")
        destination = sqlite3.connect(":memory:")
        self.addCleanup(destination.close)
        destination.row_factory = sqlite3.Row
        destination.executescript("""
            CREATE TABLE product_review_sources(review_source_id INTEGER PRIMARY KEY,
                product_id INTEGER,source TEXT,source_product_id TEXT,last_fetched_at TEXT);
            CREATE TABLE reviews(product_id INTEGER,review_source_id INTEGER,source_review_id TEXT,
                rating REAL,title TEXT,body TEXT,review_date TEXT,
                UNIQUE(review_source_id,source_review_id));
            INSERT INTO product_review_sources VALUES (1,42,'amazon','SHOE',NULL);
        """)

        class CursorAdapter:
            def __enter__(self):
                self.cursor = destination.cursor()
                return self

            def __exit__(self, *args):
                self.cursor.close()

            def execute(self, sql, params=()):
                self.cursor.execute(sql.replace("%s", "?"), params)

            def fetchall(self):
                return self.cursor.fetchall()

            @property
            def rowcount(self):
                return self.cursor.rowcount

        class ConnectionAdapter:
            def cursor(self):
                return CursorAdapter()

            def commit(self):
                destination.commit()

            def rollback(self):
                destination.rollback()

        with patch.object(importer, "get_provider", return_value=self.provider):
            for _ in range(2):
                result = await importer.ReviewImporter().import_product_reviews(ConnectionAdapter(), 42)
                self.assertEqual(result.imported_reviews, 2)
                self.assertEqual(result.available_reviews, 2)
                self.assertEqual(destination.execute("SELECT count(*) FROM reviews").fetchone()[0], 2)
            self.assertEqual(destination.execute("SELECT rating FROM reviews WHERE source_review_id='boot-a'").fetchone()[0], 4.5)
            self.assertIsNotNone(destination.execute("SELECT last_fetched_at FROM product_review_sources").fetchone()[0])
            destination.execute("UPDATE product_review_sources SET source_product_id='MISSING'")
            destination.commit()
            with self.assertRaisesRegex(ValueError, "existing reviews were kept"):
                await importer.ReviewImporter().import_product_reviews(ConnectionAdapter(), 42)
            self.assertEqual(destination.execute("SELECT count(*) FROM reviews").fetchone()[0], 2)


if __name__ == "__main__":
    unittest.main()
