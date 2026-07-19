from __future__ import annotations

import json
import wave
from pathlib import Path

from fastapi.testclient import TestClient

import app.main as main_module
from app.persistence import MemoryStore


ROOT = Path(__file__).resolve().parents[2]


def _client(monkeypatch, tmp_path) -> tuple[TestClient, MemoryStore]:
    store = MemoryStore(report_dir=tmp_path)
    monkeypatch.setattr(main_module, "platform_store", store)
    main_module.admin_sessions.clear()
    return TestClient(main_module.app), store


def _admin(client: TestClient, store: MemoryStore) -> dict[str, str]:
    store.create_account(
        email="admin@example.test",
        display_name="Internal admin",
        plan="lab",
        password="initial-admin-password",
        role="admin",
    )
    response = client.post(
        "/admin/signin",
        json={"email": "admin@example.test", "password": "initial-admin-password"},
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['token']}"}


def test_admin_password_is_db_authoritative_and_can_be_changed(monkeypatch, tmp_path):
    client, store = _client(monkeypatch, tmp_path)
    headers = _admin(client, store)

    changed = client.put(
        "/admin/password",
        headers=headers,
        json={"current_password": "initial-admin-password", "new_password": "new-admin-password-2026"},
    )
    assert changed.status_code == 200
    assert changed.json() == {"changed": True}
    assert client.post(
        "/admin/signin", json={"email": "admin@example.test", "password": "initial-admin-password"}
    ).status_code == 401
    assert client.post(
        "/admin/signin", json={"email": "admin@example.test", "password": "new-admin-password-2026"}
    ).status_code == 200

    provision = (ROOT / "scripts" / "provision_postgres.py").read_text(encoding="utf-8")
    conflict_clause = provision.split("ON CONFLICT (email)", 1)[1].split("connection.execute", 1)[0]
    assert "password_hash = EXCLUDED.password_hash" not in conflict_clause


def test_only_learn_is_public_and_admin_query_opens_internal_signin():
    index = (ROOT / "public" / "index.html").read_text(encoding="utf-8")
    app = (ROOT / "public" / "app.js").read_text(encoding="utf-8")

    assert 'id="navUseCases"' in index
    assert 'id="navPodcast"' in index
    assert 'id="navCommunity"' in index
    assert 'id="podcastView"' in index
    assert 'id="useCasesView"' in index
    assert 'id="communityView"' in index
    assert 'id="adminPasswordForm"' in index
    assert "PROTECTED_VIEWS" in app
    for workspace in ("circuits", "use-cases", "drug", "providers", "benchmarking", "improve", "podcast", "community"):
        assert f'"{workspace}"' in app
    assert "pendingProtectedView" in app
    assert "adminLoginDialog\").showModal" in app
    assert 'get("admin") === "1"' in app


def test_classical_bridge_and_evidence_aware_use_cases_are_complete():
    curriculum = json.loads((ROOT / "public" / "data" / "quantum_curriculum.json").read_text(encoding="utf-8"))
    use_cases = json.loads((ROOT / "public" / "data" / "use_cases.json").read_text(encoding="utf-8"))

    assert {item["audience"] for item in curriculum["introductions"]} == {"beginner", "executive"}
    joined = " ".join(item["narration"].lower() for item in curriculum["introductions"])
    assert "complement" in joined and "not replace" in joined
    assert "rsa" in joined and "traveling" in joined and "supply chain" in joined

    domains = {item["domain"] for item in use_cases["use_cases"]}
    assert {"chemistry", "materials", "logistics", "cybersecurity", "finance", "energy", "climate", "public sector"} <= domains
    for item in use_cases["use_cases"]:
        assert item["classical_baseline"]
        assert item["quantum_candidate"]
        assert item["resource_assumptions"]
        assert item["hardware_limits"]
        assert item["claim_strength"] in {"educational", "emerging", "evidence-backed"}
        assert item["sources"]


def test_podcast_catalog_feed_transcripts_and_long_bundled_audio(monkeypatch, tmp_path):
    client, _ = _client(monkeypatch, tmp_path)
    catalog_file = ROOT / "public" / "data" / "podcast_catalog.json"
    payload = json.loads(catalog_file.read_text(encoding="utf-8"))

    assert payload["schema_version"] == "1.0"
    assert len(payload["episodes"]) >= 4
    for episode in payload["episodes"]:
        assert len(episode["transcript"].split()) >= 500
        assert episode["chapters"]
        audio = ROOT / "public" / episode["audio"].removeprefix("/")
        assert audio.is_file()
        with wave.open(str(audio), "rb") as recording:
            duration = recording.getnframes() / recording.getframerate()
        assert duration >= 150
        assert abs(duration - episode["duration_seconds"]) < 2

    catalog = client.get("/api/v1/podcast/catalog")
    assert catalog.status_code == 200
    assert catalog.json()["episodes"][0]["audio_url"].startswith("http://testserver/")
    feed = client.get("/api/v1/podcast/feed.xml")
    assert feed.status_code == 200
    assert feed.headers["content-type"].startswith("application/rss+xml")
    assert feed.text.count("<item>") >= 4
    assert "<enclosure" in feed.text


