import json
import struct

from fastapi.testclient import TestClient

from app import local_voice_server
from app.voice_gatekeeper import ClarificationPolicy, TranscriptEvidence, audio_gate, transcript_gate


def pcm_frame(amplitude: int, samples: int = 512) -> bytes:
    return struct.pack(f"<{samples}h", *([amplitude] * samples))


def test_duplex_websocket_streams_pcm_through_vad_and_returns_whisper_text(monkeypatch):
    monkeypatch.setenv("VOICE_VAD_PROVIDER", "energy")
    async def fake_transcribe_pcm(data: bytes, sample_rate: int) -> TranscriptEvidence:
        assert sample_rate == 16_000
        assert len(data) >= 8 * 512 * 2
        return TranscriptEvidence("Show me a Bell pair", avg_logprob=-0.1, no_speech_prob=0.02)

    monkeypatch.setattr(local_voice_server, "transcribe_pcm_result", fake_transcribe_pcm)
    client = TestClient(local_voice_server.app)
    with client.websocket_connect("/api/duplex") as websocket:
        assert json.loads(websocket.receive_text()) == {"type": "state", "value": "listening"}
        for _ in range(10):
            websocket.send_bytes(pcm_frame(9000))
        messages = [json.loads(websocket.receive_text()), json.loads(websocket.receive_text())]
        assert {message["type"] for message in messages} == {"interrupt", "speech_start"}
        for _ in range(24):
            websocket.send_bytes(pcm_frame(0))
        final = json.loads(websocket.receive_text())
        assert final == {"type": "final", "text": "Show me a Bell pair"}


def test_duplex_websocket_ignores_short_audio_blips(monkeypatch):
    monkeypatch.setenv("VOICE_VAD_PROVIDER", "energy")
    calls = 0

    async def fake_transcribe_pcm(data: bytes, sample_rate: int) -> TranscriptEvidence:
        nonlocal calls
        calls += 1
        return TranscriptEvidence("should not run")

    monkeypatch.setattr(local_voice_server, "transcribe_pcm_result", fake_transcribe_pcm)
    client = TestClient(local_voice_server.app)
    with client.websocket_connect("/api/duplex") as websocket:
        websocket.receive_text()
        for _ in range(2):
            websocket.send_bytes(pcm_frame(9000))
        for _ in range(24):
            websocket.send_bytes(pcm_frame(0))
    assert calls == 0


def test_noise_gate_rejects_quiet_audio_before_whisper():
    assert not audio_gate(pcm_frame(25)).accepted
    assert audio_gate(pcm_frame(1200)).accepted


def test_transcript_gate_rejects_whisper_noise_and_confidence_failures():
    assert not transcript_gate(TranscriptEvidence("Thank you for watching")).accepted
    assert not transcript_gate(TranscriptEvidence("What is a qubit?", no_speech_prob=0.91)).accepted
    assert not transcript_gate(TranscriptEvidence("la la la la la")).accepted
    assert transcript_gate(TranscriptEvidence("What is a qubit?", avg_logprob=-0.2, no_speech_prob=0.04)).accepted


def test_clarification_policy_speaks_twice_then_waits_silently_and_resets():
    policy = ClarificationPolicy(reset_after_seconds=20)
    first, first_clip = policy.on_reject(now=1)
    second, second_clip = policy.on_reject(now=2)
    third, third_clip = policy.on_reject(now=3)
    assert first and first_clip == "noise_clarify_1"
    assert second and second_clip == "noise_clarify_2"
    assert third is None and third_clip is None
    policy.on_valid()
    assert policy.on_reject(now=4)[1] == "noise_clarify_1"


def test_duplex_rejected_transcript_never_becomes_a_final_llm_turn(monkeypatch):
    monkeypatch.setenv("VOICE_VAD_PROVIDER", "energy")

    async def fake_transcribe_pcm(data: bytes, sample_rate: int) -> TranscriptEvidence:
        return TranscriptEvidence("Thank you for watching", avg_logprob=-0.2, no_speech_prob=0.05)

    monkeypatch.setattr(local_voice_server, "transcribe_pcm_result", fake_transcribe_pcm)
    client = TestClient(local_voice_server.app)
    with client.websocket_connect("/api/duplex") as websocket:
        websocket.receive_text()
        for _ in range(10):
            websocket.send_bytes(pcm_frame(9000))
        websocket.receive_text()
        websocket.receive_text()
        for _ in range(24):
            websocket.send_bytes(pcm_frame(0))
        rejected = json.loads(websocket.receive_text())
        listening = json.loads(websocket.receive_text())
    assert rejected["type"] == "rejected"
    assert rejected["clip_id"] == "noise_clarify_1"
    assert "Thank you for watching" not in rejected.get("text", "")
    assert listening == {"type": "state", "value": "listening"}
