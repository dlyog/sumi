# Natural Language → Quantum Circuit

This is the accessibility feature: a user (possibly non-technical) types plain
English, and the system produces a runnable circuit. The trick that makes it
reliable is: **the LLM emits the Circuit IR JSON, not free-form code.** Structured
output is validatable; free-form code is not.

## Pipeline

```
user text ──► configured LLM (structured output: Circuit IR JSON)
                   │
                   ▼
         validate against IR JSON Schema
             │            │
          valid        invalid
             │            │
             │      one repair attempt (feed the schema error back to the LLM)
             │            │
             ▼            ▼ (still invalid)
    deterministic      return 422 with a friendly explanation
   peephole simplify
             │
             ▼
  fidelity check against requested qubit count
       │                         │
    matches                   mismatch
       │                 one semantic retry
       │                         │
       └──────────────┬──────────┘
                      ▼
       compile & run final IR (warning if retry still mismatches)
                      │
                      ▼
 results + interpretation + generated Qiskit/Cirq source
```

## Deterministic simplification and fidelity

Every validated IR is simplified before execution, including circuits created by
the LLM, templates, the drag palette, and direct `/run` calls. The peephole pass:

- cancels adjacent identical self-inverse pairs `H`, `X`, `Y`, `Z`, `CNOT`, and
  `SWAP` when they act on the same qubits with no intervening operation;
- merges adjacent `RX`, `RY`, or `RZ` gates on the same qubit by adding angles;
- removes a merged rotation when its angle is approximately zero modulo `2*pi`.

The UI reports `simplified: N ops removed` when the pass changes the circuit.

After simplification, cheap text signals provide a semantic guard beyond JSON
schema validity. Phrases such as "one qubit", "two qubits", or "3-qubit" are
compared with `num_qubits`; a single-qubit request is also rejected if an
entangling gate remains. A mismatch triggers exactly one semantic retry whose
repair prompt contains the expected and actual circuit shape. If that result still
does not match, it is rendered for inspection with a visible warning instead of
being silently presented as correct.

The one-line `Built:` interpretation is generated from this final IR, never copied
from model prose. The final IR is also wrapped as a versioned
`quantumyog.dev/v1` JSON/YAML manifest. That manifest, rather than generated
Python, is the portable output used by the browser and `qyog` CLI. See
`MANIFEST_LANGUAGE.md`.

## LLM system prompt (use verbatim as a starting point)

```
You translate natural-language descriptions of quantum circuits into a strict JSON
"Circuit IR". Output ONLY the JSON object — no prose, no markdown fences.

Schema:
{
  "version": "1.0",
  "num_qubits": <int>,
  "gates": [ { "op": <string>, "targets": [<int>...],
              "controls": [<int>...]?, "params": [<float>...]? }, ... ],
  "shots": <int, default 1024>,
  "seed": <int, optional>
}

Allowed op values: H, X, Y, Z, S, T, RX, RY, RZ, CNOT, CZ, SWAP, measure.
Rules:
- Qubit indices are 0-based and < num_qubits.
- RX/RY/RZ require params as a single angle in radians.
- CNOT/CZ require exactly one control and one target.
- Always end with a measure gate over all qubits unless the user says otherwise.
- If the request is ambiguous, choose the simplest circuit that satisfies it.
- If the request is not a quantum-circuit request, return
  {"error": "not a circuit request"} and nothing else.
```

## User-message examples the pipeline must handle (used in evals)

| Natural language | Expected structure (essentials) |
|---|---|
| "Put a qubit in superposition and measure it." | 1 qubit: `H` on 0, `measure`. |
| "Entangle two qubits and measure them." (Bell pair) | 2 qubits: `H` on 0, `CNOT 0→1`, `measure`. |
| "Flip a qubit, then measure." | 1 qubit: `X` on 0, `measure`. |
| "Rotate qubit 0 by 90 degrees around X, then measure." | `RX` param ≈ 1.5708 on 0, `measure`. |
| "Swap qubit 0 and 1." | `SWAP 0,1`, `measure`. |
| "What's the weather?" | `{"error": "not a circuit request"}`. |

Degrees→radians conversion is the model's job per the prompt; evals allow a small
tolerance on angles.

## Beyond single circuits: algorithm design (NL → named algorithm)

The same pipeline should recognize *algorithm-level* requests and expand them into
IR using built-in templates (deterministic, no LLM math required):

