"""Score the recommendation engine on the test set in recommendation_cases.py (task 10).

Run from backend/ with the database up:
    python -m scripts.evaluate_recommendations            # score the current settings
    python -m scripts.evaluate_recommendations --verbose  # plus what every case showed
    python -m scripts.evaluate_recommendations --tune     # search for better settings

Each case is scored 0-1:
  - NDCG@3: are the best products shown, and near the top? 1 = the best
    possible top 3 in the best order, 0 = nothing useful shown.
  - precision: share of the shown cards that are at least the right category.
  - case score = 0.7 x NDCG@3 + 0.3 x precision. A case that expects nothing
    scores 1 when nothing is shown and 0 otherwise.
The overall score is the average case score.

--tune tries every combination in GRID on half the cases (train) and reports
how the winner does on the other half (test), so settings aren't just fitted
to these exact searches. It prints the values to put in ranking.py; it never
changes anything itself.
"""

import argparse
import itertools
import math
from functools import lru_cache

import numpy as np

import ranking
from scripts.recommendation_cases import CASES, Case

NDCG_WEIGHT, PRECISION_WEIGHT = 0.7, 0.3
TOP = ranking.BEST_MATCHES

# Settings --tune tries. EMBEDDING_WEIGHT is always 1 - TFIDF_WEIGHT.
GRID = {
    "MIN_MATCH": [0.55, 0.58, 0.60, 0.62, 0.64, 0.66, 0.68, 0.70],
    "TFIDF_WEIGHT": [0.2, 0.3, 0.4, 0.5],
    "RELATIVE_SIMILARITY": [0.6, 0.7, 0.8],
    "TYPE_BONUS": [0.0, 0.15],
}


def apply(settings: dict) -> None:
    for name, value in settings.items():
        setattr(ranking, name, value)
    if "TFIDF_WEIGHT" in settings:
        ranking.EMBEDDING_WEIGHT = 1 - settings["TFIDF_WEIGHT"]


def current_settings() -> dict:
    return {name: getattr(ranking, name) for name in GRID}


def dcg(grades: list[int]) -> float:
    return sum((2 ** g - 1) / math.log2(n + 2) for n, g in enumerate(grades))


def run_case(engine, case: Case) -> tuple[float, float, float, list[tuple[str, int]]]:
    """(case score, NDCG@3, precision, [(shown product, its grade)])."""
    product_id = None
    if case.product:
        matches = [p["product_id"] for p in engine.products if p["name"] == case.product]
        if len(matches) != 1:
            raise ValueError(f"Case {case.name!r}: product {case.product!r} not found once")
        product_id = matches[0]

    result = engine.recommend(product_id=product_id, text=case.text, now_ranks=case.ranks)
    by_id = {p["product_id"]: p for p in engine.products}
    shown = [by_id[card["product_id"]] for card in result["best_matches"]]
    graded = [(p["name"], case.grade(p)) for p in shown]

    if case.expects_nothing:
        score = 1.0 if not shown else 0.0
        return score, score, score, graded

    ideal = sorted(
        (case.grade(p) for p in engine.products if p["product_id"] != product_id), reverse=True
    )[:TOP]
    ndcg = dcg([g for _, g in graded]) / dcg(ideal) if dcg(ideal) > 0 else 0.0
    precision = sum(g > 0 for _, g in graded) / len(graded) if graded else 0.0
    return NDCG_WEIGHT * ndcg + PRECISION_WEIGHT * precision, ndcg, precision, graded


def evaluate(engine, cases: list[Case]) -> dict:
    rows = [(case, *run_case(engine, case)) for case in cases]
    relevant = [r for r in rows if not r[0].expects_nothing]
    nothing = [r for r in rows if r[0].expects_nothing]
    return {
        "score": float(np.mean([r[1] for r in rows])),
        "ndcg": float(np.mean([r[2] for r in relevant])) if relevant else 0.0,
        "precision": float(np.mean([r[3] for r in relevant])) if relevant else 0.0,
        "nothing": float(np.mean([r[1] for r in nothing])) if nothing else 0.0,
        "rows": rows,
    }


def summary(label: str, result: dict) -> str:
    return (f"{label}: score {result['score']:.3f}  |  NDCG@3 {result['ndcg']:.3f}  "
            f"precision {result['precision']:.3f}  shows nothing when it should {result['nothing']:.3f}")


def print_cases(result: dict) -> None:
    for case, score, ndcg, precision, graded in sorted(result["rows"], key=lambda r: r[1]):
        shown = ", ".join(f"{name[:28]} ({grade})" for name, grade in graded) or "nothing"
        print(f"  {score:.2f}  {case.name:<32} {shown}")


def tune(engine) -> None:
    train = CASES[0::2]
    test = CASES[1::2]
    baseline = current_settings()

    names = list(GRID)
    results = []
    for values in itertools.product(*(GRID[n] for n in names)):
        settings = dict(zip(names, values))
        apply(settings)
        results.append((evaluate(engine, train)["score"], settings))
    results.sort(key=lambda r: -r[0])

    print(f"Tried {len(results)} combinations on {len(train)} train cases. Best 5:")
    for score, settings in results[:5]:
        print(f"  {score:.3f}  {settings}")

    best = results[0][1]
    apply(baseline)
    before_test, before_all = evaluate(engine, test), evaluate(engine, CASES)
    apply(best)
    after_test, after_all = evaluate(engine, test), evaluate(engine, CASES)
    apply(baseline)

    print(f"\nOn the {len(test)} held-out test cases:")
    print(summary("  current", before_test))
    print(summary("  tuned  ", after_test))
    print("\nOn all cases:")
    print(summary("  current", before_all))
    print(summary("  tuned  ", after_all))
    print("\nTo use the tuned settings, set these in ranking.py:")
    for name, value in best.items():
        print(f"  {name} = {value}")
    print(f"  EMBEDDING_WEIGHT = {1 - best['TFIDF_WEIGHT']:.1f}  (with TFIDF_WEIGHT)")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--verbose", action="store_true", help="show what every case returned")
    parser.add_argument("--tune", action="store_true", help="search GRID for better settings")
    args = parser.parse_args()

    # The same searches run many times while tuning; embed each one only once
    ranking.embed_query = lru_cache(maxsize=None)(ranking.embed_query)
    ranking.rebuild_engine()
    engine = ranking.get_engine()

    if args.tune:
        tune(engine)
        return

    result = evaluate(engine, CASES)
    print(f"{len(CASES)} cases, settings {current_settings()}")
    print(summary("Overall", result))
    if args.verbose:
        print("\nEvery case, worst first (grade after each product: 3 perfect, 0 wrong):")
        print_cases(result)


if __name__ == "__main__":
    main()
