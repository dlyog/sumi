#!/usr/bin/env python3
"""Generate reusable AI Co-Teacher WAV clips with the configured Kokoro API."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "public" / "ai-co-teacher-manifest.json"
OUTPUT = ROOT / "public" / "assets" / "co-teacher"
KOKORO_URL = os.environ.get("KOKORO_API_URL", "http://127.0.0.1:5152").rstrip("/")


def main() -> None:
    transcripts = json.loads(MANIFEST.read_text(encoding="utf-8"))["transcripts"]
    requested = set(sys.argv[1:])
    unknown = requested.difference(transcripts)
    if unknown:
        raise SystemExit(f"Unknown transcript keys: {', '.join(sorted(unknown))}")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for key, text in transcripts.items():
        if requested and key not in requested:
            continue
        destination = OUTPUT / f"{key}.wav"
        payload = json.dumps({"text": text, "voice": "af_heart", "speed": 0.94}).encode("utf-8")
        request = Request(f"{KOKORO_URL}/api/speak", data=payload, headers={"Content-Type": "application/json"}, method="POST")
        with urlopen(request, timeout=30) as response:
            destination.write_bytes(response.read())
        print(f"generated {destination.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
