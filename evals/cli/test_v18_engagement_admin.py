from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

import app.main as main_module
from app.persistence import MemoryStore


ROOT = Path(__file__).resolve().parents[2]
CURRICULUM = ROOT / "public" / "data" / "quantum_curriculum.json"


def test_every_lesson_has_distinct_prebuilt_media_and_provenance():
    payload = json.loads(CURRICULUM.read_text(encoding="utf-8"))
    lessons = [lesson for course in payload["courses"] for lesson in course["lessons"]]
    images = [lesson["visual"]["image"] for lesson in lessons]

    assert len(lessons) == 16
    assert len(set(images)) == len(images)
    for lesson in lessons:
        visual = lesson["visual"]
        assert (ROOT / "public" / visual["image"].removeprefix("/")).is_file()
        assert visual["provenance"]["kind"] == "AI-generated"
        assert len(visual["provenance"]["prompt"]) >= 30
        assert visual["provenance"]["model"]


def test_feedback_and_page_analytics_support_anonymous_visitors(monkeypatch, tmp_path):
    store = MemoryStore(report_dir=tmp_path)
    monkeypatch.setattr(main_module, "platform_store", store)
    client = TestClient(main_module.app)

    event = client.post(
        "/analytics/events",
        json={"visitor_id": "browser-visitor-001", "page": "learn:bits-and-qubits", "event_type": "page_view"},
    )
    assert event.status_code == 202

    liked = client.post(
        "/feedback",
        json={"visitor_id": "browser-visitor-001", "content_id": "bits-and-qubits", "kind": "like"},
    )
    assert liked.status_code == 201
    assert liked.json()["likes"] == 1

    report = client.post(
        "/feedback",
        json={
            "visitor_id": "browser-visitor-001",
            "content_id": "bits-and-qubits",
            "kind": "inaccuracy",
            "message": "The visual suggests a physical shell around a qubit.",
        },
    )
    assert report.status_code == 201
    assert report.json()["reports"] == 1
    assert client.get("/feedback/summary/bits-and-qubits").json() == {"likes": 1, "reports": 1}


def test_admin_analytics_require_an_internal_role_and_server_token(monkeypatch, tmp_path):
    store = MemoryStore(report_dir=tmp_path)
    learner = store.create_account(
        email="learner@example.edu", display_name="Learner", plan="explorer", password="learn-quantum"
    )
    store.create_account(
        email="internal@example.test",
        display_name="Internal reviewer",
        plan="lab",
        password="internal-review",
        role="admin",
    )
    store.record_event({"visitor_id": "visitor-admin-test", "page": "learn:entanglement", "event_type": "page_view"})
    monkeypatch.setattr(main_module, "platform_store", store)
    main_module.admin_sessions.clear()
    client = TestClient(main_module.app)

    public_signup = client.post(
        "/accounts/signup",
        json={
            "email": "role-injection@example.edu",
            "display_name": "Role injection",
            "plan": "explorer",
            "password": "role-injection",
            "role": "admin",
        },
    )
    assert public_signup.status_code == 201
    assert public_signup.json()["role"] == "learner"

    learner_login = client.post(
        "/admin/signin", json={"email": learner["email"], "password": "learn-quantum"}
    )
    assert learner_login.status_code == 403
    assert client.get("/admin/analytics").status_code == 401

    login = client.post(
        "/admin/signin", json={"email": "internal@example.test", "password": "internal-review"}
    )
    assert login.status_code == 200
    token = login.json()["token"]
    dashboard = client.get("/admin/analytics", headers={"Authorization": f"Bearer {token}"})
    assert dashboard.status_code == 200
    assert dashboard.json()["daily_visitors"][0]["visitors"] == 1
    assert dashboard.json()["popular_pages"][0]["page"] == "learn:entanglement"

    denied_settings = client.put(
        "/admin/llm-settings",
        json={"provider": "openai", "base_url": "https://api.openai.com/v1", "model": "gpt-5", "api_key": "secret"},
    )
    assert denied_settings.status_code == 401
    saved = client.put(
        "/admin/llm-settings",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "provider": "openai",
            "base_url": "https://api.openai.com/v1",
            "model": "gpt-5",
            "api_key": "sk-internal-not-returned",
        },
    )
    assert saved.status_code == 200
    assert saved.json()["api_key_configured"] is True
    assert "sk-internal" not in str(saved.json())
    stored = store.get_llm_settings(include_secret=True)
    assert stored["api_key"] == "sk-internal-not-returned"


def test_database_and_public_information_surfaces_are_reproducible():
    schema = (ROOT / "database" / "schema.sql").read_text(encoding="utf-8")
    assert "role TEXT" in schema
    assert "CREATE TABLE IF NOT EXISTS page_events" in schema
    assert "CREATE TABLE IF NOT EXISTS content_feedback" in schema
    assert "CREATE TABLE IF NOT EXISTS llm_settings" in schema
    assert "api_key_ciphertext" in schema

    index = (ROOT / "public" / "index.html").read_text(encoding="utf-8")
    assert "Create alternate visual" not in index
    assert "Local LLM ready" not in index
    assert "No cloud runtime" not in index
    assert 'href="/policies.html#terms"' in index
    assert 'href="/policies.html#privacy"' in index
    assert 'href="/policies.html#transparency"' in index
    assert 'href="/policies.html#disclaimer"' in index
    assert (ROOT / "public" / "policies.html").is_file()
    assert (ROOT / "public" / "faq.html").is_file()
    assert (ROOT / "public" / "ai-use.html").is_file()


def test_credits_name_human_ai_and_open_source_foundations():
    credits = (ROOT / "public" / "credits.html").read_text(encoding="utf-8")
    index = (ROOT / "public" / "index.html").read_text(encoding="utf-8")
    assert "Tarun Kumar Chawdhury" in credits
    assert "OpenAI Codex" in credits
    assert "GPT-5.6 Sol" in credits
    for url in (
        "https://github.com/unitaryfoundation/metriq-data",
        "https://github.com/unitaryfoundation/metriq-gym",
    ):
        assert url in credits
    assert 'href="/credits.html"' in index


def test_managed_start_detaches_the_demo_from_the_calling_terminal():
    manager = (ROOT / "manage.sh").read_text(encoding="utf-8")
    assert "start_new_session=True" in manager


def test_demo_preflight_uses_the_admin_selected_provider():
    demo = (ROOT / "scripts" / "demo.sh").read_text(encoding="utf-8")
    assert "get_llm_settings(include_secret=True)" in demo
    assert 'os.environ["LLM_BASE_URL"]' not in demo
