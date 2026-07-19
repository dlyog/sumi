#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

if [[ -f .env.setup ]]; then
  # shellcheck disable=SC1091
  . ./.env.setup
fi
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
NPM_BIN="${NPM_BIN:-$(command -v npm || true)}"
VENV_PYTHON="${VENV_PYTHON:-$ROOT/.venv/bin/python}"
[[ -x "$NODE_BIN" && -x "$NPM_BIN" && -x "$VENV_PYTHON" ]] || {
  echo "Node/npm or the Python virtual environment is missing. Run ./scripts/setup.sh first." >&2
  exit 1
}
export PATH="$(dirname "$NODE_BIN"):$PATH"

cleanup() {
  if [[ -n "${FRONTEND_PID:-}" ]]; then
    kill "$FRONTEND_PID" 2>/dev/null || true
    wait "$FRONTEND_PID" 2>/dev/null || true
  fi
  if [[ -n "${BACKEND_PID:-}" ]]; then
    kill "$BACKEND_PID" 2>/dev/null || true
    wait "$BACKEND_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if ! curl -fsS http://localhost:8000/health >/dev/null 2>&1; then
  ALLOW_LLM_UNAVAILABLE=1 "$VENV_PYTHON" -m uvicorn app.main:app --port 8000 \
    > "${TMPDIR:-/tmp}/quantumyog-api-evals.log" 2>&1 &
  BACKEND_PID=$!
  for _ in {1..80}; do
    curl -fsS http://localhost:8000/health >/dev/null 2>&1 && break
    sleep 0.25
  done
fi

curl -fsS http://localhost:8000/health >/dev/null 2>&1 || {
  echo "Backend did not start; see ${TMPDIR:-/tmp}/quantumyog-api-evals.log" >&2
  exit 1
}

if ! curl -fsS http://localhost:8080/ >/dev/null 2>&1; then
  "$NPM_BIN" run dev > "${TMPDIR:-/tmp}/quantumyog-ui-evals.log" 2>&1 &
  FRONTEND_PID=$!
  for _ in {1..40}; do
    curl -fsS http://localhost:8080/ >/dev/null 2>&1 && break
    sleep 0.25
  done
fi

curl -fsS http://localhost:8080/ >/dev/null 2>&1 || {
  echo "Frontend did not start; see ${TMPDIR:-/tmp}/quantumyog-ui-evals.log" >&2
  exit 1
}

./node_modules/.bin/playwright test \
  --config evals/ui/playwright.config.ts \
  --workers "${PLAYWRIGHT_WORKERS:-1}" \
  evals/ui/*.spec.ts
