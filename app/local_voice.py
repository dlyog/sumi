"""Optional local Whisper + Kokoro voice APIs for the learning companion.

The heavy ML packages are imported lazily so the simulator and its test suite
remain usable on machines that have not installed the voice extras yet.
"""

from __future__ import annotations

import asyncio
import io
import importlib.util
import os
import tempfile
import wave
from pathlib import Path
from threading import Lock
from typing import Any

from .voice_gatekeeper import TranscriptEvidence


WHISPER_MODEL = os.getenv("WHISPER_MODEL", "mlx-community/whisper-small-mlx")
WHISPER_MAX_SECONDS = int(os.getenv("WHISPER_MAX_SECONDS", "30"))
MAX_AUDIO_BYTES = int(os.getenv("WHISPER_MAX_BYTES", "12_000_000"))
KOKORO_MODEL = os.getenv("COMPANION_TTS_MODEL", "hexgrad/Kokoro-82M")
KOKORO_VOICE = os.getenv("KOKORO_VOICE", "am_michael")
KOKORO_SPEED = float(os.getenv("KOKORO_SPEED", "0.94"))

_whisper_model: str | None = None
_kokoro_pipeline: Any | None = None
_whisper_lock = Lock()
_kokoro_lock = Lock()
_preload_error: str | None = None


def _available(module: str) -> bool:
    return importlib.util.find_spec(module) is not None


def _whisper() -> Any:
    if not _available("mlx_whisper"):
        raise RuntimeError("Local Whisper is not installed. Install the voice extras and ffmpeg.")
    return __import__("mlx_whisper")


def _kokoro() -> Any:
    if not _available("kokoro"):
        raise RuntimeError("Local Kokoro is not installed. Install the voice extras and espeak-ng.")
    return __import__("kokoro", fromlist=["KPipeline"])


def transcribe_file_result(path: str | Path) -> TranscriptEvidence:
    """Transcribe one file and preserve Whisper confidence evidence."""
    global _whisper_model
    with _whisper_lock:
        mlx_whisper = _whisper()
        _whisper_model = WHISPER_MODEL
        result = mlx_whisper.transcribe(
            str(path),
            path_or_hf_repo=WHISPER_MODEL,
            task="transcribe",
            temperature=0,
            condition_on_previous_text=False,
            no_speech_threshold=0.6,
        )
    text = str(result.get("text", "")).strip() if isinstance(result, dict) else ""
    if not text:
        raise ValueError("Whisper returned an empty transcription.")
    segments = result.get("segments", []) if isinstance(result, dict) else []
    logprobs = [float(segment["avg_logprob"]) for segment in segments if isinstance(segment, dict) and segment.get("avg_logprob") is not None]
    no_speech = [float(segment["no_speech_prob"]) for segment in segments if isinstance(segment, dict) and segment.get("no_speech_prob") is not None]
    return TranscriptEvidence(
        text=text,
        avg_logprob=sum(logprobs) / len(logprobs) if logprobs else None,
        no_speech_prob=sum(no_speech) / len(no_speech) if no_speech else None,
    )


def transcribe_file(path: str | Path) -> str:
    """Compatibility wrapper returning only the transcription text."""
    return transcribe_file_result(path).text


def synthesize_wav(text: str, voice: str = KOKORO_VOICE, speed: float = KOKORO_SPEED) -> bytes:
    """Generate a WAV response with one cached local Kokoro pipeline."""
    global _kokoro_pipeline
    clean = " ".join(text.split()).strip()
    if not clean:
        raise ValueError("text is required")
    if len(clean) > 900:
        raise ValueError("text is too long for one companion speech response")
    with _kokoro_lock:
        kokoro = _kokoro()
        if _kokoro_pipeline is None:
            # The official package uses MPS on Apple Silicon when available.
            _kokoro_pipeline = kokoro.KPipeline(lang_code="a")
        pipeline = _kokoro_pipeline
        import numpy as np
        import soundfile as sf

        parts = []
        for _, _, audio in pipeline(clean, voice=voice, speed=float(speed)):
            parts.append(np.asarray(audio))
        if not parts:
            raise RuntimeError("Kokoro returned no audio")
        output = io.BytesIO()
        sf.write(output, np.concatenate(parts), 24_000, format="WAV", subtype="PCM_16")
        return output.getvalue()


async def transcribe_upload(data: bytes, suffix: str = ".webm") -> str:
    return (await transcribe_upload_result(data, suffix)).text


async def transcribe_upload_result(data: bytes, suffix: str = ".webm") -> TranscriptEvidence:
    if not data:
        raise ValueError("audio is required")
    if len(data) > MAX_AUDIO_BYTES:
        raise ValueError("audio upload is too large")
    temporary_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(prefix="1stopq-whisper-", suffix=suffix, delete=False) as handle:
            handle.write(data)
            temporary_path = handle.name
        return await asyncio.to_thread(transcribe_file_result, temporary_path)
    finally:
        if temporary_path:
            try:
                os.remove(temporary_path)
            except OSError:
                pass


async def transcribe_pcm(data: bytes, sample_rate: int = 16_000) -> str:
    return (await transcribe_pcm_result(data, sample_rate)).text


async def transcribe_pcm_result(data: bytes, sample_rate: int = 16_000) -> TranscriptEvidence:
    """Transcribe raw mono PCM16 frames received by the duplex WebSocket."""
    if not data or len(data) % 2:
        raise ValueError("PCM16 audio is required")
    if sample_rate < 8_000 or sample_rate > 48_000:
        raise ValueError("unsupported PCM sample rate")
    output = io.BytesIO()
    with wave.open(output, "wb") as recording:
        recording.setnchannels(1)
        recording.setsampwidth(2)
        recording.setframerate(sample_rate)
        recording.writeframes(data)
    return await transcribe_upload_result(output.getvalue(), suffix=".wav")


def voice_health() -> dict[str, Any]:
    return {
        "ready": _preload_error is None and _whisper_model is not None and _kokoro_pipeline is not None,
        "preload_error": _preload_error,
        "whisper": {
            "provider": "local-mlx",
            "package_available": _available("mlx_whisper"),
            "model": WHISPER_MODEL,
            "loaded": _whisper_model is not None,
        },
        "kokoro": {
            "provider": "local-python",
            "package_available": _available("kokoro"),
            "model": KOKORO_MODEL,
            "loaded": _kokoro_pipeline is not None,
        },
    }


def preload_models() -> None:
    """Load both models before the standalone voice server reports ready."""
    global _preload_error
    try:
        # A short silent WAV forces Whisper's model/tokenizer to load without
        # requiring a microphone recording during server startup.
        with tempfile.NamedTemporaryFile(prefix="1stopq-whisper-preload-", suffix=".wav", delete=False) as handle:
            path = handle.name
        try:
            frames = b"\x00\x00" * (16000 // 5)
            with wave.open(path, "wb") as recording:
                recording.setnchannels(1)
                recording.setsampwidth(2)
                recording.setframerate(16000)
                recording.writeframes(frames)
            try:
                transcribe_file(path)
            except ValueError:
                # Silence may legitimately produce no text; model loading has
                # still completed if no RuntimeError was raised.
                pass
        finally:
            Path(path).unlink(missing_ok=True)
        synthesize_wav("Voice ready.")
        _preload_error = None
    except Exception as exc:
        _preload_error = str(exc)
        raise
