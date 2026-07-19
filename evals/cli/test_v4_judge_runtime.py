from fastapi.testclient import TestClient


def test_known_prompt_falls_back_when_local_llm_is_unconfigured(monkeypatch):
    import app.main as main_module

    class UnavailableLLM:
        def __init__(self):
            raise RuntimeError("local LLM is not configured")

    monkeypatch.setattr(main_module, "LocalLLM", UnavailableLLM)
    response = TestClient(main_module.app).post(
        "/nl2circuit",
        json={"text": "Put one qubit in superposition and measure it", "backend": "qiskit"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["translation"]["source"] == "deterministic-template-fallback"
    assert [gate["op"] for gate in payload["ir"]["gates"]] == ["H", "measure"]
