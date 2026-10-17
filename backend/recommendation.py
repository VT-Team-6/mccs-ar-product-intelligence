"""Content-based product recommendations using TF-IDF and cosine similarity.

Each product is turned into one text string (name, brand, type, description).
TF-IDF turns those strings into vectors, where words that are common across
the whole catalog (like "shoe") count for less than words that are specific
to a few products (like "waterproof" or "cushioning"). Two products are
similar when their vectors point in a similar direction (cosine similarity).
"""

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from database import get_connection

# Fields used to describe a product. The type is repeated so products of the
# same kind (e.g. two boots) score a little higher than ones that only share
# a few description words.
TEXT_FIELDS = ("name", "brand", "product_type", "product_type", "description")


def build_product_text(product: dict) -> str:
    """Join the text fields of one product into a single string."""
    parts = [str(product.get(field) or "") for field in TEXT_FIELDS]
    return " ".join(part for part in parts if part)


def build_tfidf_matrix(products: list[dict]):
    """Turn a list of products into a TF-IDF matrix.

    Returns the fitted vectorizer and a matrix with one row per product,
    in the same order as the input list.
    """
    texts = [build_product_text(p) for p in products]
    vectorizer = TfidfVectorizer(stop_words="english")
    matrix = vectorizer.fit_transform(texts)
    return vectorizer, matrix


def compute_similarity(matrix):
    """Return a square matrix where [i][j] is how similar product i is to product j.

    Values range from 0 (nothing in common) to 1 (same words, same weights).
    """
    return cosine_similarity(matrix)


def top_k_similar(product_id: int, product_ids: list[int], similarity, k: int = 5) -> list[tuple[int, float]]:
    """Return up to k (product_id, score) pairs most similar to product_id.

    The product itself is left out, and products with a score of 0 are
    skipped since they share no meaningful words.
    Raises ValueError if product_id is not in the catalog.
    """
    if k < 1:
        return []
    try:
        row = product_ids.index(product_id)
    except ValueError:
        raise ValueError(f"Product {product_id} is not in the catalog") from None

    scores = similarity[row]
    # Sort by score (highest first). Ties are broken by product_id so the
    # order is the same every time.
    ranked = sorted(
        (i for i in range(len(product_ids)) if i != row and scores[i] > 0),
        key=lambda i: (-scores[i], product_ids[i]),
    )
    return [(product_ids[i], round(float(scores[i]), 4)) for i in ranked[:k]]


class Recommender:
    """Holds the TF-IDF model for a catalog so it is built once, not per request."""

    def __init__(self, products: list[dict]):
        self.product_ids = [p["product_id"] for p in products]
        if products:
            _, matrix = build_tfidf_matrix(products)
            self.similarity = compute_similarity(matrix)
        else:
            self.similarity = []

    def similar_to(self, product_id: int, k: int = 5) -> list[tuple[int, float]]:
        return top_k_similar(product_id, self.product_ids, self.similarity, k)


def load_products() -> list[dict]:
    """Read the fields the recommender needs for every product in the database."""
    with get_connection() as conn:
        return conn.execute(
            "SELECT product_id, name, brand, product_type, description "
            "FROM products ORDER BY product_id"
        ).fetchall()