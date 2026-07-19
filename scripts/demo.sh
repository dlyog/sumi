#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${ENV_FILE:-$ROOT/.env}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

PYTHON_BIN="${PYTHON_BIN:-$ROOT/.venv/bin/python}"
ALLOW_LLM_UNAVAILABLE="${ALLOW_LLM_UNAVAILABLE:-0}"
[[ -x "$PYTHON_BIN" ]] || {
  echo "Python environment is missing. Run ./scripts/setup.sh first." >&2
  exit 1
}

provider_status=0
"$PYTHON_BIN" - <<'PY' || provider_status=$?
import sys
import urllib.request

from app.persistence import store_from_environment

try:
    settings = store_from_environment().get_llm_settings(include_secret=True)
except Exception:
    sys.exit(3)
if not settings.get("base_url") or not settings.get("model"):
    sys.exit(2)
request = urllib.request.Request(
    settings["base_url"].rstrip("/") + "/models",
    headers={"Authorization": f"Bearer {settings.get('api_key', 'local')}"},
)
try:
    urllib.request.urlopen(request, timeout=3).close()
except Exception:
    sys.exit(1)
PY
if [[ "$provider_status" != "0" ]]; then
  if [[ "$ALLOW_LLM_UNAVAILABLE" != "1" ]]; then
    case "$provider_status" in
      2) echo "No LLM provider is configured. Use the internal admin settings or update $ENV_FILE." >&2 ;;
      3) echo "The saved LLM provider settings could not be read. Check PostgreSQL and the encryption key." >&2 ;;
      *) echo "The configured LLM provider is unreachable. Check the internal admin settings." >&2 ;;
    esac
    exit 1
  fi
  echo "The configured LLM is unavailable; deterministic templates and manifests remain available." >&2
fi

cleanup() {
  [[ -n "${VOICE_PID:-}" ]] && kill "$VOICE_PID" 2>/dev/null || true
  [[ -n "${VOICE_PID_FILE:-}" ]] && rm -f "$VOICE_PID_FILE"
  [[ -n "${BACKEND_PID:-}" ]] && kill "$BACKEND_PID" 2>/dev/null || true
  [[ -n "${MCP_PID:-}" ]] && kill "$MCP_PID" 2>/dev/null || true
  [[ -n "${FRONTEND_PID:-}" ]] && kill "$FRONTEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

if [[ "${VOICE_AUTOSTART:-1}" != "0" ]]; then
  VOICE_PID_FILE="${QYOG_STATE_DIR:-$ROOT/.run}/voice.pid"
  mkdir -p "$(dirname "$VOICE_PID_FILE")"
  "$PYTHON_BIN" -m uvicorn app.local_voice_server:app --host "${VOICE_HOST:-127.0.0.1}" --port "${VOICE_PORT:-5152}" &
  VOICE_PID=$!
  printf '%s\n' "$VOICE_PID" > "$VOICE_PID_FILE"
fi

"$PYTHON_BIN" -m uvicorn app.main:app --port 8000 &
BACKEND_PID=$!
"$PYTHON_BIN" -m app.mcp_server &
MCP_PID=$!
"$PYTHON_BIN" scripts/static_server.py &
FRONTEND_PID=$!

for _ in {1..40}; do
  if curl -fsS http://localhost:8000/health >/dev/null 2>&1 \
    && curl -fsS http://localhost:8080/ >/dev/null 2>&1; then
    echo "1StopQuantum is running at http://localhost:8080"
    if [[ "${VOICE_AUTOSTART:-1}" != "0" ]]; then
      echo "Local voice API: http://${VOICE_HOST:-127.0.0.1}:${VOICE_PORT:-5152} (preloading in parallel)"
    fi
    echo "ChatGPT MCP endpoint: http://localhost:8001/mcp"
    wait
  fi
  sleep 0.25
done

echo "1StopQuantum did not become ready. Check ports 8000 and 8080." >&2
exit 1
