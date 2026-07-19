# Setup — macOS and Rocky Linux, Local First

Target dev machine: a **MacBook (Apple Silicon or Intel)**. Everything runs
locally: the quantum simulators, PostgreSQL, the backend, MCP, and the IDE
frontend. The default LLM is local; an internal administrator may instead select
OpenAI, which requires internet access and an API key.

## Prerequisites

- **Git** — available through Xcode Command Line Tools and already present if the
  repository has been cloned.
- **A local LLM server** exposing an **OpenAI-compatible endpoint** for the
  fully-local default. Any of:
  - **Ollama** (recommended, simplest): `brew install ollama`, then
    `ollama pull qwen2.5-coder:14b` (or your preferred model) and `ollama serve`.
    Endpoint: `http://localhost:11434/v1`.
  - **LM Studio**: GUI app; load a model; enable the local server.
    Endpoint: `http://localhost:1234/v1`.
  - **llama.cpp / MLX-LM**: fine too — anything OpenAI-compatible works.

  > The owner will provide the bootstrap URL. After setup, use `/?admin=1` to
  > save the effective local or OpenAI provider in PostgreSQL.

Docker is **not** required. `make demo` starts API + MCP + frontend as native
processes.

## One-command setup

From a new clone, run only:

```bash
./setup.sh
```

On macOS, the root script installs Homebrew when absent, then installs Python
3.12, Node 20, and PostgreSQL 16. It creates `.venv`, installs Python and locked
Node dependencies, builds browser assets, provisions the database, and downloads
the Playwright browser. The same entrypoint delegates to the Rocky/RHEL installer
when run on supported Linux.

Useful controls:

```bash
INSTALL_SYSTEM_DEPS=0 ./setup.sh          # tools already installed
INSTALL_PLAYWRIGHT_BROWSERS=0 ./setup.sh  # skip browser download
SETUP_POSTGRES=0 ./setup.sh               # manage DATABASE_URL yourself
INSTALL_HOMEBREW=0 ./setup.sh             # require preinstalled Homebrew
```

Detected tool paths are written to the ignored `.env.setup` file. The setup
script also creates an ignored `.env` from `.env.example` when one is absent.
Set that file's `LLM_BASE_URL`, `LLM_MODEL`, and `LLM_API_KEY` for the target
machine before starting normal mode. If `.env` contains a reachable
`DATABASE_URL`, setup reuses it and applies the idempotent schema/seed files. If
not, it reuses a running local PostgreSQL service or installs PostgreSQL 16,
creates the application database, and writes its URL to `.env`.

## Backend (Python) — see `requirements.txt`
Core:
- `qiskit` + `qiskit-aer` — IBM framework + high-performance local simulator (default backend).
- `cirq` — Google framework (alternate local backend).
- `fastapi` + `uvicorn[standard]` — the API service.
- `psycopg` — PostgreSQL accounts, entitlements, and scheduled improvement jobs.
- `mcp` — Streamable HTTP MCP server and ChatGPT App resource.
- `pydantic>=2` — Circuit IR models + validation.
- `jsonschema` — validate the Circuit IR JSON.
- `PyYAML` — parse and emit versioned JSON/YAML 1StopQuantum manifests.
- `openai` — used purely as the **client for the local OpenAI-compatible LLM
  endpoint** (Ollama / LM Studio / llama.cpp). No OpenAI account needed.

Drug-discovery:
- `rdkit` — SMILES parsing, 2D depiction, QED, descriptors, structural alerts.
- `numpy`, `scipy` — math for the VQE-style illustrative routine.

Optional (stretch — annealing paradigm, still local):
- `dwave-neal` — classical simulated-annealing sampler with the D-Wave Ocean API
  shape, for the gate-based vs annealing teaching module (`docs/PROVIDERS.md`).

Testing:
- `pytest`, `pytest-asyncio`, `httpx` — CLI/backend evals.

Install:
```bash
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

## Frontend (Node) — see `package.json`
- A local static server hosts the Monaco-based workspace at
  `http://localhost:8080`.
- `monaco-editor`, D3, Three.js, esbuild, and TypeScript support the editor and
  interactive visualizations.
- **Playwright** (`@playwright/test`) for UI evals; `npx playwright install` once
  (this downloads browsers — the only step that needs internet; do it at setup time).

Install:
```bash
npm ci
npx playwright install
```

## Environment variables
Create `.env` (never commit it):
```
# --- Bootstrap LLM defaults (admin can change these in the app) ---
LLM_PROVIDER=local
LLM_BASE_URL=http://localhost:11434/v1   # ← the URL the owner provides
LLM_MODEL=qwen2.5-coder:14b              # whatever model is loaded locally
LLM_API_KEY=ollama                       # any non-empty string for most local servers

# --- Simulation ---
QLAB_BACKEND=qiskit                      # default backend (qiskit|cirq)

# --- Local platform services ---
DATABASE_URL=postgresql://quantumyog:generated-password@127.0.0.1:5432/quantumyog
PUBLIC_APP_URL=http://localhost:8080
QUANTUMYOG_ADMIN_EMAIL=admin@localhost.test
QUANTUMYOG_ADMIN_PASSWORD=generated-by-setup
LLM_SETTINGS_ENCRYPTION_KEY=generated-by-setup
```
The eval suite uses a **mock LLM** and needs no LLM server and no key.

