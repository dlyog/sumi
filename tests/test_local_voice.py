import asyncio

import pytest

from app.local_voice import synthesize_wav, transcribe_upload, voice_health


def test_voice_health_is_safe_before_optional_models_are_loaded():
    health = voice_health()
    assert {"ready", "preload_error", "whisper", "kokoro"} <= set(health)
    assert health["whisper"]["model"]
    assert health["kokoro"]["model"]


def test_transcribe_upload_rejects_empty_audio_without_loading_model():
    with pytest.raises(ValueError, match="audio is required"):
        asyncio.run(transcribe_upload(b""))


def test_synthesize_wav_rejects_empty_text_without_loading_model():
    with pytest.raises(ValueError, match="text is required"):
        synthesize_wav(" ")
