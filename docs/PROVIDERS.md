# Providers — Gate-Based vs Annealing, and Future Hardware Hooks

This document turns the strategic research (Qiskit vs Cirq, IonQ, D-Wave) into a
concrete, **local-only** design. Nothing here requires a network at runtime.

## Implemented local boundary

- `GET /providers` returns the provider/paradigm catalog used by the Provider Lab.
- `POST /run` dispatches Circuit IR to real Qiskit or Cirq statevector adapters.
- `POST /anneal` validates QUBO IR and executes it with `dwave-neal` locally.
- IonQ is cataloged as `planned`; there is no API-key input or real-QPU submission.
- The browser Provider Lab includes a deterministic triangle max-cut lesson.

## The two paradigms (teaching point and architectural seam)

| | Gate-based (IBM/Google/IonQ) | Annealing (D-Wave) |
|---|---|---|
| Model | Circuit of gates (H, CNOT, …) — universal | Energy landscape (Ising/QUBO) — optimization-specialized |
| Our IR | **Circuit IR** (`docs/ARCHITECTURE.md`) | **QUBO IR** (below) |
| Local execution | Qiskit Aer / Cirq simulator | `dwave-neal` simulated-annealing sampler |
| Future hardware | IBM Quantum, IonQ (via `qiskit-ionq`) | D-Wave Leap |

Key facts worth teaching in the UI (from the research):
- IonQ is a **hardware** provider, not a framework — you write in Qiskit/Cirq and
  submit to IonQ. Trapped ions give all-to-all connectivity and long coherence but
  slower gates; superconducting (IBM/Google) gives fast gates and scale but
  nearest-neighbor connectivity.
- D-Wave is not gate-based at all; it solves optimization problems expressed as
  QUBO/Ising models.

## QUBO IR (minimal, for the annealing lesson)

```jsonc
{
  "version": "1.0",
  "kind": "qubo",
  "variables": ["x0", "x1", "x2"],
  "linear":    { "x0": -1.0, "x1": -1.0, "x2": -1.0 },
  "quadratic": { "x0,x1": 2.0, "x1,x2": 2.0 },
  "num_reads": 100,
  "seed": 42
}
```

Validated by its own JSON Schema. Executed locally with `neal.SimulatedAnnealingSampler`
(deterministic when seeded). Results: list of samples with energies + a best-sample
highlight.

## Future NL intent router

Extend `/nl2circuit` (or add `/nl2solution`) with an intent-classification first
step in the LLM system prompt:

```
First decide the problem kind:
- "circuit"   → gate-level or algorithm-template request → emit Circuit IR
                (or {"template": ..., "params": ...}).
- "optimize"  → an optimization problem (routing, scheduling, max-cut, knapsack)
                → emit QUBO IR.
- otherwise   → {"error": "not a quantum request"}.
```

The backend dispatches: Circuit IR → Aer/Cirq simulator; QUBO IR → neal sampler.
The UI shows *which paradigm was chosen and why* — that explanation is the lesson.

## Future real-hardware hooks (documented, NOT built)

Keep `run(ir, backend=...)` as the single dispatch seam. Later, adding hardware is
additive:

- `backend="ionq"` → `qiskit-ionq` provider, `IONQ_API_KEY` env, submit the same
  Circuit IR compiled through Qiskit.
- `backend="ibm"` → `qiskit-ibm-runtime`.
- `backend="dwave"` → `dwave-system` / Leap, `DWAVE_API_TOKEN` env, submit the same
  QUBO IR.

Rules if/when these land:
- Keys from env only; feature-flagged off by default; the local simulators remain
  the default and the eval gate never touches the network.
- The UI must label results as **real hardware** vs **simulated** unmistakably.

## Provider regression coverage

- `tests/test_templates_providers.py` verifies the seeded 3-variable max-cut
  optimum and keeps IonQ marked as planned rather than locally available.
- NL optimization routing is still future work. Circuit NL requests continue to
  use Circuit IR; the explicit `/anneal` endpoint accepts QUBO IR.
