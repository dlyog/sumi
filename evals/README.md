# Test suites

The repository test gate is split into two tiers so development fails fast:

- `cli/` — **fast, headless correctness** (pytest). Quantum core + NL translation +
  drug-discovery scoring. No browser, no network (LLM is mocked). Run these on every
  change.
- `ui/` — **slow, end-to-end** (Playwright). Verifies the editor, the NL box, the
  visual panels, and the drug-discovery view in a real browser. Run after CLI is green.

Run the complete gate with:

```bash
make evals
```

`make evals` must exit **0** only when everything passes. That exit code is the
release signal for the local application.

## Test rules

- Fix product code when behavior regresses; update tests only for an intentional
  contract or repository-layout change.
- Tests are deterministic: the simulator is seeded and the LLM is mocked in CI.
- Keep CLI tests fast enough to run on every change.

## What each file covers
- `cli/test_quantum_core.py` — Circuit IR validation, gate correctness, the Bell
  state, deterministic seeded distributions, both backends (Qiskit + Cirq) agree.
- `cli/test_nl_translation.py` — NL→IR with a mock LLM: valid cases produce correct
  IR, invalid JSON triggers exactly one repair then a clean 422, non-circuit
  requests are rejected, degrees→radians handled, drug-discovery scoring is stable.
- `ui/editor.spec.ts` — the browser flow: NL box → circuit runs → histogram +
  Bloch render; palette icons present with labels; backend switch works; the
  drug-discovery view loads a SMILES and shows the scorecard with the
  "not for clinical use" banner.

## Note on real-LLM smoke tests
Keep an optional, separately-tagged smoke test that hits the **local LLM** at
`LLM_BASE_URL` (guarded by an env flag, e.g. `QLAB_LIVE_LLM=1`) for pre-demo
sanity: it should confirm the endpoint answers and that a Bell-pair prompt yields
valid IR after at most one repair. It must **not** run in the default `make evals`
gate, so the loop never depends on a running model server. The mock-LLM tests are
the contract; the smoke test is a convenience.
