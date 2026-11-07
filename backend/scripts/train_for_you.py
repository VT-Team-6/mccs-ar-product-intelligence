"""Train the "Recommended for You" weights from what shoppers opened (task 9).

Run from backend/:
    python scripts/train_for_you.py          # learn from the database
    python scripts/train_for_you.py --demo   # learn from made-up data, for a demo

Saves models/for_you_weights.json, which the app uses on its next recommendation.
Delete that file to go back to the hand-picked weights. --demo never touches the
database; it only shows the weights moving toward the signal clicks follow.
"""

import argparse
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from for_you_model import (  # noqa: E402
    SIGNALS,
    WEIGHTS_FILE,
    load_training_data,
    load_weights,
    save_weights,
    train,
)


def from_database():
    from database import get_connection

    with get_connection() as conn:
        return load_training_data(conn)


def demo_data(n: int = 500, seed: int = 0):
    """Made-up shoppers who mostly open products close to what they liked."""
    rng = np.random.default_rng(seed)
    features = rng.random((n, len(SIGNALS)))
    similarity, preference, likes = features.T
    chance = 1 / (1 + np.exp(-(1.0 * similarity + 0.5 * preference + 4.0 * likes - 3.0)))
    clicked = (rng.random(n) < chance).astype(int)
    return features.tolist(), clicked.tolist()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--demo", action="store_true", help="train on made-up data")
    args = parser.parse_args()

    features, clicked = demo_data() if args.demo else from_database()
    print(f"{len(clicked)} shown cards, {sum(clicked)} opened")

    before = load_weights()
    weights = train(features, clicked)
    if weights is None:
        print("Not enough data to learn from yet: keeping the current weights.")
        return

    save_weights(weights, impressions=len(clicked), clicks=sum(clicked))
    print("Before:", before or "hand-picked (0.4 similarity, 0.4 preference, 0.2 likes)")
    print("After: ", weights)
    print(f"Saved to {WEIGHTS_FILE}")


if __name__ == "__main__":
    main()
