This is ai generated. This filters through the amazon review dataset to either get just
the seeded data's reviews plus a few others for demo purposes, or all of the ones in clothing/
shoes/jewelry.

# Amazon Review Dataset Script

Run from `backend/`. Uses Python's standard library; no packages to install.

**1. Find Amazon listings for the 52 seeded shoes and 5 demo shoes:**

```powershell
python scripts/amazon_reviews.py find --targets data/reviews/amazon_targets.csv --output data/reviews/amazon_candidates.csv
```

Scans the **Clothing, Shoes and Jewelry** metadata, saving up to 8 distinct candidate listings per target shoe.

**2. Extract reviews for those candidate listings:**

```powershell
python scripts/amazon_reviews.py extract --candidates data/reviews/amazon_candidates.csv --limit 100 --output data/reviews/amazon_reviews.jsonl --catalog data/reviews/amazon_catalog.json
```

Scans the category reviews, saving up to **100 reviews per distinct Amazon listing** (not per shoe). The admin will choose the correct listing(s) later; these commands do not modify PostgreSQL.

**Files:** Keep `amazon_reviews.py` in `backend/scripts/` and `amazon_targets.csv` in `backend/data/reviews/`. Keep generated review text out of Git unless redistribution is authorized.

## SQLite archive builder (five product types)

From `backend/`:

```powershell
python scripts/build_amazon_sqlite.py short
python scripts/build_amazon_sqlite.py full
```

Short mode has a 25-minute total budget and preserves partial results. Full mode
streams the source files with an approximately 3 GB database ceiling. Both produce
five top-50 seed-candidate lists, a JSON export, and coverage/error reports.

See [README_amazon_sqlite.md](README_amazon_sqlite.md) for options, package filters,
output paths, progress indicators, sampling limits, and offline test instructions.
