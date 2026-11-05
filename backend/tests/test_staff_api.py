"""Store-scoped staff integration tests; require Docker, never contact AWS."""

from urllib.parse import quote

import psycopg
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from testcontainers.community.postgres import PostgresContainer

import auth
from conftest import DB_DIR
from routers import admin


@pytest.fixture(scope="module")
def db_url():
    with PostgresContainer("postgres:17") as pg:
        url = (f"postgresql://{quote(pg.username, safe='')}:{quote(pg.password, safe='')}"
               f"@{pg.get_container_host_ip()}:{pg.get_exposed_port(5432)}/{pg.dbname}")
        with psycopg.connect(url, autocommit=True) as conn:
            conn.execute((DB_DIR / "migrations/001-init.sql").read_text())
            # Verify migration backfills the original global role correctly.
            conn.execute("INSERT INTO users (cognito_sub,email,role) VALUES ('legacy','legacy@test','store_admin')")
            conn.execute("INSERT INTO stores (name,address) VALUES ('Legacy','Test')")
            conn.execute("INSERT INTO user_stores (user_id,store_id) SELECT user_id,store_id FROM users CROSS JOIN stores")
            conn.execute((DB_DIR / "migrations/006-store-staff-roles.sql").read_text())
            assert conn.execute("SELECT role FROM user_stores").fetchone()[0] == "store_admin"
            assert conn.execute("SELECT role FROM users").fetchone()[0] == "user"
            conn.execute((DB_DIR / "migrations/007-global-staff-roles.sql").read_text())
            assert conn.execute("SELECT role FROM users").fetchone()[0] == "store_admin"
        yield url


