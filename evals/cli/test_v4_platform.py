from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[2]


BLOATED_BELL = {
    "version": "1.0",
    "num_qubits": 2,
    "gates": [
        {"op": "H", "targets": [0]},
        {"op": "H", "targets": [0]},
        {"op": "H", "targets": [0]},
        {"op": "CNOT", "controls": [0], "targets": [1]},
        {"op": "measure", "targets": [0, 1]},
    ],
    "shots": 256,
    "seed": 42,
}


def test_signup_persists_subscription_with_injected_store(monkeypatch):
    import app.main as main_module
    from app.persistence import MemoryStore

    store = MemoryStore()
    monkeypatch.setattr(main_module, "platform_store", store)
    client = TestClient(main_module.app)

    created = client.post(
        "/accounts/signup",
        json={"email": "ada@example.edu", "display_name": "Ada", "plan": "scholar", "password": "quantum-ada"},
    )
    assert created.status_code == 201
    account = created.json()
    assert account["email"] == "ada@example.edu"
    assert account["subscription"]["plan"] == "scholar"
    assert account["subscription"]["status"] == "active"

    loaded = client.get(f"/accounts/{account['id']}")
    assert loaded.status_code == 200
    assert loaded.json() == account


def test_improvement_engine_accepts_only_equivalent_gate_reduction(tmp_path):
    from app.improvement import improve_circuit

    result = improve_circuit(
        BLOATED_BELL,
        objective="Reduce gate count while preserving the Bell state.",
        max_iterations=3,
        report_dir=tmp_path,
    )
    assert result["status"] == "completed"
    assert result["accepted"] is True
    assert result["before_metrics"]["unitary_gates"] == 4
    assert result["after_metrics"]["unitary_gates"] == 2
    assert result["review"]["equivalent"] is True
    assert [gate["op"] for gate in result["improved_ir"]["gates"]] == ["H", "CNOT", "measure"]

    report = Path(result["report_path"])
    assert report.exists()
    html = report.read_text(encoding="utf-8")
    assert "Circuit improvement review" in html
    assert "ACCEPTED" in html
    assert "Statevector equivalence" in html


def test_scheduled_improvement_job_round_trip(monkeypatch, tmp_path):
    import app.main as main_module
    from app.persistence import MemoryStore

    store = MemoryStore(report_dir=tmp_path)
    monkeypatch.setattr(main_module, "platform_store", store)
    client = TestClient(main_module.app)
    account = client.post(
        "/accounts/signup",
        json={"email": "grace@example.edu", "display_name": "Grace", "plan": "lab", "password": "quantum-grace"},
    ).json()

    created = client.post(
        "/improvements/jobs",
        json={
            "user_id": account["id"],
            "circuit": BLOATED_BELL,
            "objective": "Reduce gate count while preserving behavior.",
            "schedule_at": "2026-07-16T12:00:00Z",
            "max_iterations": 3,
            "run_now": True,
        },
    )
    assert created.status_code == 201
    job = created.json()
    assert job["status"] == "completed"
    assert job["result"]["accepted"] is True
    assert job["report_url"].startswith("/improvements/reports/")

    listing = client.get(f"/improvements/jobs?user_id={account['id']}").json()
    assert [item["id"] for item in listing] == [job["id"]]
    report = client.get(job["report_url"])
    assert report.status_code == 200
    assert "Circuit improvement review" in report.text


def test_chatgpt_mcp_tool_returns_widget_ready_visualization(monkeypatch):
    from app import mcp_server

    minimal = {
        "version": "1.0",
        "num_qubits": 1,
        "gates": [{"op": "H", "targets": [0]}, {"op": "measure", "targets": [0]}],
        "shots": 128,
        "seed": 42,
    }

    class MockLLM:
        def complete(self, system, user):
            return json.dumps(minimal)

    monkeypatch.setattr(mcp_server, "LocalLLM", MockLLM)
    result = mcp_server.visualize_quantum_circuit(
        "Put one qubit in superposition and measure it", backend="qiskit"
    )
    assert result["structuredContent"]["ir"]["num_qubits"] == 1
    assert set(result["structuredContent"]["counts"]) == {"0", "1"}
    assert result["_meta"]["ui"]["resourceUri"].startswith("ui://quantumyog/")
    assert "simulated" in result["content"][0]["text"].lower()

    resource = mcp_server.circuit_widget_resource()
    assert resource["mimeType"] == "text/html;profile=mcp-app"
    assert "window.openai" in resource["text"]
    assert "circuit" in resource["text"].lower()


def test_custom_gpt_action_schema_exposes_nl_visualization():
    schema = json.loads((ROOT / "integrations" / "custom-gpt-openapi.json").read_text())
    operation = schema["paths"]["/integrations/chatgpt/visualize"]["post"]
    assert operation["operationId"] == "visualizeQuantumCircuit"
    assert schema["openapi"].startswith("3.")
    assert "text" in operation["requestBody"]["content"]["application/json"]["schema"]["required"]
