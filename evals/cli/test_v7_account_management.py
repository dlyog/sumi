from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient


PROJECT = Path(__file__).resolve().parents[2]


def test_local_account_can_sign_in_without_exposing_password_hash(monkeypatch):
    import app.main as main_module
    from app.persistence import MemoryStore

    store = MemoryStore()
    monkeypatch.setattr(main_module, "platform_store", store)
    client = TestClient(main_module.app)

    created = client.post(
        "/accounts/signup",
        json={
            "email": "student@example.edu",
            "display_name": "Student",
            "plan": "scholar",
            "password": "learn-quantum-101",
        },
    )
    assert created.status_code == 201
    assert "password" not in str(created.json()).lower()

    rejected = client.post(
        "/accounts/signin",
        json={"email": "student@example.edu", "password": "wrong-password"},
    )
    assert rejected.status_code == 401
    assert "invalid email or password" in rejected.json()["detail"].lower()

    signed_in = client.post(
        "/accounts/signin",
        json={"email": "student@example.edu", "password": "learn-quantum-101"},
    )
    assert signed_in.status_code == 200
    assert signed_in.json()["display_name"] == "Student"
    assert signed_in.json()["subscription"]["plan"] == "scholar"
    assert "password" not in str(signed_in.json()).lower()


def test_passwordless_local_accounts_are_rejected(monkeypatch):
    import app.main as main_module
    from app.persistence import MemoryStore

    store = MemoryStore()
    monkeypatch.setattr(main_module, "platform_store", store)
    client = TestClient(main_module.app)
    created = client.post(
        "/accounts/signup",
        json={"email": "legacy@example.edu", "display_name": "Legacy", "plan": "explorer"},
    )
    assert created.status_code == 422
    assert "password is required" in created.json()["detail"].lower()


def test_database_migration_and_manage_script_are_portable():
    schema = (PROJECT / "database" / "schema.sql").read_text(encoding="utf-8")
    manager = (PROJECT / "manage.sh").read_text(encoding="utf-8")

    assert "password_hash" in schema
    assert "ADD COLUMN IF NOT EXISTS password_hash" in schema
    for command in ("start", "stop", "restart", "status", "log"):
        assert command in manager
    assert "scripts/demo.sh" in manager
    assert "nohup" in manager
    assert "quantumyog.pid" in manager
    assert "quantumyog.log" in manager

