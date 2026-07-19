#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import wave
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
CURRICULUM = ROOT / "public" / "data" / "quantum_curriculum.json"
PODCAST = ROOT / "public" / "data" / "podcast_catalog.json"
MANIFEST = ROOT / "public" / "audio" / "audio_manifest.json"
KOKORO_URL = os.getenv("KOKORO_API_URL", "http://127.0.0.1:5152").rstrip("/")


def source_hash(text: str, voice: str, speed: float) -> str:
    material = json.dumps({"text": text, "voice": voice, "speed": speed}, sort_keys=True)
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def validate_wav(path: Path) -> dict[str, Any]:
    with wave.open(str(path), "rb") as recording:
        channels = recording.getnchannels()
        rate = recording.getframerate()
        frames = recording.getnframes()
        duration = frames / rate
    if channels < 1 or rate < 16_000 or duration < 3:
        raise ValueError(f"invalid narration WAV: {path} ({channels} channels, {rate} Hz, {duration:.2f}s)")
    return {"channels": channels, "sample_rate": rate, "duration_seconds": round(duration, 3)}


def generate_audio(text: str, destination: Path, voice: str, speed: float) -> dict[str, Any]:
    body = json.dumps({"text": text, "voice": voice, "speed": speed}).encode("utf-8")
    request = Request(
        f"{KOKORO_URL}/api/speak",
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "Accept": "audio/wav"},
    )
    try:
        with urlopen(request, timeout=180) as response:
            audio = response.read()
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Kokoro returned HTTP {error.code}: {detail[:300]}") from error
    except (URLError, TimeoutError) as error:
        raise RuntimeError(f"Cannot reach Kokoro at {KOKORO_URL}: {error}") from error

    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(".tmp.wav")
    temporary.write_bytes(audio)
    metadata = validate_wav(temporary)
    temporary.replace(destination)
    return metadata


def speech_chunks(text: str, maximum: int = 560) -> list[str]:
    sentences = [part.strip() for part in re.split(r"(?<=[.!?])\s+|\n+", text) if part.strip()]
    chunks: list[str] = []
    current = ""
    for sentence in sentences:
        if len(sentence) > maximum:
            words = sentence.split()
            for word in words:
                candidate = f"{current} {word}".strip()
                if current and len(candidate) > maximum:
                    chunks.append(current)
                    current = word
                else:
                    current = candidate
            continue
        candidate = f"{current} {sentence}".strip()
        if current and len(candidate) > maximum:
            chunks.append(current)
            current = sentence
        else:
            current = candidate
    if current:
        chunks.append(current)
    return chunks


def generate_long_audio(text: str, destination: Path, voice: str, speed: float) -> dict[str, Any]:
    chunks = speech_chunks(text)
    if len(chunks) == 1:
        return generate_audio(text, destination, voice, speed)
    parts = [destination.with_name(f".{destination.stem}.part-{index:03d}.wav") for index in range(len(chunks))]
    try:
        for chunk, part in zip(chunks, parts, strict=True):
            generate_audio(chunk, part, voice, speed)
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(".tmp.wav")
        parameters = None
        with wave.open(str(temporary), "wb") as output:
            for index, part in enumerate(parts):
                with wave.open(str(part), "rb") as recording:
                    current = recording.getparams()
                    comparable = (current.nchannels, current.sampwidth, current.framerate, current.comptype)
                    if parameters is None:
                        parameters = comparable
                        output.setnchannels(current.nchannels)
                        output.setsampwidth(current.sampwidth)
                        output.setframerate(current.framerate)
                        output.setcomptype(current.comptype, current.compname)
                    elif comparable != parameters:
                        raise ValueError("Kokoro chunks returned incompatible WAV parameters")
                    output.writeframes(recording.readframes(recording.getnframes()))
                    if index < len(parts) - 1:
                        output.writeframes(b"\x00" * current.nchannels * current.sampwidth * int(current.framerate * 0.18))
        metadata = validate_wav(temporary)
        temporary.replace(destination)
        return metadata
    finally:
        for part in parts:
            part.unlink(missing_ok=True)


def narration_items(curriculum: dict[str, Any], podcast: dict[str, Any]) -> list[dict[str, str]]:
    items = [
        {"kind": "lesson", "id": lesson["id"], "text": lesson["narration"], "path": lesson["audio"]}
        for course in curriculum["courses"]
        for lesson in course["lessons"]
    ]
    items.extend(
        {"kind": "screen", "id": screen, "text": guide["narration"], "path": guide["audio"]}
        for screen, guide in curriculum["screen_guides"].items()
    )
    items.extend(
        {"kind": "screen", "id": screen, "text": guide["narration"], "path": guide["audio"]}
        for screen, guide in curriculum.get("workspace_guides", {}).items()
    )
    items.extend(
        {"kind": "podcast", "id": episode["id"], "text": episode["transcript"], "path": episode["audio"]}
        for episode in podcast["episodes"]
    )
    return items


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate and validate saved 1StopQuantum narration with Kokoro.")
    parser.add_argument("--voice", default=os.getenv("KOKORO_VOICE", "am_michael"))
    parser.add_argument("--speed", type=float, default=float(os.getenv("KOKORO_SPEED", "0.94")))
    parser.add_argument("--lesson", help="Generate one lesson ID")
    parser.add_argument("--screen", help="Generate one screen guide ID")
    parser.add_argument("--episode", help="Generate one podcast episode ID")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args(argv)

    curriculum = json.loads(CURRICULUM.read_text(encoding="utf-8"))
    podcast = json.loads(PODCAST.read_text(encoding="utf-8"))
    previous = json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.is_file() else {"items": {}}
    result = {"schema_version": "1.0", "kokoro_url": KOKORO_URL, "voice": args.voice, "speed": args.speed, "items": {}}
    selected = []
    for item in narration_items(curriculum, podcast):
        if args.lesson and not (item["kind"] == "lesson" and item["id"] == args.lesson):
            continue
        if args.screen and not (item["kind"] == "screen" and item["id"] == args.screen):
            continue
        if args.episode and not (item["kind"] == "podcast" and item["id"] == args.episode):
            continue
        selected.append(item)
    if not selected:
        parser.error("no narration matched the requested lesson or screen")

    for index, item in enumerate(selected, start=1):
        destination = ROOT / "public" / item["path"].removeprefix("/")
        digest = source_hash(item["text"], args.voice, args.speed)
        old = previous.get("items", {}).get(item["path"], {})
        unchanged = destination.is_file() and old.get("source_hash") == digest and not args.force
        print(f"[{index}/{len(selected)}] {'validate' if unchanged else 'generate'} {item['kind']} {item['id']}")
        generate = generate_long_audio if len(item["text"]) > 700 else generate_audio
        metadata = validate_wav(destination) if unchanged else generate(item["text"], destination, args.voice, args.speed)
        result["items"][item["path"]] = {
            "kind": item["kind"], "id": item["id"], "source_hash": digest,
            "bytes": destination.stat().st_size, **metadata,
        }
        if item["kind"] == "podcast":
            episode = next(entry for entry in podcast["episodes"] if entry["id"] == item["id"])
            episode["duration_seconds"] = round(metadata["duration_seconds"])
            episode["bytes"] = destination.stat().st_size

    if not args.lesson and not args.screen and not args.episode:
        MANIFEST.parent.mkdir(parents=True, exist_ok=True)
        MANIFEST.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    if any(item["kind"] == "podcast" for item in selected):
        PODCAST.write_text(json.dumps(podcast, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"generated_or_validated": len(selected), "manifest": str(MANIFEST)}, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError) as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(1)
