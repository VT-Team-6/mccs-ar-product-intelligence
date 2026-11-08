"""Categories in ranking and scoring: alternatives stay in their category,
criteria that don't fit a category are ignored, and scores compare a product
with its type or, for small types, its category. Made-up embeddings, no model."""

import os
from urllib.parse import quote

import numpy as np
import psycopg
import pytest
from testcontainers.community.postgres import PostgresContainer

import product_features
import review_aspects
from conftest import apply_init_sql
from preferences import CRITERIA
from product_features import compute_scores
from ranking import RecommendationEngine, preference_scores

NOTHING_RANKED = {c: 0 for c in CRITERIA}
COMFORT_FIRST = {**NOTHING_RANKED, "comfort": 1}


def _engine(products, scores=None):
    """Products all about equally similar, so categories and scores decide."""
    embeddings = np.ones((len(products), 4))
    embeddings[:, 0] += np.arange(len(products)) * 0.01
    embeddings /= np.linalg.norm(embeddings, axis=1, keepdims=True)
    neutral = {c: 0.5 for c in CRITERIA}
    return RecommendationEngine(
        products,
        {p["product_id"]: {**neutral, **(scores or {}).get(p["product_id"], {})} for p in products},
        embeddings=embeddings,
    )


def _product(pid, category, product_type, price=50.0):
    return {"product_id": pid, "name": f"{product_type} {pid}", "brand": f"B{pid}",
            "product_type": product_type, "category": category, "price": price,
            "rating": 4.0, "description": "everyday item"}


# --- the engine --------------------------------------------------------------


def test_alternatives_to_a_product_stay_in_its_category():
    engine = _engine([
        _product(1, "shoes", "Sneaker"), _product(2, "shoes", "Sneaker"),
        _product(3, "coffee", "Ground Coffee"), _product(4, "shoes", "Boot"),
        _product(5, "coffee", "Ground Coffee"),
    ])

    best = engine.recommend(product_id=1)["best_matches"]

    assert best and {card["product_id"] for card in best} <= {2, 4}


def test_comfort_means_nothing_for_coffee():
    coffees = [_product(pid, "coffee", "Ground Coffee") for pid in (1, 2, 3, 4)]
    plain = _engine(coffees)
    # The same coffees, but 2 and 3 "score" on comfort, which coffee doesn't have
    with_comfort = _engine(coffees, scores={2: {"comfort": 1.0}, 3: {"comfort": 0.0}})

    expected = plain.recommend(product_id=1, now_ranks=COMFORT_FIRST)["best_matches"]
    cards = with_comfort.recommend(product_id=1, now_ranks=COMFORT_FIRST)["best_matches"]

    assert cards == expected
    assert all("Very comfortable" not in card["reasons"] for card in cards)


def test_comfort_still_counts_for_shoes():
    engine = _engine(
        [_product(1, "shoes", "Sneaker"), _product(2, "shoes", "Sneaker"),
         _product(3, "shoes", "Sneaker"), _product(4, "shoes", "Sneaker")],
        scores={2: {"comfort": 0.0}, 4: {"comfort": 1.0}},
    )

    cards = engine.recommend(product_id=1, now_ranks=COMFORT_FIRST)["best_matches"]

    order = [card["product_id"] for card in cards]
    assert order.index(4) < order.index(2)  # comfy beats uncomfortable
    assert "Very comfortable" in cards[order.index(4)]["reasons"]


def test_preference_scores_skip_criteria_that_dont_apply():
    scores = np.array([[0.5, 0.5, 0.5, 0.5, 0.5, 1.0]])  # comfort 1.0
    weights = {c: 1 for c in CRITERIA}
    everything = np.ones((1, len(CRITERIA)))
    no_comfort = everything.copy()
    no_comfort[0, CRITERIA.index("comfort")] = 0

    assert preference_scores(scores, weights, everything)[0] > 0.5
    assert preference_scores(scores, weights, no_comfort)[0] == pytest.approx(0.5)


# --- scores ------------------------------------------------------------------


def _scored(pid, product_type, category, price):
    return {"product_id": pid, "product_type": product_type, "category": category,
            "brand": None, "price": price, "rating": None}


def test_a_type_of_one_is_compared_with_its_category():
    scores = compute_scores([
        _scored(1, "Clog", "shoes", 40.0),
        _scored(2, "Sneaker", "shoes", 100.0),
        _scored(3, "Boot", "shoes", 200.0),
    ])
    assert scores[1]["price"] == 1.0  # cheapest shoe, not neutral
    assert scores[3]["price"] == 0.0


def test_a_big_enough_type_is_compared_within_itself():
    scores = compute_scores([
        _scored(1, "Sneaker", "shoes", 100.0),
        _scored(2, "Sneaker", "shoes", 120.0),
        _scored(3, "Sneaker", "shoes", 140.0),
        _scored(4, "Flip-Flop", "shoes", 10.0),
    ])
    assert scores[1]["price"] == 1.0  # cheapest sneaker, even though flip-flops cost less