@pytest.fixture
def setup(db_url, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", db_url)
    with psycopg.connect(db_url, autocommit=True) as conn:
        conn.execute("TRUNCATE users, stores RESTART IDENTITY CASCADE")
        for sub, role in [("manager", "store_admin"), ("target", "store_buyer"), ("system", "system_admin")]:
            conn.execute(
                "INSERT INTO users (cognito_sub,email,role) VALUES (%s,%s,%s)",
                (sub, sub + "@test.com", role),
            )
        conn.execute("INSERT INTO stores (name,address) VALUES ('A','Test'),('B','Test')")
        conn.execute("""
            INSERT INTO user_stores (user_id,store_id) VALUES
                (1,1), (2,1), (2,2)
        """)
        app = FastAPI()
        app.include_router(admin.router)
        app.dependency_overrides[auth.verify_access_token] = lambda: {
            "claims": {"sub": "manager"}, "token": "unused",
        }
        with TestClient(app) as client:
            yield conn, client, app


def target_assignments(conn):
    return conn.execute(
        "SELECT us.store_id,u.role FROM user_stores us JOIN users u USING(user_id) "
        "WHERE us.user_id=2 ORDER BY us.store_id"
    ).fetchall()


def test_update_preserves_other_store_role(setup):
    conn, client, _ = setup
    response = client.put("/api/admin/staff/2/stores/1", json={"role": "store_buyer"})
    assert response.status_code == 200
    assert response.json()["role"] == "store_buyer"
    assert target_assignments(conn) == [(1, "store_buyer"), (2, "store_buyer")]


def test_remove_preserves_other_store_and_global_identity(setup):
    conn, client, _ = setup
    assert client.delete("/api/admin/staff/2/stores/1").status_code == 200
    assert target_assignments(conn) == [(2, "store_buyer")]
    assert conn.execute("SELECT role FROM users WHERE user_id=2").fetchone()[0] == "store_buyer"
    assert client.delete("/api/admin/staff/2/stores/1").status_code == 404


def test_unassigned_store_cannot_be_managed(setup):
    conn, client, _ = setup
    before = target_assignments(conn)
    assert client.put("/api/admin/staff/2/stores/2", json={"role": "store_buyer"}).status_code == 403
    assert client.delete("/api/admin/staff/2/stores/2").status_code == 403
    assert client.get("/api/admin/staff?store_id=2").status_code == 403
    assert target_assignments(conn) == before


def test_store_admin_cannot_promote_or_demote_admin(setup):
    conn, client, _ = setup
    assert client.put("/api/admin/staff/2/stores/1", json={"role": "store_admin"}).status_code == 403
    conn.execute("UPDATE users SET role='store_admin' WHERE user_id=2")
    assert client.put("/api/admin/staff/2/stores/1", json={"role": "store_buyer"}).status_code == 403
    assert client.delete("/api/admin/staff/2/stores/1").status_code == 403


def test_system_admin_changes_one_global_role_and_preserves_assignments(setup):
    conn, client, app = setup
    app.dependency_overrides[auth.verify_access_token] = lambda: {
        "claims": {"sub": "system"}, "token": "unused",
    }
    assert client.put("/api/admin/staff/2/stores/1", json={"role": "store_admin"}).status_code == 200
    assert target_assignments(conn) == [(1, "store_admin"), (2, "store_admin")]
    assert client.put("/api/admin/staff/2/stores/2", json={"role": "store_buyer"}).status_code == 200
    assert target_assignments(conn) == [(1, "store_buyer"), (2, "store_buyer")]
    assert client.delete("/api/admin/staff/2/stores/1").status_code == 200
    assert client.delete("/api/admin/staff/2/stores/2").status_code == 200
    assert target_assignments(conn) == []
    assert conn.execute("SELECT role FROM users WHERE user_id=2").fetchone()[0] == "user"
    assert conn.execute("SELECT COUNT(*) FROM users WHERE user_id=2").fetchone()[0] == 1


def test_candidates_include_staff_at_other_stores(setup):
    conn, client, _ = setup
    conn.execute("DELETE FROM user_stores WHERE user_id=2 AND store_id=1")
    response = client.get("/api/admin/staff/candidates?store_id=1&q=target")
    assert response.status_code == 200
    assert [u["user_id"] for u in response.json()["users"]] == [2]


def test_list_and_options_are_store_scoped(setup):
    _, client, _ = setup
    response = client.get("/api/admin/staff?store_id=1")
    assert response.status_code == 200
    assert response.json()["assignments"] == [
        {"user_id": 2, "email": "target@test.com", "store_id": 1, "role": "store_buyer"}
    ]
    options = client.get("/api/admin/staff/options").json()["stores"]
    assert [(s["store_id"], s["allowed_roles"]) for s in options] == [(1, ["store_buyer"])]


def test_self_and_system_admin_changes_are_denied(setup):
    _, client, _ = setup
    for user_id in (1, 3):
        assert client.put(f"/api/admin/staff/{user_id}/stores/1", json={"role": "store_buyer"}).status_code == 403


def test_invalid_body_and_missing_records(setup):
    _, client, _ = setup
    assert client.put("/api/admin/staff/2/stores/1", json={"role": "system_admin"}).status_code == 422
    assert client.put("/api/admin/staff/2/stores/1", json={"role": "store_buyer", "store_ids": [2]}).status_code == 422
    assert client.put("/api/admin/staff/999/stores/1", json={"role": "store_buyer"}).status_code == 404


def test_revoked_store_admin_is_denied_on_next_request(setup):
    conn, client, _ = setup
    conn.execute("UPDATE users SET role='store_buyer' WHERE user_id=1")
    assert client.put("/api/admin/staff/2/stores/1", json={"role": "store_buyer"}).status_code == 403


def test_add_existing_buyer_preserves_other_assignment(setup):
    conn, client, _ = setup
    conn.execute("DELETE FROM user_stores WHERE user_id=2 AND store_id=1")
    assert client.put("/api/admin/staff/2/stores/1", json={"role": "store_buyer"}).status_code == 200
    assert target_assignments(conn) == [(1, "store_buyer"), (2, "store_buyer")]


def test_global_role_change_outside_store_scope_is_denied(setup):
    conn, client, _ = setup
    conn.execute("UPDATE users SET role='user' WHERE user_id=2")
    assert client.put("/api/admin/staff/2/stores/1", json={"role": "store_buyer"}).status_code == 403
    assert conn.execute("SELECT role FROM users WHERE user_id=2").fetchone()[0] == "user"
