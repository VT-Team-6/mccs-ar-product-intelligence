"""Tests for the product score calculations (no database needed)."""

from product_features import NEUTRAL, compute_scores


def product(product_id, product_type="Boot", price=None, rating=None, brand=None):
    return {
        "product_id": product_id,
        "product_type": product_type,
        "price": price,
        "rating": rating,
        "brand": brand,
    }


def test_cheapest_of_a_type_scores_1_and_most_expensive_scores_0():
    scores = compute_scores([product(1, price=100), product(2, price=150), product(3, price=200)])
    assert scores[1]["price"] == 1
    assert scores[2]["price"] == 0.5
    assert scores[3]["price"] == 0


def test_prices_are_only_compared_within_the_same_type():
    # A $20 hat should not make every boot look expensive
    scores = compute_scores(
        [product(1, "Boot", price=100), product(2, "Boot", price=200), product(3, "Hat", price=20)]
    )
    assert scores[1]["price"] == 1
    assert scores[3]["price"] == NEUTRAL  # only hat, nothing to compare with


def test_highest_rating_of_a_type_scores_1_and_lowest_scores_0():
    scores = compute_scores([product(1, rating=4.5), product(2, rating=4.8), product(3, rating=4.6)])
    assert scores[2]["rating"] == 1
    assert scores[1]["rating"] == 0
    assert 0 < scores[3]["rating"] < 1


def test_missing_values_are_neutral():
    scores = compute_scores([product(1, price=100, rating=4), product(2, price=None, rating=None)])
    assert scores[2]["price"] == NEUTRAL
    assert scores[2]["rating"] == NEUTRAL


def test_same_price_for_every_product_is_neutral():
    scores = compute_scores([product(1, price=50), product(2, price=50)])
    assert scores[1]["price"] == NEUTRAL
    assert scores[2]["price"] == NEUTRAL


def test_brand_with_one_product_is_neutral():
    scores = compute_scores([product(1, rating=4.0, brand="Nike"), product(2, rating=5.0, brand="Adidas")])
    assert scores[1]["brand"] == NEUTRAL
    assert scores[2]["brand"] == NEUTRAL


def test_brand_with_several_products_gets_their_average_rating_score():
    scores = compute_scores(
        [
            product(1, rating=4.0, brand="Nike"),
            product(2, rating=5.0, brand="nike "),  # same brand, different spelling
            product(3, rating=4.5, brand="Adidas"),
        ]
    )
    # Nike's rating scores are 0 and 1, so the brand averages 0.5
    assert scores[1]["brand"] == scores[2]["brand"] == 0.5
    assert scores[3]["brand"] == NEUTRAL


def test_review_based_scores_are_neutral_for_now():
    scores = compute_scores([product(1, price=100, rating=4)])
    for criterion in ("quality", "durability", "comfort"):
        assert scores[1][criterion] == NEUTRAL


def test_every_score_is_between_0_and_1():
    products = [product(i, "Boot", price=50 + i * 10, rating=3 + i * 0.2, brand="A" if i % 2 else "B") for i in range(8)]
    for scores in compute_scores(products).values():
        assert all(0 <= value <= 1 for value in scores.values())