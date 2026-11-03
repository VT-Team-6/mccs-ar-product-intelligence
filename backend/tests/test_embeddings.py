"""Tests for the embedding model (8.9).

These use the real model, so the first run downloads it (about 90 MB).
"""

import numpy as np
import pytest

from embeddings import EmbeddingRecommender, embed_texts
from recommendation import Recommender


def product(product_id, name, description, product_type=""):
    return {
        "product_id": product_id,
        "name": name,
        "brand": None,
        "product_type": product_type,
        "description": description,
    }


def similarity(a: str, b: str) -> float:
    vectors = embed_texts([a, b])
    return float(vectors[0] @ vectors[1])


def test_each_text_becomes_384_numbers_of_length_1():
    vectors = embed_texts(["running shoe", "leather boot", "wool socks"])
    assert vectors.shape == (3, 384)
    assert np.allclose(np.linalg.norm(vectors, axis=1), 1, atol=1e-5)


def test_no_texts_gives_no_embeddings():
    assert embed_texts([]).shape == (0, 384)


def test_same_meaning_with_different_words_scores_higher_than_unrelated():
    boots = "waterproof hiking boots"
    assert similarity(boots, "rain-proof trail shoes") > similarity(boots, "silk necktie")


# No two of these share a word, so TF-IDF can't tell which ones are related
CATALOG = [
    product(1, "Insulated winter footwear", "Keeps feet warm in the snow"),
    product(2, "Cold weather boots", "Built for freezing temperatures"),
    product(3, "Beach sandals", "Light summer flip-flops"),
]


def test_tfidf_misses_products_with_no_shared_words():
    assert Recommender(CATALOG).similar_to(1) == []


def test_embeddings_find_products_with_similar_meaning():
    results = EmbeddingRecommender(CATALOG).similar_to(1)
    assert results[0][0] == 2  # cold weather boots, not beach sandals


def test_search_by_meaning():
    recommender = EmbeddingRecommender(
        [
            product(1, "Rubber rain boots", "Waterproof boots for wet days", "Boot"),
            product(2, "Silk necktie", "Formal tie for business wear", "Tie"),
            product(3, "Running shorts", "Lightweight shorts for the gym", "Shorts"),
        ]
    )
    results = recommender.search("something to keep my feet dry")
    assert results[0][0] == 1


def test_search_with_empty_text_returns_nothing():
    recommender = EmbeddingRecommender(CATALOG)
    assert recommender.search("   ") == []


@pytest.mark.parametrize("k", [1, 2])
def test_similar_to_returns_at_most_k_and_never_the_product_itself(k):
    results = EmbeddingRecommender(CATALOG).similar_to(1, k=k)
    assert len(results) <= k
    assert all(product_id != 1 for product_id, _ in results)