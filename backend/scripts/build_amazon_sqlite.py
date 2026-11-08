#!/usr/bin/env python3
"""Stream Amazon Reviews 2023 into a bounded SQLite archive (Python 3.11+)."""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import gzip
import hashlib
import heapq
import json
import math
import multiprocessing as mp
from pathlib import Path
import queue
import re
import sqlite3
import sys
import time
import traceback
from urllib.request import Request, urlopen

BASE_URL = "https://mcauleylab.ucsd.edu/public_datasets/data/amazon_2023/raw"
TYPES = ("shoes", "backpacks", "headphones", "shampoo", "ground_coffee")
SOURCES = {
    "Clothing_Shoes_and_Jewelry": ("shoes", "backpacks"),
    "Amazon_Fashion": ("shoes", "backpacks"),
    "Sports_and_Outdoors": ("shoes", "backpacks"),
    "Electronics": ("headphones",),
    "Beauty_and_Personal_Care": ("shampoo",),
    "Grocery_and_Gourmet_Food": ("ground_coffee",),
}

SCHEMA = """
PRAGMA foreign_keys=ON;
CREATE TABLE products (
 parent_asin TEXT PRIMARY KEY, product_type TEXT NOT NULL, subtype TEXT,
 title TEXT NOT NULL, brand TEXT, description TEXT,
 source_category TEXT NOT NULL, matched_by TEXT NOT NULL, matched_category TEXT,
 categories_json TEXT NOT NULL, details_json TEXT NOT NULL,
 image_url TEXT, source_url TEXT NOT NULL, source_price REAL,
 source_average_rating REAL, source_rating_count INTEGER,
 available_review_count INTEGER NOT NULL DEFAULT 0,
 available_text_review_count INTEGER NOT NULL DEFAULT 0,
 available_average_rating REAL,
 available_rating_histogram_json TEXT NOT NULL DEFAULT '{}',
 saved_review_count INTEGER NOT NULL DEFAULT 0,
 review_scan_complete INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE reviews (
 review_id TEXT PRIMARY KEY,
 parent_asin TEXT NOT NULL REFERENCES products(parent_asin) ON DELETE CASCADE,
 rating REAL CHECK(rating IS NULL OR rating BETWEEN 1 AND 5),
 title TEXT, body TEXT NOT NULL CHECK(length(trim(body))>0), review_date TEXT,
 verified_purchase INTEGER CHECK(verified_purchase IS NULL OR verified_purchase IN (0,1)),
 helpful_votes INTEGER CHECK(helpful_votes IS NULL OR helpful_votes>=0),
 asin TEXT, sample_priority INTEGER NOT NULL
);
CREATE INDEX idx_products_type ON products(product_type);
CREATE INDEX idx_products_brand ON products(brand);
CREATE INDEX idx_reviews_product_priority ON reviews(parent_asin, sample_priority DESC, review_id DESC);
CREATE TABLE build_sources (
 phase TEXT NOT NULL, source_category TEXT NOT NULL, status TEXT NOT NULL,
 rows_scanned INTEGER NOT NULL DEFAULT 0, bytes_read INTEGER NOT NULL DEFAULT 0,
 matched INTEGER NOT NULL DEFAULT 0, error TEXT, details_json TEXT NOT NULL DEFAULT '{}',
 PRIMARY KEY(phase,source_category)
);
CREATE TABLE build_info (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""


def normalized(value):
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", str(value or "").lower())).strip()


def number(value):
    try:
        result = float(str(value).replace(",", "").replace("$", ""))
        return result if math.isfinite(result) else None
    except (ValueError, TypeError):
        return None


def integer(value, default=0):
    value = number(value)
    return int(value) if value is not None else default


def details_dict(value):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return {}
    return value if isinstance(value, dict) else {}


def flattened(value):
    if isinstance(value, list):
        return [s for v in value for s in flattened(v)]
    return [str(value)] if value else []


def digest(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def package_problem(row, kind, args):
    """Conservative retail-package rules; missing size is explicitly rejected."""
    if kind not in {"shampoo", "ground_coffee"}:
        return None
    details = details_dict(row.get("details"))
    title = str(row.get("title") or "")
    norm = normalized(title)
    if re.search(r"\b(bulk|wholesale|salon size|professional size|variety pack|sampler|bundle|gift set|gallon)\b", norm):
        return "bulk_or_bundle"
    if re.search(r"\b(?:[2-9]|\d{2,})\s*[x\u00d7]\s*\d", title, re.I):
        return "multipack"
    # A retail package means one container, not a case of small containers.
    for text in [title, *[str(v) for k, v in details.items()
                           if normalized(k) in {"item package quantity", "number of items", "unit count", "size"}]]:
        if re.search(r"\b(?:pack|case|set)\s+of\s*(\d+)", text, re.I):
            if any(int(n) > 1 for n in re.findall(r"\b(?:pack|case|set)\s+of\s*(\d+)", text, re.I)):
                return "multipack"
        if re.search(r"\b(?:[2-9]|\d{2,})\s*[- ]?\s*(?:pack|pk|count|ct|bottles|bags|cans)\b", text, re.I):
            return "multipack"
    for key, value in details.items():
        key = normalized(key)
        if key in {"item package quantity", "number of items"} and integer(value, 1) > 1:
            return "multipack"
        if key == "unit count" and re.search(r"\bcount\b", str(value), re.I):
            if number(str(value).split()[0]) and number(str(value).split()[0]) > 1:
                return "multipack"
    # Use product size/content fields, never shipping/package weight.
    keys = {"size", "item weight", "net weight", "item volume", "unit count"}
    texts = [title, *[str(v) for k, v in details.items() if normalized(k) in keys]]
    measures = []
    pattern = r"(\d+(?:\.\d+)?)\s*(fl\.?\s*oz\.?|fluid ounces?|ounces?|oz\.?|pounds?|lbs?\.?|kilograms?|kg|grams?|g|millilit(?:er|re)s?|ml|lit(?:er|re)s?|l)\b"
    for text in texts:
        for raw, unit in re.findall(pattern, text, re.I):
            amount = float(raw)
            unit = normalized(unit)
            if kind == "ground_coffee":
                factor = (28.3495 if unit in {"oz", "ounce", "ounces"} else
                          453.592 if unit in {"lb", "lbs", "pound", "pounds"} else
                          1000 if unit in {"kg", "kilogram", "kilograms"} else
                          1 if unit in {"g", "gram", "grams"} else None)
            else:
                factor = (29.5735 if unit in {"fl oz", "fluid ounce", "fluid ounces", "oz", "ounce", "ounces"} else
                          1000 if unit in {"l", "liter", "liters", "litre", "litres"} else
                          1 if unit in {"ml", "milliliter", "milliliters", "millilitre", "millilitres"} else None)
            if factor:
                measures.append(amount * factor)
    if not measures:
        return "unknown_package_size"
    low, high = ((args.coffee_min_grams, args.coffee_max_grams) if kind == "ground_coffee"
                 else (args.shampoo_min_ml, args.shampoo_max_ml))
    # Allow a little rounding between equivalent oz/metric labels.
    if max(measures) > high * 1.03 or min(measures) < low * 0.97:
        return "outside_retail_size"
    return None


def classify(row, source, args):
    title = normalized(row.get("title"))
    cats = flattened(row.get("categories", []))
    cat_norms = [normalized(c) for c in cats]
    # The top-level domain contains "Shoes" even for shirts and underwear.
    # Never use that broad label as evidence that a product is footwear.
    broad_labels = {"clothing shoes jewelry", "clothing shoes and jewelry", "amazon fashion",
                    "sports outdoors", "sports and outdoors", "electronics", "beauty personal care",
                    "beauty and personal care", "grocery gourmet food", "grocery and gourmet food",
                    "headphones earbuds accessories", "backpacks bags accessories", "shampoo conditioner"}
    allowed = SOURCES[source]
    patterns = {
        "shoes": r"\b(shoes?|sneakers?|boots?|sandals?|loafers?|slippers?|footwear|oxfords?|clogs?|pumps?|espadrilles?)\b",
        "backpacks": r"\b(backpacks?|rucksacks?|daypacks?)\b",
        "headphones": r"\b(headphones?|earbuds?|earphones?|headsets?)\b",
        "shampoo": r"\bshampoos?\b",
        "ground_coffee": r"\bground coffee\b",
    }
    category_matches = {kind: next((c for c, n in zip(reversed(cats), reversed(cat_norms))
                                   if n not in broad_labels and re.search(patterns[kind], n)), None)
                        for kind in allowed}
    # A category-identifiable backpack must win over a title mentioning shoes.
    for kind in sorted(allowed, key=lambda k: category_matches[k] is None):
        category = category_matches[kind]
        # Restrict fallback to the product-name portion, before compatibility/use
        # wording. Mentions deep in a title often describe another product.
        name_part = re.split(r"\b(?:compatible with|fits in|fits into|ideal for|designed for)\b", title)[0][:100]
        if not category and not re.search(patterns[kind], name_part):
            continue
        # Accessory checks use the title and most specific available category.
        leaf = cat_norms[-1] if cat_norms else ""
        text = title + " " + leaf
        exclusions = {
            "shoes": r"\b(insoles?|shoelaces?|shoe laces?|shoe trees?|shoe racks?|shoe bags?|shoe covers?|shoe polish|shoe care|shoe cleaners?|shoe horns?|socks?|replacement|accessories|doll shoes|baby booties)\b",
            "backpacks": r"\b(rain covers?|backpack covers?|replacement|accessories|doll backpacks?|backpack charms?|backpack straps?|backpack patches?|chairs?|stools?)\b",
            "headphones": r"\b(replacement|ear ?pads?|ear cushions?|ear ?tips?|headphone stands?|headphone holders?|headphone cases?|earbud cases?|headphone amplifiers?|headphone adapters?|headphone cables?|accessories|hearing aids?)\b|\b(?:case|cover|pouch|cable|adapter)\s+(?:for|compatible with)\b",
            "shampoo": r"\b(dry shampoo|solid shampoo|shampoo bars?|bar shampoo|body wash|liquid soap|carpet|dog|cat|pet|horse|wig|shampoo brushes?|shampoo bowls?|shampoo dispensers?|shampoo caps?)\b|\b(?:shampoo\s*(?:and|with)\s*conditioner|2 in 1|two in one)\b",
            "ground_coffee": r"\b(whole bean|instant|pods?|capsules?|k cups?|keurig|nespresso|coffee makers?|coffee grinders?|coffee filters?|coffee scrubs?|coffee grounds? for|chicory)\b",
        }
        if re.search(exclusions[kind], text):
            return None, f"{kind}:accessory_or_out_of_scope"
        if kind == "backpacks" and not category and re.search(r"\b(umbrellas?|water bottles?|lunch boxes?)\b", name_part):
            return None, "backpacks:incidental_mention"
        if kind == "headphones" and re.search(
                r"\b(?:airpods?|earbuds?|headphones?)\s+(?:pro\s+)?(?:charging\s+)?(?:cases?|covers?)\b", title):
            return None, "headphones:accessory_or_out_of_scope"
        # A conditioner title mentioning shampoo is not a shampoo product.
        if kind == "shampoo" and "conditioner" in title:
            return None, "shampoo:conditioner_or_set"
        problem = package_problem(row, kind, args)
        if problem:
            return None, f"{kind}:{problem}"
        subtype = None
        if kind == "headphones":
            subtype = "earbuds" if re.search(r"\b(earbuds?|earphones?|in ear)\b", title + " " + leaf) else "headphones"
        elif kind == "shoes":
            subtype = next((s for s in ("running", "walking", "hiking", "boots", "sandals", "slippers", "loafers")
                            if s in title + " " + leaf), None)
        details = details_dict(row.get("details"))
        images = row.get("images") or []
        images = [i for i in images if isinstance(i, dict)] if isinstance(images, list) else []
        images.sort(key=lambda i: i.get("variant") != "MAIN")
        image = next((i.get("hi_res") or i.get("large") or i.get("thumb") for i in images
                      if i.get("hi_res") or i.get("large") or i.get("thumb")), None)
        asin = str(row.get("parent_asin") or "").strip()
        if not asin or not row.get("title"):
            return None, "missing_identity"
        product = dict(parent_asin=asin, product_type=kind, subtype=subtype,
                       title=str(row["title"]), brand=details.get("Brand") or row.get("store"),
                       description="\n".join(flattened(row.get("description") or row.get("features")))[:6000],
                       source_category=source, matched_by="category" if category else "title_fallback",
                       matched_category=category, categories_json=json.dumps(cats, ensure_ascii=False),
                       details_json=json.dumps(details, ensure_ascii=False), image_url=image,
                       source_url=f"https://www.amazon.com/dp/{asin}", source_price=number(row.get("price")),
                       source_average_rating=number(row.get("average_rating")),
                       source_rating_count=max(0, integer(row.get("rating_number"))))
        return product, None
    return None, "other_type"


class WireReader:
    def __init__(self, raw, progress):
        self.raw, self.progress, self.bytes = raw, progress, 0

    def read(self, size=-1):
        data = self.raw.read(size)
        self.bytes += len(data)
        self.progress(self.bytes)
        return data


def stream_worker(messages, phase, source, args, selected):
    """Disposable process: parent can stop even a blocked network read on time."""
    count = matched = byte_count = malformed = 0
    rejects, labels = Counter(), Counter()
    last_status = last_batch = time.monotonic()
    batch = []

    def send_status(force=False):
        nonlocal last_status
        if force or time.monotonic() - last_status >= 2:
            messages.put((source, "progress", dict(rows=count, matched=matched, bytes=byte_count,
                                                    malformed=malformed, rejections=dict(rejects),
                                                    category_labels=dict(labels.most_common(80)))))
            last_status = time.monotonic()

    def wire_progress(value):
        nonlocal byte_count
        byte_count = value
        send_status()

    try:
        # Optional Windows corporate/university CA support; TLS stays verified.
        try:
            import truststore
            truststore.inject_into_ssl()
        except ImportError:
            pass
        if args.source_dir:
            folder = "meta_categories" if phase == "metadata" else "review_categories"
            name = ("meta_" if phase == "metadata" else "") + source + ".jsonl.gz"
            target = Path(args.source_dir) / folder / name
            raw = target.open("rb")
            messages.put((source, "opened", str(target)))
        else:
            folder = "meta_categories" if phase == "metadata" else "review_categories"
            name = ("meta_" if phase == "metadata" else "") + source + ".jsonl.gz"
            target = f"{args.base_url.rstrip('/')}/{folder}/{name}"
            messages.put((source, "connecting", target))
            raw = urlopen(Request(target, headers={"User-Agent": "MCCS-AcademicDatasetBuilder/1.0",
                                                  "Accept-Encoding": "identity"}), timeout=args.network_timeout)
            messages.put((source, "opened", f"HTTP {raw.status}; compressed bytes={raw.headers.get('Content-Length', 'unknown')}"))
        with raw:
            wire = WireReader(raw, wire_progress)
            with gzip.GzipFile(fileobj=wire) as file:
                for line in file:
                    count += 1
                    if count == 1:
                        messages.put((source, "first_record", "First decompressed row received"))
                    try:
                        row = json.loads(line)
                        if not isinstance(row, dict):
                            raise ValueError("not an object")
                    except (ValueError, UnicodeDecodeError):
                        malformed += 1
                        continue
                    if phase == "metadata":
                        product, reason = classify(row, source, args)
                        if reason:
                            rejects[reason] += 1
                        if product:
                            batch.append(product)
                            matched += 1
                            if product["matched_category"]:
                                labels[product["matched_category"]] += 1
                                if len(labels) > 500:
                                    labels = Counter(dict(labels.most_common(250)))
                    elif str(row.get("parent_asin")) in selected:
                        batch.append(row)
                        matched += 1
                    if batch and (len(batch) >= 50 or time.monotonic() - last_batch > .5):
                        messages.put((source, "batch", batch))
                        batch, last_batch = [], time.monotonic()
                    send_status()
        if batch:
            messages.put((source, "batch", batch))
        send_status(True)
        messages.put((source, "done", None))
    except Exception as exc:
        if batch:
            messages.put((source, "batch", batch))
        send_status(True)
        messages.put((source, "error", f"{type(exc).__name__}: {exc}"))


class ProductPool:
    """Bounded popular + deterministic random candidate pools per product type."""
    def __init__(self, limit, seed, popular_only=False):
        self.limit, self.seed, self.popular_only = limit, seed, popular_only
        self.popular = {k: [] for k in TYPES}
        self.diverse = {k: [] for k in TYPES}
        self.rows = {}
        self.refs = Counter()

    def consider(self, row):
        asin, kind = row["parent_asin"], row["product_type"]
        # Same ASIN in different domain files is assigned to its first source.
        if asin in self.rows:
            # Stable source preference when category archives overlap.
            previous = self.rows[asin]
            if ("source_category" in row and list(SOURCES).index(row["source_category"]) <
                    list(SOURCES).index(previous["source_category"])):
                self.rows[asin] = row
            return
        self.rows[asin] = row
        choices = [(self.popular, integer(row["source_rating_count"]))]
        if not self.popular_only:
            choices.append((self.diverse, int(digest(f"{self.seed}:{asin}")[:15], 16)))
        for heaps, score in choices:
            heap = heaps[kind]
            item = (score, asin)
            if len(heap) < self.limit:
                heapq.heappush(heap, item)
                self.refs[asin] += 1
            elif item > heap[0]:
                _, removed = heapq.heapreplace(heap, item)
                self.refs[asin] += 1
                self.refs[removed] -= 1
                if not self.refs[removed]:
                    self.rows.pop(removed, None)
                    del self.refs[removed]
        if not self.refs[asin]:
            self.rows.pop(asin, None)
            self.refs.pop(asin, None)

    def selected(self):
        result = []
        for kind in TYPES:
            popular = sorted(self.popular[kind], reverse=True)
            if self.popular_only:
                result.extend(self.rows[asin] for _, asin in popular)
                continue
            diverse = sorted(self.diverse[kind], reverse=True)
            chosen = dict.fromkeys(asin for _, asin in popular[:max(1, int(self.limit * .7))])
            for _, asin in diverse + popular:
                if len(chosen) >= self.limit:
                    break
                chosen[asin] = None
            result.extend(self.rows[asin] for asin in chosen)
        return result


class SizeLimitReached(Exception):
    pass


class PopularityBudget:
    """Full-mode space policy: drop the worst within-type rank, then keep scanning.

    Metadata has already been scanned, so a product whose reviews arrive late
    has the same priority as one whose reviews arrive early. Dropped products
    never re-enter; retained products keep their complete hash-sampling history.
    """
    def __init__(self, conn, size_budget, log, report_dir, heartbeat=10):
        self.conn, self.limit, self.log = conn, size_budget, log
        self.heartbeat, self.last_notice = heartbeat, 0.0
        self.started = time.monotonic()
        self.page_size = conn.execute("PRAGMA page_size").fetchone()[0]
        self.evicted = set()
        self.evicted_per_type = Counter()
        self.evicted_reviews_per_type = Counter()
        self.evicted_reviews = self.removed_text_bytes = self.reusable_bytes = 0
        self.pressure_events = self.skipped_evicted_rows = self.oversized_reviews = 0
        self.first_hit_seconds = None
        self.ranking = []
        self.initial_per_type = {}
        for kind in TYPES:
            rows = conn.execute(
                "SELECT parent_asin,title,coalesce(source_rating_count,0) FROM products "
                "WHERE product_type=? ORDER BY coalesce(source_rating_count,0) DESC,parent_asin DESC",
                (kind,),
            ).fetchall()
            self.initial_per_type[kind] = len(rows)
            for rank, (asin, title, count) in enumerate(rows, 1):
                self.ranking.append((rank, -count, asin, kind, title))
        # Worst rank first on pop(). Rating count breaks ties across types.
        # This avoids comparing every coffee directly with every shoe solely
        # on raw count, which could erase a smaller product category.
        self.ranking.sort()
        self.audit_path = report_dir / "size_cap_evictions.jsonl"
        self.audit = self.audit_path.open("w", encoding="utf-8", buffering=1)

    def used_bytes(self):
        pages = self.conn.execute("PRAGMA page_count").fetchone()[0]
        free = self.conn.execute("PRAGMA freelist_count").fetchone()[0]
        return (pages - free) * self.page_size

    def ensure_space(self, incoming_asin, growth, sampler):
        if self.used_bytes() + growth <= self.limit:
            return True
        self.pressure_events += 1
        if self.first_hit_seconds is None:
            self.first_hit_seconds = round(time.monotonic() - self.started, 3)
            self.log(f"SIZE_CAP HIT: used={self.used_bytes()/1e6:,.2f} MB; "
                     f"review budget={self.limit/1e6:,.2f} MB. "
                     "Full mode will prune lower-popularity listings and CONTINUE scanning.")
        # Never wipe the archive trying to fit one individually impossible row.
        if growth > self.limit - 65536:
            self.oversized_reviews += 1
            self.log(f"SIZE_CAP OVERSIZED_REVIEW: ASIN={incoming_asin}; "
                     f"estimated growth={growth:,} bytes; skipping this review only.")
            return False
        removed_this_event = 0
        while self.ranking and self.used_bytes() + growth > self.limit:
            rank, negative_count, asin, kind, title = self.ranking.pop()
            review_count, text_bytes = self.conn.execute(
                "SELECT count(*),coalesce(sum(length(CAST(body AS BLOB))),0) "
                "FROM reviews WHERE parent_asin=?", (asin,),
            ).fetchone()
            before = self.used_bytes()
            # FK cascade also removes the listing's sampled reviews.
            self.conn.execute("DELETE FROM products WHERE parent_asin=?", (asin,))
            after = self.used_bytes()
            freed = max(0, before - after)
            self.evicted.add(asin)
            sampler.stats.pop(asin, None)
            self.evicted_per_type[kind] += 1
            self.evicted_reviews += review_count
            self.evicted_reviews_per_type[kind] += review_count
            self.removed_text_bytes += text_bytes
            self.reusable_bytes += freed
            removed_this_event += 1
            record = dict(parent_asin=asin, product_type=kind, title=title,
                          popularity_rank_in_type=rank, source_rating_count=-negative_count,
                          saved_reviews_removed=review_count, review_text_bytes_removed=text_bytes,
                          reusable_page_bytes_freed=freed, incoming_parent_asin=incoming_asin)
            self.audit.write(json.dumps(record, ensure_ascii=False) + "\n")
            if len(self.evicted) <= 5:
                self.log(f"SIZE_CAP EVICT: {kind}/{asin}; rank={rank}; "
                         f"historical ratings={-negative_count:,}; reviews removed={review_count:,}")
            if time.monotonic() - self.last_notice >= self.heartbeat and len(self.evicted) > 5:
                self.log(f"SIZE_CAP PRUNING: {len(self.evicted):,} products / {self.evicted_reviews:,} reviews removed; "
                         f"used={after/1e6:,.2f} MB; reclaiming space for {incoming_asin}.")
                self.last_notice = time.monotonic()
            if asin == incoming_asin:
                # This incoming listing is the lowest priority remaining. Drop
                # it instead of displacing any higher-priority listing.
                break
        now = time.monotonic()
        if now - self.last_notice >= self.heartbeat or self.pressure_events <= 3:
            self.log(f"SIZE_CAP UPDATE: pressure events={self.pressure_events:,}; "
                     f"evicted this event={removed_this_event:,}; total products removed={len(self.evicted):,}; "
                     f"reviews removed={self.evicted_reviews:,}; "
                     f"pages made reusable={self.reusable_bytes/1e6:,.2f} MB; "
                     f"used now={self.used_bytes()/1e6:,.2f} MB; continuing source scans.")
            self.last_notice = now
        return incoming_asin not in self.evicted and self.used_bytes() + growth <= self.limit

    def summary(self):
        return dict(policy="popularity_rank_within_each_product_type", reached=self.first_hit_seconds is not None,
                    pressure_events=self.pressure_events, first_hit_seconds_into_review_stage=self.first_hit_seconds,
                    evicted_products=len(self.evicted), evicted_products_per_type=dict(self.evicted_per_type),
                    evicted_saved_reviews=self.evicted_reviews, removed_review_text_bytes=self.removed_text_bytes,
                    evicted_saved_reviews_per_type=dict(self.evicted_reviews_per_type),
                    reusable_page_bytes_freed=self.reusable_bytes,
                    skipped_review_records_from_evicted_products=self.skipped_evicted_rows,
                    individually_oversized_reviews_skipped=self.oversized_reviews,
                    initial_products_per_type=self.initial_per_type,
                    final_products_per_type={kind: self.conn.execute(
                        "SELECT count(*) FROM products WHERE product_type=?", (kind,)).fetchone()[0] for kind in TYPES},
                    database_file_bytes=db_bytes(self.conn), active_database_bytes=self.used_bytes(),
                    eviction_audit_file=self.audit_path.name)

    def close(self):
        self.audit.close()


class ReviewSampler:
    """Deterministic bottom-k hash sample: equal chance, no preference for stars."""
    def __init__(self, conn, limit, seed, size_budget=None, popularity_budget=None):
        self.conn, self.limit, self.seed, self.size_budget = conn, limit, seed, size_budget
        self.popularity_budget = popularity_budget
        self.stats = {}

    def consume(self, row):
        asin = str(row["parent_asin"])
        if self.popularity_budget and asin in self.popularity_budget.evicted:
            self.popularity_budget.skipped_evicted_rows += 1
            return
        state = self.stats.setdefault(asin, dict(total=0, text=0, total_rating=0.0,
                                                rated=0, saved=0, worst=None, histogram=Counter()))
        state["total"] += 1
        rating = number(row.get("rating"))
        if rating is not None and 1 <= rating <= 5:
            state["rated"] += 1
            state["total_rating"] += rating
            state["histogram"][str(rating)] += 1
        else:
            rating = None
        body = str(row.get("text") or row.get("body") or "").strip()
        if not body:
            return
        state["text"] += 1
        material = [asin, row.get("asin"), row.get("user_id"), row.get("timestamp", row.get("sort_timestamp")),
                    row.get("title"), body, rating]
        review_id = digest(json.dumps(material, ensure_ascii=False, separators=(",", ":")))
        priority = int(digest(f"{self.seed}:{review_id}")[:15], 16)
        if state["saved"] >= self.limit and (priority, review_id) >= state["worst"]:
            return
        if self.conn.execute("SELECT 1 FROM reviews WHERE review_id=?", (review_id,)).fetchone():
            return
        timestamp = number(row.get("timestamp", row.get("sort_timestamp")))
        date = None
        if timestamp is not None:
            try:
                # Reviews 2023 timestamps are milliseconds; tolerate seconds.
                date = datetime.fromtimestamp(timestamp / 1000 if abs(timestamp) > 1e11 else timestamp,
                                              timezone.utc).isoformat()
            except (ValueError, OSError, OverflowError):
                pass
        verified = row.get("verified_purchase")
        verified = int(verified) if isinstance(verified, bool) else None
        helpful = max(0, integer(row.get("helpful_vote", row.get("helpful_votes"))))
        estimated_growth = len(body.encode("utf-8")) + len(str(row.get("title") or "").encode("utf-8")) + 16384
        if self.popularity_budget:
            if not self.popularity_budget.ensure_space(asin, estimated_growth, self):
                if asin in self.popularity_budget.evicted:
                    self.popularity_budget.skipped_evicted_rows += 1
                return
        elif self.size_budget and db_bytes(self.conn) + estimated_growth > self.size_budget:
            raise SizeLimitReached()
        if state["saved"] >= self.limit:
            self.conn.execute("DELETE FROM reviews WHERE parent_asin=? AND sample_priority=? AND review_id=?",
                              (asin, *state["worst"]))
        else:
            state["saved"] += 1
        self.conn.execute("INSERT INTO reviews VALUES (?,?,?,?,?,?,?,?,?,?)",
                          (review_id, asin, rating, row.get("title"), body, date, verified, helpful,
                           row.get("asin"), priority))
        if state["saved"] >= self.limit:
            self.refresh_worst(asin, state)

    def refresh_worst(self, asin, state):
        state["worst"] = self.conn.execute(
            "SELECT sample_priority,review_id FROM reviews WHERE parent_asin=? "
            "ORDER BY sample_priority DESC,review_id DESC LIMIT 1", (asin,)).fetchone()

    def flush(self):
        self.conn.executemany(
            "UPDATE products SET available_review_count=?,available_text_review_count=?,"
            "available_average_rating=?,available_rating_histogram_json=?,saved_review_count=? WHERE parent_asin=?",
            [(s["total"], s["text"], s["total_rating"] / s["rated"] if s["rated"] else None,
              json.dumps(dict(s["histogram"]), sort_keys=True), s["saved"], asin)
             for asin, s in self.stats.items()])


def db_bytes(conn):
    return conn.execute("PRAGMA page_count").fetchone()[0] * conn.execute("PRAGMA page_size").fetchone()[0]


def format_duration(seconds):
    return f"{int(seconds)//60:02d}:{int(seconds)%60:02d}"


def run_stage(phase, args, conn, handle_batch, deadline, log, source_ids=None, size_budget=None,
              popularity_budget=None):
    context = mp.get_context("spawn")
    messages = context.Queue(maxsize=48)
    workers, statuses, last_activity = {}, {}, {}
    started = time.monotonic()
    sources = list(SOURCES) if phase == "metadata" else [s for s in SOURCES if source_ids.get(s)]
    for source in sources:
        statuses[source] = dict(status="connecting", rows=0, matched=0, bytes=0, error=None)
        last_activity[source] = started
        worker = context.Process(target=stream_worker, args=(messages, phase, source, args,
                                                            source_ids.get(source, set()) if source_ids else set()))
        worker.start()
        workers[source] = worker
        log(f"START {phase}/{source}")
    active = set(sources)
    next_heartbeat = time.monotonic()
    last_commit = time.monotonic()
    reason = "complete"
    try:
        while active:
            now = time.monotonic()
            if deadline is not None and now >= deadline:
                reason = "time_limit"
                break
            if size_budget and db_bytes(conn) >= size_budget:
                reason = "size_limit"
                break
            if now >= next_heartbeat:
                total_rows = sum(s["rows"] for s in statuses.values())
                total_matches = sum(s["matched"] for s in statuses.values())
                total_wire = sum(s["bytes"] for s in statuses.values())
                remaining = f" | stage time left {format_duration(max(0,deadline-now))}" if deadline else ""
                log(f"HEARTBEAT {phase} | elapsed {format_duration(now-started)} | active {len(active)} "
                    f"| scanned {total_rows:,} ({total_rows/max(1,now-started):,.0f}/s) "
                    f"| matches {total_matches:,} | received {total_wire/1e6:,.1f} MB "
                    f"| SQLite {db_bytes(conn)/1e6:,.1f} MB{remaining}")
                if popularity_budget:
                    log(f"  SIZE_CAP status={'reached' if popularity_budget.first_hit_seconds is not None else 'not reached'}; "
                        f"active pages={popularity_budget.used_bytes()/1e6:,.1f} MB; "
                        f"evicted products={len(popularity_budget.evicted):,}; "
                        f"evicted reviews={popularity_budget.evicted_reviews:,}")
                for source in sorted(active):
                    age = now - last_activity[source]
                    s = statuses[source]
                    log(f"  {source}: {s['status']}, rows={s['rows']:,}, matches={s['matched']:,}, "
                        f"last signal={age:.0f}s ago" + (" [WAITING/NO DATA]" if age >= 20 else ""))
                next_heartbeat = now + args.heartbeat
            try:
                source, event, payload = messages.get(timeout=.25)
            except queue.Empty:
                for source in list(active):
                    worker = workers[source]
                    if not worker.is_alive() and time.monotonic() - last_activity[source] > 2:
                        statuses[source].update(status="error", error=f"worker exited ({worker.exitcode}) without completion")
                        active.remove(source)
                        log(f"ERROR {phase}/{source}: {statuses[source]['error']}")
                    elif time.monotonic() - last_activity[source] > args.idle_timeout:
                        statuses[source].update(status="error", error="No progress before idle timeout")
                        active.remove(source)
                        log(f"ERROR {phase}/{source}: no progress for {args.idle_timeout}s")
                        worker.terminate()
                continue
            last_activity[source] = time.monotonic()
            if event == "batch":
                handle_batch(payload)
            elif event == "progress":
                statuses[source].update(payload)
                statuses[source]["status"] = "streaming"
            elif event in {"opened", "first_record", "connecting"}:
                statuses[source]["status"] = event
                log(f"{event.upper()} {phase}/{source}: {payload}")
            elif event in {"done", "error"}:
                statuses[source]["status"] = "complete" if event == "done" else "error"
                statuses[source]["error"] = payload
                active.discard(source)
                log(f"{event.upper()} {phase}/{source}" + (f": {payload}" if payload else ""))
            if time.monotonic() - last_commit >= 5:
                conn.commit()
                last_commit = time.monotonic()
    except SizeLimitReached:
        reason = "size_limit"
        log("Size headroom reached; stopping review streams and preserving partial results.")
    except KeyboardInterrupt:
        reason = "interrupted"
        log("Ctrl+C received; stopping streams and preserving partial results.")
    finally:
        for source, worker in workers.items():
            if worker.is_alive():
                worker.terminate()
        for worker in workers.values():
            worker.join(timeout=.5)
            if worker.is_alive():
                worker.kill()
                worker.join(timeout=.5)
        messages.close()
        for source in active:
            statuses[source]["status"] = reason
        for source, s in statuses.items():
            conn.execute("INSERT OR REPLACE INTO build_sources VALUES (?,?,?,?,?,?,?,?)",
                         (phase, source, s["status"], s["rows"], s["bytes"], s["matched"], s["error"],
                          json.dumps(s, ensure_ascii=False)))
        conn.commit()
    if reason == "complete" and any(s["status"] == "error" for s in statuses.values()):
        reason = "source_errors"
    return reason, statuses


def export_reports(conn, args, report_dir, summary):
    fields = ["parent_asin", "product_type", "subtype", "title", "brand", "description", "image_url",
              "source_url", "source_price", "source_rating_count", "source_average_rating",
              "available_review_count", "available_text_review_count", "available_average_rating",
              "saved_review_count", "review_scan_complete", "matched_by", "matched_category"]
    candidates = []
    coverage = {}
    for kind in TYPES:
        # Prefer seedable products with archived reviews; metadata-only candidates follow.
        cursor = conn.execute(f"SELECT {','.join(fields)} FROM products WHERE product_type=? "
                              "ORDER BY (saved_review_count>0) DESC, source_rating_count DESC, parent_asin LIMIT ?",
                              (kind, args.top))
        rows = [dict(zip(fields, row)) for row in cursor]
        candidates.extend(rows)
        coverage[kind] = dict(zip(("products", "products_with_reviews", "saved_reviews"), conn.execute(
            "SELECT count(*),coalesce(sum(saved_review_count>0),0),coalesce(sum(saved_review_count),0) "
            "FROM products WHERE product_type=?", (kind,)).fetchone()))
        lines = [f"{kind}: top {len(rows)} seed candidates", "",
                 "Popularity proxy: historical metadata rating count, NOT sales.",
                 "Candidates with archived text reviews rank ahead of metadata-only entries.",
                 "A partial build ranks only the portion scanned; verify variant/package/image before seeding.", ""]
        for n, row in enumerate(rows, 1):
            lines.extend([f"{n}. {row['title']}",
                          f"   ASIN: {row['parent_asin']} | brand: {row['brand'] or 'unknown'}",
                          f"   Historical rating count: {row['source_rating_count']} | rating: {row['source_average_rating']}",
                          f"   Scanned reviews: {row['available_review_count']} | saved: {row['saved_review_count']} "
                          f"| review scan complete: {bool(row['review_scan_complete'])}",
                          f"   Historical price: {row['source_price']} (not a current store price)",
                          f"   Product: {row['source_url']}", f"   Image: {row['image_url'] or 'missing'}", ""])
        (report_dir / f"{kind}_top_{args.top}.txt").write_text("\n".join(lines), encoding="utf-8")
    summary["coverage"] = coverage
    summary["sources"] = [dict(zip(("phase", "source", "status", "rows", "bytes", "matched", "error", "details"), row))
                          for row in conn.execute("SELECT * FROM build_sources ORDER BY phase,source_category")]
    summary["database_bytes"] = db_bytes(conn)
    summary["config"] = {k: str(v) if isinstance(v, Path) else v for k, v in vars(args).items()}
    (report_dir / "seed_candidates.json").write_text(json.dumps(candidates, ensure_ascii=False, indent=2), encoding="utf-8")
    (report_dir / "build_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = [f"Build status: {summary['status']}", f"Database: {args.output}",
             f"Size: {summary['database_bytes']/1e9:.3f} GB (decimal)", "",
             "All 'available' review statistics cover scanned records only. They are partial unless review_scan_complete=1.",
             "Samples are equal-probability hash samples of nonblank reviews; no artificial positive/negative balancing.",
             "Statistics count source records; duplicate saved review identities are suppressed.", ""]
    for kind, counts in coverage.items():
        lines.append(f"{kind}: {counts['products']:,} products; {counts['products_with_reviews']:,} with reviews; "
                     f"{counts['saved_reviews']:,} saved reviews")
    if "size_cap" in summary:
        cap = summary["size_cap"]
        lines.extend(["", "Full-mode size-cap impact:",
                      f"Cap reached: {cap['reached']}; pressure events: {cap['pressure_events']:,}",
                      f"Products removed: {cap['evicted_products']:,}; sampled reviews removed: {cap['evicted_saved_reviews']:,}",
                      f"Removed products by type: {json.dumps(cap['evicted_products_per_type'],sort_keys=True)}",
                      f"Review text removed: {cap['removed_review_text_bytes']:,} bytes",
                      f"Pages made reusable: {cap['reusable_page_bytes_freed']:,} bytes (cumulative)",
                      f"Later records skipped for removed products: {cap['skipped_review_records_from_evicted_products']:,}",
                      f"Individually oversized reviews skipped: {cap['individually_oversized_reviews_skipped']:,}",
                      f"Active database pages: {cap['active_database_bytes']:,} bytes; file: {cap['database_file_bytes']:,} bytes",
                      f"Per-product audit: {cap['eviction_audit_file']}",
                      "Review source scans continue after pruning; completion flags refer to retained products."])
    if summary.get("metadata_products_not_written_due_to_size"):
        lines.append(f"Metadata candidates excluded by size: {summary['metadata_products_not_written_due_to_size']:,}")
    lines.extend(["", "Sources:"])
    lines.extend(f"{r['phase']}/{r['source']}: {r['status']}; rows={r['rows']:,}; error={r['error']}" for r in summary["sources"])
    (report_dir / "SUMMARY.txt").write_text("\n".join(lines), encoding="utf-8")
    return coverage


def parser():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    p.add_argument("mode", choices=("short", "full"))
    p.add_argument("--output", type=Path, help="New SQLite filename; existing files are never overwritten")
    p.add_argument("--minutes", type=float, help="Total time budget; short defaults to 25, full is unlimited")
    p.add_argument("--target-gb", type=float, default=3.0, help="Decimal GB ceiling, not a size to pad up to")
    p.add_argument("--products-per-type", type=int, help="Short: 500 (70%% popular / 30%% diverse); full: 10000 (popular only)")
    p.add_argument("--reviews-per-product", type=int, default=100)
    p.add_argument("--top", type=int, default=50)
    p.add_argument("--heartbeat", type=float, default=10)
    p.add_argument("--network-timeout", type=float, default=20)
    p.add_argument("--idle-timeout", type=float, default=90)
    p.add_argument("--seed", default="mccs-2023-v1")
    p.add_argument("--coffee-min-grams", type=float, default=100)
    p.add_argument("--coffee-max-grams", type=float, default=680, help="About 24 oz; excludes big bulk bags")
    p.add_argument("--shampoo-min-ml", type=float, default=100)
    p.add_argument("--shampoo-max-ml", type=float, default=1000)
    p.add_argument("--base-url", default=BASE_URL)
    p.add_argument("--source-dir", type=Path, help="Optional local gzip fixture/source root; same folder layout as official host")
    return p


def main(argv=None):
    args = parser().parse_args(argv)
    if args.minutes is None and args.mode == "short":
        args.minutes = 25.0
    if args.mode == "short" and args.minutes > 25:
        parser().error("short mode is capped at 25 minutes; use full for a longer run")
    if args.products_per_type is None:
        args.products_per_type = 500 if args.mode == "short" else 10000
    for name in ("target_gb", "products_per_type", "reviews_per_product", "top", "heartbeat", "network_timeout",
                 "idle_timeout", "coffee_min_grams", "coffee_max_grams", "shampoo_min_ml", "shampoo_max_ml"):
        if not math.isfinite(getattr(args, name)) or getattr(args, name) <= 0:
            parser().error(f"--{name.replace('_','-')} must be positive and finite")
    if args.minutes is not None and (not math.isfinite(args.minutes) or args.minutes <= 0):
        parser().error("--minutes must be positive and finite")
    if args.coffee_min_grams > args.coffee_max_grams or args.shampoo_min_ml > args.shampoo_max_ml:
        parser().error("minimum package size must not exceed maximum")
    if args.target_gb < .001:
        parser().error("--target-gb must be at least 0.001 (1 MB)")
    backend = Path(__file__).resolve().parent.parent
    args.output = (args.output or backend / "data" / "reviews" / f"amazon_{args.mode}.sqlite").resolve()
    args.source_dir = args.source_dir.resolve() if args.source_dir else None
    report_dir = args.output.parent / f"{args.output.stem}_reports"
    if args.output.exists() or report_dir.exists():
        parser().error("output database or report directory exists; choose a new --output (nothing was overwritten)")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    report_dir.mkdir()
    started = time.monotonic()
    with (report_dir / "build.log").open("w", encoding="utf-8", buffering=1) as logfile:
        def log(message):
            line = f"[{datetime.now().astimezone().strftime('%H:%M:%S')}] {message}"
            print(line, flush=True)
            logfile.write(line + "\n")
        log(f"MCCS Amazon builder | mode={args.mode} | Python={sys.version.split()[0]}")
        log(f"Database: {args.output} | reports: {report_dir}")
        log(f"Streaming {len(SOURCES)} source domains; no raw downloads cached. Watch OPENED and FIRST_RECORD messages.")
        log(f"Product cap/type={args.products_per_type:,}; review cap/product={args.reviews_per_product}; "
            f"database ceiling={args.target_gb:.3f} GB. It may finish smaller.")
        if args.mode == "full":
            log("FULL POPULARITY POLICY: top historical rating counts per type; no random product quota. "
                "At the cap, remove the worst within-type popularity ranks, reuse their pages, and keep scanning.")
        log(f"Retail packages: coffee {args.coffee_min_grams:g}-{args.coffee_max_grams:g}g; "
            f"shampoo {args.shampoo_min_ml:g}-{args.shampoo_max_ml:g}mL; known single containers only.")
        budget_seconds = args.minutes * 60 if args.minutes else None
        reserve = min(30, budget_seconds * .1) if budget_seconds else 30
        review_deadline = started + budget_seconds - reserve if budget_seconds else None
        meta_deadline = started + (budget_seconds - reserve) * .4 if budget_seconds else None
        if budget_seconds:
            log(f"Total budget={args.minutes:g}m; metadata gets ~40% of streaming time; "
                f"last {reserve:g}s reserved for cleanup/reports. Partial coverage is expected in short mode.")
        conn = sqlite3.connect(args.output)
        popularity_budget = None
        try:
            conn.execute("PRAGMA auto_vacuum=INCREMENTAL")
            conn.executescript(SCHEMA)
            conn.execute("PRAGMA journal_mode=TRUNCATE")
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.execute("PRAGMA cache_size=-16384")
            # Page-level backstop; normal stopping uses headroom below this.
            target = max(1_000_000, int(args.target_gb * 1e9))
            conn.execute(f"PRAGMA max_page_count={max(64,target//4096)}")
            conn.execute("INSERT INTO build_info VALUES ('schema_version','1')")
            conn.execute("INSERT INTO build_info VALUES ('status','running')")
            conn.commit()
            pool = ProductPool(args.products_per_type, args.seed, popular_only=args.mode == "full")
            meta_reason, meta_status = run_stage("metadata", args, conn,
                lambda batch: [pool.consider(row) for row in batch], meta_deadline, log)
            products = pool.selected()
            if args.mode == "full":
                groups = [[p for p in products if p["product_type"] == kind] for kind in TYPES]
                # Insert best-of-each-type first if metadata alone reaches a
                # very small custom ceiling. Normal 3 GB builds need far less.
                products = [group[rank] for rank in range(max(map(len, groups), default=0))
                            for group in groups if rank < len(group)]
            metadata_omitted = 0
            log(f"METADATA SELECTION: {len(products):,} distinct products; writing candidates to SQLite.")
            if products:
                fields = list(products[0])
                sql = f"INSERT INTO products ({','.join(fields)}) VALUES ({','.join('?' for _ in fields)})"
                for index, product in enumerate(products):
                    estimated = sum(len(str(v).encode('utf-8')) for v in product.values()) + 16384
                    if db_bytes(conn) + estimated > target * .90:
                        log("Metadata reached size headroom; keeping only products already written.")
                        meta_reason = "size_limit"
                        metadata_omitted = len(products) - index
                        break
                    conn.execute(sql, [product[f] for f in fields])
            conn.commit()
            ids = {}
            for asin, source in conn.execute("SELECT parent_asin,source_category FROM products"):
                ids.setdefault(source, set()).add(asin)
            del pool, products
            if args.mode == "full":
                popularity_budget = PopularityBudget(conn, target * .94, log, report_dir, args.heartbeat)
            sampler = ReviewSampler(conn, args.reviews_per_product, args.seed, target * .94, popularity_budget)
            review_reason, review_status = "not_started", {}
            if ids and meta_reason != "interrupted" and (not review_deadline or time.monotonic() < review_deadline):
                # Reserve file space for statistics, indexes and transaction growth.
                review_reason, review_status = run_stage("reviews", args, conn,
                    lambda batch: [sampler.consume(row) for row in batch], review_deadline, log,
                    source_ids=ids, size_budget=target * .94 if args.mode == "short" else None,
                    popularity_budget=popularity_budget)
            else:
                log("REVIEWS SKIPPED: no selected products, interrupted, or no time remains.")
            sampler.flush()
            for source, state in review_status.items():
                if state["status"] == "complete":
                    conn.execute("UPDATE products SET review_scan_complete=1 WHERE source_category=?", (source,))
            conn.commit()
            status = "complete"
            retained_count = conn.execute("SELECT count(*) FROM products").fetchone()[0]
            if not retained_count:
                status = "no_products"
            elif meta_reason != "complete" or review_reason != "complete" or any(
                    s["status"] != "complete" for s in [*meta_status.values(), *review_status.values()]):
                status = "partial"
            if not any(s["saved"] for s in sampler.stats.values()):
                status = "no_reviews" if retained_count else "no_products"
            if status == "complete" and popularity_budget and popularity_budget.first_hit_seconds is not None:
                status = "complete_with_size_cap"
            conn.execute("INSERT OR REPLACE INTO build_info VALUES ('status',?)", (status,))
            conn.execute("INSERT OR REPLACE INTO build_info VALUES ('config',?)",
                         (json.dumps({k:str(v) if isinstance(v,Path) else v for k,v in vars(args).items()}),))
            conn.commit()
            summary = dict(status=status, metadata_stop=meta_reason, reviews_stop=review_reason,
                           elapsed_seconds=round(time.monotonic()-started, 2),
                           metadata_products_not_written_due_to_size=metadata_omitted)
            if popularity_budget:
                summary["size_cap"] = popularity_budget.summary()
                conn.execute("INSERT OR REPLACE INTO build_info VALUES ('size_cap',?)",
                             (json.dumps(summary["size_cap"]),))
                conn.commit()
                cap = summary["size_cap"]
                log(f"SIZE_CAP FINAL: reached={cap['reached']}; pressure events={cap['pressure_events']:,}; "
                    f"products removed={cap['evicted_products']:,}; reviews removed={cap['evicted_saved_reviews']:,}; "
                    f"reusable pages freed={cap['reusable_page_bytes_freed']/1e6:,.2f} MB; "
                    f"removed by type={json.dumps(cap['evicted_products_per_type'],sort_keys=True)}; "
                    f"review scan outcome={review_reason}.")
            coverage = export_reports(conn, args, report_dir, summary)
            for kind, counts in coverage.items():
                log(f"COVERAGE {kind}: {counts['products']:,} products; {counts['products_with_reviews']:,} with reviews; "
                    f"{counts['saved_reviews']:,} saved reviews")
            log(f"FINISHED status={status}; metadata={meta_reason}; reviews={review_reason}; "
                f"size={db_bytes(conn)/1e9:.3f} GB; elapsed={format_duration(time.monotonic()-started)}")
            log(f"Read {report_dir / 'SUMMARY.txt'} and the five top-{args.top} lists.")
            if status in {"no_products", "no_reviews"}:
                log("WARNING: no usable review archive. Inspect source errors, package exclusions, and time limits.")
                return 2
            return 0
        except Exception:
            conn.rollback()
            log("FAILED: " + traceback.format_exc())
            try:
                conn.execute("INSERT OR REPLACE INTO build_info VALUES ('status','failed')")
                conn.commit()
                failure_summary = dict(status="failed", elapsed_seconds=time.monotonic()-started)
                if popularity_budget:
                    failure_summary["size_cap"] = popularity_budget.summary()
                export_reports(conn, args, report_dir, failure_summary)
            except Exception as error:
                log(f"Could not finish reports: {error}; database/log preserved.")
            return 1
        finally:
            if popularity_budget:
                popularity_budget.close()
            conn.close()


if __name__ == "__main__":
    mp.freeze_support()
    raise SystemExit(main())
