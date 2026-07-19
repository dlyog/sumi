# Architecture

## High-level picture

```
        ┌────────────────────────────── Browser ──────────────────────────────┐
        │  1StopQuantum browser workspace (Monaco editor)                       │
        │                                                                      │
        │  ┌── Concept palette ──┐  ┌── NL input box ──┐  ┌── Visual panels ──┐│
        │  │ H X Z CNOT … icons  │  │ "entangle 2 qb"  │  │ circuit diagram   ││
        │  │ drag → insert gate  │  │      ↓           │  │ Bloch sphere      ││
        │  └─────────────────────┘  └──────┬───────────┘  │ prob. histogram   ││
        │                                  │              └───────────────────┘│
        └──────────────────────────────────┼───────────────────────────────────┘
                                            │  HTTP (JSON)
                    ┌───────────────────────▼────────────────────────┐
                    │        1StopQuantum backend (FastAPI, Python)   │
                    │                                                 │
                    │  /nl2circuit ─► selected LLM ─► Circuit IR      │
                    │     (admin-managed local/OpenAI-compatible      │
                    │      settings; encrypted provider key)          │
                    │  /run         ─► compile IR ─► simulate         │
                    │                    │                            │
                    │        ┌───────────┴───────────┐                │
                    │        ▼                       ▼                │
                    │   Qiskit Aer            Cirq Simulator          │
                    │   (default backend)     (alternate backend)     │
                    │                                                 │
                    │  Drug-discovery: RDKit (SMILES) + VQE-style     │
                    │  illustrative circuit builder                   │
                    └─────────────────────────────────────────────────┘

    ChatGPT ── HTTPS ── MCP :8001 ── validated Circuit IR + widget resource
    Browser/API ─────────── FastAPI :8000 ── PostgreSQL users/jobs/reviews
                                               │
                                               ├── engagement/admin settings
                                               └── local scheduled worker

    Metriq Gym JSON ── importer ── attributed snapshot ── benchmark APIs
                                                     └── D3 landscape/forecast
```

## Components

### 1. Frontend — local Monaco browser workspace
- A local static server provides a URL for hackathon judges and students without
  requiring VS Code or Docker. Monaco supplies the structured manifest editor.
- The workspace renders circuit diagrams, Bloch spheres, state amplitudes,
  histograms, documentation, membership, and improvement review surfaces.
- The extension never simulates quantum math itself — it calls the backend and
  renders results. Keep it thin.

### 2. Backend — FastAPI service
- Owns all quantum execution. Stateless per request (circuit in → results out) so
  it scales trivially and is easy to test.
- Core circuit endpoints:
  - `POST /run` — body is a **Circuit IR** document; returns counts, statevector
    (for ≤ N qubits), and per-qubit Bloch coordinates.
  - `POST /nl2circuit` — body is `{ "text": "...", "backend": "qiskit" }`;
    returns a validated Circuit IR (and optionally the generated source for display).
  - `POST /nl2manifest` — translates natural language through the same simplifier
    and fidelity checks, then returns a portable 1StopQuantum manifest.
  - `POST /manifests/compile` — parses a JSON/YAML manifest, resolves templates,
    validates its Circuit IR, and returns simulation and generated source results.
  - `GET /health` — readiness probe used by the demo compose file and the UI evals.
  - `POST /accounts/signup` — creates a local educational account and entitlement.
  - `POST /analytics/events` and `POST /feedback` — record privacy-minimized page
    activity, helpful votes, and accuracy reports.
  - `/admin/*` — role-protected analytics and write-only-secret LLM settings.
  - `POST /improvements/jobs` — schedules or immediately runs a bounded review.
  - `POST /integrations/chatgpt/visualize` — Custom GPT Action-compatible result.
  - `GET /benchmarking/overview` — source provenance, coverage, devices, and
    normalized measured timeline.
  - `POST /benchmarking/recommend` — workload screening with independent fit and
    evidence-coverage scores.
  - `POST /benchmarking/forecast` — a comparable time series plus widening 95%
    exploratory interval.
  - `POST /benchmarking/claims/assess` — QBI-inspired evidence-gap review that is
    explicitly not an official DARPA assessment.
  - `GET /benchmarking/digest` — source-linked local feed for adapter jobs.

### 2a. Declarative interface
- `app/manifest.py` is the strict, versioned JSON/YAML boundary around Circuit IR.
- `app/cli.py` and the `qyog` launcher provide `init`, `fmt`, `validate`, `plan`,
  `compile`, `run`, `generate`, and `visualize` workflows without cloud services.
- Browser deep links carry the manifest in the URL fragment, so the document is
  not sent to another service before the local UI loads it.

### 3. Simulation backends (pluggable)
- **Qiskit Aer** — default. `statevector` and `qasm`/sampling simulators.
- **Cirq** — alternate, selectable per request, so students can compare the two
  frameworks (a nice teaching point: same IR, two vendors).
- Both are driven from the **Circuit IR** — see below.

### 3a. Benchmark intelligence
- `scripts/import_metriq.py` normalizes the sibling `metriq-data` Gym documents
  into `data/metriq/benchmark_snapshot.json`. The snapshot records its source Git
  revision and per-record source path; raw metric values are not changed.
- `app/benchmarking.py` reads only the bundled snapshot. Benchmark families keep
  their own direction and parameters because unlike metrics are not comparable.
- QPU Match ranks capacity and workload fit separately from public evidence
  coverage. Forecasting requires at least two comparable observations and labels
  every extrapolated point as inferred.
