# Amazon SQLite archive builder

Run from `backend/` with Python 3.11+. Standard library only. If `truststore` is
already installed, it is used for Windows/university certificate support. TLS
verification is never disabled.

```powershell
# Short: 25-minute total budget, then save partial results and reports.
python scripts/build_amazon_sqlite.py short

# Full: scan all selected source files, with an approximately 3 GB ceiling.
python scripts/build_amazon_sqlite.py full
```

Both modes collect **metadata and reviews** for shoes, backpacks, headphones
(including earbuds/headsets), shampoo, and ground coffee. They create the same
schema and reports. Building an archive does not modify PostgreSQL. The Amazon
review provider reads SQLite directly; admin-approved imports still go through
the existing PostgreSQL importer.

## Use the archive in the app

The backend defaults to `data/reviews/amazon_short.sqlite`. To switch archives,
set this in `backend/.env` and restart Uvicorn:

```dotenv
AMAZON_REVIEW_DB=data/reviews/amazon_full.sqlite
```

Absolute paths are also supported. Relative paths resolve from `backend/`, not
the terminal's current folder. The archive must already exist and have the
builder's schema; an incorrect path gives a clear startup error and never
creates an empty database. The JSON/JSONL files are no longer used by the Amazon
provider. Frontend responses and admin source-selection/import routes stay the
same. Existing saved ASINs must be present in the new archive; otherwise select
an available listing before reimporting. The importer keeps existing reviews
when a selected listing has no available reviews.

Search prefilters product titles/brands in SQLite, fuzzy-ranks at most 250
candidates, and returns up to 10 listings with saved reviews. You can also search
by parent ASIN. Counts describe the reviews actually available to import, not
the historical Amazon rating count. No catalog/review preload, image download,
archive mutation, or new search-index file is required. SQLite work runs outside
the async request loop, with a separate read-only connection per operation.

## Outputs

Default databases: `data/reviews/amazon_short.sqlite` or `amazon_full.sqlite`.
Alongside each database is a corresponding `amazon_short_reports/` or
`amazon_full_reports/` directory containing:

- `build.log`: timestamped connections, first records, heartbeats, failures.
- `SUMMARY.txt` and `build_summary.json`: coverage, errors, scan completion,
  filter-rejection counts and observed category labels.
- Full mode: `size_cap_evictions.jsonl`, one audit record per removed listing,
  including its type, popularity rank/count, reviews removed and incoming ASIN.
- Five `*_top_50.txt` lists: up to 50 seed candidates per product type.
- `seed_candidates.json`: candidate metadata, image URLs and source IDs for a
  future PostgreSQL seed step. No images are downloaded or verified here.

Existing outputs are never overwritten. For another run, choose a new filename:

```powershell
python scripts/build_amazon_sqlite.py short --output data/reviews/amazon_test2.sqlite
python scripts/build_amazon_sqlite.py short --minutes 5 --heartbeat 5 --output data/reviews/amazon_5min.sqlite
python scripts/build_amazon_sqlite.py full --target-gb 3 --products-per-type 10000 --reviews-per-product 100
```

## Runtime, networking and size

- Reads official gzipped Amazon Reviews 2023 JSONL streams from UCSD, without
  caching original files. Streaming still transfers source data; a full run can
  transfer tens of GB. Six domains are processed in parallel so one category
  cannot consume all of short mode's time.
- Short mode allows about 40% of its streaming budget for metadata and the rest
  for reviews, reserving 30 seconds for shutdown/reports. The default total is
  25 minutes, including network time. Workers can be terminated during blocked
  network reads. A suspended machine, overloaded disk, or operating-system
  stalls can delay cleanup; this is a runtime budget, not a real-time guarantee.
- Look for `OPENED` and `FIRST_RECORD`. Every 10 seconds a heartbeat shows
  scanned rows, match counts, received compressed MB, database size, and each
  source's last signal. `WAITING/NO DATA` is explicit. Socket timeout: 20 seconds;
  idle cutoff: 90 seconds. Errors are saved, not silently treated as successful
  source scans. No automatic restart from byte zero hides a failing source.
- Full mode has no time limit unless `--minutes N` is provided. `--target-gb`
  means decimal GB. About 6% is reserved for summaries and transaction overhead;
  a SQLite page limit also limits the database file. Short mode stops near that
  working limit. **Full mode prunes less-popular listings and continues scanning
  reviews**, reusing the deleted rows' pages. A file may stay the same size after
  pruning because those pages are reused internally. Logs show active space as
  well as file size. No second database copy or full-file VACUUM is made.
- Default product caps: 500/type in short, 10,000/type in full. **Full mode keeps
  the highest historical rating counts per type, with no random product quota**.
  Its bounded metadata pool replaces early low-count candidates when higher-count
  ones appear later. Short mode retains its 70% popular / 30% deterministic random
  mix. The archive can finish below 3 GB; there is no padding or promise to cover
  every product or current inventory. Reports/logs are additional disk usage.
- Ctrl+C during streaming stops workers and exports partial results. SQLite
  changes commit periodically. There is **no resume command**: reruns use a new
  output and re-stream sources. Abrupt power loss may leave counters/reports
  unfinished even when some review rows were committed.

## Full-mode size-cap policy and logging

All metadata is processed before reviews, so a late review does not make a
popular listing lose to an early low-count listing. At review-space pressure,
the script removes the worst **popularity rank within its product type** first.
Historical rating count breaks ties across types. This gives the five types a
chance to retain their own popular listings instead of comparing every coffee
directly to every shoe solely on raw count. It is not an equal-byte allocation
or a guarantee of 50 retained listings in every type under an extremely small cap.

