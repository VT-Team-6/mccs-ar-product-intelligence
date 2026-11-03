#!/usr/bin/env python3
# full disclosure this script is ai generated 
"""Discover Amazon Reviews 2023 products and export a curated review archive.

Workflow
--------
1. `find`: Stream product metadata, rank candidate parent ASINs for the target shoes,
   and write a CSV of candidate listings. Candidates are NOT verified matches.
2. `extract`: Stream the review category once, select up to 100 representative
   written reviews per *candidate parent ASIN*, and output JSONL + a catalog.
3. Later, your app administrator selects correct listings from the archived catalog;
   the backend imports only their reviews into PostgreSQL.

The export is deliberately *not* tied to local PostgreSQL product IDs. An admin
can later associate one or more of the archived Amazon listings with a product.

Uses only the Python standard library. No original dataset files are saved.
The selected compressed categories are still transferred in full over the network.
"""

from __future__ import annotations

import argparse
import csv
from dataclasses import dataclass, field
from datetime import datetime, timezone
from difflib import SequenceMatcher
import gzip
import hashlib
import json
from pathlib import Path
import random
import re
import sys
from collections import Counter, defaultdict
from typing import Any, Iterator
from urllib.request import Request, urlopen
import truststore

truststore.inject_into_ssl()
BASE_URL = "https://mcauleylab.ucsd.edu/public_datasets/data/amazon_2023/raw"
CATEGORIES = ("Clothing_Shoes_and_Jewelry", "Amazon_Fashion", "Sports_and_Outdoors")
PROGRESS_METADATA = 500_000
PROGRESS_REVIEWS = 1_000_000

SCRIPT_DIR = Path(__file__).resolve().parent
TARGET_CHOICES = [SCRIPT_DIR / "amazon_targets.csv", SCRIPT_DIR.parent / "data" / "reviews" / "amazon_targets.csv"]
DEFAULT_TARGETS = next((p for p in TARGET_CHOICES if p.exists()), TARGET_CHOICES[0])

CANDIDATE_FIELDS = (
    "target_name", "brand", "group", "category", "match_score",
    "amazon_title", "amazon_store", "parent_asin",
    "metadata_rating_count", "metadata_average_rating",
)


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def normalize(value: Any) -> str:
    """Normalize titles for approximate matching (not product verification)."""
    text = str(value or "").casefold().replace("’", "'")
    text = re.sub(r"[^\w]+", " ", text, flags=re.UNICODE)
    return " ".join(text.split())


def similarity(wanted: str, actual: str) -> float:
    if not actual:
        return 0.0
    wanted_words = set(wanted.split())
    title_words = set(actual.split())
    overlap = len(wanted_words & title_words) / len(wanted_words) if wanted_words else 0.0
    sequence = SequenceMatcher(None, wanted, actual).ratio()
    return round(100 * (0.7 * overlap + 0.3 * sequence), 1)


def parse_int(value: Any, default: int = 0) -> int:
    try:
        return int(float(value))
    except (ValueError, TypeError, OverflowError):
        return default


def load_targets(path: Path, group: str) -> list[dict[str, str]]:
    if not path.is_file():
        raise FileNotFoundError(f"Target CSV not found: {path}. Pass --targets PATH.")
    with path.open(newline="", encoding="utf-8-sig") as file:
        reader = csv.DictReader(file)
        if not {"product_name", "brand", "group"}.issubset(reader.fieldnames or []):
            raise ValueError("Targets CSV must contain: product_name, brand, group")
        targets = []
        for line_no, row in enumerate(reader, 2):
            name, brand, category = (row.get("product_name") or "").strip(), (row.get("brand") or "").strip(), (row.get("group") or "").strip().lower()
            if not name or not brand or category not in {"seeded", "demo"}:
                raise ValueError(f"Invalid target on line {line_no}")
            if group in {"all", category}:
                targets.append({"name": name, "brand": brand, "group": category, "normalized": normalize(name)})
    if not targets:
        raise ValueError(f"No targets for group {group!r}")
    if len({p["name"] for p in targets}) != len(targets):
        raise ValueError("Target names must be unique")
    return targets


def stream_category(base_url: str, category: str, *, metadata: bool) -> Iterator[dict]:
    """Read gzipped JSONL from the official UCSD host without saving bulk files."""
    folder = "meta_categories" if metadata else "review_categories"
    filename = ("meta_" if metadata else "") + category + ".jsonl.gz"
    url = f"{base_url.rstrip('/')}/{folder}/{filename}"
    log(f"Streaming {url}")
    request = Request(url, headers={"User-Agent": "AcademicReviewResearch/1.0"})
    with urlopen(request, timeout=180) as response:
        with gzip.GzipFile(fileobj=response) as compressed:
            for line in compressed:
                if line.strip():
                    yield json.loads(line)