- The Claims + QBI flow mirrors the learning sequence of plausible concept,
  risk retirement, and independent verification. Its output identifies missing
  evidence; it does not certify a vendor or reproduce DARPA's evaluation.
- See `docs/BENCHMARK_INTELLIGENCE.md` and `docs/METRIQ_ATTRIBUTION.md`.

### 4. Drug-discovery subsystem
- RDKit parses SMILES → molecule → descriptors (QED drug-likeness, synthetic
  accessibility, simple toxicity proxy/alerts).
- An illustrative VQE-style circuit represents the binding-energy estimation so
  students see *how* a quantum routine would be structured. See
  `docs/DRUG_DISCOVERY.md`.

### 5. PostgreSQL and scheduler
- `database/schema.sql` creates plans, users, subscriptions, jobs, immutable
  review evidence, engagement, feedback, and encrypted LLM settings.
  `database/seed.sql` idempotently imports Explorer, Scholar, and Lab
  entitlements.
- A local worker polls due jobs every two seconds. Plan limits cap concurrent
  scheduled work and maximum review iterations.
- The optimizer applies deterministic proposals and accepts only strict metric
  improvement after statevector equivalence up to global phase. HTML reports live
  under `artifacts/improvements/`.
- Public signup cannot request the admin role. The ignored `.env` seeds one
  internal administrator, and bearer-token admin routes re-check that server-side
  role. The provider API key is encrypted at rest and never returned to clients.

### 6. ChatGPT integration
- `app/mcp_server.py` serves Streamable HTTP at `/mcp`, advertises the
  `visualize_quantum_circuit` tool, and supplies an MCP App HTML resource.
- ChatGPT requires an HTTPS route to the MCP service. The endpoint is intended for
  development until OAuth/authenticated proxying is added.
- `integrations/custom-gpt-openapi.json` is a separate OpenAPI Action surface; it
  returns structured data and a visualization link rather than an embedded widget.

## The Circuit IR (single source of truth)

Everything — natural language, hand-written code, both simulators, and the UI —
speaks one small JSON format. Define it once; validate every path against it.

```jsonc
{
  "version": "1.0",
  "num_qubits": 2,
  "gates": [
    { "op": "H",    "targets": [0] },
    { "op": "CNOT", "controls": [0], "targets": [1] },
    { "op": "RX",   "targets": [0], "params": [1.5708] },   // radians
    { "op": "measure", "targets": [0, 1], "classical": [0, 1] }
  ],
  "shots": 1024,
  "seed": 42          // optional; when present, results are deterministic
}
```

**Supported `op` values (minimum):**
`H, X, Y, Z, S, T, RX, RY, RZ, CNOT, CZ, SWAP, measure`.

**Rules:**
- `controls`/`targets` are qubit indices in `[0, num_qubits)`.
- Rotation gates require `params` (angles in radians).
- `measure` may specify `classical` bit indices; default to matching `targets`.
- A JSON Schema for this IR lives with the backend and is the validation gate for
  both `/run` and `/nl2circuit`. Invalid IR is a 422 with a human-readable reason.

## Data flow for a natural-language request

1. UI sends `{ text, backend }` to `/nl2circuit`.
2. Backend prompts the **admin-selected LLM** (see `docs/NL_TO_GATE.md`)
   to emit **Circuit IR only** — or a `{template, params}` object for
   algorithm-level requests (GHZ, Grover, Deutsch–Jozsa, QRNG), which the backend
   expands to IR from a deterministic template registry.
3. Backend validates the IR against the schema; if invalid, it runs one repair
   attempt (feeds the validation error back to the LLM), else returns 422.
4. Valid IR is compiled to the chosen backend and simulated.
5. Response bundles: the IR, counts, statevector (if small), Bloch coords, and the
   equivalent Qiskit/Cirq source (so the lesson can show "here's the code we ran").

## LLM layer (local-first)
- Bootstrap settings come from `LLM_BASE_URL`, `LLM_MODEL`, and `LLM_API_KEY`.
  An internal administrator can save a local OpenAI-compatible endpoint or the
  OpenAI API as the effective configuration in PostgreSQL.
- The provider API key is encrypted with the deployment Fernet key. It is
  decrypted only inside the API/MCP process and never returned to the browser.
- Local is the default zero-internet path. Selecting OpenAI explicitly changes
  the data boundary for circuit prompts; the admin UI states that consequence.

## Provider abstraction (future-proofing, see `docs/PROVIDERS.md`)
- The `run(ir, backend=...)` dispatcher is the seam where real hardware providers
  would later plug in: `qiskit` → could target IBM QPUs, `ionq` → Qiskit-IonQ
  provider, `dwave` → Ocean/Leap. Locally, `qiskit`/`cirq` map to simulators and
  an optional `anneal` backend maps to `dwave-neal` (classical simulated
  annealing) for the gate-vs-annealing lesson.

## Non-goals
- No real-QPU submission in this build (the abstraction exists; the network calls
  do not). No cloud LLM in the default path unless an admin selects one.
- No payment processing or card data. Subscriptions are local educational
  entitlements only.
- No general code self-modification. Improvement jobs may alter only submitted
  Circuit IR under deterministic equivalence and iteration guards.
- No claim of real quantum speedup — this is a classical simulator.
- No official DARPA/QBI determination, investment advice, procurement decision,
  or cross-family benchmark league table.
