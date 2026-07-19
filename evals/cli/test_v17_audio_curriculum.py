from __future__ import annotations

import json
import wave
from pathlib import Path

from fastapi.testclient import TestClient

import app.main as main_module


ROOT = Path(__file__).resolve().parents[2]
CURRICULUM = ROOT / "public" / "data" / "quantum_curriculum.json"
REQUIRED_SCREENS = {
    "learn",
    "editor",
    "drug",
    "providers",
    "benchmarking",
    "improve",
    "guide",
}


def _assert_valid_saved_audio(relative_path: str) -> None:
    audio_path = ROOT / "public" / relative_path.removeprefix("/")
    assert audio_path.is_file(), relative_path
    with wave.open(str(audio_path), "rb") as recording:
        assert recording.getnchannels() >= 1
        assert recording.getframerate() >= 16_000
        assert recording.getnframes() / recording.getframerate() >= 3


def test_curriculum_is_a_complete_versioned_course_tree_with_local_media():
    payload = json.loads(CURRICULUM.read_text(encoding="utf-8"))

    assert payload["schema_version"] == "1.0"
    assert payload["product"] == "1StopQuantum"
    assert len(payload["courses"]) >= 4
    lessons = [lesson for course in payload["courses"] for lesson in course["lessons"]]
    assert len(lessons) >= 16
    assert len({lesson["id"] for lesson in lessons}) == len(lessons)

    for course in payload["courses"]:
        assert course["title"]
        assert course["description"]
        assert (ROOT / "public" / course["image"].removeprefix("/")).is_file()
        assert len(course["lessons"]) >= 4
        for lesson in course["lessons"]:
            assert lesson["legacy_module"] in {
                "foundations", "qubit", "gates", "superposition",
                "interference", "entanglement", "algorithms",
            }
            assert len(lesson["objectives"]) >= 2
            assert len(lesson["sections"]) >= 2
            assert lesson["narration"]
            assert lesson["visual"]["alt"]
            _assert_valid_saved_audio(lesson["audio"])

    assert set(payload["screen_guides"]) == REQUIRED_SCREENS
    for guide in payload["screen_guides"].values():
        assert guide["summary"]
        assert guide["how_to"]
        assert guide["narration"]
        _assert_valid_saved_audio(guide["audio"])


def test_course_audio_generator_is_reproducible_and_configurable():
    generator = (ROOT / "scripts" / "generate_course_audio.py").read_text(encoding="utf-8")
    assert "KOKORO_API_URL" in generator
    assert "http://127.0.0.1:5152" in generator
    assert "/api/speak" in generator
    assert "source_hash" in generator
    assert "wave.open" in generator


def test_image_generation_endpoint_uses_a_fixed_server_side_workflow(monkeypatch, tmp_path):
    generated = tmp_path / "lesson.png"
    generated.write_bytes(b"\x89PNG\r\n\x1a\n")

    def fake_generate(request):
        assert request.prompt == "two linked qubits"
        assert request.width == 768
        return {
            "image_url": "/generated/lesson.png",
            "seed": 17,
            "model": "DreamShaper_8_pruned.safetensors",
            "quality": {"passed": True, "warnings": []},
        }

    monkeypatch.setattr(main_module, "generate_lesson_image", fake_generate)
    response = TestClient(main_module.app).post(
        "/media/images/generate",
        json={"prompt": "two linked qubits", "width": 768, "height": 512, "seed": 17},
    )

    assert response.status_code == 201
    assert response.json()["image_url"] == "/generated/lesson.png"
    assert response.json()["quality"]["passed"] is True


def test_image_generation_rejects_empty_or_oversized_requests():
    client = TestClient(main_module.app)
    assert client.post("/media/images/generate", json={"prompt": ""}).status_code == 422
    assert client.post(
        "/media/images/generate",
        json={"prompt": "sphere", "width": 4096, "height": 512},
    ).status_code == 422