def rank(row: dict) -> tuple:
    return (float(row["match_score"]), parse_int(row["metadata_rating_count"]), row["parent_asin"])


def find_candidates(args: argparse.Namespace) -> None:
    targets = load_targets(args.targets, args.group)
    by_brand: dict[str, list[dict]] = defaultdict(list)
    for target in targets:
        by_brand[normalize(target["brand"])].append(target)

    brand_regex = re.compile(r"\b(?:" + "|".join(re.escape(b) for b in sorted(by_brand, key=len, reverse=True)) + r")\b")
    # Bounded per-target dictionary: key = parent ASIN, not metadata row.
    candidates: dict[tuple[str, str], dict[str, dict]] = defaultdict(dict)
    seen = 0

    for category in args.categories:
        for record in stream_category(args.base_url, category, metadata=True):
            seen += 1
            if seen % PROGRESS_METADATA == 0:
                log(f"{seen:,} metadata records examined")
            title = (record.get("title") or "").strip()
            asin = str(record.get("parent_asin") or "").strip()
            if not title or not asin:
                continue
            title_norm = normalize(title)
            store_norm = normalize(record.get("store") or "")
            joined = f"{title_norm} {store_norm}"
            for brand in set(brand_regex.findall(joined)):
                for target in by_brand[brand]:
                    # 'On' alone is a common English word: require the brand to
                    # appear as the store, or the product title to start with On.
                    if brand == "on" and not (store_norm.startswith("on ") or store_norm == "on" or title_norm.startswith("on ")):
                        continue
                    score = similarity(target["normalized"], title_norm)
                    if score < args.min_score:
                        continue
                    key = (target["name"], category)
                    pool = candidates[key]
                    row = {
                        "target_name": target["name"], "brand": target["brand"],
                        "group": target["group"], "category": category,
                        "match_score": score, "amazon_title": title,
                        "amazon_store": record.get("store") or "",
                        "parent_asin": asin,
                        "metadata_rating_count": parse_int(record.get("rating_number")),
                        "metadata_average_rating": record.get("average_rating") or "",
                    }
                    old = pool.get(asin)
                    if old is not None:
                        if rank(row) > rank(old):
                            pool[asin] = row
                    elif len(pool) < args.top:
                        pool[asin] = row
                    else:
                        worst_asin = min(pool, key=lambda a: rank(pool[a]))
                        if rank(row) > rank(pool[worst_asin]):
                            del pool[worst_asin]
                            pool[asin] = row

    rows = []
    for target in targets:
        for category in args.categories:
            pool = candidates.get((target["name"], category), {})
            rows.extend(sorted(pool.values(), key=rank, reverse=True))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=CANDIDATE_FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    matched = len({row["target_name"] for row in rows})
    log(f"Checked {seen:,} metadata records; found candidates for {matched}/{len(targets)} targets.")
    log(f"Saved {len(rows)} DISTINCT candidate ASIN rows to: {args.output}")
    log("NEXT: Run extract on this CSV to archive the candidate listings for later admin selection.")




def load_candidates(path: Path) -> dict[str, dict[str, dict]]:
    """Load unique candidate ASINs by category; no manual approval required.

    A candidate may appear for several target shoe names. Store each ASIN's
    reviews only once and preserve all suggested targets as search hints.
    The admin, not this offline script, will verify a product match later.
    """
    if not path.is_file():
        raise FileNotFoundError(f"Candidate CSV not found: {path}")
    candidates: dict[str, dict[str, dict]] = defaultdict(dict)
    with path.open(newline="", encoding="utf-8-sig") as file:
        reader = csv.DictReader(file)
        required = {"category", "parent_asin"}
        if not required.issubset(reader.fieldnames or []):
            raise ValueError("Candidate CSV must contain category and parent_asin (use the 'find' output)")
        for line_no, row in enumerate(reader, 2):
            category = (row.get("category") or "").strip()
            asin = (row.get("parent_asin") or "").strip()
            if category not in CATEGORIES or not asin:
                raise ValueError(f"Invalid candidate category/ASIN on line {line_no}")
            by_asin = candidates[category]
            if asin not in by_asin:
                by_asin[asin] = {
                    "source": "amazon", "source_product_id": asin,
                    "category": category,
                    "amazon_title": row.get("amazon_title") or "",
                    "amazon_store": row.get("amazon_store") or "",
                    "suggested_targets": [],
                    "reviews_saved": 0, "written_reviews_seen": 0,
                }
            target = (row.get("target_name") or row.get("product_name") or "").strip()
            if target and target not in by_asin[asin]["suggested_targets"]:
                by_asin[asin]["suggested_targets"].append(target)
    if not candidates:
        raise ValueError("No candidates found in the CSV; run 'find' first.")
    return candidates


