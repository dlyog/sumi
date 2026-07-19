# Repository Guidelines

## Project Structure & Module Organization

`app/` contains the FastAPI backend, Circuit IR, Qiskit/Cirq engines, PostgreSQL persistence, MCP server, and optional local voice service. `public/` is the browser application and committed media; reusable Sumi files use the `sumi-*` prefix. PostgreSQL schema and seed data live in `database/`. Keep runnable utilities in `scripts/`, manifests in `examples/`, product documentation in `docs/`, backend tests in `tests/` and `evals/cli/`, and Playwright tests in `evals/ui/`.

Do not rename compatibility identifiers such as `quantumyog.dev/v1`, `qyog`, or existing database objects without a migration.

## Build, Test, and Development Commands

- `./setup.sh` — bootstrap an Apple-silicon Mac, install dependencies, provision or reuse PostgreSQL, and build browser assets.
- `./manage.sh start|status|log|restart|stop` — operate the detached local stack.
- `ALLOW_LLM_UNAVAILABLE=1 ./manage.sh start` — run deterministic classroom/hackathon mode without an LLM.
- `npm run build` — syntax-check JavaScript and rebuild `public/tutorial-viz.bundle.js`.
- `make evals-cli` — run Python API, simulator, CLI, and distribution tests.
- `make evals-ui` — run Playwright browser tests.
- `make evals` — run the complete release gate.

## Coding Style & Naming Conventions

Use four spaces and type hints in Python; use two spaces and semicolons in browser JavaScript. Keep endpoint handlers thin and place reusable behavior in focused modules. Use `snake_case` for Python, `camelCase` for JavaScript, and `kebab-case` for static filenames and Sumi action IDs. Run `npm run build` before committing frontend changes. Never hardcode credentials, model names, or host-specific URLs; use `.env` and update `.env.example` when adding configuration.

## Testing Guidelines

Pytest covers backend behavior; Playwright covers real browser workflows. Name Python tests `test_<behavior>` and UI files `<feature>.spec.ts`. Add regression coverage for bug fixes, seed simulations, mock the default LLM path, and test both success and failure boundaries. Do not report a change complete until relevant tests pass.

## Commit & Pull Request Guidelines

Use short imperative subjects such as `Add reusable Sumi screen adapter`. Keep commits focused. Pull requests should explain purpose, architecture or schema effects, verification commands, and configuration changes. Link issues and include screenshots or recordings for visible UI changes. Never commit `.env`, local databases, logs, caches, generated reports, or backup dumps.