def test_community_submission_moderation_and_public_read_api(monkeypatch, tmp_path):
    client, store = _client(monkeypatch, tmp_path)
    headers = _admin(client, store)

    submitted = client.post(
        "/api/v1/community/submissions",
        json={
            "kind": "research",
            "name": "Ada Learner",
            "email": "ada@example.edu",
            "title": "A classroom Bell experiment",
            "summary": "A reproducible teaching activity that compares correlated classical bits with a Bell-state simulation.",
            "consent": True,
        },
    )
    assert submitted.status_code == 201
    submission_id = submitted.json()["id"]
    assert "email" not in submitted.json()
    assert client.get("/api/v1/community/publications").json()["items"] == []

    private_queue = client.get("/admin/community/submissions", headers=headers)
    assert private_queue.status_code == 200
    assert private_queue.json()["items"][0]["email"] == "ada@example.edu"
    approved = client.put(
        f"/admin/community/submissions/{submission_id}",
        headers=headers,
        json={"status": "approved", "note": "Reviewed for educational publication."},
    )
    assert approved.status_code == 200

    public = client.get("/api/v1/community/publications").json()
    assert public["items"][0]["title"] == "A classroom Bell experiment"
    assert "email" not in json.dumps(public)
    assert public["privacy"]["private_feedback_exposed"] is False
    audit = client.get(f"/admin/community/submissions/{submission_id}/audit", headers=headers)
    assert audit.status_code == 200 and audit.json()["items"]

    contributor = store.create_account(
        email="grace@example.edu", display_name="Grace Reviewer", plan="explorer", password="quantum-reviewer"
    )
    application = client.post(
        "/api/v1/community/submissions",
        json={"kind": "reviewer", "name": "Grace Reviewer", "email": contributor["email"], "consent": True},
    ).json()
    assert client.put(
        f"/admin/community/submissions/{application['id']}",
        headers=headers,
        json={"status": "approved", "note": "Approved for educational review."},
    ).status_code == 200
    assert store.get_account(contributor["id"])["role"] == "reviewer"

    interests = client.get("/api/v1/community/interests").json()
    assert interests["aggregate_only"] is True
    assert interests["counts"] == {"research": 1, "contributor": 0, "reviewer": 1}
    assert "email" not in json.dumps(interests)
    content = client.get("/api/v1/content/catalog").json()
    assert content["schema_version"] == "1.0"
    assert len(content["courses"]) >= 4 and len(content["podcast_episodes"]) >= 4


def test_guided_tours_cover_every_primary_workspace_and_authoring_stays_internal():
    tours = json.loads((ROOT / "public" / "data" / "product_tours.json").read_text(encoding="utf-8"))
    required = {"learn", "circuits", "use-cases", "providers", "benchmarking", "improve", "podcast", "community"}
    assert required <= set(tours["tours"])
    for name in required:
        tour = tours["tours"][name]
        assert tour["steps"]
        assert tour["narration"]
        assert tour["practical_action"]
        for step in tour["steps"]:
            assert step["target"] and step["title"] and step["body"]

    index = (ROOT / "public" / "index.html").read_text(encoding="utf-8")
    assert 'id="tourDialog"' in index
    assert 'id="tourSkip"' in index and 'id="tourReplay"' in index
    assert "ComfyUI" not in index and "Kokoro" not in index


def test_portable_database_contains_community_workflow_and_privacy_fields():
    schema = (ROOT / "database" / "schema.sql").read_text(encoding="utf-8")
    for table in ("community_submissions", "community_audit_log"):
        assert f"CREATE TABLE IF NOT EXISTS {table}" in schema
    for field in ("consent_at", "retention_until", "status", "reviewed_by"):
        assert field in schema

    readme = (ROOT / "docs" / "COMMUNITY_API.md").read_text(encoding="utf-8")
    for subject in ("rate limit", "deletion", "California", "attribution", "licens"):
        assert subject.lower() in readme.lower()
