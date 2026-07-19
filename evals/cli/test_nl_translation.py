"""
CLI evals — natural-language -> circuit, and drug-discovery scoring.

Uses a MOCK LLM so CI needs no network and no API key. The mock returns canned IR
for known prompts and deliberately-broken JSON for the repair test.

Assumptions about the code under test (adjust to your layout):
  - `app.nl2circuit` exposes `translate(text: str, llm) -> dict` returning validated
    Circuit IR, or raising `NotACircuitError` / `IRValidationError`.
  - `translate` performs exactly ONE repair attempt on invalid JSON (feeding the
    validation error back to `llm`), then raises.
  - `app.drug` exposes `score_molecule(smiles: str) -> dict` with keys at least:
    {"valid", "qed", "sa_score", "tox_alerts", "lipinski_pass"} and
    `score_molecule` is deterministic.
"""

import json
import math
import pytest

from app.nl2circuit import translate, NotACircuitError, IRValidationError  # adjust
from app.drug import score_molecule                                        # adjust


# ---------- a tiny mock LLM ----------

class MockLLM:
    """Returns queued responses in order. Each .complete() call pops the next one."""
    def __init__(self, responses):
        self._responses = list(responses)

    def complete(self, system: str, user: str) -> str:
        return self._responses.pop(0)


def bell_ir_json():
    return json.dumps({
        "version": "1.0", "num_qubits": 2,
        "gates": [
            {"op": "H", "targets": [0]},
            {"op": "CNOT", "controls": [0], "targets": [1]},
            {"op": "measure", "targets": [0, 1]},
        ],
        "shots": 1024,
    })


# ---------- happy paths ----------

def test_superposition_prompt_produces_h_and_measure():
    ir_json = json.dumps({
        "version": "1.0", "num_qubits": 1,
        "gates": [{"op": "H", "targets": [0]}, {"op": "measure", "targets": [0]}],
        "shots": 1024,
    })
    llm = MockLLM([ir_json])
    ir = translate("Put a qubit in superposition and measure it.", llm)
    ops = [g["op"] for g in ir["gates"]]
    assert ops == ["H", "measure"]
    assert ir["num_qubits"] == 1


def test_entangle_prompt_produces_bell_pair():
    llm = MockLLM([bell_ir_json()])
    ir = translate("Entangle two qubits and measure them.", llm)
    ops = [g["op"] for g in ir["gates"]]
    assert ops[:2] == ["H", "CNOT"]
    assert ir["num_qubits"] == 2


def test_degrees_to_radians_within_tolerance():
    ir_json = json.dumps({
        "version": "1.0", "num_qubits": 1,
        "gates": [{"op": "RX", "targets": [0], "params": [1.5708]},
                  {"op": "measure", "targets": [0]}],
        "shots": 1024,
    })
    llm = MockLLM([ir_json])
    ir = translate("Rotate qubit 0 by 90 degrees around X, then measure.", llm)
    angle = ir["gates"][0]["params"][0]
    assert abs(angle - math.pi / 2) < 1e-2


# ---------- markdown-fence stripping ----------

def test_fenced_json_is_still_parsed():
    fenced = "```json\n" + bell_ir_json() + "\n```"
    llm = MockLLM([fenced])
    ir = translate("Entangle two qubits and measure them.", llm)
    assert ir["num_qubits"] == 2


# ---------- repair path ----------

def test_invalid_json_triggers_one_repair_then_succeeds():
    broken = '{ "version": "1.0", "num_qubits": 2, "gates": [ {"op": "H" '  # truncated
    llm = MockLLM([broken, bell_ir_json()])  # first invalid, repair returns valid
    ir = translate("Entangle two qubits and measure them.", llm)
    assert ir["num_qubits"] == 2  # repair succeeded on the second attempt


def test_invalid_twice_raises_validation_error():
    broken = '{ not valid json at all'
    llm = MockLLM([broken, broken])  # both attempts invalid
    with pytest.raises(IRValidationError):
        translate("Entangle two qubits and measure them.", llm)


# ---------- non-circuit rejection ----------

def test_non_circuit_request_is_rejected():
    llm = MockLLM([json.dumps({"error": "not a circuit request"})])
    with pytest.raises(NotACircuitError):
        translate("What's the weather today?", llm)


# ---------- drug-discovery scoring ----------

def test_valid_smiles_scores_and_is_deterministic():
    aspirin = "CC(=O)OC1=CC=CC=C1C(=O)O"
    a = score_molecule(aspirin)
    b = score_molecule(aspirin)
    assert a["valid"] is True
    assert a == b  # deterministic
    assert 0.0 <= a["qed"] <= 1.0
    assert "tox_alerts" in a and a["tox_alerts"] >= 0


def test_invalid_smiles_flagged_not_crashed():
    res = score_molecule("this-is-not-smiles")
    assert res["valid"] is False  # graceful failure, no exception
