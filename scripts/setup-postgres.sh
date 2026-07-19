#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PYTHON_BIN="${PYTHON_BIN:-$ROOT/.venv/bin/python}"
[[ -x "$PYTHON_BIN" ]] || {
  echo "Python environment is missing. Run ./scripts/setup.sh first." >&2
  exit 1
}

configured_url="${DATABASE_URL:-}"
if [[ -n "$configured_url" && "$configured_url" != *replace-with* ]]; then
  echo "[postgres] reusing configured DATABASE_URL"
  database_url="$("$PYTHON_BIN" scripts/provision_postgres.py --database-url "$configured_url")"
elif [[ "$(uname -s)" == "Darwin" ]]; then
  # Reuse any healthy local PostgreSQL service before installing a second one.
  if database_url="$("$PYTHON_BIN" scripts/provision_postgres.py 2>/dev/null)"; then
    echo "[postgres] reused the existing local PostgreSQL service"
  else
    command -v brew >/dev/null 2>&1 || { echo "Homebrew is required to install PostgreSQL." >&2; exit 1; }
    brew list postgresql@16 >/dev/null 2>&1 || brew install postgresql@16
    brew services start postgresql@16 >/dev/null
    export PATH="$(brew --prefix postgresql@16)/bin:$PATH"
    database_url="$("$PYTHON_BIN" scripts/provision_postgres.py)"
  fi
else
  if command -v systemctl >/dev/null 2>&1; then
    if [[ ! -s /var/lib/pgsql/data/PG_VERSION && -x /usr/bin/postgresql-setup ]]; then
      sudo /usr/bin/postgresql-setup --initdb
    fi
    sudo systemctl enable --now postgresql
  fi
  if [[ -n "${POSTGRES_ADMIN_URL:-}" ]]; then
    database_url="$("$PYTHON_BIN" scripts/provision_postgres.py --admin-dsn "$POSTGRES_ADMIN_URL")"
  else
    command -v sudo >/dev/null 2>&1 || {
      echo "Set POSTGRES_ADMIN_URL or install sudo to provision PostgreSQL on Rocky/RHEL." >&2
      exit 1
    }
    database_url="$(sudo -u postgres "$PYTHON_BIN" scripts/provision_postgres.py)"
  fi
fi

"$PYTHON_BIN" scripts/update_env.py .env DATABASE_URL "$database_url"
echo "[postgres] 1StopQuantum database is ready on 127.0.0.1:5432"
echo "[postgres] DATABASE_URL was written to the ignored .env file"
