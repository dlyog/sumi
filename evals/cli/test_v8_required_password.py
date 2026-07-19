from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient


PROJECT = Path(__file__).resolve().parents[2]


def test_new_signup_rejects_explicitly_blank_or_short_passwords(monkeypatch):
    import app.main as main_module
    from app.persistence import MemoryStore

    monkeypatch.setattr(main_module, "platform_store", MemoryStore())
    client = TestClient(main_module.app)
    account = {
        "email": "required-password@example.edu",
        "display_name": "Required Password",
        "plan": "explorer",
    }

    missing = client.post("/accounts/signup", json=account)
    assert missing.status_code == 422
    assert "password is required" in missing.json()["detail"].lower()

    blank = client.post("/accounts/signup", json={**account, "password": ""})
    assert blank.status_code == 422
    assert "password is required" in blank.json()["detail"].lower()

    short = client.post("/accounts/signup", json={**account, "password": "short"})
    assert short.status_code == 422
    assert "8 to 128" in short.json()["detail"]


def test_database_migration_disables_null_password_accounts():
    schema = (PROJECT / "database" / "schema.sql").read_text(encoding="utf-8")

    assert "disabled_legacy_account" in schema
    assert "ALTER COLUMN password_hash SET NOT NULL" in schema
