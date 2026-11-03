"""Product embeddings for the recommendation engine (tasks 8.6-8.8).

An embedding is a list of 384 numbers that represents what a piece of text
means. Texts with similar meanings get similar numbers, even when they use
different words ("waterproof" vs "keeps your feet dry"). TF-IDF only
matches shared words, so the two methods complement each other.

The model runs locally through FastEmbed (no PyTorch, no API costs). It is
downloaded once (about 90 MB) the first time it is used.
"""

import numpy as np
from fastembed import TextEmbedding

from recommendation import build_product_text, top_k_similar

MODEL_NAME = "BAAI/bge-small-en-v1.5"

_model = None


def get_model() -> TextEmbedding:
    """Load the model the first time it's needed, then reuse it (8.6)."""
    global _model
    if _model is None:
        _model = TextEmbedding(MODEL_NAME)
    return _model


def embed_texts(texts: list[str]) -> np.ndarray:
    """Turn texts into embeddings: one row of 384 numbers per text (8.7).

    Each row is scaled to length 1, so the dot product of two rows is
    their cosine similarity.
    """
    if not texts:
        return np.zeros((0, 384), dtype=np.float32)
    vectors = np.array(list(get_model().embed(texts)), dtype=np.float32)
    return vectors / np.linalg.norm(vectors, axis=1, keepdims=True)

def embed_query(query: str) -> np.ndarray:
    """Embed a typed search query (one row of 384 numbers, length 1).

    BGE embeds questions slightly differently from product descriptions,
    which makes search more accurate.
    """
    vector = np.array(list(get_model().query_embed(query))[0], dtype=np.float32)
    return vector / np.linalg.norm(vector)


def build_product_embeddings(products: list[dict]) -> np.ndarray:
    """Embed every product, using the same text TF-IDF uses (8.7)."""
    return embed_texts([build_product_text(p) for p in products])


def compute_embedding_similarity(embeddings: np.ndarray) -> np.ndarray:
    """Square matrix where [i][j] is how close product i and j are in meaning (8.8).

    1 = same meaning, around 0 = unrelated.
    """
    return embeddings @ embeddings.T


class EmbeddingRecommender:
    """Holds every product's embedding so they are built once, not per request."""

    def __init__(self, products: list[dict]):
        self.product_ids = [p["product_id"] for p in products]
        self.embeddings = build_product_embeddings(products)
        self.similarity = compute_embedding_similarity(self.embeddings)

    def similar_to(self, product_id: int, k: int = 5) -> list[tuple[int, float]]:
        """The k products closest in meaning to product_id."""
        return top_k_similar(product_id, self.product_ids, self.similarity, k)

    def search(self, query: str, k: int = 5) -> list[tuple[int, float]]:
        """The k products closest in meaning to a typed query (for Advanced Search)."""
        if not query.strip() or not self.product_ids:
            return []
        scores = self.embeddings @ embed_query(query)
        ranked = sorted(range(len(self.product_ids)), key=lambda i: (-scores[i], self.product_ids[i]))
        return [(self.product_ids[i], round(float(scores[i]), 4)) for i in ranked[:k] if scores[i] > 0]