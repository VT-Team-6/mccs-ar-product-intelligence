"""Tests for the recommendation ranking (8.13).

Uses a small made-up catalog and the real embedding model, so the first run
may download the model.
"""

import numpy as np
import pytest

from preferences import CRITERIA
from ranking import (
    RecommendationEngine,
    combined_weights,
    compare_within,
    rescale,
    types_named_in,
)

NOTHING_RANKED = {c: 0 for c in CRITERIA}


def product(product_id, name, product_type, description, price, rating=4.5):
    return {
        "product_id": product_id,
        "name": name,
        "brand": None,
        "product_type": product_type,
        "price": price,
        "rating": rating,
        "description": description,
    }


CATALOG = [
    product(1, "Alpine Snow Boot", "Boot", "Insulated waterproof boots for snow and freezing winter weather", 200),
    product(2, "Glacier Winter Boot", "Boot", "Warm insulated boots built for snow and ice", 190),
    product(3, "Summit Hiking Boot", "Boot", "Sturdy leather boots for hiking trails and cold weather", 180),
    product(4, "Beach Flip Flop", "Flip-Flop", "Light summer flip flops for the beach and pool", 20),
    product(5, "Oxford Dress Shoe", "Dress Shoe", "Polished leather oxford shoes for weddings and formal events", 150),
    product(6, "Daily Runner", "Running Shoe", "Cushioned running shoes for road runs and the gym", 120),
    product(7, "Trail Runner", "Running Shoe", "Lightweight running shoes for muddy trail runs", 130),
    product(8, "Classic Sandal", "Sandal", "Comfortable sandals for warm summer days", 40),
    # The only rain boot, like Hunter in the real catalog
    product(9, "Puddle Rain Boot", "Rain Boot", "Waterproof rubber boots for rain and puddles", 70),
]


def scores(**overrides):
    """Every criterion 0.5, except the given {product_id: {criterion: score}}."""
    result = {p["product_id"]: {c: 0.5 for c in CRITERIA} for p in CATALOG}
    for product_id, values in overrides.items():
        result[int(product_id[1:])].update(values)
    return result


@pytest.fixture(scope="module")
def engine():
    return RecommendationEngine(
        CATALOG,
        scores(p3={"comfort": 1.0}, p6={"comfort": 0.9}),
    )


def ids(cards):
    return [card["product_id"] for card in cards]


# --- small helpers (no model needed) ----------------------------------------


def test_rescale_puts_best_at_1_and_worst_at_0():
    assert list(rescale(np.array([2.0, 4.0, 3.0]))) == [0, 1, 0.5]
    assert list(rescale(np.array([5.0, 5.0]))) == [0, 0]


def test_types_named_in_text_singular_or_plural():
    types = {"Boot", "Rain Boot", "Sandal", "Running Shoe"}
    assert types_named_in("warm boots for snow", types) == {"Boot"}
    assert types_named_in("rain boot for puddles", types) == {"Boot", "Rain Boot"}
    assert types_named_in("running shoes", types) == {"Running Shoe"}
    assert types_named_in("something for a wedding", types) == set()


def test_compare_within_scores_values_against_each_other():
    prices = np.array([100.0, 200.0, 150.0])
    assert list(compare_within(prices, higher_is_better=False)) == [1, 0, 0.5]
    assert list(compare_within(prices, higher_is_better=True)) == [0, 1, 0.5]


def test_compare_within_is_neutral_without_anything_to_compare():
    assert list(compare_within(np.array([100.0, np.nan]), False)) == [0.5, 0.5]
    assert list(compare_within(np.array([100.0, 100.0]), False)) == [0.5, 0.5]
    assert list(compare_within(np.array([100.0, np.nan, 50.0]), False)) == [0, 0.5, 1]


def test_combined_weights_average_now_and_saved():
    weights = combined_weights({**NOTHING_RANKED, "price": 1}, {**NOTHING_RANKED, "comfort": 1})
    assert weights["price"] == pytest.approx(weights["comfort"])
    assert weights["price"] > weights["rating"]
    assert sum(weights.values()) == pytest.approx(1)


# --- requests ---------------------------------------------------------------


def test_needs_a_product_or_text(engine):
    with pytest.raises(ValueError):
        engine.recommend()
    with pytest.raises(ValueError):
        engine.recommend(text="   ")


