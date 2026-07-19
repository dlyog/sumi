#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${QYOG_STATE_DIR:-$ROOT/.run}"
PID_FILE="$STATE_DIR/quantumyog.pid"
LOG_FILE="$STATE_DIR/quantumyog.log"
BUILD_ID_FILE="$STATE_DIR/build-id"
API_URL="${QYOG_API_URL:-http://localhost:8000/health}"
APP_URL="${QYOG_APP_URL:-http://localhost:8080/}"
VOICE_URL="${QYOG_VOICE_URL:-http://127.0.0.1:5152}"
VOICE_PID_FILE="$STATE_DIR/voice.pid"

mkdir -p "$STATE_DIR"

read_pid() {
  [[ -f "$PID_FILE" ]] && tr -d '[:space:]' < "$PID_FILE"
}

is_running() {
  local pid
  pid="$(read_pid || true)"
  [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null
}

voice_is_running() {
  local pid
  pid="$(if [[ -f "$VOICE_PID_FILE" ]]; then tr -d '[:space:]' < "$VOICE_PID_FILE"; fi)"
  [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null
}

refresh_build_id() {
  local build_id
  build_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
  printf '%s\n' "$build_id" > "$BUILD_ID_FILE"
  printf '%s\n' "$build_id"
}

start() {
  if is_running; then
    echo "1StopQuantum is already running (PID $(read_pid))."
    echo "App: $APP_URL"
    return 0
  fi
  rm -f "$PID_FILE"
  if curl -fsS "$API_URL" >/dev/null 2>&1 || curl -fsS "$APP_URL" >/dev/null 2>&1; then
    echo "1StopQuantum ports are already in use by a process not started by manage.sh." >&2
    echo "Stop that process first, then run: ./manage.sh start" >&2
    return 1
  fi

  local build_id
  build_id="$(refresh_build_id)"
  printf '\n[%s] starting 1StopQuantum build %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$build_id" >> "$LOG_FILE"
  # A detached subprocess is more reliable than nohup under terminal and CI
  # process-group cleanup while preserving the same background-manager contract.
  local launcher="$ROOT/.venv/bin/python"
  [[ -x "$launcher" ]] || {
    echo "Python environment is missing. Run ./scripts/setup.sh first." >&2
    return 1
  }
  local pid
  pid="$("$launcher" - "$ROOT" "$STATE_DIR" "$LOG_FILE" "$build_id" "${ALLOW_LLM_UNAVAILABLE:-0}" <<'PY'
import os
import subprocess
import sys

root, state_dir, log_path, build_id, allow_llm_unavailable = sys.argv[1:]
environment = os.environ.copy()
environment.update({
    "ALLOW_LLM_UNAVAILABLE": allow_llm_unavailable,
    "QYOG_STATE_DIR": state_dir,
    "QYOG_BUILD_ID": build_id,
})
with open(log_path, "ab", buffering=0) as log_stream:
    process = subprocess.Popen(
        ["bash", "scripts/demo.sh"],
        cwd=root,
        env=environment,
        stdin=subprocess.DEVNULL,
        stdout=log_stream,
        stderr=subprocess.STDOUT,
        start_new_session=True,
        close_fds=True,
    )
print(process.pid)
PY
)"
  printf '%s\n' "$pid" > "$PID_FILE"

  for _ in {1..120}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$PID_FILE"
      echo "1StopQuantum stopped during startup. Recent log output:" >&2
      tail -n 30 "$LOG_FILE" >&2 || true
      return 1
    fi
    if curl -fsS "$API_URL" >/dev/null 2>&1 && curl -fsS "$APP_URL" >/dev/null 2>&1; then
      echo "1StopQuantum started (PID $pid)."
      echo "App: $APP_URL"
      echo "Voice: $VOICE_URL (preloading or ready)"
      echo "Log: $LOG_FILE"
      return 0
    fi
    sleep 0.25
  done

  echo "1StopQuantum did not become ready within 30 seconds." >&2
  stop || true
  tail -n 30 "$LOG_FILE" >&2 || true
  return 1
}

stop() {
  if ! is_running; then
    rm -f "$PID_FILE"
    if voice_is_running; then
      local voice_pid
      voice_pid="$(tr -d '[:space:]' < "$VOICE_PID_FILE")"
      kill -TERM "$voice_pid" 2>/dev/null || true
      rm -f "$VOICE_PID_FILE"
      echo "1StopQuantum main process was stopped; local voice stopped (PID $voice_pid)."
    else
      rm -f "$VOICE_PID_FILE"
      echo "1StopQuantum is not running."
    fi
    return 0
  fi
  local pid
  pid="$(read_pid)"
  kill -TERM "$pid" 2>/dev/null || true
  for _ in {1..40}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$PID_FILE"
      rm -f "$VOICE_PID_FILE"
      echo "1StopQuantum stopped."
      return 0
    fi
    sleep 0.25
  done
  kill -KILL "$pid" 2>/dev/null || true
  rm -f "$PID_FILE"
  echo "1StopQuantum was force-stopped after the shutdown timeout."
}

status() {
  if is_running; then
    echo "1StopQuantum is running (PID $(read_pid))."
    if curl -fsS "$API_URL" >/dev/null 2>&1 && curl -fsS "$APP_URL" >/dev/null 2>&1; then
      echo "Health: ready"
    else
      echo "Health: starting or degraded"
    fi
    echo "App: $APP_URL"
    if curl -fsS "$VOICE_URL/health" >/dev/null 2>&1; then
      echo "Voice: ready ($VOICE_URL)"
    else
      echo "Voice: warming or unavailable ($VOICE_URL)"
    fi
    [[ -f "$BUILD_ID_FILE" ]] && echo "Build: $(tr -d '[:space:]' < "$BUILD_ID_FILE")"
    return 0
  fi
  rm -f "$PID_FILE"
  echo "1StopQuantum is not running."
  if curl -fsS "$VOICE_URL/health" >/dev/null 2>&1; then
    echo "Voice: responding ($VOICE_URL)"
  else
    echo "Voice: not responding ($VOICE_URL)"
  fi
  return 1
}

show_log() {
  touch "$LOG_FILE"
  if [[ "${1:-}" == "--follow" || "${1:-}" == "-f" ]]; then
    tail -n "${LINES:-100}" -f "$LOG_FILE"
  else
    tail -n "${LINES:-100}" "$LOG_FILE"
  fi
}

usage() {
  cat <<'EOF'
Usage: ./manage.sh start|stop|restart|status|log [--follow]

  start     Start API, MCP, and frontend in the background
            Also starts the isolated local Whisper/Kokoro API on port 5152
  stop      Stop the managed 1StopQuantum process tree
  restart   Stop and start, waiting for health checks
  status    Show process and health state
  log       Print the latest consolidated log lines; use -f to follow
EOF
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  status) status ;;
  log) show_log "${2:-}" ;;
  help|-h|--help) usage ;;
  *) usage >&2; exit 2 ;;
esac
