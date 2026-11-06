"""Learning to rank for "Recommended for You" (task 9).

The pick mixes three signals: how similar a product is to the request, how well
it fits the shopper's saved ranking, and how close it is to what they liked.
Instead of fixed weights, a logistic regression learns them from which shown
cards were actually opened. Until there's enough data, the engine keeps its
hand-picked weights.
"""

import json
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression

SIGNALS = ("similarity", "preference", "likes")
WEIGHTS_FILE = Path(__file__).parent / "models" / "for_you_weights.json"

# Below this, a model learns noise, so the hand-picked weights stay
MIN_IMPRESSIONS = 30

# A shown card counts as clicked if the product was opened from recommendations this soon after
CLICK_WINDOW_MINUTES = 30


def load_training_data(conn) -> tuple[list[list[float]], list[int]]:
    """Every logged card's 3 signals, and whether it was opened (1) or not (0)."""
    rows = conn.execute(
        """
        SELECT i.similarity, i.preference, i.likes,
               EXISTS (
                   SELECT 1 FROM user_product_history h
                   WHERE h.user_id = i.user_id
                     AND h.product_id = i.product_id
                     AND h.interaction = 'viewed-from-recommendation'
                     AND h.occurred_at BETWEEN i.shown_at
                         AND i.shown_at + make_interval(mins => %s)
               ) AS clicked
        FROM recommendation_impressions i
        ORDER BY i.impression_id
        """,
        (CLICK_WINDOW_MINUTES,),
    ).fetchall()
    features = [[float(row[s]) for s in SIGNALS] for row in rows]
    clicked = [int(row["clicked"]) for row in rows]
    return features, clicked


def train(features, clicked) -> dict | None:
    """Learned weights from shown cards: features are the 3 signals, clicked is 0/1.

    Weights are scaled so their sizes add up to 1, like the hand-picked ones, so
    the requirement bonus keeps the same effect. None when there's too little
    data or nothing to learn from (no clicks, or everything clicked).
    """
    X = np.asarray(features, dtype=float).reshape(-1, len(SIGNALS))
    y = np.asarray(clicked, dtype=int)
    if len(y) < MIN_IMPRESSIONS or y.min() == y.max():
        return None
    coefs = LogisticRegression().fit(X, y).coef_[0]
    total = np.abs(coefs).sum()
    if total == 0:
        return None
    return {signal: round(float(c / total), 4) for signal, c in zip(SIGNALS, coefs)}


def save_weights(weights: dict, impressions: int, clicks: int, path: Path | None = None) -> None:
    path = path or WEIGHTS_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(
        {"weights": weights, "impressions": impressions, "clicks": clicks}, indent=2
    ) + "\n")


def load_weights(path: Path | None = None) -> dict | None:
    """The learned weights, or None to use the hand-picked ones."""
    path = path or WEIGHTS_FILE  # looked up each call, so tests can point it elsewhere
    try:
        weights = json.loads(path.read_text()).get("weights", {})
    except (FileNotFoundError, ValueError, AttributeError):
        return None
    if not all(isinstance(weights.get(s), (int, float)) for s in SIGNALS):
        return None
    return {s: float(weights[s]) for s in SIGNALS}