An eviction deletes the product metadata and all its sampled reviews. Its later
records are skipped, while source streams continue to EOF. A lower-priority
incoming listing is dropped rather than displacing higher-priority listings.
The retained products keep their existing sampling history. A review that is
individually too large to fit the working budget is skipped and counted instead
of removing the whole archive to make room for it. A tiny custom cap can also
limit how much ranked metadata is written; this is reported separately.

Look for `SIZE_CAP HIT`, `SIZE_CAP EVICT`, `SIZE_CAP UPDATE`/`PRUNING`, and
`SIZE_CAP FINAL`. Heartbeats report whether the review cap has been reached and
the running eviction totals. Final TXT/JSON reports show products/reviews removed,
removals by type, review-text bytes removed, cumulative pages made reusable,
records skipped for removed listings, and any individually oversized reviews.
`size_cap_evictions.jsonl` has the complete per-product audit; console eviction
details are throttled to keep progress readable. A no-pressure full build still
reports `reached: false` and zero removals.

`complete_with_size_cap` means source scans finished and the archive was pruned
to fit. `partial` means scans were interrupted/time-limited, source failures
occurred, or metadata selection reached its own size limit. As before, review
completion flags describe retained listings. New behavior applies to a **new
full run**, not an already-running process or an existing database. Pick a new
`--output` if an earlier full archive already exists.

## Filtering and sampling

Source domains: Clothing/Shoes/Jewelry, Amazon Fashion, Sports/Outdoors,
Electronics, Beauty/Personal Care, Grocery/Gourmet Food. Narrow structured
category labels are preferred; broad labels containing the word "shoes" or
"headphones" are not sufficient. Product-name fallback, accessory exclusions,
and package checks are heuristic. Inspect the candidate lists and rejection
counts before relying on the selection; it is not a perfect classifier.

Shampoo defaults to one known-size **100–1,000 mL** container; ground coffee to
one **100–680 g** bag/can (about 3.5–24 oz). Multipacks, bulk/wholesale/gallon
listings and ambiguous package sizes are excluded. Shampoo/conditioner sets,
dry/pet/solid-bar shampoo, coffee pods, instant coffee, whole beans and equipment are
excluded. Coffee blends with chicory are excluded. Units are parsed from titles
and product size/content fields, not shipping weight. Shampoo labels expressing
ounces without "fluid" are treated as fluid ounces. These conservative rules
can reject valid retail products or miss an unusually described bulk package.

```powershell
python scripts/build_amazon_sqlite.py short --coffee-max-grams 454 --shampoo-max-ml 750 --output data/reviews/amazon_smallpacks.sqlite
```

Each listing keeps up to 100 nonblank reviews using deterministic bottom-k
hash sampling: equal inclusion probability, without favoring good/bad ratings
or helpfulness. Full-file completion makes the sample representative of the
available written-review population in expectation, not a guarantee that rare
complaints appear. Time-limited/short/stopped scans sample only the scanned
portion. Full-mode product evictions do not restart or truncate sampling for
retained listings; those can still finish their source scans. Individually
oversized skipped reviews are excluded from the text sample. Do not claim a
partial scan or a size-selected product catalog represents the entire dataset.

`available_*` counts, average and rating histogram cover **all scanned source
records**, before sampling (including blank reviews for rating statistics).
`source_average_rating`/`source_rating_count` are separate historical metadata
figures. `review_scan_complete=1` means the assigned review source reached EOF;
otherwise the available statistics are partial. Duplicate saved review
identities are suppressed; summary counts describe source records, not a
separate deduplicated population. Shared ASINs use one metadata/source domain
to avoid importing the same review feed twice.

## Schema and seed candidates

`products` holds metadata, filtering evidence, image URL, historical price,
full-scanned rating histogram, saved count and completion flag. `reviews`
references `products.parent_asin`, with rating, text, UTC ISO date, variant ASIN,
verified purchase/helpful votes, and an internal sampling priority. Two small
operational tables, `build_sources` and `build_info`, record source outcomes and
configuration. Product category/detail arrays and rating histograms are JSON
text; individual products and reviews are relational rows. Raw review bodies
are preserved; descriptions are limited to 6,000 characters.

The top lists prioritize listings with saved reviews, then rank by historical
metadata rating count. **This is a popularity proxy, not sales or best rating.**
Lists can contain fewer than 50 entries. Metadata-only candidates are marked;
the JSON includes counts and completion flags. Check exact model, package,
image, historical price and variant before seeding. A parent ASIN is not a UPC.

Exit codes: `0` usable archive (possibly partial or `complete_with_size_cap`); `2` no products or no saved
reviews, or invalid CLI arguments; `1` unexpected build failure. Always inspect
`SUMMARY.txt` for partial sources or empty categories.

## Offline tests

```powershell
python -m unittest discover -s scripts -p test_build_amazon_sqlite.py -v
python -m unittest discover -s tests -p test_amazon_sqlite_provider.py -v
```

Tests generate tiny gzipped fixtures and exercise filtering, package limits,
sampling, both modes, reports, deadlines, source failures, late popular product
replacement, continued full scans under pressure, and page reuse without network.
`--source-dir PATH` accepts local files using the official layout:
`meta_categories/meta_CATEGORY.jsonl.gz` and
`review_categories/CATEGORY.jsonl.gz`.

Dataset documentation: https://amazon-reviews-2023.github.io/main.html
