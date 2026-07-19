#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "Local MLX voice setup requires an Apple Silicon Mac." >&2
  exit 1
fi
command -v brew >/dev/null 2>&1 || { echo "Install Homebrew first: https://brew.sh/" >&2; exit 1; }
brew install ffmpeg espeak-ng
"${PYTHON:-.venv/bin/python}" -m pip install -r requirements-voice-macos.txt
echo "Local voice ready. First STT/TTS requests download and cache their models."
