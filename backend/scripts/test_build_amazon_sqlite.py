"""Offline checks: python -m unittest discover -s scripts -p test_build_amazon_sqlite.py"""
import gzip
import importlib.util
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("builder", HERE / "build_amazon_sqlite.py")
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)


def product(asin, title, categories, **extra):
    return dict(parent_asin=asin, title=title, categories=categories,
                rating_number=250, average_rating=4.2, details={}, **extra)


def examples():
    return {
        "Clothing_Shoes_and_Jewelry": [
            product("SHOE", "Brand running shoes", ["Shoes", "Running Shoes"]),
            product("PACK", "Brand daypack", ["Backpacks"]),
            product("LACES", "Replacement shoe laces", ["Shoes", "Shoe Laces"])],
        "Amazon_Fashion": [],
        "Sports_and_Outdoors": [],
        "Electronics": [
            product("HEAD", "Wireless over-ear headphones", ["Headphones"]),
            product("EAR", "Wireless earbuds with charging case", ["Earbud Headphones"]),
            product("CASE", "Case for headphones", ["Headphones", "Cases"])],
        "Beauty_and_Personal_Care": [
            product("WASH", "Daily shampoo 12 fl oz", ["Shampoos"]),
            product("BIGWASH", "Daily shampoo 1 gallon", ["Shampoos"]),
            product("MULTIWASH", "Daily shampoo 12 fl oz pack of 3", ["Shampoos"])],
        "Grocery_and_Gourmet_Food": [
            product("COFFEE", "Medium roast ground coffee 12 oz", ["Ground Coffee"]),
            product("BULKCOFFEE", "Ground coffee 5 pounds", ["Ground Coffee"]),
            product("PODS", "Ground coffee pods 12 oz", ["Ground Coffee"])],
    }


def make_fixture(root):
    fixtures = examples()
    for source, products in fixtures.items():
        for phase in ("meta_categories", "review_categories"):
            folder = root / phase
            folder.mkdir(exist_ok=True)
            filename = ("meta_" if phase == "meta_categories" else "") + source + ".jsonl.gz"
            rows = products if phase == "meta_categories" else [
                dict(parent_asin=p["parent_asin"], asin=p["parent_asin"], user_id=f"u{n}",
                     text=f"Review {n}: {'good' if n % 5 else 'bad'}", rating=float(n % 5 + 1),
                     title="Review", timestamp=1600000000000 + n, verified_purchase=True, helpful_vote=n)
                for p in products for n in range(30)]
            with gzip.open(folder / filename, "wt", encoding="utf-8") as f:
                for row in rows:
                    f.write(json.dumps(row) + "\n")


