# 1StopQuantum developer entry points.

.PHONY: install db evals evals-cli evals-ui demo judge-demo backend mcp frontend course-audio course-images voice-local

PYTHON ?= .venv/bin/python
NPM ?= $(shell if [ -f .env.setup ]; then . ./.env.setup && printf '%s' "$$NPM_BIN"; else command -v npm; fi)
NODE_DIR ?= $(shell if [ -f .env.setup ]; then . ./.env.setup && dirname "$$NODE_BIN"; else dirname "$$(command -v node 2>/dev/null || printf /usr/bin/node)"; fi)

install:
	./setup.sh

db:
	./scripts/setup-postgres.sh

# Fast gate first (headless correctness), then the slow browser gate.
evals: evals-cli evals-ui

evals-cli:
	$(PYTHON) -m pytest evals/cli tests -q

evals-ui:
	./scripts/run-ui-evals.sh

# Individual services (for local dev).
backend:
	$(PYTHON) -m uvicorn app.main:app --reload --port 8000

mcp:
	$(PYTHON) -m app.mcp_server

frontend:
	PATH="$(NODE_DIR):$$PATH" $(NPM) run dev

# Optional authoring services. Generated lesson media is committed under public/,
# so neither Kokoro nor ComfyUI is required to run the learning platform.
course-audio:
	$(PYTHON) scripts/generate_course_audio.py

course-images:
	$(PYTHON) scripts/generate_course_images.py --force

voice-local:
	bash scripts/setup-local-voice.sh

# One command for a local demo on the Mac: start backend + frontend as native
# processes (no Docker). Probe the local LLM first and print an actionable error
# if LLM_BASE_URL is unreachable (e.g. "start Ollama: ollama serve").
demo:
	./scripts/demo.sh

# Starts the complete UI/API/MCP stack without requiring a model server. Known
# prompts use deterministic templates; free-form NL generation reports unavailable.
judge-demo:
	ALLOW_LLM_UNAVAILABLE=1 ./scripts/demo.sh
