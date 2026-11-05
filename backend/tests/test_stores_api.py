"""Store API tests. Only tests named 'nearby_sql' require Docker.

Run from backend: python -m pytest tests/test_stores_api.py -v
Without Docker:  python -m pytest tests/test_stores_api.py -v -k "not nearby_sql"
External geocoding responses are mocked; no Open-Meteo calls are made.
"""

from contextlib import contextmanager
from urllib.parse import quote

import httpx
import psycopg
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from psycopg.rows import dict_row

from routers import stores


@pytest.fixture
def client():
    # Avoid importing main: its startup initializes unrelated recommendation data.
    app = FastAPI()
    app.include_router(stores.router)
    with TestClient(app) as client:
        yield client


@pytest.fixture
def geocoder(monkeypatch):
    original_client = httpx.AsyncClient

    def configure(handler):
        transport = httpx.MockTransport(handler)
        monkeypatch.setattr(
            stores.httpx, "AsyncClient",
            lambda **kwargs: original_client(transport=transport, **kwargs),
        )

    return configure


@pytest.mark.parametrize("query", ["02460", "Blacksburg, VA"])
def test_location_search(client, geocoder, query):
    def respond(request):
        assert request.url.host == "geocoding-api.open-meteo.com"
        assert request.url.params["name"] == query
        assert request.url.params["countryCode"] == "US"
        assert request.url.params["count"] == "5"
        return httpx.Response(200, json={"results": [
            {"id": 1, "name": "First City", "admin1": "Virginia",
             "country": "United States", "latitude": 37.23, "longitude": -80.42},
            {"id": 2, "name": "Second City", "latitude": 38, "longitude": -81},
        ]})

    geocoder(respond)
    response = client.get("/api/stores/search", params={"q": f" {query} "})
    assert response.status_code == 200
    assert response.json() == {"locations": [
        {"id": 1, "label": "First City, Virginia, United States",
         "latitude": 37.23, "longitude": -80.42},
        {"id": 2, "label": "Second City", "latitude": 38, "longitude": -81},
    ]}


@pytest.mark.parametrize("payload", [{}, {"results": []}])
def test_no_matching_locations(client, geocoder, payload):
    geocoder(lambda request: httpx.Response(200, json=payload))
    response = client.get("/api/stores/search?q=unknown")
    assert response.status_code == 200
    assert response.json() == {"locations": []}


@pytest.mark.parametrize("failure,status", [
    ("timeout", 504), ("connection", 502), ("http", 502),
    ("json", 502), ("fields", 502),
])
def test_geocoding_failures(client, geocoder, failure, status):
    def respond(request):
        if failure == "timeout":
            raise httpx.ReadTimeout("timeout", request=request)
        if failure == "connection":
            raise httpx.ConnectError("unavailable", request=request)
        if failure == "http":
            return httpx.Response(429)
        if failure == "json":
            return httpx.Response(200, text="not JSON")
        return httpx.Response(200, json={"results": [{}]})

    geocoder(respond)
    assert client.get("/api/stores/search?q=24060").status_code == status


@pytest.mark.parametrize("path", [
    "/search", "/search?q=a", "/search?q=%20%20", "/search?q=" + "a" * 151,
    "/nearby", "/nearby?latitude=0",
    "/nearby?latitude=91&longitude=0", "/nearby?latitude=0&longitude=-181",
    "/nearby?latitude=nan&longitude=0", "/nearby?latitude=0&longitude=inf",
    "/nearby?latitude=0&longitude=0&radius_miles=0",
    "/nearby?latitude=0&longitude=0&radius_miles=201",
    "/nearby?latitude=0&longitude=0&limit=0",
    "/nearby?latitude=0&longitude=0&limit=101",
])
def test_invalid_input(client, monkeypatch, path):
    def unexpected_call(*args, **kwargs):
        pytest.fail("Invalid input must be rejected before accessing services")

    monkeypatch.setattr(stores.httpx, "AsyncClient", unexpected_call)
    monkeypatch.setattr(stores, "get_connection", unexpected_call)
    assert client.get("/api/stores" + path).status_code == 422


@pytest.fixture(scope="module")
def store_db_url():
    from testcontainers.community.postgres import PostgresContainer

    # A disposable database: never connect these tests to the development DB.
    with PostgresContainer("postgres:17") as pg:
        url = (f"postgresql://{quote(pg.username, safe='')}:{quote(pg.password, safe='')}"
               f"@{pg.get_container_host_ip()}:{pg.get_exposed_port(5432)}/{pg.dbname}")
        with psycopg.connect(url) as conn:
            conn.execute("""
                CREATE TABLE stores (
                    store_id int PRIMARY KEY, name text, address text,
                    latitude numeric(10,8), longitude numeric(11,8)
                )
            """)
            conn.execute("""
                INSERT INTO stores VALUES
                    (1, 'Origin', 'One', 0, 0),
                    (2, 'East', 'Two', 0, 0.1),
                    (3, 'West', 'Three', 0, -0.1),
                    (4, 'Far away', 'Four', 0, 1),
                    (5, 'Missing latitude', 'Five', NULL, 0),
                    (6, 'Missing longitude', 'Six', 0, NULL)
            """)
        yield url


@pytest.fixture
def sql_client(client, monkeypatch, store_db_url):
    @contextmanager
    def connection():
        with psycopg.connect(store_db_url, row_factory=dict_row) as conn:
            yield conn

    monkeypatch.setattr(stores, "get_connection", connection)
    return client


def test_nearby_sql_filters_sorts_and_measures(sql_client):
    response = sql_client.get("/api/stores/nearby?latitude=0&longitude=0")
    assert response.status_code == 200
    body = response.json()
    assert body["origin"] == {"latitude": 0, "longitude": 0}
    assert body["radius_miles"] == 25
    results = body["stores"]
    assert [row["store_id"] for row in results] == [1, 2, 3]
    assert results[0]["distance_miles"] == pytest.approx(0)
    assert results[1]["distance_miles"] == pytest.approx(6.91, abs=0.01)
    assert results[2]["distance_miles"] == pytest.approx(6.91, abs=0.01)


@pytest.mark.parametrize("extra,expected", [
    ("&limit=2", [1, 2]), ("&radius_miles=1", [1]),
    ("&radius_miles=100", [1, 2, 3, 4]),
])
def test_nearby_sql_radius_and_limit(sql_client, extra, expected):
    response = sql_client.get("/api/stores/nearby?latitude=0&longitude=0" + extra)
    assert response.status_code == 200
    assert [row["store_id"] for row in response.json()["stores"]] == expected


def test_nearby_sql_no_stores_in_range(sql_client):
    response = sql_client.get("/api/stores/nearby?latitude=50&longitude=50")
    assert response.status_code == 200
    assert response.json()["stores"] == []
