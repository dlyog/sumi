from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

import app.main as main_module
from app.persistence import MemoryStore


ROOT = Path(__file__).resolve().parents[2]


def test_recovery_challenge_resets_password_without_exposing_secrets(monkeypatch, tmp_path):
    store = MemoryStore(report_dir=tmp_path)
    monkeypatch.setattr(main_module, "platform_store", store)
    main_module.recovery_attempt_windows.clear()
    client = TestClient(main_module.app)

    created = client.post(
        "/accounts/signup",
        json={
            "email": "recover@example.edu",
            "display_name": "Recovery Learner",
            "plan": "explorer",
            "password": "original-password",
            "password_hint": "Two words: where circuits begin",
            "recovery_question": "What recovery word did you choose?",
            "recovery_answer": "Bloch sphere",
        },
    )
    assert created.status_code == 201
    assert {"password_hash", "password_hint", "recovery_question", "recovery_answer_hash"}.isdisjoint(
        created.json()
    )

    challenge = client.post("/accounts/recovery/challenge", json={"email": "recover@example.edu"})
    assert challenge.status_code == 200
    assert challenge.json() == {
        "password_hint": "Two words: where circuits begin",
        "recovery_question": "What recovery word did you choose?",
    }
    assert "hash" not in str(challenge.json()).lower()

    wrong = client.post(
        "/accounts/recovery/reset",
        json={
            "email": "recover@example.edu",
            "recovery_answer": "wrong answer",
            "new_password": "replacement-password",
        },
    )
    assert wrong.status_code == 401

    changed = client.post(
        "/accounts/recovery/reset",
        json={
            "email": "recover@example.edu",
            "recovery_answer": "  BLOCH SPHERE ",
            "new_password": "replacement-password",
        },
    )
    assert changed.status_code == 200
    assert changed.json() == {"changed": True}
    assert client.post(
        "/accounts/signin", json={"email": "recover@example.edu", "password": "original-password"}
    ).status_code == 401
    assert client.post(
        "/accounts/signin", json={"email": "recover@example.edu", "password": "replacement-password"}
    ).status_code == 200


def test_recovery_requires_complete_safe_setup(monkeypatch, tmp_path):
    store = MemoryStore(report_dir=tmp_path)
    monkeypatch.setattr(main_module, "platform_store", store)
    client = TestClient(main_module.app)

    partial = client.post(
        "/accounts/signup",
        json={
            "email": "partial@example.edu",
            "display_name": "Partial",
            "plan": "explorer",
            "password": "original-password",
            "password_hint": "original-password",
            "recovery_question": "What recovery word did you choose?",
            "recovery_answer": "answer",
        },
    )
    assert partial.status_code == 422
    assert "hint" in partial.json()["detail"].lower()

    store.create_account(
        email="legacy@example.edu",
        display_name="Legacy",
        plan="explorer",
        password="legacy-password",
    )
    unavailable = client.post("/accounts/recovery/challenge", json={"email": "legacy@example.edu"})
    assert unavailable.status_code == 404
    assert "not configured" in unavailable.json()["detail"].lower()


def test_portable_schema_demo_account_and_recovery_ui_are_present():
    schema = (ROOT / "database" / "schema.sql").read_text(encoding="utf-8")
    provision = (ROOT / "scripts" / "provision_postgres.py").read_text(encoding="utf-8")
    index = (ROOT / "public" / "index.html").read_text(encoding="utf-8")
    app = (ROOT / "public" / "app.js").read_text(encoding="utf-8")
    styles = (ROOT / "public" / "styles.css").read_text(encoding="utf-8")

    for column in ("password_hint", "recovery_question", "recovery_answer_hash"):
        assert column in schema
    assert "learner@1stopquantum.local" in provision
    assert "LearnQuantum2026!" in provision
    assert "demoAccountFill" in index
    assert "recoveryDialog" in index
    assert "Forgot password" in index
    assert "Sign in locally" not in index
    assert "/accounts/recovery/challenge" in app
    assert "/accounts/recovery/reset" in app
    assert 'grid-template-columns: 28px minmax(0, 1fr) 20px' in styles
