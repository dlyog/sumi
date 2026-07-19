"""Standalone local voice service; intentionally separate from the main app."""

from __future__ import annotations

import asyncio
import io
import json
import logging
import math
import os
from array import array
from collections import deque
from pathlib import Path
from typing import Protocol

from fastapi import FastAPI, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .local_voice import preload_models, synthesize_wav, transcribe_pcm, transcribe_pcm_result, transcribe_upload, voice_health
from .voice_gatekeeper import MIN_PCM_RMS, ClarificationPolicy, TranscriptEvidence, audio_gate, transcript_gate


SAMPLE_RATE = 16_000
VAD_SAMPLES = 512
VAD_FRAME_MS = VAD_SAMPLES / SAMPLE_RATE * 1000
ENDPOINT_SILENCE_MS = int(os.getenv("VOICE_ENDPOINT_SILENCE_MS", "600"))
MIN_UTTERANCE_MS = int(os.getenv("VOICE_MIN_UTTERANCE_MS", "250"))
ENERGY_THRESHOLD = int(os.getenv("VOICE_ENERGY_THRESHOLD", "900"))
SILERO_THRESHOLD = float(os.getenv("VOICE_SILERO_THRESHOLD", "0.60"))
logger = logging.getLogger(__name__)
_upload_clarification_policy = ClarificationPolicy()


class VoiceDetector(Protocol):
    last_voiced: bool

    def feed(self, chunk: bytes) -> str | None: ...
    def reset(self) -> None: ...


def _pcm_rms(chunk: bytes) -> float:
    samples = array("h")
    samples.frombytes(chunk)
    if not samples:
        return 0.0
    return math.sqrt(sum(sample * sample for sample in samples) / len(samples))


class EnergyVoiceDetector:
    """Dependency-free fallback used when Silero is unavailable."""

    def __init__(self) -> None:
        self.active = False
        self.voiced_frames = 0
        self.silent_frames = 0
        self.last_voiced = False

    def feed(self, chunk: bytes) -> str | None:
        self.last_voiced = _pcm_rms(chunk) >= ENERGY_THRESHOLD
        if self.last_voiced:
            self.silent_frames = 0
            self.voiced_frames += 1
            if not self.active and self.voiced_frames >= 2:
                self.active = True
                return "start"
        else:
            self.voiced_frames = 0
            if self.active:
                self.silent_frames += 1
                if self.silent_frames * VAD_FRAME_MS >= ENDPOINT_SILENCE_MS:
                    self.active = False
                    self.silent_frames = 0
                    return "end"
        return None

    def reset(self) -> None:
        self.active = False
        self.voiced_frames = 0
        self.silent_frames = 0
        self.last_voiced = False


_silero_model = None


class SileroVoiceDetector:
    def __init__(self) -> None:
        global _silero_model
        from silero_vad import VADIterator, load_silero_vad
        if _silero_model is None:
            _silero_model = load_silero_vad()
        self.iterator = VADIterator(
            _silero_model,
            threshold=SILERO_THRESHOLD,
            sampling_rate=SAMPLE_RATE,
            min_silence_duration_ms=ENDPOINT_SILENCE_MS,
            speech_pad_ms=96,
        )
        self.last_voiced = False

    def feed(self, chunk: bytes) -> str | None:
        import numpy as np
        audio = np.frombuffer(chunk, np.int16).astype(np.float32) / 32768.0
        self.last_voiced = _pcm_rms(chunk) >= ENERGY_THRESHOLD
        event = self.iterator(audio)
        if event and "start" in event:
            return "start"
        if event and "end" in event:
            return "end"
        return None

    def reset(self) -> None:
        self.iterator.reset_states()
        self.last_voiced = False


def create_voice_detector() -> VoiceDetector:
    if os.getenv("VOICE_VAD_PROVIDER", "silero").lower() == "energy":
        return EnergyVoiceDetector()
    try:
        return SileroVoiceDetector()
    except Exception:
        return EnergyVoiceDetector()


app = FastAPI(title="1StopQuantum local voice")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8080", "http://127.0.0.1:8080"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"]
)


@app.on_event("startup")
def load_voice_models() -> None:
    if os.getenv("VOICE_PRELOAD", "1").lower() not in {"0", "false", "no"}:
        try:
            preload_models()
        except Exception:
            # Keep the process available so /health explains the failure and
            # the manager can report degraded rather than hiding diagnostics.
            pass
    if os.getenv("VOICE_VAD_PROVIDER", "silero").lower() != "energy":
        create_voice_detector().reset()


@app.get("/health")
def health() -> dict:
    result = voice_health()
    result["duplex"] = {
        "transport": "websocket-pcm16",
        "sample_rate": SAMPLE_RATE,
        "vad": "silero" if _silero_model is not None else "energy-fallback",
        "endpoint_silence_ms": ENDPOINT_SILENCE_MS,
        "silero_threshold": SILERO_THRESHOLD,
        "responsible_noise_gate": True,
        "minimum_pcm_rms": MIN_PCM_RMS,
    }
    return result


