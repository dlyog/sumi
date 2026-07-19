"""Responsible noise and transcript gate for Sumi's local voice pipeline."""

from __future__ import annotations

import math
import os
import re
import time
from array import array
from dataclasses import dataclass


MIN_PCM_RMS = float(os.getenv("VOICE_MIN_PCM_RMS", "350"))
MAX_NO_SPEECH_PROB = float(os.getenv("VOICE_MAX_NO_SPEECH_PROB", "0.50"))
MIN_AVG_LOGPROB = float(os.getenv("VOICE_MIN_AVG_LOGPROB", "-1.0"))
MIN_WORD_CONFIDENCE = float(os.getenv("VOICE_MIN_WORD_CONFIDENCE", "0.55"))

WHISPER_HALLUCINATIONS = {
    "bye",
    "please subscribe",
    "silence",
    "so",
    "subtitles by the amara org community",
    "thank you",
    "thank you for watching",
    "thanks for watching",
    "the end",
    "you",
}

CLARIFICATION_PHRASES = (
    "Sorry, I didn't catch a clear question. Please try again.",
    "I still couldn't hear a clear question. I'll stay quiet until I hear you.",
)


@dataclass(frozen=True)
class TranscriptEvidence:
    text: str
    avg_logprob: float | None = None
    no_speech_prob: float | None = None
    word_confidence: float | None = None


@dataclass(frozen=True)
class GateDecision:
    accepted: bool
    reason: str


def pcm_rms(pcm16: bytes) -> float:
    """Return RMS energy for little-endian mono PCM16 without optional packages."""
    if not pcm16 or len(pcm16) % 2:
        return 0.0
    samples = array("h")
    samples.frombytes(pcm16)
    if not samples:
        return 0.0
    return math.sqrt(sum(sample * sample for sample in samples) / len(samples))


def audio_gate(pcm16: bytes, minimum_rms: float = MIN_PCM_RMS) -> GateDecision:
    rms = pcm_rms(pcm16)
    return GateDecision(rms >= minimum_rms, "accepted" if rms >= minimum_rms else f"audio_rms:{rms:.1f}")


def _normalized_phrase(text: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9\s]", " ", text.lower()).split())


def transcript_gate(evidence: TranscriptEvidence) -> GateDecision:
    """Reject low-confidence, hallucinated, or linguistically implausible text."""
    text = evidence.text.strip()
    normalized = _normalized_phrase(text)
    if evidence.no_speech_prob is not None and evidence.no_speech_prob > MAX_NO_SPEECH_PROB:
        return GateDecision(False, f"no_speech_prob:{evidence.no_speech_prob:.3f}")
    if evidence.avg_logprob is not None and evidence.avg_logprob < MIN_AVG_LOGPROB:
        return GateDecision(False, f"avg_logprob:{evidence.avg_logprob:.3f}")
    if evidence.word_confidence is not None and evidence.word_confidence < MIN_WORD_CONFIDENCE:
        return GateDecision(False, f"word_confidence:{evidence.word_confidence:.3f}")
    if normalized in WHISPER_HALLUCINATIONS:
        return GateDecision(False, f"known_hallucination:{normalized}")
    if len(text) < 3:
        return GateDecision(False, "text_too_short")
    words = re.findall(r"[^\W\d_]+", text.lower())
    if not words:
        return GateDecision(False, "no_words")
    if len(words) >= 4 and len(set(words)) / len(words) < 0.34:
        return GateDecision(False, "repeated_token")
    vowels = set("aeiouy")
    vowelless = sum(1 for word in words if len(word) > 2 and not (set(word) & vowels))
    if vowelless / len(words) > 0.5:
        return GateDecision(False, "unpronounceable_text")
    if len(words) == 1 and len(words[0]) > 20:
        return GateDecision(False, "smeared_token")
    return GateDecision(True, "accepted")


class ClarificationPolicy:
    """Clarify twice, then silently wait until valid speech or a quiet reset."""

    def __init__(self, reset_after_seconds: float = 20.0) -> None:
        self.consecutive_rejections = 0
        self.last_rejection_at = 0.0
        self.reset_after_seconds = reset_after_seconds

    def on_valid(self) -> None:
        self.consecutive_rejections = 0

    def on_reject(self, now: float | None = None) -> tuple[str | None, str | None]:
        current_time = time.monotonic() if now is None else now
        if current_time - self.last_rejection_at > self.reset_after_seconds:
            self.consecutive_rejections = 0
        self.last_rejection_at = current_time
        self.consecutive_rejections += 1
        index = self.consecutive_rejections - 1
        if index >= len(CLARIFICATION_PHRASES):
            return None, None
        return CLARIFICATION_PHRASES[index], f"noise_clarify_{index + 1}"
