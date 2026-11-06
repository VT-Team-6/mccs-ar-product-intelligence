# Marks the backend/ directory as the pytest root, so application modules
# (main, database, schemas, routers) are importable from tests/.

from pathlib import Path

import pytest

DB_DIR = Path(__file__).parent / "db"


def apply_init_sql(conn) -> None:
    """Apply every SQL file under db/ in the same order as `docker compose up`.

    Files directly inside db/ are run by the postgres image; files in
    subdirectories are run by db/zz-load-nested-sql.sh, after those.
    """
    top_level = sorted(DB_DIR.glob("*.sql"))
    nested = sorted(p for p in DB_DIR.rglob("*.sql") if p.parent != DB_DIR)
    for path in [*top_level, *nested]:
        conn.execute(path.read_text())



@pytest.fixture(autouse=True)
def _no_learned_for_you_weights(monkeypatch, tmp_path):
    """A locally trained models/for_you_weights.json must not change test results."""
    import for_you_model

    monkeypatch.setattr(for_you_model, "WEIGHTS_FILE", tmp_path / "for_you_weights.json")