class Filters(unittest.TestCase):
    def setUp(self):
        self.args = b.parser().parse_args(["short"])

    def test_expected_types_and_exclusions(self):
        accepted = {}
        for source, rows in examples().items():
            for row in rows:
                result, reason = b.classify(row, source, self.args)
                if result:
                    accepted[row["parent_asin"]] = result["product_type"]
        self.assertEqual(accepted, {"SHOE":"shoes", "PACK":"backpacks", "HEAD":"headphones",
                                    "EAR":"headphones", "WASH":"shampoo", "COFFEE":"ground_coffee"})

    def test_structured_category_without_name_keyword(self):
        row = product("ABC", "Brand Model 123", ["Electronics", "Over-Ear Headphones"])
        result, _ = b.classify(row, "Electronics", self.args)
        self.assertEqual(result["matched_by"], "category")

    def test_broad_clothing_category_does_not_make_everything_shoes(self):
        row = product("NO", "Cotton crewneck shirt", ["Clothing, Shoes & Jewelry", "Men", "Clothing", "Shirts"])
        result, _ = b.classify(row, "Clothing_Shoes_and_Jewelry", self.args)
        self.assertIsNone(result)
        row = product("YES", "Brand Model 123", ["Clothing, Shoes & Jewelry", "Men", "Shoes", "Running"])
        result, _ = b.classify(row, "Clothing_Shoes_and_Jewelry", self.args)
        self.assertEqual(result["matched_category"], "Shoes")

    def test_broad_accessory_categories_and_incidental_mentions(self):
        rows = [
            ("Electronics", "Silicone AirPods Case Cover", ["Headphones, Earbuds & Accessories"]),
            ("Sports_and_Outdoors", "Water bottle fits in backpacks", []),
            ("Sports_and_Outdoors", "Portable umbrella for travel, backpack compatible", []),
            ("Sports_and_Outdoors", "Folding backpack beach chair", []),
            ("Beauty_and_Personal_Care", "Solid shampoo bar 4 oz", ["Shampoos"]),
        ]
        for source, title, cats in rows:
            with self.subTest(title=title):
                result, _ = b.classify(product("X", title, cats), source, self.args)
                self.assertIsNone(result)
        row = product("X", "Backpack with shoe compartment", ["Backpacks"])
        result, _ = b.classify(row, "Clothing_Shoes_and_Jewelry", self.args)
        self.assertEqual(result["product_type"], "backpacks")

    def test_fallback_and_nested_categories(self):
        row = product("ABC", "Running sneakers", [])
        result, _ = b.classify(row, "Sports_and_Outdoors", self.args)
        self.assertEqual(result["matched_by"], "title_fallback")
        row["categories"] = [["Clothing", "Running Shoes"]]
        result, _ = b.classify(row, "Sports_and_Outdoors", self.args)
        self.assertEqual(result["matched_by"], "category")

    def test_package_rules(self):
        cases = [
            ("Daily shampoo 500 ml", "shampoo", True),
            ("Daily shampoo 33.8 fl oz", "shampoo", True),
            ("Daily shampoo 1.5 liters", "shampoo", False),
            ("Daily shampoo", "shampoo", False),
            ("Ground coffee 340 grams", "ground_coffee", True),
            ("Ground coffee 1 lb", "ground_coffee", True),
            ("Ground coffee 2 lb", "ground_coffee", False),
            ("Ground coffee 12 oz (pack of 2)", "ground_coffee", False),
            ("Ground coffee 12 oz 2-pack", "ground_coffee", False),
            ("Ground coffee 3 x 12 oz", "ground_coffee", False),
            ("Ground coffee 12 oz variety pack", "ground_coffee", False),
        ]
        for title, kind, allowed in cases:
            with self.subTest(title=title):
                self.assertEqual(b.package_problem(dict(title=title), kind, self.args) is None, allowed)

    def test_details_size_and_multipack(self):
        row = dict(title="Brand shampoo", details=json.dumps({"Item Volume":"400 Milliliters", "Number of Items":"1"}))
        self.assertIsNone(b.package_problem(row, "shampoo", self.args))
        row["details"] = {"Item Volume":"400 Milliliters", "Number of Items":"3"}
        self.assertEqual(b.package_problem(row, "shampoo", self.args), "multipack")

    def test_main_image(self):
        row = product("ABC", "Shoes", ["Shoes"], images=[
            {"variant":"PT01", "large":"other"}, {"variant":"MAIN", "large":"main"}])
        result, _ = b.classify(row, "Clothing_Shoes_and_Jewelry", self.args)
        self.assertEqual(result["image_url"], "main")