@app.post("/api/transcribe")
async def transcribe(audio: UploadFile = File(...)) -> dict:
    allowed = {"audio/webm", "audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp4", "audio/ogg"}
    content_type = (audio.content_type or "").split(";", 1)[0].strip().lower()
    if content_type and content_type not in allowed:
        raise HTTPException(status_code=415, detail="Unsupported audio type")
    try:
        data = await audio.read()
        text = await transcribe_upload(data, suffix=Path(audio.filename or "recording.webm").suffix or ".webm")
        decision = transcript_gate(TranscriptEvidence(text=text))
        if not decision.accepted:
            phrase, clip_id = _upload_clarification_policy.on_reject()
            logger.info("Sumi rejected upload transcript reason=%s text=%r", decision.reason, text[:120])
            return {"success": True, "accepted": False, "transcription": "", "reason": decision.reason, "clarification": phrase, "clip_id": clip_id, "silent": phrase is None, "provider": "local-mlx"}
        _upload_clarification_policy.on_valid()
        return {"success": True, "accepted": True, "transcription": text, "provider": "local-mlx"}
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/api/speak")
def speak(body: dict) -> StreamingResponse:
    text = body.get("text", "") if isinstance(body, dict) else ""
    voice = body.get("voice", "am_michael") if isinstance(body, dict) else "am_michael"
    speed = body.get("speed", 0.94) if isinstance(body, dict) else 0.94
    if not isinstance(text, str) or not text.strip():
        raise HTTPException(status_code=422, detail="text is required")
    try:
        audio = synthesize_wav(text, str(voice), float(speed))
    except (RuntimeError, ValueError, TypeError) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return StreamingResponse(io.BytesIO(audio), media_type="audio/wav", headers={"Cache-Control": "no-store"})


class DuplexSession:
    """Continuous PCM/VAD session; application actions remain in the browser."""

    def __init__(self, websocket: WebSocket) -> None:
        self.websocket = websocket
        self.detector = create_voice_detector()
        self.leftover = b""
        self.in_speech = False
        self.speech = bytearray()
        self.pre_roll: deque[bytes] = deque(maxlen=4)
        self.candidate_voiced_frames = 0
        self.voiced_frames = 0
        self.transcription_task: asyncio.Task | None = None
        self.clarification_policy = ClarificationPolicy()

    async def send(self, **message) -> None:
        await self.websocket.send_text(json.dumps(message))

    async def interrupt(self) -> None:
        if self.transcription_task and not self.transcription_task.done():
            self.transcription_task.cancel()
            try:
                await self.transcription_task
            except asyncio.CancelledError:
                pass
        self.transcription_task = None
        await self.send(type="interrupt")

    async def feed(self, data: bytes) -> None:
        self.leftover += data
        chunk_bytes = VAD_SAMPLES * 2
        while len(self.leftover) >= chunk_bytes:
            chunk, self.leftover = self.leftover[:chunk_bytes], self.leftover[chunk_bytes:]
            event = self.detector.feed(chunk)
            if not self.in_speech:
                self.pre_roll.append(chunk)
                self.candidate_voiced_frames = self.candidate_voiced_frames + 1 if self.detector.last_voiced else 0
            if event == "start":
                await self.interrupt()
                self.in_speech = True
                self.speech = bytearray().join(self.pre_roll)
                self.voiced_frames = max(2, self.candidate_voiced_frames)
                self.pre_roll.clear()
                await self.send(type="speech_start")
                continue
            if self.in_speech:
                self.speech.extend(chunk)
                if self.detector.last_voiced:
                    self.voiced_frames += 1
            if event == "end" and self.in_speech:
                await self.commit()

    async def commit(self) -> None:
        if not self.in_speech:
            return
        utterance = bytes(self.speech)
        voiced_ms = self.voiced_frames * VAD_FRAME_MS
        self.in_speech = False
        self.speech.clear()
        self.voiced_frames = 0
        self.candidate_voiced_frames = 0
        self.detector.reset()
        audio_decision = audio_gate(utterance)
        if voiced_ms >= MIN_UTTERANCE_MS and audio_decision.accepted:
            self.transcription_task = asyncio.create_task(self.transcribe(utterance))
        elif voiced_ms >= MIN_UTTERANCE_MS:
            logger.info("Sumi silently rejected PCM before Whisper reason=%s", audio_decision.reason)
            await self.send(type="state", value="listening")

    async def transcribe(self, utterance: bytes) -> None:
        try:
            evidence = await transcribe_pcm_result(utterance, SAMPLE_RATE)
            decision = transcript_gate(evidence)
            if not decision.accepted:
                phrase, clip_id = self.clarification_policy.on_reject()
                logger.info("Sumi rejected duplex transcript reason=%s text=%r", decision.reason, evidence.text[:120])
                await self.send(type="rejected", reason=decision.reason, text=phrase or "", clip_id=clip_id or "", silent=phrase is None)
                await self.send(type="state", value="listening")
                return
            self.clarification_policy.on_valid()
            await self.send(type="final", text=evidence.text.strip())
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            await self.send(type="error", text=str(exc))

    async def close(self) -> None:
        if self.transcription_task and not self.transcription_task.done():
            self.transcription_task.cancel()
            try:
                await self.transcription_task
            except asyncio.CancelledError:
                pass


@app.websocket("/api/duplex")
async def duplex(websocket: WebSocket) -> None:
    await websocket.accept()
    session = DuplexSession(websocket)
    await session.send(type="state", value="listening")
    try:
        while True:
            message = await websocket.receive()
            if message.get("bytes"):
                await session.feed(message["bytes"])
            elif message.get("text"):
                try:
                    command = json.loads(message["text"])
                except json.JSONDecodeError:
                    command = {}
                if command.get("type") == "commit":
                    await session.commit()
            elif message.get("type") == "websocket.disconnect":
                break
    except WebSocketDisconnect:
        pass
    finally:
        await session.close()
