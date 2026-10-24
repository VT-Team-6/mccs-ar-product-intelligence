"""Return the configured provider instance for each review source."""

from pathlib import Path

from .amazon_dataset import AmazonDatasetProvider

BACKEND_DIR = Path(__file__).resolve().parents[2]

providers = {
    "amazon": AmazonDatasetProvider(
        BACKEND_DIR / "data/reviews/amazon_catalog.json",
        BACKEND_DIR / "data/reviews/amazon_reviews.jsonl",
    ),
}

def get_provider(source: str):
    try:
        return providers[source]
    except KeyError:
        raise ValueError(f"Unsupported review source: {source}") from None