class Sampling(unittest.TestCase):
    @staticmethod
    def add_product(conn, asin, rating_count):
        conn.execute("INSERT INTO products(parent_asin,product_type,title,source_category,matched_by,"
                     "categories_json,details_json,source_url,source_rating_count) "
                     "VALUES (?,'shoes',?,'Clothing_Shoes_and_Jewelry','category','[]','{}','url',?)",
                     (asin, asin + ' shoes', rating_count))

    def test_hash_sample_is_order_independent_and_summaries_cover_all(self):
        selected = []
        for reverse in (False, True):
            conn = sqlite3.connect(":memory:")
            conn.executescript(b.SCHEMA)
            conn.execute("INSERT INTO products(parent_asin,product_type,title,source_category,matched_by,categories_json,details_json,source_url) "
                         "VALUES ('X','shoes','Shoe','Clothing_Shoes_and_Jewelry','category','[]','{}','url')")
            sampler = b.ReviewSampler(conn, 10, "fixed")
            rows = [dict(parent_asin="X", text=f"Text {n}", user_id=str(n), rating=n%5+1,
                         timestamp=1600000000000+n) for n in range(200)]
            for row in reversed(rows) if reverse else rows:
                sampler.consume(row)
            sampler.consume(dict(parent_asin="X", text="", rating=1))
            sampler.flush()
            selected.append(conn.execute("SELECT review_id FROM reviews ORDER BY review_id").fetchall())
            self.assertEqual(len(selected[-1]), 10)
            self.assertEqual(conn.execute("SELECT available_review_count,available_text_review_count,saved_review_count "
                                          "FROM products").fetchone(), (201,200,10))
            self.assertTrue(conn.execute("SELECT review_date FROM reviews LIMIT 1").fetchone()[0].startswith("2020-"))
            conn.close()
        self.assertEqual(*selected)

    def test_pool_is_bounded(self):
        pool = b.ProductPool(10, "fixed")
        for n in range(1000):
            pool.consider(dict(parent_asin=str(n), product_type="shoes", source_rating_count=n))
        self.assertLessEqual(len(pool.rows), 20)
        self.assertEqual(len(pool.selected()), 10)
        self.assertIn("999", {r["parent_asin"] for r in pool.selected()})

    def test_full_pool_replaces_early_unpopular_metadata(self):
        for seed in ("one", "two"):
            pool = b.ProductPool(10, seed, popular_only=True)
            for n in range(1000):
                pool.consider(dict(parent_asin=str(n), product_type="shoes", source_rating_count=n))
            self.assertEqual({r["parent_asin"] for r in pool.selected()}, {str(n) for n in range(990,1000)})
            self.assertLessEqual(len(pool.rows), 10)

    def test_late_popular_reviews_replace_early_unpopular_and_reuse_pages(self):
        conn = sqlite3.connect(":memory:")
        self.addCleanup(conn.close)
        conn.executescript(b.SCHEMA)
        self.add_product(conn, "LOW", 2)
        self.add_product(conn, "HIGH", 20000)
        sampler = b.ReviewSampler(conn, 10, "fixed")
        for n in range(8):
            sampler.consume(dict(parent_asin="LOW",text=str(n)+"x"*20000,rating=1,user_id=str(n)))
        file_before = b.db_bytes(conn)
        td = tempfile.TemporaryDirectory()
        self.addCleanup(td.cleanup)
        logs = []
        budget = b.PopularityBudget(conn, file_before+1000, logs.append, Path(td.name), heartbeat=1)
        self.addCleanup(budget.close)
        sampler.popularity_budget = budget
        sampler.consume(dict(parent_asin="HIGH",text="Popular product review"+"y"*20000,rating=5))
        sampler.consume(dict(parent_asin="LOW",text="Later unpopular review",rating=1))
        sampler.flush()
        self.assertEqual(conn.execute("SELECT parent_asin FROM products").fetchall(), [("HIGH",)])
        self.assertEqual(conn.execute("SELECT parent_asin FROM reviews").fetchall(), [("HIGH",)])
        self.assertLessEqual(b.db_bytes(conn), file_before)
        self.assertGreater(budget.summary()["reusable_page_bytes_freed"], 0)
        self.assertEqual(budget.summary()["evicted_saved_reviews"], 8)
        self.assertEqual(budget.summary()["skipped_review_records_from_evicted_products"], 1)
        self.assertTrue(any("SIZE_CAP HIT" in line for line in logs))
        audit = [json.loads(line) for line in budget.audit_path.read_text().splitlines()]
        self.assertEqual(audit[0]["parent_asin"], "LOW")
        self.assertEqual(audit[0]["incoming_parent_asin"], "HIGH")
        self.assertNotIn("LOW", sampler.stats)

    def test_low_priority_incoming_cannot_displace_popular_product(self):
        conn = sqlite3.connect(":memory:")
        self.addCleanup(conn.close)
        conn.executescript(b.SCHEMA)
        self.add_product(conn, "LOW", 2)
        self.add_product(conn, "HIGH", 20000)
        sampler = b.ReviewSampler(conn, 10, "fixed")
        for n in range(3):
            sampler.consume(dict(parent_asin="HIGH",text=str(n)+"x"*20000,rating=5,user_id=str(n)))
        td = tempfile.TemporaryDirectory()
        self.addCleanup(td.cleanup)
        budget = b.PopularityBudget(conn,b.db_bytes(conn)+1000,lambda line: None,Path(td.name))
        self.addCleanup(budget.close)
        sampler.popularity_budget = budget
        sampler.consume(dict(parent_asin="LOW",text="New low-priority review"+"y"*20000,rating=1))
        self.assertEqual(conn.execute("SELECT parent_asin FROM reviews").fetchall(), [("HIGH",)]*3)
        self.assertIn("LOW",budget.evicted)
        self.assertNotIn("HIGH",budget.evicted)

    def test_within_type_rank_keeps_smaller_category_competitive(self):
        conn = sqlite3.connect(":memory:")
        self.addCleanup(conn.close)
        conn.executescript(b.SCHEMA)
        self.add_product(conn,"TOP_SHOE",100000)
        self.add_product(conn,"OTHER_SHOE",5000)
        self.add_product(conn,"TOP_COFFEE",10)
        conn.execute("UPDATE products SET product_type='ground_coffee' WHERE parent_asin='TOP_COFFEE'")
        sampler=b.ReviewSampler(conn,10,"fixed")
        for n in range(8):
            sampler.consume(dict(parent_asin="OTHER_SHOE",text=str(n)+"x"*20000,rating=4,user_id=str(n)))
        td=tempfile.TemporaryDirectory()
        self.addCleanup(td.cleanup)
        budget=b.PopularityBudget(conn,b.db_bytes(conn)+1000,lambda line: None,Path(td.name))
        self.addCleanup(budget.close)
        sampler.popularity_budget=budget
        sampler.consume(dict(parent_asin="TOP_COFFEE",text="Coffee review"+"y"*20000,rating=5))
        self.assertIn("OTHER_SHOE",budget.evicted)
        self.assertNotIn("TOP_COFFEE",budget.evicted)