def test_unknown_product_is_an_error(engine):
    with pytest.raises(KeyError):
        engine.recommend(product_id=999)


def test_returns_3_best_matches_without_the_scanned_product(engine):
    result = engine.recommend(product_id=1)
    assert len(result["best_matches"]) == 3
    assert 1 not in ids(result["best_matches"])


def test_scores_are_in_order(engine):
    cards = engine.recommend(product_id=1, now_ranks={**NOTHING_RANKED, "comfort": 1})["best_matches"]
    assert [c["score"] for c in cards] == sorted((c["score"] for c in cards), reverse=True)


def test_same_input_gives_same_output(engine):
    request = {"product_id": 6, "text": "for the gym", "now_ranks": {**NOTHING_RANKED, "price": 1}}
    assert engine.recommend(**request) == engine.recommend(**request)


def test_scanning_a_snow_boot_never_returns_summer_products(engine):
    result = engine.recommend(product_id=1, now_ranks={**NOTHING_RANKED, "price": 1})
    assert not {4, 8} & set(ids(result["best_matches"]))


def test_without_a_ranking_results_are_by_similarity_only(engine):
    cards = engine.recommend(product_id=1)["best_matches"]
    assert cards[0]["product_id"] == 2  # the other insulated snow boot


def test_ranking_price_first_moves_the_cheapest_similar_product_up(engine):
    plain = engine.recommend(product_id=3)["best_matches"]
    cheap = engine.recommend(product_id=3, now_ranks={**NOTHING_RANKED, "price": 1})["best_matches"]
    # The $70 rain boot moves up, and says why
    assert ids(cheap).index(9) < ids(plain).index(9)
    assert "Cheaper than similar products" in cheap[ids(cheap).index(9)]["reasons"]


def test_price_is_compared_across_types_among_the_results(engine):
    # Like the Timberland example: the only rain boot is the cheapest waterproof
    # boot, so with price first it should win even though its type is different
    cards = engine.recommend(
        product_id=1, text="waterproof boots", now_ranks={**NOTHING_RANKED, "price": 1}
    )["best_matches"]
    assert cards[0]["product_id"] == 9


def test_ranking_comfort_first_moves_the_comfiest_product_up(engine):
    plain = ids(engine.recommend(product_id=2)["best_matches"])
    comfy = ids(engine.recommend(product_id=2, now_ranks={**NOTHING_RANKED, "comfort": 1})["best_matches"])
    assert comfy.index(3) <= plain.index(3)
    assert comfy[0] == 3


def test_text_search_finds_by_meaning(engine):
    cards = engine.recommend(text="something to wear to a wedding")["best_matches"]
    assert cards[0]["product_id"] == 5


def test_product_and_text_together(engine):
    cards = engine.recommend(product_id=6, text="for muddy trails")["best_matches"]
    assert cards[0]["product_id"] == 7


def test_every_card_has_1_or_2_reasons(engine):
    result = engine.recommend(product_id=1, now_ranks={**NOTHING_RANKED, "price": 1, "comfort": 2})
    for card in result["best_matches"]:
        assert 1 <= len(card["reasons"]) <= 2


# --- recommended for you ------------------------------------------------------


def test_no_for_you_without_a_saved_ranking_or_likes(engine):
    result = engine.recommend(product_id=1, now_ranks={**NOTHING_RANKED, "price": 1})
    assert result["for_you"] is None


def test_for_you_is_a_new_product(engine):
    result = engine.recommend(
        text="boots for winter",
        saved_ranks={**NOTHING_RANKED, "comfort": 1},
        liked_ids=[2],
    )
    pick = result["for_you"]["product_id"]
    assert pick not in ids(result["best_matches"])
    assert pick != 2  # already liked


def test_for_you_uses_the_saved_ranking(engine):
    result = engine.recommend(text="boots for cold weather", saved_ranks={**NOTHING_RANKED, "comfort": 1})
    shown = ids(result["best_matches"]) + [result["for_you"]["product_id"]]
    assert 3 in shown  # the comfiest boot makes it in somewhere

def test_likes_only_count_when_truly_similar(engine):
    # Liking a flip flop says nothing about winter boots
    result = engine.recommend(text="boots for winter", liked_ids=[4])
    assert result["for_you"] is not None
    assert "Like products you liked" not in result["for_you"]["reasons"]