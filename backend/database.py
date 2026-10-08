import os
from contextlib import contextmanager
from pathlib import Path

import psycopg
from dotenv import load_dotenv
from psycopg.rows import dict_row

# Load backend/.env relative to this file
load_dotenv(Path(__file__).with_name(".env"))

# Development-only fallback pointing at the docker database defined in
# docker-compose.yml. It is reachable only when USE_LOCAL_DEV_DB is true
LOCAL_DEV_DATABASE_URL = "postgresql://mccs:mccs@localhost:5433/mccs"

_TRUTHY = {"1", "true", "yes", "on"}


def get_database_url() -> str:
    """Resolve the database URL from the environment.

    An explicit DATABASE_URL always takes precedence, so the dev fallback can
    never override it.
    """
    url = os.getenv("DATABASE_URL")
    if url:
        return url
    if os.getenv("USE_LOCAL_DEV_DB", "").strip().lower() in _TRUTHY:
        return LOCAL_DEV_DATABASE_URL
    raise RuntimeError(
        "DATABASE_URL is not set. Copy backend/.env.example to backend/.env and "
        "fill it in, or set USE_LOCAL_DEV_DB=1 to use the local docker database."
    )


def describe_database_url(url: str) -> str:
    """Render a database URL for logs: host, port, and db name only.

    Credentials are never included.
    """
    parsed = psycopg.conninfo.conninfo_to_dict(url)
    host = parsed.get("host") or "?"
    port = parsed.get("port")
    dbname = parsed.get("dbname") or "?"
    return f"{dbname} on {host}{f':{port}' if port else ''}"


@contextmanager
def get_connection():
    """Yield a dict-row connection that commits on success, rolls back on error."""
    with psycopg.connect(
        get_database_url(), row_factory=dict_row, connect_timeout=10
    ) as conn:
        yield conn
