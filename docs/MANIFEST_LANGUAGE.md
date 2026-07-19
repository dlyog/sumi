# 1StopQuantum Manifest Language

The 1StopQuantum Manifest is a versioned declarative language for circuit lessons.
It can be written as JSON or YAML. Both formats decode to the same object and
compile to the existing validated Circuit IR, so the CLI, API, configured LLM, Qiskit,
Cirq, and browser visualizations share one semantic contract.

## Minimal YAML

```yaml
apiVersion: quantumyog.dev/v1
kind: Circuit
metadata:
  name: bell-state
spec:
  backend: qiskit
  circuit:
    version: "1.0"
    num_qubits: 2
    gates:
      - op: H
        targets: [0]
      - op: CNOT
        controls: [0]
        targets: [1]
      - op: measure
        targets: [0, 1]
    shots: 1024
    seed: 42
```

## Equivalent JSON

```json
{
  "apiVersion": "quantumyog.dev/v1",
  "kind": "Circuit",
  "metadata": {"name": "bell-state"},
  "spec": {
    "backend": "qiskit",
    "circuit": {
      "version": "1.0",
      "num_qubits": 2,
      "gates": [
        {"op": "H", "targets": [0]},
        {"op": "CNOT", "controls": [0], "targets": [1]},
        {"op": "measure", "targets": [0, 1]}
      ],
      "shots": 1024,
      "seed": 42
    }
  }
}
```

## Document fields

| Field | Required | Meaning |
|---|---:|---|
| `apiVersion` | yes | Must be `quantumyog.dev/v1`. |
| `kind` | yes | Must be `Circuit`. |
| `metadata.name` | yes | Lowercase DNS-style name, up to 63 characters. |
| `metadata.description` | no | Human-readable lesson description. |
| `metadata.sourcePrompt` | no | Natural-language prompt that generated the artifact. |
| `spec.backend` | no | `qiskit` (default) or `cirq`. |
| `spec.circuit` | exclusive | Full Circuit IR. |
| `spec.template` | exclusive | Deterministic template and parameters. |

Unknown top-level, metadata, spec, and template fields are rejected. A spec must
contain exactly one of `circuit` or `template`.

## Circuit form

`spec.circuit` uses Circuit IR version `1.0`:

- `num_qubits`: positive integer.
- `gates`: ordered list of gate objects.
- `shots`: positive sample count, default 1024.
- `seed`: optional non-negative deterministic seed.

Supported operations are `H`, `X`, `Y`, `Z`, `S`, `T`, `RX`, `RY`, `RZ`,
`CNOT`, `CZ`, `SWAP`, and `measure`. Qubit indices are zero based. Rotations use
one angle in radians. Controlled gates use one `controls` entry and one `targets`
entry.

## Template form

Templates keep common algorithms concise while expansion remains deterministic:

```yaml
apiVersion: quantumyog.dev/v1
kind: Circuit
metadata:
  name: ghz-lesson
spec:
  backend: cirq
  template:
    name: ghz
    parameters:
      qubits: 3
      shots: 512
      seed: 42
```

Allowed names are `ghz`, `grover`, `deutsch_jozsa`, and `qrng`. The template is
expanded and validated before planning, compilation, execution, or visualization.

## Compilation pipeline

```text
natural language
      |
      v
configured LLM -> Circuit IR -> schema repair -> simplifier -> fidelity retry
      |                                                |
      +--------------- 1StopQuantum Manifest <--------+
                               |
             +-----------------+-----------------+
             |                 |                 |
          validate           compile            run
             |          Qiskit / Cirq Python      |
             +-----------------+-----------------+
                               |
                           visualize
```

The LLM never emits executable Python. It proposes structured Circuit IR, and the
application wraps the validated final result in a manifest. Every later phase is
deterministic code.

## CLI lifecycle

```bash
./qyog init lesson
./qyog fmt lesson/main.qyog.yaml
./qyog validate lesson/main.qyog.yaml
./qyog plan lesson/main.qyog.yaml
./qyog compile lesson/main.qyog.yaml --target cirq --output lesson.py
./qyog run lesson/main.qyog.yaml --json
./qyog visualize lesson/main.qyog.yaml
```

- `fmt` parses, validates, and writes canonical YAML or JSON.
- `validate` performs no simulation.
- `plan` reports backend, qubits, operations, and simplification changes.
- `compile` generates readable Qiskit or Cirq Python without executing it.
- `run` uses the selected local statevector simulator and seeded sampling.
- `visualize` opens the same manifest in the browser through a URL fragment.
- `generate` calls the configured LLM and writes a reviewed manifest as the
  output artifact.

## API

- `POST /manifests/compile` accepts `{ "document": "<YAML or JSON>" }` and
  returns normalized manifest, final IR, simulation, source, and visualization
  data.
- `POST /nl2manifest` accepts natural-language `text`, optional manifest `name`,
  and `backend`; it returns the same payload plus fidelity metadata.

Invalid documents return HTTP 422 and are never sent to a simulator.

## Versioning

`quantumyog.dev/v1` is the language compatibility boundary. New optional fields
may be introduced only when older readers can reject or ignore them explicitly.
Breaking field or semantic changes require a new `apiVersion`.