# --- saved review topics -----------------------------------------------------


@pytest.fixture(scope="module")
def db_url():
    with PostgresContainer("postgres:17") as pg:
        url = (
            f"postgresql://{quote(pg.username)}:{quote(pg.password)}"
            f"@{pg.get_container_host_ip()}:{pg.get_exposed_port(5432)}/{pg.dbname}"
        )
        with psycopg.connect(url, autocommit=True) as conn:
            apply_init_sql(conn)
        previous = os.environ.get("DATABASE_URL")
        os.environ["DATABASE_URL"] = url
        yield url
        if previous is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = previous


def test_review_topics_are_saved_and_reused(db_url, monkeypatch):
    seen = []

    def fake_topics(reviews):
        seen.append(len(reviews))
        return [["quality"] for _ in reviews]

    monkeypatch.setattr(product_features, "review_topics", fake_topics)
    with psycopg.connect(db_url, autocommit=True) as conn:
        total = conn.execute("SELECT count(*) FROM reviews").fetchone()[0]
    assert total > 0

    product_features.refresh_product_scores()
    assert sum(seen) == total  # every review the first time

    seen.clear()
    product_features.refresh_product_scores()
    assert seen == []  # nothing the second time


def test_changed_examples_redo_only_that_category(db_url, monkeypatch):
    monkeypatch.setattr(product_features, "review_topics", lambda reviews: [["quality"] for _ in reviews])
    product_features.refresh_product_scores()

    redone = []
    monkeypatch.setattr(
        product_features, "review_topics",
        lambda reviews: redone.extend(r["category"] for r in reviews) or [[] for _ in reviews],
    )
    monkeypatch.setitem(review_aspects.TOPICS, "shoes", {"quality": ["a brand new example"]})
    product_features.refresh_product_scores()

    assert redone and set(redone) == {"shoes"}


# --- searches that name a category ---------------------------------------------


def test_category_words():
    from categories import categories_named_in

    assert categories_named_in("earbuds for running at the gym") == {"headphones"}
    assert categories_named_in("small pack for day hikes") == {"backpacks"}
    assert categories_named_in("shampoo for oily hair") == {"shampoo"}
    assert categories_named_in("warm boots for snow") == {"shoes"}
    assert categories_named_in("car tires") == categories_named_in("a new couch") == set()


def _far_away_query(monkeypatch):
    """Every search scores far below the match floor on raw similarity."""
    import ranking

    far = np.zeros(4)
    far[1] = 1.0
    monkeypatch.setattr(ranking, "embed_query", lambda text: far)


def test_a_named_category_keeps_out_other_categories_types(monkeypatch):
    _far_away_query(monkeypatch)
    engine = _engine([
        _product(1, "shoes", "Running Shoe"), _product(2, "shoes", "Running Shoe"),
        _product(3, "headphones", "Headphones"), _product(4, "headphones", "Headphones"),
        _product(5, "headphones", "Headphones"),
    ])

    best = engine.recommend(text="earbuds for running")["best_matches"]

    assert best and {card["product_id"] for card in best} <= {3, 4, 5}


def test_a_named_category_shows_its_products_even_below_the_floor(monkeypatch):
    _far_away_query(monkeypatch)
    engine = _engine([_product(pid, "headphones", "Headphones") for pid in (1, 2, 3, 4)])

    assert engine.recommend(text="headphones to block out noise on a flight")["best_matches"]
    assert engine.recommend(text="something to block out noise on a flight")["best_matches"] == []


def test_products_without_a_category_are_never_left_out(monkeypatch):
    _far_away_query(monkeypatch)
    old = [{**_product(pid, None, "Boot")} for pid in (1, 2, 3, 4)]

    assert _engine(old).recommend(text="boots for winter")["best_matches"]


def test_a_brand_with_nothing_in_the_category_is_ignored(monkeypatch):
    _far_away_query(monkeypatch)
    engine = _engine([
        {**_product(1, "shoes", "Running Shoe"), "brand": "Nike"},
        *[_product(pid, "headphones", "Headphones") for pid in (2, 3, 4, 5)],
    ])

    assert engine.recommend(text="Nike headphones")["best_matches"]


def test_alternatives_to_a_product_skip_the_floor(monkeypatch):
    # Candy that isn't very alike is still the right kind of alternative to candy
    products = [_product(pid, "candy", "Candy") for pid in (1, 2, 3)]
    embeddings = np.eye(3, 4)  # nothing similar to anything
    engine = RecommendationEngine(products, {}, embeddings=embeddings)

    best = engine.recommend(product_id=1)["best_matches"]

    assert {card["product_id"] for card in best} == {2, 3}
