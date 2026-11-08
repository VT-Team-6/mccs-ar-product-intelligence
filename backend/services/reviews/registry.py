"""Return the configured provider instance for each review source."""

import os
from pathlib import Path

from dotenv import load_dotenv

from .amazon_dataset import AmazonDatasetProvider

BACKEND_DIR = Path(__file__).resolve().parents[2]
load_dotenv(BACKEND_DIR / ".env")

# Relative paths are resolved from backend/, independent of the launch folder.
archive_path = Path(os.getenv("AMAZON_REVIEW_DB", "data/reviews/amazon_dataset.sqlite")).expanduser()
if not archive_path.is_absolute():
    archive_path = BACKEND_DIR / archive_path

providers = {"amazon": AmazonDatasetProvider(archive_path)}


def get_provider(source: str):
    try:
        return providers[source]
    except KeyError:
        raise ValueError(f"Unsupported review source: {source}") from None