class EndToEnd(unittest.TestCase):
    def run_build(self, root, mode, extra=(), timeout=30):
        return subprocess.run([sys.executable, str(HERE / "build_amazon_sqlite.py"), mode,
            "--source-dir", str(root / "source"), "--output", str(root / f"{mode}.sqlite"),
            "--reviews-per-product", "10", "--products-per-type", "10", "--heartbeat", "1", *extra],
            capture_output=True, text=True, timeout=timeout)

    def test_both_modes_and_reports(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "source").mkdir()
            make_fixture(root / "source")
            for mode in ("short", "full"):
                with self.subTest(mode=mode):
                    result = self.run_build(root, mode)
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                    conn = sqlite3.connect(root / f"{mode}.sqlite")
                    self.assertEqual(conn.execute("SELECT count(*) FROM products").fetchone()[0], 6)
                    self.assertEqual(conn.execute("SELECT count(*) FROM reviews").fetchone()[0], 60)
                    self.assertEqual(conn.execute("SELECT sum(review_scan_complete) FROM products").fetchone()[0], 6)
                    self.assertEqual(conn.execute("PRAGMA integrity_check").fetchone()[0], "ok")
                    self.assertEqual(conn.execute("PRAGMA foreign_key_check").fetchall(), [])
                    conn.close()
                    reports = root / f"{mode}_reports"
                    self.assertEqual(len(list(reports.glob("*_top_50.txt"))), 5)
                    summary = json.loads((reports / "build_summary.json").read_text())
                    self.assertEqual(summary["status"], "complete")
                    self.assertEqual(summary["coverage"]["headphones"]["saved_reviews"], 20)
                    if mode == "full":
                        self.assertFalse(summary["size_cap"]["reached"])
                        self.assertEqual(summary["size_cap"]["evicted_products"],0)
                        self.assertEqual((reports/"size_cap_evictions.jsonl").read_text(),"")
                        self.assertIn("SIZE_CAP FINAL: reached=False",result.stdout)
                    else:
                        self.assertNotIn("size_cap",summary)
                    candidates = json.loads((reports / "seed_candidates.json").read_text())
                    self.assertEqual(len(candidates), 6)
                    self.assertIn("FIRST_RECORD", result.stdout)
                    self.assertIn("HEARTBEAT", result.stdout)
            result = self.run_build(root, "full")
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("nothing was overwritten", result.stderr)

    def test_source_failure_reports(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            result = self.run_build(root, "short")
            self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
            report = json.loads((root / "short_reports" / "build_summary.json").read_text())
            self.assertEqual(report["status"], "no_products")
            self.assertTrue(all(s["status"] == "error" for s in report["sources"]))

    def test_short_deadline(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "source").mkdir()
            make_fixture(root / "source")
            started = time.monotonic()
            result = self.run_build(root, "short", ["--minutes", ".02"])
            self.assertLess(time.monotonic()-started, 8)
            self.assertIn(result.returncode, (0,2), result.stdout + result.stderr)
            self.assertTrue((root / "short_reports" / "SUMMARY.txt").exists())

    def test_size_budget_stops_cleanly(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "source").mkdir()
            make_fixture(root / "source")
            path = root / "source" / "review_categories" / "Clothing_Shoes_and_Jewelry.jsonl.gz"
            with gzip.open(path, "wt", encoding="utf-8") as file:
                for n in range(500):
                    file.write(json.dumps(dict(parent_asin="SHOE", text=str(n)+"x"*20000,
                                               user_id=str(n), rating=4)) + "\n")
            # Short retains its original stop-at-ceiling policy.
            result = self.run_build(root, "short", ["--target-gb", ".001", "--reviews-per-product", "100"])
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            summary = json.loads((root / "short_reports" / "build_summary.json").read_text())
            self.assertEqual(summary["reviews_stop"], "size_limit")
            self.assertLessEqual((root / "short.sqlite").stat().st_size, 1_000_000)
            self.assertEqual(summary["status"], "partial")

    def test_full_cap_keeps_scanning_and_logs_impact(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "source").mkdir()
            make_fixture(root / "source")
            source = "Clothing_Shoes_and_Jewelry"
            metadata = examples()[source]
            low = []
            for n in range(8):
                row = product(f"LOW{n}",f"Low review count running shoes {n}",["Shoes"])
                row["rating_number"] = n+1
                low.append(row)
            high = product("LATEHIGH","Popular running shoes",["Shoes"])
            high["rating_number"] = 50000
            metadata += low + [high]
            meta_path = root/"source"/"meta_categories"/f"meta_{source}.jsonl.gz"
            with gzip.open(meta_path,"wt",encoding="utf-8") as file:
                for row in metadata:
                    file.write(json.dumps(row)+"\n")
            review_path = root/"source"/"review_categories"/f"{source}.jsonl.gz"
            with gzip.open(review_path,"wt",encoding="utf-8") as file:
                for row in low:
                    for n in range(30):
                        file.write(json.dumps(dict(parent_asin=row["parent_asin"],user_id=str(n),
                                                   text=str(n)+"x"*4000,rating=2))+"\n")
                # Popular listing deliberately appears after all the low-count
                # review batches. Its last row proves scanning reached EOF.
                for n in range(50):
                    file.write(json.dumps(dict(parent_asin="LATEHIGH",user_id=str(n),
                                               text=str(n)+"y"*6000,rating=5))+"\n")
            result = self.run_build(root,"full",["--target-gb",".001","--reviews-per-product","100"])
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)
            reports = root/"full_reports"
            summary=json.loads((reports/"build_summary.json").read_text())
            self.assertEqual(summary["reviews_stop"],"complete")
            self.assertEqual(summary["status"],"complete_with_size_cap")
            cap=summary["size_cap"]
            self.assertTrue(cap["reached"])
            self.assertGreater(cap["evicted_products"],0)
            self.assertGreater(cap["evicted_saved_reviews"],0)
            self.assertLessEqual((root/"full.sqlite").stat().st_size,1_000_000)
            conn=sqlite3.connect(root/"full.sqlite")
            try:
                self.assertEqual(conn.execute("SELECT saved_review_count,available_review_count,review_scan_complete "
                                              "FROM products WHERE parent_asin='LATEHIGH'").fetchone(),(50,50,1))
                self.assertEqual(conn.execute("PRAGMA integrity_check").fetchone()[0],"ok")
                self.assertEqual(conn.execute("PRAGMA foreign_key_check").fetchall(),[])
                for asin,saved in conn.execute("SELECT parent_asin,saved_review_count FROM products"):
                    self.assertEqual(conn.execute("SELECT count(*) FROM reviews WHERE parent_asin=?",(asin,)).fetchone()[0],saved)
                initial=sum(cap["initial_products_per_type"].values())
                final=conn.execute("SELECT count(*) FROM products").fetchone()[0]
                self.assertEqual(initial-final,cap["evicted_products"])
            finally:
                conn.close()
            audit=[json.loads(line) for line in (reports/"size_cap_evictions.jsonl").read_text().splitlines()]
            self.assertEqual(len(audit),cap["evicted_products"])
            self.assertTrue(all(row["parent_asin"]!="LATEHIGH" for row in audit))
            self.assertEqual(sum(row["saved_reviews_removed"] for row in audit),cap["evicted_saved_reviews"])
            self.assertIn("SIZE_CAP HIT",result.stdout)
            self.assertIn("SIZE_CAP FINAL",result.stdout)
            self.assertIn("Full-mode size-cap impact",(reports/"SUMMARY.txt").read_text())

    def test_stalled_network_is_stopped_and_reported(self):
        class StalledHandler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.flush()
                time.sleep(15)

            def log_message(self, *args):
                pass

        server = ThreadingHTTPServer(('127.0.0.1', 0), StalledHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as td:
                root = Path(td)
                started = time.monotonic()
                result = subprocess.run([sys.executable, str(HERE / 'build_amazon_sqlite.py'), 'short',
                    '--output', str(root/'stalled.sqlite'), '--minutes', '.1', '--idle-timeout', '1',
                    '--base-url', f'http://127.0.0.1:{server.server_port}', '--heartbeat', '1'],
                    capture_output=True, text=True, timeout=12)
                self.assertLess(time.monotonic()-started, 10)
                self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
                self.assertTrue((root/'stalled_reports'/'SUMMARY.txt').exists())
                self.assertIn('OPENED', result.stdout)
        finally:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    unittest.main()