`scripts/setup.sh` generates the admin password and Fernet encryption key in the
ignored `.env`. Use `http://localhost:8080/?admin=1` to select either the local
OpenAI-compatible endpoint or OpenAI. The saved provider key is encrypted in
PostgreSQL and is never returned to the browser. Public pages do not display LLM
health or configuration.
The generated admin password bootstraps a new database only. A dashboard password
change updates PostgreSQL, invalidates internal sessions, and is not reset from
`.env` when setup is rerun.

## Local Sumi voice APIs

Live Sumi voice is an optional Apple Silicon extra. Install it after the core
setup, then leave `VOICE_AUTOSTART=1` in `.env`:

```bash
./scripts/setup-local-voice.sh
./manage.sh start
curl -fsS http://127.0.0.1:5152/health
```

The managed local API exposes MLX Whisper at `POST /api/transcribe` and
`WS /api/duplex`, plus Kokoro at `POST /api/speak`. Both use port `5152`; no
second Kokoro service is required. The model files download and cache on the
first start or request. LLM reasoning remains a separate OpenAI-compatible API
selected with `LLM_BASE_URL`, `LLM_MODEL`, and `LLM_API_KEY`. Follow
[`LOCAL_AI_SETUP.md`](LOCAL_AI_SETUP.md) for Ollama, MLX-LM, llama.cpp, remote
LLM, request examples, and all three endpoint contracts.

Database provisioning also creates this local Scholar test account:

```text
Email: learner@1stopquantum.local
Password: LearnQuantum2026!
Recovery answer: superposition
```

Use **Use demo account** in the sign-in dialog to fill it. Learners who supplied
recovery details at signup can use **Forgot password?** to load the saved challenge
and set a new password. Recovery attempts are rate limited, answers are stored as
PBKDF2 hashes, and account API responses omit password and recovery secrets.

## Running (all local, or `make demo`)
```bash
# 0. local LLM (if using Ollama)
ollama serve                              # leaves the endpoint at :11434

# 1. backend
.venv/bin/python -m uvicorn app.main:app --reload --port 8000

# 2. optional individual services
.venv/bin/python -m app.mcp_server        # MCP at http://localhost:8001/mcp
npm run dev                               # IDE at http://localhost:8080

# or everything at once:
make demo                                 # starts API + MCP + frontend natively
```

For a detached local stack with lifecycle commands:

```bash
./manage.sh start
./manage.sh status
./manage.sh log --follow
./manage.sh restart
./manage.sh stop
```

`manage.sh` supervises the same API, MCP, and frontend started by `make demo`.
It writes its ignored PID and consolidated log to `.run/` and waits for API and
frontend health before reporting a successful start. Every start writes a new
`.run/build-id`. The frontend exposes that token through an uncached bootstrap
script, and the PWA worker deletes caches from earlier builds after activation.
After `./manage.sh restart`, a normal page reload is enough to receive the new UI.

When no local model server is available, judges can run:

```bash
make judge-demo
```

This preserves deterministic templates, known prompt fallbacks, manifests, both
simulators, docs, PostgreSQL signup, and improvement jobs. Free-form generation
remains unavailable and `/health` reports that honestly.

## ChatGPT and Custom GPT

ChatGPT cannot reach localhost directly. The MCP path requires an HTTPS route to
port 8001 and developer mode in ChatGPT. A Custom GPT Action instead imports
`integrations/custom-gpt-openapi.json` and targets an HTTPS route to port 8000.
See `CHATGPT_MCP.md` for exact connection steps and security limitations.

## Running the evals
```bash
make evals             # CLI (pytest) then UI (Playwright); exits non-zero on any failure
# or individually:
pytest evals/cli -q
npx playwright test evals/ui
```

## Declarative CLI

The setup script marks the repository-local CLI executable. Run it from the
project directory so it uses the project `.venv`:

```bash
./qyog --help
./qyog validate examples/bell.qyog.yaml
./qyog plan examples/bell.qyog.yaml
./qyog run examples/bell.qyog.yaml
```

`./qyog visualize` expects the browser workspace at `http://localhost:8080`; run
`make demo` first. `./qyog generate` additionally requires the configured LLM
provider. All other CLI commands work without an LLM server.

## Sanity checks after setup
```bash
curl localhost:8000/health          # backend and database status
open http://localhost:8080          # IDE loads in the browser
```

The LLM status is deliberately absent from public navigation. Administrators can
review the effective provider at `http://localhost:8080/?admin=1`.
