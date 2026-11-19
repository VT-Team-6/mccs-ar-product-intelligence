"""Review management is app-admin-only, including for a product's owning manager."""

from contextlib import contextmanager

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import auth
from routers import reviews


@pytest.fixture
def client(monkeypatch):
    # The tests exercise authorization; provider/network access is never needed.
    class Result:
        def fetchone(self):
            return {"product_id": 1, "name": "Test", "created_by_store_id": 1}

        def fetchall(self):
            return []

    class Connection:
        def execute(self, *args):
            return Result()

    @contextmanager
    def connection():
        yield Connection()

    monkeypatch.setattr(reviews, "get_connection", connection)
    app = FastAPI()
    app.include_router(reviews.admin_router)
    app.include_router(reviews.router)
    with TestClient(app) as test_client:
        yield test_client, app


def _as(app, role):
    app.dependency_overrides[auth.require_authenticated_user] = lambda: {
        "user_id": 10, "role": role, "store_ids": [1],
        "permissions": sorted(auth.ROLE_PERMISSIONS[role]),
    }


@pytest.mark.parametrize("role", ["user", "store_clerk", "store_buyer", "store_admin"])
@pytest.mark.parametrize("method,path,body", [
    ("GET", "review-candidates", None),
    ("GET", "review-sources", None),
    ("PUT", "review-sources", {"source": "amazon", "source_product_ids": []}),
    ("POST", "import-reviews", None),
])
def test_non_admins_cannot_manage_review_sources(client, role, method, path, body):
    http, app = client
    _as(app, role)
    response = http.request(method, f"/api/admin/products/1/{path}", json=body)
    assert response.status_code == 403


def test_app_admin_can_read_sources(client):
    http, app = client
    _as(app, "system_admin")
    response = http.get("/api/admin/products/1/review-sources")
    assert response.status_code == 200
    assert response.json() == {"sources": []}


def test_public_reviews_remain_public(client):
    http, _ = client
    response = http.get("/api/products/1/reviews")
    assert response.status_code == 200
    assert response.json() == []
