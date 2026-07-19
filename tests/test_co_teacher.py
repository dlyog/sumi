import json
from pathlib import Path

from fastapi.testclient import TestClient

from app import local_voice_server, main


ROOT = Path(__file__).resolve().parents[1]


def test_voice_server_accepts_browser_webm_codec_parameter(monkeypatch):
    async def fake_transcribe(data: bytes, suffix: str) -> str:
        assert data == b"browser-audio"
        assert suffix == ".webm"
        return "Show me Grover search"

    monkeypatch.setattr(local_voice_server, "transcribe_upload", fake_transcribe)
    client = TestClient(local_voice_server.app)
    response = client.post(
        "/api/transcribe",
        files={"audio": ("co-teacher.webm", b"browser-audio", "audio/webm;codecs=opus")},
    )
    assert response.status_code == 200
    assert response.json()["transcription"] == "Show me Grover search"


def test_local_llm_routes_only_registered_actions(monkeypatch):
    monkeypatch.setattr(
        main.LocalLLM,
        "complete",
        lambda self, system, user: '```json\n{"action":"guided_experiment","experiment":"Grover search"}\n```',
    )
    response = TestClient(main.app).post(
        "/api/v1/co-teacher/route",
        json={"text": "Explain this screen and perform an experiment"},
    )
    assert response.status_code == 200
    assert response.json() == {"action": "guided_experiment", "experiment": "Grover search"}


def test_sumi_screen_registry_owns_actions_terms_and_prepared_audio():
    registry = json.loads((ROOT / "public" / "sumi-screen-registry.json").read_text(encoding="utf-8"))
    actions = {entry["id"]: entry for entry in registry["actions"]}
    terms = {entry["id"]: entry for entry in registry["terms"]}

    assert registry["screen_id"] == "algorithm-studio"
    assert registry["voice"]["intro_barge_in_grace_ms"] >= 1000
    assert "run_simulation" in registry["screens"]["circuits"]["allowed_actions"]
    assert "run_simulation" not in registry["screens"]["learn"]["allowed_actions"]
    assert "skip intro" in actions["skip_intro"]["aliases"]
    assert "stop sumi" in actions["stop_conversation"]["aliases"]
    assert terms["bloch_sphere"]["control_id"] == "blochSphere"
    assert terms["bloch_sphere"]["audio_id"] == "bloch_sphere"
    assert len(terms["bloch_sphere"]["description"]) > 80


def test_spoken_intro_and_stop_intents_are_bounded_even_when_model_is_wrong(monkeypatch):
    monkeypatch.setattr(
        main.LocalLLM,
        "complete",
        lambda self, system, user: '{"action":"answer_question","experiment":""}',
    )
    client = TestClient(main.app)

    skip = client.post("/api/v1/co-teacher/route", json={"text": "Sumi, skip intro please"})
    stop = client.post("/api/v1/co-teacher/route", json={"text": "Stop Sumi"})

    assert skip.json() == {"action": "skip_intro", "experiment": ""}
    assert stop.json() == {"action": "stop_conversation", "experiment": ""}


def test_registered_screen_term_uses_prepared_explanation(monkeypatch):
    monkeypatch.setattr(
        main.LocalLLM,
        "complete",
        lambda self, system, user: '{"action":"answer_question","experiment":""}',
    )
    response = TestClient(main.app).post(
        "/api/v1/co-teacher/route",
        json={"text": "Explain the Bloch sphere"},
    )

    assert response.status_code == 200
    assert response.json() == {"action": "explain_term", "experiment": "bloch_sphere"}


def test_non_circuit_screen_rejects_a_circuit_only_model_action(monkeypatch):
    monkeypatch.setattr(
        main.LocalLLM,
        "complete",
        lambda self, system, user: '{"action":"run_simulation","experiment":""}',
    )
    response = TestClient(main.app).post(
        "/api/v1/co-teacher/route",
        json={"text": "do it", "screen_id": "learn"},
    )

    assert response.status_code == 200
    assert response.json() == {"action": "unsupported", "experiment": ""}


def test_local_llm_routes_vague_algorithm_request_to_experiment_menu(monkeypatch):
    monkeypatch.setattr(
        main.LocalLLM,
        "complete",
        lambda self, system, user: '{"action":"build_experiment","experiment":"Run a specific circuit algorithm"}',
    )
    response = TestClient(main.app).post(
        "/api/v1/co-teacher/route",
        json={"text": "Run a specific circuit algorithm"},
    )
    assert response.status_code == 200
    assert response.json()["action"] == "run_simulation"


def test_named_experiments_override_incorrect_model_action(monkeypatch):
    monkeypatch.setattr(
        main.LocalLLM,
        "complete",
        lambda self, system, user: '{"action":"show_cirq","experiment":"wrong"}',
    )
    client = TestClient(main.app)
    cases = {
        "Run a Bell pair experiment": "bell",
        "Show me GHZ": "ghz",
        "Run a Hadamard superposition": "hadamard",
        "Show the ninety degree rotation": "rotation",
        "Run Grover search": "grover",
        "Show Deutsch-Jozsa": "deutsch_jozsa",
        "Run a quantum random number generator": "qrng",
    }
    for request, experiment in cases.items():
        response = client.post("/api/v1/co-teacher/route", json={"text": request})
        assert response.status_code == 200
        assert response.json() == {"action": "run_named_experiment", "experiment": experiment}


