# AI-gen tests for the products API.

import os
from datetime import datetime, timedelta
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


def test_create_product(client):
    response = client.post(
        "/api/admin/products",
        json={
            "name": "Trail Glove",
            "brand": "Acme Sports",
            "product_type": "Glove",
            "rating": 4.1,
            "description": "Grippy trail glove.",
        },
    )
    assert response.status_code == 201
    body = response.json()
    assert body["product_id"] > 0
    assert body["name"] == "Trail Glove"
    assert body["rating"] == 4.1
    assert body["created_at"]


def test_create_product_rejects_out_of_range_rating(client):
    response = client.post(
        "/api/admin/products",
        json={"name": "Bad", "product_type": "Glove", "rating": 7.5},
    )
    assert response.status_code == 422


def test_create_product_requires_name_and_product_type(client):
    response = client.post("/api/admin/products", json={"brand": "Only Brand"})
    assert response.status_code == 422


def test_update_product_partial_edit(client):
    created = client.post(
        "/api/admin/products",
        json={"name": "Original", "product_type": "Boot", "rating": 3.0},
    ).json()

    response = client.put(
        f"/api/admin/products/{created['product_id']}",
        json={"name": "Renamed", "rating": 4.8},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Renamed"
    assert body["rating"] == 4.8
    # Omitted fields are untouched.
    assert body["product_type"] == "Boot"
    assert body["product_id"] == created["product_id"]


def test_update_product_bumps_updated_at(client):
    created = client.post(
        "/api/admin/products",
        json={"name": "Bump", "product_type": "Boot"},
    ).json()

    updated = client.put(
        f"/api/admin/products/{created['product_id']}",
        json={"rating": 2.5},
    ).json()

    assert datetime.fromisoformat(updated["updated_at"]) > datetime.fromisoformat(
        created["updated_at"]
    ) - timedelta(seconds=1)


def test_update_product_rejects_null_required_field(client):
    created = client.post(
        "/api/admin/products",
        json={"name": "Keep", "product_type": "Boot"},
    ).json()

    response = client.put(
        f"/api/admin/products/{created['product_id']}", json={"name": None}
    )
    assert response.status_code == 422


def test_update_missing_product_returns_404(client):
    response = client.put(
        "/api/admin/products/999999", json={"name": "Ghost"}
    )
    assert response.status_code == 404


def test_delete_product(client):
    created = client.post(
        "/api/admin/products",
        json={"name": "Disposable", "product_type": "Boot"},
    ).json()

    response = client.delete(f"/api/admin/products/{created['product_id']}")
    assert response.status_code == 200
    assert response.json() == {"deleted": True, "product_id": created["product_id"]}

    # A second delete finds nothing.
    assert client.delete(f"/api/admin/products/{created['product_id']}").status_code == 404


def test_delete_missing_product_returns_404(client):
    assert client.delete("/api/admin/products/999999").status_code == 404
