#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f .env.setup ]]; then
  # Reuse paths from an earlier setup unless the caller overrides them.
  # shellcheck disable=SC1091
  . ./.env.setup
fi

PYTHON_BIN="${PYTHON_BIN:-}"
NODE_BIN="${NODE_BIN:-}"
NPM_BIN="${NPM_BIN:-}"
INSTALL_SYSTEM_DEPS="${INSTALL_SYSTEM_DEPS:-1}"
INSTALL_PLAYWRIGHT_BROWSERS="${INSTALL_PLAYWRIGHT_BROWSERS:-1}"
SETUP_POSTGRES="${SETUP_POSTGRES:-1}"

log() {
  printf '[setup] %s\n' "$*"
}

have() {
  command -v "$1" >/dev/null 2>&1
}

as_root() {
  if [[ "${EUID:-$(id -u)}" == "0" ]]; then
    "$@"
  elif have sudo; then
    sudo "$@"
  else
    echo "System package installation requires root or sudo: $*" >&2
    exit 1
  fi
}

detect_platform() {
  if [[ "$(uname -s)" == "Darwin" ]]; then
    echo "macos"
    return
  fi
  if [[ -r /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    case "${ID:-}:${ID_LIKE:-}" in
      rocky:*|rhel:*|centos:*|*:rhel*|*:fedora*) echo "rhel" ;;
      *) echo "linux" ;;
    esac
    return
  fi
  echo "unknown"
}

install_macos_deps() {
  have brew || {
    echo "Homebrew is required on macOS. Install it from https://brew.sh/ and re-run this script." >&2
    exit 1
  }
  brew install python@3.12 node@20 postgresql@16
  PYTHON_BIN="${PYTHON_BIN:-/opt/homebrew/bin/python3.12}"
  if [[ ! -x "$PYTHON_BIN" && -x /usr/local/bin/python3.12 ]]; then
    PYTHON_BIN="/usr/local/bin/python3.12"
  fi
  NODE_BIN="${NODE_BIN:-/opt/homebrew/opt/node@20/bin/node}"
  NPM_BIN="${NPM_BIN:-/opt/homebrew/opt/node@20/bin/npm}"
  if [[ ! -x "$NODE_BIN" && -x /usr/local/opt/node@20/bin/node ]]; then
    NODE_BIN="/usr/local/opt/node@20/bin/node"
    NPM_BIN="/usr/local/opt/node@20/bin/npm"
  fi
}

install_rhel_deps() {
  if [[ "$INSTALL_SYSTEM_DEPS" != "1" ]]; then
    return
  fi
  if have dnf; then
    as_root dnf install -y gcc gcc-c++ make git curl tar xz postgresql-server postgresql-contrib \
      nss atk at-spi2-atk cups-libs libdrm libXcomposite libXdamage libXfixes \
      libXrandr mesa-libgbm pango cairo alsa-lib libxcb libxkbcommon
    local installed_python=0
    for version in 3.12 3.11; do
      if as_root dnf install -y "python${version}" "python${version}-devel" "python${version}-pip"; then
        installed_python=1
        break
      fi
    done
    if [[ "$installed_python" != "1" ]]; then
      echo "Rocky/RHEL requires Python 3.11 or 3.12. Enable the matching AppStream/CRB repository and re-run." >&2
      exit 1
    fi
    if ! have node || ! node --version | grep -Eq '^v2[0-9]\.'; then
      curl -fsSL https://rpm.nodesource.com/setup_20.x | as_root bash -
      as_root dnf install -y nodejs
    fi
  elif have yum; then
    as_root yum install -y gcc gcc-c++ make git curl tar xz postgresql-server postgresql-contrib
    if ! as_root yum install -y python3.11 python3.11-devel python3.11-pip; then
      echo "Rocky 8 requires a Python 3.11 repository/module. Enable it, or set PYTHON_BIN to an existing Python 3.11/3.12 binary." >&2
      exit 1
    fi
    if ! have node || ! node --version | grep -Eq '^v2[0-9]\.'; then
      curl -fsSL https://rpm.nodesource.com/setup_20.x | as_root bash -
      as_root yum install -y nodejs
    fi
  else
    echo "Rocky/RHEL setup needs dnf or yum, or set PYTHON_BIN/NPM_BIN manually." >&2
    exit 1
  fi
}

