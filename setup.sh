#!/usr/bin/env bash
set -euo pipefail

# One-command bootstrap for a newly cloned repository. The implementation stays
# in scripts/setup.sh so Make and automation share exactly the same installer.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "$(uname -s)" == "Darwin" ]]; then
  if [[ "$(uname -m)" != "arm64" ]]; then
    echo "[setup] warning: this guide is optimized for Apple silicon; continuing on $(uname -m)" >&2
  fi
  if ! command -v brew >/dev/null 2>&1; then
    if [[ "${INSTALL_HOMEBREW:-1}" != "1" ]]; then
      echo "Homebrew is required. Install it from https://brew.sh/ or rerun with INSTALL_HOMEBREW=1." >&2
      exit 1
    fi
    command -v curl >/dev/null 2>&1 || { echo "curl is required to install Homebrew." >&2; exit 1; }
    echo "[setup] Homebrew not found; running the official non-interactive installer"
    NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  fi
  if [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[ -x /usr/local/bin/brew ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
fi

exec "$ROOT/scripts/setup.sh" "$@"
