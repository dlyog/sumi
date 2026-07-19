"""
CLI evals — quantum core correctness.

These are the fast, headless gate for the autonomous build loop. They pin down the
Circuit IR contract and the simulation behavior. The agent must make these pass
WITHOUT weakening them.

Assumptions about the code under test (adjust import paths to your layout):
  - `app.ir` exposes `validate_ir(dict) -> None` (raises on invalid) and a schema.
  - `app.engine` exposes `run(ir: dict, backend: str = "qiskit") -> Result` where
    Result has `.counts` (dict outcome->int) and optionally `.statevector`,
    `.bloch` (per-qubit coords).

If your names differ, keep the *behaviors* asserted here identical.
"""

import math
import pytest

from app.ir import validate_ir            # noqa: E402  (adjust path if needed)
from app.engine import run                # noqa: E402


# ---------- Circuit IR validation ----------

def test_valid_bell_ir_passes_validation():
    ir = {
        "version": "1.0",
        "num_qubits": 2,
        "gates": [
            {"op": "H", "targets": [0]},
            {"op": "CNOT", "controls": [0], "targets": [1]},
            {"op": "measure", "targets": [0, 1]},
        ],
        "shots": 1024,
        "seed": 42,
    }
    validate_ir(ir)  # should not raise


@pytest.mark.parametrize("bad_ir", [
    {"version": "1.0", "num_qubits": 1, "gates": [{"op": "H", "targets": [5]}]},   # index out of range
    {"version": "1.0", "num_qubits": 1, "gates": [{"op": "NOTAGATE", "targets": [0]}]},  # unknown op
    {"version": "1.0", "num_qubits": 1, "gates": [{"op": "RX", "targets": [0]}]},  # rotation without params
    {"version": "1.0", "num_qubits": 2, "gates": [{"op": "CNOT", "targets": [1]}]},  # CNOT without control
])
def test_invalid_ir_rejected(bad_ir):
    with pytest.raises(Exception):
        validate_ir(bad_ir)


# ---------- Gate correctness ----------

def test_x_gate_flips_zero_to_one():
    ir = {"version": "1.0", "num_qubits": 1,
          "gates": [{"op": "X", "targets": [0]}, {"op": "measure", "targets": [0]}],
          "shots": 512, "seed": 7}
    res = run(ir, backend="qiskit")
    # With X then measure, every shot is "1".
    assert set(res.counts.keys()) == {"1"}


def test_hadamard_is_roughly_balanced():
    ir = {"version": "1.0", "num_qubits": 1,
          "gates": [{"op": "H", "targets": [0]}, {"op": "measure", "targets": [0]}],
          "shots": 4000, "seed": 7}
    res = run(ir, backend="qiskit")
    p0 = res.counts.get("0", 0) / 4000
    assert abs(p0 - 0.5) < 0.05  # ~50/50 within statistical tolerance


def test_bell_state_only_correlated_outcomes():
    ir = {"version": "1.0", "num_qubits": 2,
          "gates": [
              {"op": "H", "targets": [0]},
              {"op": "CNOT", "controls": [0], "targets": [1]},
              {"op": "measure", "targets": [0, 1]},
          ],
          "shots": 4000, "seed": 7}
    res = run(ir, backend="qiskit")
    outcomes = set(res.counts.keys())
    # A Bell pair yields only "00" and "11" — never "01" or "10".
    assert outcomes.issubset({"00", "11"})
    assert "00" in outcomes and "11" in outcomes


# ---------- Determinism ----------

def test_seed_makes_results_deterministic():
    ir = {"version": "1.0", "num_qubits": 2,
          "gates": [
              {"op": "H", "targets": [0]},
              {"op": "CNOT", "controls": [0], "targets": [1]},
              {"op": "measure", "targets": [0, 1]},
          ],
          "shots": 1000, "seed": 123}
    a = run(ir, backend="qiskit").counts
    b = run(ir, backend="qiskit").counts
    assert a == b  # same seed -> identical counts


# ---------- Rotation semantics ----------

def test_rx_pi_flips_qubit():
    ir = {"version": "1.0", "num_qubits": 1,
          "gates": [{"op": "RX", "targets": [0], "params": [math.pi]},
                    {"op": "measure", "targets": [0]}],
          "shots": 512, "seed": 7}
    res = run(ir, backend="qiskit")
    # RX(pi) ~ X up to global phase: measures "1".
    assert set(res.counts.keys()) == {"1"}


# ---------- Backend agreement (Qiskit vs Cirq) ----------

def test_qiskit_and_cirq_agree_on_bell_support():
    ir = {"version": "1.0", "num_qubits": 2,
          "gates": [
              {"op": "H", "targets": [0]},
              {"op": "CNOT", "controls": [0], "targets": [1]},
              {"op": "measure", "targets": [0, 1]},
          ],
          "shots": 4000, "seed": 7}
    q = set(run(ir, backend="qiskit").counts.keys())
    c = set(run(ir, backend="cirq").counts.keys())
    # Both frameworks compiled from the same IR must produce the same outcome support.
    assert q.issubset({"00", "11"}) and c.issubset({"00", "11"})