select_bins() {
  if [[ -z "$PYTHON_BIN" ]]; then
    for candidate in python3.12 python3.11 python3; do
      if have "$candidate"; then
        PYTHON_BIN="$(command -v "$candidate")"
        break
      fi
    done
  fi
  if [[ -z "$NODE_BIN" ]]; then
    NODE_BIN="$(command -v node || true)"
  fi
  if [[ -z "$NPM_BIN" ]]; then
    NPM_BIN="$(command -v npm || true)"
  fi
  [[ -n "$PYTHON_BIN" && -x "$PYTHON_BIN" ]] || { echo "No usable Python found." >&2; exit 1; }
  [[ -n "$NODE_BIN" && -x "$NODE_BIN" ]] || { echo "No usable Node.js found." >&2; exit 1; }
  [[ -n "$NPM_BIN" && -x "$NPM_BIN" ]] || { echo "No usable npm found." >&2; exit 1; }
}

platform="$(detect_platform)"
log "detected platform: $platform"
if [[ "$INSTALL_SYSTEM_DEPS" == "1" ]]; then
  case "$platform" in
    macos) install_macos_deps ;;
    rhel) install_rhel_deps ;;
    *) log "unknown Linux family; expecting Python and Node to already be installed" ;;
  esac
fi

select_bins
python_version="$("$PYTHON_BIN" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
if [[ "$python_version" != "3.11" && "$python_version" != "3.12" ]]; then
  echo "1StopQuantum requires Python 3.11 or 3.12; found $python_version at $PYTHON_BIN." >&2
  exit 1
fi
log "python: $("$PYTHON_BIN" --version)"
log "node: $("$NODE_BIN" --version)"
log "npm: $("$NPM_BIN" --version)"

log "creating Python virtual environment"
"$PYTHON_BIN" -m venv .venv
# shellcheck disable=SC1091
. .venv/bin/activate
python -m pip install --upgrade pip setuptools wheel
pip install -r requirements.txt

if [[ ! -f .env ]]; then
  cp .env.example .env
  log "created .env from .env.example"
fi
if ! grep -q '^QUANTUMYOG_ADMIN_PASSWORD=' .env \
  || grep -q '^QUANTUMYOG_ADMIN_PASSWORD=replace-with' .env; then
  admin_password="$(python -c 'import secrets; print(secrets.token_urlsafe(18))')"
  python scripts/update_env.py .env QUANTUMYOG_ADMIN_EMAIL admin@localhost.test
  python scripts/update_env.py .env QUANTUMYOG_ADMIN_PASSWORD "$admin_password"
  log "generated internal admin credentials in the ignored .env file"
fi
if ! grep -q '^LLM_SETTINGS_ENCRYPTION_KEY=' .env \
  || grep -q '^LLM_SETTINGS_ENCRYPTION_KEY=replace-with' .env; then
  encryption_key="$(python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())')"
  python scripts/update_env.py .env LLM_SETTINGS_ENCRYPTION_KEY "$encryption_key"
  log "generated the LLM settings encryption key in the ignored .env file"
fi
set -a
# shellcheck disable=SC1091
. ./.env
set +a

if [[ "$SETUP_POSTGRES" == "1" ]]; then
  log "provisioning local PostgreSQL"
  PYTHON_BIN="$ROOT/.venv/bin/python" bash ./scripts/setup-postgres.sh
fi

log "installing Node dependencies"
if [[ -f package-lock.json ]]; then
  PATH="$(dirname "$NODE_BIN"):$PATH" "$NPM_BIN" ci
else
  PATH="$(dirname "$NODE_BIN"):$PATH" "$NPM_BIN" install
fi
log "building local browser assets"
PATH="$(dirname "$NODE_BIN"):$PATH" "$NPM_BIN" run build

if [[ "$INSTALL_PLAYWRIGHT_BROWSERS" == "1" ]]; then
  log "installing Playwright browsers"
  PATH="$(dirname "$NODE_BIN"):$PATH" "$NPM_BIN" exec playwright install
fi

printf 'PYTHON_BIN=%s\nNODE_BIN=%s\nNPM_BIN=%s\n' \
  "$PYTHON_BIN" "$NODE_BIN" "$NPM_BIN" > .env.setup

log "done. Activate Python with: source .venv/bin/activate"
log "saved detected tool paths in .env.setup"
chmod +x "$ROOT/qyog"
chmod +x "$ROOT/manage.sh"
chmod +x "$ROOT/scripts/setup-postgres.sh"
log "1StopQuantum CLI ready: ./qyog --help"
log "run make demo, then use /?admin=1 to review the private LLM provider settings"
