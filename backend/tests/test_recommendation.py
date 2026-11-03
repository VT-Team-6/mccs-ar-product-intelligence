# Tests for the TF-IDF recommender. These don't need a database, so they
# run on a small catalog modeled on the seed products.

import pytest

from recommendation import (
    Recommender,
    build_product_text,
    build_tfidf_matrix,
    compute_similarity,
    top_k_similar,
)

CATALOG = [
    {"product_id": 1, "name": "Brooks Ghost 15", "brand": "Brooks", "product_type": "Running Shoe",
     "description": "Smooth daily trainer with balanced cushioning and a breathable mesh upper."},
    {"product_id": 2, "name": "Hoka Clifton 9", "brand": "Hoka", "product_type": "Running Shoe",
     "description": "Lightweight running shoe with a high-cushion midsole and rocker geometry."},
    {"product_id": 3, "name": "Sorel Caribou Waterproof Boots", "brand": "Sorel", "product_type": "Boot",
     "description": "Insulated winter boot with waterproof construction and a rugged rubber shell."},
    {"product_id": 4, "name": "Timberland 6\" Premium Waterproof Boots", "brand": "Timberland", "product_type": "Boot",
     "description": "Waterproof leather boot with a padded collar and a rugged lug sole."},
    {"product_id": 5, "name": "Teva Original Universal Sandals", "brand": "Teva", "product_type": "Sandal",
     "description": "Quick-drying outdoor sandal with adjustable straps and a durable outsole."},
    {"product_id": 6, "name": "Chaco Z/Cloud Sandals", "brand": "Chaco", "product_type": "Sandal",
     "description": "Supportive sport sandal with adjustable webbing and a cushioned footbed."},
]


@pytest.fixture(scope="module")
def recommender():
    return Recommender(CATALOG)


# Task 22: building the text and TF-IDF vectors

def test_product_text_includes_all_fields():
    text = build_product_text(CATALOG[0])
    for word in ["Brooks", "Ghost", "Running Shoe", "cushioning"]:
        assert word in text


def test_product_text_handles_missing_description():
    text = build_product_text({"name": "Mystery Shoe", "brand": "Acme", "product_type": "Sneaker", "description": None})
    assert text == "Mystery Shoe Acme Sneaker Sneaker"


def test_tfidf_matrix_has_one_row_per_product():
    vectorizer, matrix = build_tfidf_matrix(CATALOG)
    assert matrix.shape[0] == len(CATALOG)
    # Common filler words are removed, so they aren't part of the vocabulary.
    assert "with" not in vectorizer.vocabulary_
    assert "waterproof" in vectorizer.vocabulary_


# Task 23: cosine similarity

def test_similarity_matrix_is_square_and_symmetric():
    _, matrix = build_tfidf_matrix(CATALOG)
    sim = compute_similarity(matrix)
    assert sim.shape == (len(CATALOG), len(CATALOG))
    for i in range(len(CATALOG)):
        assert sim[i][i] == pytest.approx(1.0)
        for j in range(len(CATALOG)):
            assert sim[i][j] == pytest.approx(sim[j][i])
            assert 0.0 <= sim[i][j] <= 1.0 + 1e-9


# Task 24: top-k retrieval

def test_similar_products_are_the_same_kind(recommender):
    # The closest match to each product should be the other one of its type.
    assert recommender.similar_to(1, k=1)[0][0] == 2  # running shoe -> running shoe
    assert recommender.similar_to(3, k=1)[0][0] == 4  # boot -> boot
    assert recommender.similar_to(5, k=1)[0][0] == 6  # sandal -> sandal


def test_results_exclude_the_product_itself(recommender):
    ids = [pid for pid, _ in recommender.similar_to(3, k=10)]
    assert 3 not in ids


def test_results_are_sorted_and_limited_to_k(recommender):
    results = recommender.similar_to(1, k=2)
    assert len(results) <= 2
    scores = [score for _, score in results]
    assert scores == sorted(scores, reverse=True)


def test_products_with_nothing_in_common_are_left_out():
    catalog = [
        {"product_id": 1, "name": "Alpha", "brand": "Red", "product_type": "Boot", "description": "warm"},
        {"product_id": 2, "name": "Beta", "brand": "Blue", "product_type": "Boot", "description": "dry"},
        {"product_id": 3, "name": "Gamma", "brand": "Green", "product_type": "Sandal", "description": "cool"},
    ]
    ids = [pid for pid, _ in Recommender(catalog).similar_to(1, k=5)]
    assert ids == [2]


def test_unknown_product_raises(recommender):
    with pytest.raises(ValueError):
        recommender.similar_to(999)


def test_k_of_zero_returns_nothing(recommender):
    assert recommender.similar_to(1, k=0) == []


def test_single_product_catalog_has_no_recommendations():
    assert Recommender(CATALOG[:1]).similar_to(1) == []


def test_empty_catalog():
    with pytest.raises(ValueError):
        Recommender([]).similar_to(1)


def test_ties_are_ordered_by_product_id():
    product_ids = [10, 20, 30]
    similarity = [[1.0, 0.5, 0.5], [0.5, 1.0, 0.0], [0.5, 0.0, 1.0]]
    assert top_k_similar(10, product_ids, similarity, k=2) == [(20, 0.5), (30, 0.5)]