| Natural language | Behavior |
|---|---|
| "Build a 3-qubit GHZ state." | Template: `H` on 0, `CNOT 0→1`, `CNOT 0→2`, `measure`. |
| "Run Deutsch–Jozsa on 2 qubits with a constant oracle." | Template expansion. |
| "Grover search for \|11⟩ on 2 qubits." | Template: superposition + oracle + diffusion + measure. |
| "Make a quantum random number generator." | `H` on each qubit + `measure`. |

Implement these as a small `templates.py` registry. The LLM's job is to pick the
template and fill parameters (qubit count, marked state, oracle type) — emitted as
`{"template": "grover", "params": {...}}` — and the backend expands it to IR. This
keeps correctness in code, not in the model.

The equivalent CLI path is:

```bash
./qyog generate "Build a 3-qubit GHZ state" --name ghz-lesson -o ghz.qyog.yaml
./qyog validate ghz.qyog.yaml
./qyog plan ghz.qyog.yaml
./qyog visualize ghz.qyog.yaml
```


## Provider configuration (LOCAL-FIRST — no cloud required)

The primary and default LLM provider is a **local model served on your Mac** behind
an OpenAI-compatible HTTP endpoint (Ollama, LM Studio, llama.cpp server, vLLM, and
MLX-LM all expose one). The owner will supply the URL; never hardcode it.

Bootstrap via environment variables, then review the effective provider in the
internal `/?admin=1` dashboard:

```
LLM_PROVIDER=local                          # default; admin choices are local | openai
LLM_BASE_URL=http://localhost:11434/v1      # ← owner-provided local LLM URL (Ollama default shown)
LLM_MODEL=qwen2.5-coder:14b                 # whatever model is loaded locally
LLM_API_KEY=ollama                          # most local servers accept any non-empty string
```

The admin API persists provider, URL, model, and encrypted key in PostgreSQL.
Public users cannot see or change these values. Selecting OpenAI sends circuit
prompts to that external service; local simulation and saved course media remain
on the installation.

Common local endpoints (for reference):
- **Ollama**: `http://localhost:11434/v1`
- **LM Studio**: `http://localhost:1234/v1`
- **llama.cpp server / MLX**: as configured — avoid `:8080` (the IDE uses it); e.g. `http://localhost:8081/v1`

### Implementation
- Use the `openai` Python SDK pointed at `LLM_BASE_URL` — it speaks the
  OpenAI-compatible protocol that all of the local servers above implement:

```python
from openai import OpenAI
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ.get("LLM_API_KEY", "local"))

def complete(system: str, user: str) -> str:
    resp = client.chat.completions.create(
        model=os.environ["LLM_MODEL"],
        temperature=0,                       # determinism helps structured output
        messages=[{"role": "system", "content": system},
                  {"role": "user", "content": user}],
    )
    return resp.choices[0].message.content
```

- Keep the provider behind the thin interface `llm.complete(system, user) -> str`
  so a cloud provider (Anthropic/OpenAI) can be swapped in with one env change —
  but the default path must work fully offline.
- Fail fast at startup with a clear message if `LLM_BASE_URL` is unreachable
  (probe it in `GET /health` and report `llm: ok|unreachable`).

### Local-model robustness notes (important)
Local models (7B–14B class) are less reliable at strict JSON than frontier cloud
models. Compensate in the pipeline, not the prompt alone:
- Set `temperature=0`.
- If the server supports JSON mode / grammar constraints (Ollama `format: json`,
  llama.cpp grammars), enable it — but still validate; never trust it blindly.
- Strip markdown fences and any leading/trailing prose before parsing.
- Keep the single automatic repair attempt (schema error fed back verbatim).
- Run simplification and the single semantic-fidelity retry after schema repair.
- If repair fails, return 422 with a friendly message suggesting a rephrase.

### Optional cloud fallback (off by default)
`LLM_PROVIDER=anthropic` or `openai` with the matching API key env var enables a
cloud model for demos where a bigger model is wanted. Never required; never in CI.

## Robustness requirements (evaluated)
- Strip accidental markdown fences before parsing.
- Validate against the IR JSON Schema; never execute unvalidated IR.
- Exactly one automatic repair attempt on invalid JSON, then a clean 422.
- One semantic retry when requested and generated qubit counts differ; if it still
  differs, return the final circuit with a warning flag.
- Deterministic tests: the eval suite injects a **mock LLM** so CI needs no network
  and no API key. A real provider is only used in the live demo.