def test_exact_experiment_name_runs_registered_experiment_instead_of_generic_builder(monkeypatch):
    monkeypatch.setattr(
        main.LocalLLM,
        "complete",
        lambda self, system, user: '{"action":"build_experiment","experiment":"grover"}',
    )
    response = TestClient(main.app).post("/api/v1/co-teacher/route", json={"text": "grover"})
    assert response.status_code == 200
    assert response.json() == {"action": "run_named_experiment", "experiment": "grover"}


def test_concept_question_routes_to_answer_without_requesting_an_action(monkeypatch):
    monkeypatch.setattr(
        main.LocalLLM,
        "complete",
        lambda self, system, user: '{"action":"answer_question","experiment":""}',
    )
    response = TestClient(main.app).post(
        "/api/v1/co-teacher/route",
        json={"text": "Why does Grover use diffusion?"},
    )
    assert response.status_code == 200
    assert response.json()["action"] == "answer_question"


def test_conversational_answer_is_spoken_friendly_and_cannot_return_actions(monkeypatch):
    def fake_complete(self, system, user):
        assert "Never claim that you operated" in system
        assert "Current circuit: 2 qubits and 13 operations" in user
        return '```json\n{"answer":"The diffusion step increases the marked state\'s amplitude relative to the others."}\n```'

    monkeypatch.setattr(main.LocalLLM, "complete", fake_complete)
    response = TestClient(main.app).post(
        "/api/v1/co-teacher/answer",
        json={
            "text": "What does diffusion do?",
            "context": {"screen": "Algorithm Studio", "qubits": 2, "operations": 13},
        },
    )
    assert response.status_code == 200
    assert response.json() == {
        "answer": "The diffusion step increases the marked state's amplitude relative to the others."
    }


def test_conversational_answer_is_grounded_to_registered_learn_screen(monkeypatch):
    def fake_complete(self, system, user):
        assert "Current screen: Learn" in user
        assert "Choose a learning level" in user
        assert "Bits and qubits" in user
        assert "Algorithm Studio" not in user
        return '{"answer":"This Learn page contains guided courses and the current Bits and qubits lesson."}'

    monkeypatch.setattr(main.LocalLLM, "complete", fake_complete)
    response = TestClient(main.app).post(
        "/api/v1/co-teacher/answer",
        json={
            "text": "What is this page for?",
            "context": {
                "screen_id": "learn",
                "visible_state": {"lesson": "Bits and qubits", "level": "Master's"},
            },
        },
    )

    assert response.status_code == 200
    assert response.json()["answer"].startswith("This Learn page")


def test_every_sumi_screen_has_bounded_context_and_registered_ui_actions():
    registry = json.loads((ROOT / "public" / "sumi-screen-registry.json").read_text(encoding="utf-8"))
    known_actions = {entry["id"] for entry in registry["actions"]}

    for screen_id, screen in registry["screens"].items():
        assert len(screen["description"]) > 80, screen_id
        assert screen.get("concepts"), screen_id
        assert set(screen["allowed_actions"]) <= known_actions, screen_id
        for action_id, binding in screen.get("action_bindings", {}).items():
            assert action_id in screen["allowed_actions"], (screen_id, action_id)
            assert binding["control_id"], (screen_id, action_id)
            assert binding["confirmation"], (screen_id, action_id)


def test_registered_learn_action_overrides_an_incorrect_model_choice(monkeypatch):
    monkeypatch.setattr(
        main.LocalLLM,
        "complete",
        lambda self, system, user: '{"action":"answer_question","experiment":""}',
    )
    response = TestClient(main.app).post(
        "/api/v1/co-teacher/route",
        json={"text": "Play this lesson", "screen_id": "learn"},
    )

    assert response.status_code == 200
    assert response.json() == {"action": "play_lesson", "experiment": ""}


def test_parameterized_learn_action_returns_typed_arguments(monkeypatch):
    monkeypatch.setattr(main.LocalLLM, "complete", lambda self, system, user: '{"action":"answer_question","experiment":""}')
    response = TestClient(main.app).post(
        "/api/v1/co-teacher/route",
        json={"text": "Switch me to High school level", "screen_id": "learn", "include_args": True},
    )
    assert response.status_code == 200
    assert response.json() == {"action": "set_learning_level", "experiment": "", "args": {"level": "High school"}}


def test_parameterized_circuit_action_returns_template_argument(monkeypatch):
    monkeypatch.setattr(main.LocalLLM, "complete", lambda self, system, user: '{"action":"answer_question","experiment":""}')
    response = TestClient(main.app).post(
        "/api/v1/co-teacher/route",
        json={"text": "Load the Grover template", "screen_id": "circuits", "include_args": True},
    )
    assert response.status_code == 200
    assert response.json() == {"action": "load_template", "experiment": "", "args": {"template": "grover"}}


def test_local_llm_cannot_invent_an_action(monkeypatch):
    monkeypatch.setattr(
        main.LocalLLM,
        "complete",
        lambda self, system, user: '{"action":"execute_javascript","experiment":""}',
    )
    response = TestClient(main.app).post("/api/v1/co-teacher/route", json={"text": "Do something unsafe"})
    assert response.status_code == 422


def test_kokoro_proxy_returns_wav(monkeypatch):
    monkeypatch.setattr(main, "_request_kokoro", lambda url, text: b"RIFF-kokoro")
    response = TestClient(main.app).post("/api/v1/co-teacher/speak", json={"text": "Ready"})
    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"
    assert response.content == b"RIFF-kokoro"
