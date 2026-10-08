# Marks the backend/ directory as the pytest root, so application modules
# (main, database, schemas, routers) are importable from tests/.

from pathlib import Path

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

