# Tests for GET /api/search.

import os
from pathlib import Path
from urllib.parse import quote

import psycopg
import pytest
from fastapi.testclient import TestClient
from testcontainers.community.postgres import PostgresContainer

from database import get_database_url
from main import app

INIT_SQL = Path(__file__).parents[1] / "db" / "init.sql"


def _connection_url(pg):
    # testcontainers masks credentials in get_connection_url(), so build it here.
    return (
        f"postgresql://{quote(pg.username)}:{quote(pg.password)}"
        f"@{pg.get_container_host_ip()}:{pg.get_exposed_port(5432)}/{pg.dbname}"
    )


@pytest.fixture(scope="module")
def client():
    with PostgresContainer("postgres:17") as pg:
        url = _connection_url(pg)
        with psycopg.connect(url, autocommit=True) as conn:
            conn.execute(INIT_SQL.read_text())

        # Point the app at the throwaway database instead of the dev container.
        previous_url = get_database_url()
        os.environ["DATABASE_URL"] = url
        try:
            with TestClient(app) as test_client:
                yield test_client
        finally:
            os.environ["DATABASE_URL"] = previous_url


def test_search_matches_name(client):
    response = client.get("/api/search", params={"q": "nike"})
    assert response.status_code == 200
    names = [product["name"] for product in response.json()]
    assert names == ["Nike Air Force 1 Low"]


def test_search_ignores_case(client):
    response = client.get("/api/search", params={"q": "TIMBERLAND"})
    assert response.status_code == 200
    assert len(response.json()) == 1
    assert response.json()[0]["brand"] == "Timberland"


def test_search_matches_product_type(client):
    response = client.get("/api/search", params={"q": "boot"})
    assert response.status_code == 200
    assert [p["name"] for p in response.json()] == ['Timberland 6" Premium Waterproof Boots']


def test_search_with_no_matches_returns_empty_list(client):
    response = client.get("/api/search", params={"q": "zzzzzz"})
    assert response.status_code == 200
    assert response.json() == []


def test_search_treats_percent_as_plain_text(client):
    response = client.get("/api/search", params={"q": "%"})
    assert response.status_code == 200
    assert response.json() == []


def test_search_requires_text(client):
    response = client.get("/api/search")
    assert response.status_code == 422
    response = client.get("/api/search", params={"q": ""})
    assert response.status_code == 422