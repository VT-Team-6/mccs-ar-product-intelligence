"""Learning to rank for "Recommended for You" (task 9).

Uses made-up embeddings, so no model download is needed.
"""

import json

import numpy as np

import for_you_model
from for_you_model import MIN_IMPRESSIONS, SIGNALS, load_weights, save_weights, train
from preferences import CRITERIA
from ranking import RecommendationEngine

NOTHING_RANKED = {c: 0 for c in CRITERIA}


def _clicks_follow(signal: str, n: int = 400, seed: int = 0):
    """Made-up shown cards where opening one depends only on `signal`."""
    rng = np.random.default_rng(seed)
    features = rng.random((n, len(SIGNALS)))
    chance = 1 / (1 + np.exp(-(6 * features[:, SIGNALS.index(signal)] - 3)))
    return features, (rng.random(n) < chance).astype(int)


# --- training ---------------------------------------------------------------

def test_learns_which_signal_clicks_follow():
    for signal in SIGNALS:
        weights = train(*_clicks_follow(signal))
        assert max(weights, key=weights.get) == signal


def test_weight_sizes_add_up_to_1():
    weights = train(*_clicks_follow("likes"))
    assert abs(sum(abs(w) for w in weights.values()) - 1) < 1e-3


def test_too_little_data_learns_nothing():
    features, clicked = _clicks_follow("likes", n=MIN_IMPRESSIONS - 1)
    assert train(features, clicked) is None


def test_no_clicks_learns_nothing():
    features, _ = _clicks_follow("likes")
    assert train(features, np.zeros(len(features))) is None


# --- saving and loading -----------------------------------------------------

def test_saved_weights_load_back(tmp_path):
    path = tmp_path / "weights.json"
    weights = {"similarity": 0.2, "preference": 0.3, "likes": 0.5}
    save_weights(weights, impressions=100, clicks=10, path=path)
    assert load_weights(path) == weights


def test_no_file_or_a_broken_one_means_hand_picked_weights(tmp_path):
    assert load_weights(tmp_path / "missing.json") is None
    broken = tmp_path / "broken.json"
    broken.write_text("{not json")
    assert load_weights(broken) is None
    partial = tmp_path / "partial.json"
    partial.write_text(json.dumps({"weights": {"similarity": 1}}))
    assert load_weights(partial) is None


# --- the engine uses them ---------------------------------------------------

def _engine():
    """6 boots: the higher the id, the less like boot 1. Boot 5 is the comfiest."""
    products = [
        {"product_id": i, "name": f"Boot {i}", "brand": "B", "product_type": "Boot",
         "price": 100.0, "rating": 4.0, "description": "leather boot"}
        for i in range(1, 7)
    ]
    embeddings = np.ones((6, 4))
    embeddings[:, 0] += np.arange(6) * 0.05
    embeddings /= np.linalg.norm(embeddings, axis=1, keepdims=True)
    neutral = {c: 0.5 for c in CRITERIA}
    scores = {i: dict(neutral) for i in range(1, 7)}
    scores[5]["comfort"] = 1.0
    return RecommendationEngine(products, scores, embeddings=embeddings)


def _pick(engine):
    result = engine.recommend(
        product_id=1, saved_ranks={**NOTHING_RANKED, "comfort": 1}, liked_ids=[2]
    )
    return result


def _learned(weights):
    save_weights(weights, impressions=100, clicks=10)


def test_learned_weights_change_the_pick():
    engine = _engine()
    _learned({"similarity": 1.0, "preference": 0.0, "likes": 0.0})
    assert _pick(engine)["for_you"]["product_id"] == 3  # most similar that isn't liked

    _learned({"similarity": 0.0, "preference": 1.0, "likes": 0.0})
    assert _pick(engine)["for_you"]["product_id"] == 5  # the comfiest


def test_without_learned_weights_the_hand_picked_ones_are_used():
    assert not for_you_model.WEIGHTS_FILE.exists()
    result = _pick(_engine())
    assert result["for_you"] is not None


def test_signals_are_returned_for_each_product_the_pick_chose_from():
    result = _pick(_engine())
    assert result["for_you"]["product_id"] in result["signals"]
    assert 2 not in result["signals"]  # liked, so never the pick
    for values in result["signals"].values():
        assert len(values) == len(SIGNALS)
        assert all(0 <= v <= 1 for v in values)


def test_no_signals_without_a_saved_ranking_or_likes():
    result = _engine().recommend(product_id=1)
    assert result["for_you"] is None
    assert result["signals"] == {}