def review_date(timestamp: Any) -> str | None:
    """Amazon timestamps are milliseconds since the Unix epoch (UTC)."""
    if timestamp is None or timestamp == "":
        return None
    try:
        return datetime.fromtimestamp(float(timestamp) / 1000, tz=timezone.utc).isoformat()
    except (ValueError, OverflowError, OSError, TypeError):
        return None


def year_bucket(date_text: str | None) -> str:
    """Broad time buckets ensure selections span the review history."""
    if not date_text:
        return "unknown"
    year = int(date_text[:4])
    if year <= 2016:
        return "through-2016"
    if year <= 2019:
        return "2017-2019"
    if year <= 2021:
        return "2020-2021"
    if year == 2022:
        return "2022"
    return "2023-plus"


def stable_review_id(review: dict) -> str:
    """Hash source fields before dropping reviewer ID; output is 64 hex chars.

    Amazon Reviews 2023 does not expose a dedicated review ID in raw records.
    This is a reproducible content-based identifier, not an official Amazon ID.
    """
    fields = [review.get(k) for k in ("parent_asin", "asin", "user_id", "timestamp", "rating", "title", "text")]
    blob = json.dumps(fields, ensure_ascii=False, separators=(",", ":"), default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def normalized_review(review: dict) -> dict | None:
    body = review.get("text")
    if not isinstance(body, str) or not body.strip():
        return None
    try:
        rating = float(review["rating"])
    except (KeyError, TypeError, ValueError):
        return None
    if not 0 <= rating <= 5:
        return None
    raw_title = review.get("title")
    title = raw_title.strip() if isinstance(raw_title, str) else None
    return {
        "source": "amazon",
        "source_product_id": str(review["parent_asin"]),
        "source_review_id": stable_review_id(review),
        "rating": rating,
        "title": title or None,
        "body": body.strip(),
        "review_date": review_date(review.get("timestamp")),
        # Optional provenance for future support of size/color variants.
        "asin": review.get("asin"),
    }


@dataclass
class Reservoir:
    """Unbiased bounded sample of records from one rating x time stratum."""
    seen: int = 0
    items: list[dict] = field(default_factory=list)

    def consider(self, review: dict, capacity: int, rng: random.Random) -> None:
        self.seen += 1
        if len(self.items) < capacity:
            self.items.append(review)
        else:
            n = rng.randrange(self.seen)
            if n < capacity:
                self.items[n] = review


def allocate_strata(strata: dict[tuple[int, str], Reservoir], limit: int) -> dict[tuple[int, str], int]:
    """Allocate quota proportional to observed star-rating/time distribution.

    Because each reservoir holds up to `limit` items, all allocation requests
    can be satisfied without storing the full review category in memory.
    """
    total = sum(bucket.seen for bucket in strata.values())
    desired = min(limit, total)
    if not desired:
        return {}
    order = sorted(strata)
    ideal = {key: desired * strata[key].seen / total for key in order}
    allot = {key: min(int(ideal[key]), len(strata[key].items)) for key in order}
    remaining = desired - sum(allot.values())
    while remaining:
        choices = [k for k in order if allot[k] < len(strata[k].items)]
        if not choices:
            break
        key = max(choices, key=lambda k: (ideal[k] - allot[k], strata[k].seen))
        allot[key] += 1
        remaining -= 1
    return allot


def choose_reviews(strata: dict[tuple[int, str], Reservoir], limit: int, rng: random.Random) -> list[dict]:
    quota = allocate_strata(strata, limit)
    picks = []
    for key in sorted(quota):
        n = quota[key]
        if n:
            picks.extend(rng.sample(strata[key].items, n))
    # Deduplicate within an ASIN; original Amazon raw records may repeat.
    unique = {r["source_review_id"]: r for r in picks}
    return sorted(unique.values(), key=lambda r: (r["review_date"] or "", r["source_review_id"]), reverse=True)


def extract_reviews(args: argparse.Namespace) -> None:
    candidates = load_candidates(args.candidates)
    rng = random.Random(args.seed)
    all_exports: list[dict] = []
    catalog: list[dict] = []

    for category, asins in candidates.items():
        # Only allocate reservoirs for ASINs in the candidate catalog.
        reservoir_by_asin: dict[str, dict[tuple[int, str], Reservoir]] = defaultdict(dict)
        valid_counts: Counter[str] = Counter()
        examined = 0
        for record in stream_category(args.base_url, category, metadata=False):
            examined += 1
            if examined % PROGRESS_REVIEWS == 0:
                log(f"{category}: {examined:,} review records examined")
            asin = str(record.get("parent_asin") or "")
            if asin not in asins:
                continue
            cleaned = normalized_review(record)
            if cleaned is None:
                continue
            valid_counts[asin] += 1
            stratum = (max(1, min(5, round(cleaned["rating"]))), year_bucket(cleaned["review_date"]))
            bucket = reservoir_by_asin[asin].setdefault(stratum, Reservoir())
            bucket.consider(cleaned, args.limit, rng)

        for asin, entry in asins.items():
            sampled = choose_reviews(reservoir_by_asin.get(asin, {}), args.limit, rng)
            entry["written_reviews_seen"] = valid_counts[asin]
            entry["reviews_saved"] = len(sampled)
            catalog.append(entry)
            all_exports.extend(sampled)
            log(f"{category} / {asin}: {valid_counts[asin]:,} written records -> {len(sampled)} reviews")
        log(f"{category}: completed scan of {examined:,} records")

    # If a source review appears twice across categories or candidate ASINs,
    # preserve only one copy in the exported review archive.
    deduped = {r["source_review_id"]: r for r in all_exports}
    results = sorted(deduped.values(), key=lambda r: (r["source_product_id"], r["source_review_id"]))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.catalog.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as file:
        for item in results:
            file.write(json.dumps(item, ensure_ascii=False) + "\n")
    with args.catalog.open("w", encoding="utf-8") as file:
        json.dump({"source": "amazon", "dataset": "Amazon Reviews 2023", "products": catalog}, file, ensure_ascii=False, indent=2)
        file.write("\n")
    log(f"Saved {len(results):,} distinct reviews to {args.output}")
    log(f"Saved {len(catalog)} candidate Amazon product entries to {args.catalog}")
    log("These reviews remain associated with Amazon ASINs, not application products.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    find = commands.add_parser("find", help="Discover and rank candidate listings")
    find.add_argument("--targets", type=Path, default=DEFAULT_TARGETS)
    find.add_argument("--group", choices=["all", "seeded", "demo"], default="all")
    find.add_argument("--categories", nargs="+", choices=CATEGORIES, default=["Clothing_Shoes_and_Jewelry"])
    find.add_argument("--top", type=int, default=8, help="Unique parent ASINs per target and category")
    find.add_argument("--min-score", type=float, default=45.0)
    find.add_argument("--output", type=Path, default=Path("amazon_candidates.csv"))
    find.add_argument("--base-url", default=BASE_URL, help=argparse.SUPPRESS)

    extract = commands.add_parser("extract", help="Export a capped, representative review sample")
    extract.add_argument("--candidates", type=Path, default=Path("amazon_candidates.csv"), help="Candidate CSV produced by the find command")
    extract.add_argument("--limit", type=int, default=100, help="Maximum reviews per candidate parent ASIN")
    extract.add_argument("--seed", type=int, default=2026, help="Repeatable random sampling seed")
    extract.add_argument("--output", type=Path, default=Path("amazon_reviews.jsonl"))
    extract.add_argument("--catalog", type=Path, default=Path("amazon_catalog.json"))
    extract.add_argument("--base-url", default=BASE_URL, help=argparse.SUPPRESS)

    args = parser.parse_args()
    if args.command == "find":
        if args.top < 1 or not 0 <= args.min_score <= 100:
            parser.error("--top must be >=1 and --min-score between 0 and 100")
        find_candidates(args)
    elif args.command == "extract":
        if not 1 <= args.limit <= 10000:
            parser.error("--limit must be between 1 and 10000")
        extract_reviews(args)


if __name__ == "__main__":
    try:
        main()
    except (FileNotFoundError, ValueError) as error:
        log(f"Error: {error}")
        sys.exit(1)
    except KeyboardInterrupt:
        log("Interrupted; rerun the command to restart the stream.")
        sys.exit(130)
