import json
import math

from fastapi.testclient import TestClient

from app.drug import score_molecule
from app.engine import run
from app.nl2circuit import translate_with_fidelity
from app.providers import run_qubo
from app.simplify import simplify_ir


class MockLLM:
    def __init__(self, responses):
        self.responses = list(responses)
        self.prompts = []

    def complete(self, system, user):
        self.prompts.append(user)
        return self.responses.pop(0)


def bloated_superposition_ir():
    return {
        "version": "1.0",
        "num_qubits": 2,
        "gates": [
            {"op": "H", "targets": [0]},
            {"op": "H", "targets": [0]},
            {"op": "X", "targets": [0]},
            {"op": "CNOT", "controls": [0], "targets": [1]},
            {"op": "CNOT", "controls": [0], "targets": [1]},
            {"op": "H", "targets": [0]},
            {"op": "SWAP", "targets": [0, 1]},
            {"op": "measure", "targets": [0, 1]},
        ],
        "shots": 1024,
        "seed": 42,
    }


def minimal_superposition_ir():
    return {
        "version": "1.0",
        "num_qubits": 1,
        "gates": [
            {"op": "H", "targets": [0]},
            {"op": "measure", "targets": [0]},
        ],
        "shots": 1024,
        "seed": 42,
    }


def bell_ir():
    return {
        "version": "1.0",
        "num_qubits": 2,
        "gates": [
            {"op": "H", "targets": [0]},
            {"op": "CNOT", "controls": [0], "targets": [1]},
            {"op": "measure", "targets": [0, 1]},
        ],
        "shots": 512,
        "seed": 42,
    }


def test_peephole_simplifies_observed_bloated_ir():
    simplified, removed = simplify_ir(bloated_superposition_ir())
    assert removed == 4
    assert [gate["op"] for gate in simplified["gates"]] == ["X", "H", "SWAP", "measure"]


def test_peephole_merges_rotations_and_drops_full_turn():
    ir = {
        "version": "1.0",
        "num_qubits": 1,
        "gates": [
            {"op": "RX", "targets": [0], "params": [math.pi / 2]},
            {"op": "RX", "targets": [0], "params": [3 * math.pi / 2]},
            {"op": "RY", "targets": [0], "params": [0.2]},
            {"op": "RY", "targets": [0], "params": [0.3]},
            {"op": "measure", "targets": [0]},
        ],
    }
    simplified, removed = simplify_ir(ir)
    assert removed == 3
    assert [gate["op"] for gate in simplified["gates"]] == ["RY", "measure"]
    assert simplified["gates"][0]["params"][0] == 0.5


def test_peephole_leaves_bell_circuit_unchanged():
    simplified, removed = simplify_ir(bell_ir())
    assert removed == 0
    assert simplified == bell_ir()


def test_fidelity_mismatch_retries_with_explanation_and_clears_warning():
    llm = MockLLM([json.dumps(bloated_superposition_ir()), json.dumps(minimal_superposition_ir())])
    outcome = translate_with_fidelity("Put one qubit in superposition and measure it", llm)
    assert outcome.ir["num_qubits"] == 1
    assert [gate["op"] for gate in outcome.ir["gates"]] == ["H", "measure"]
    assert outcome.warning is None
    assert len(llm.prompts) == 2
    assert "expected 1 qubit, got 2" in llm.prompts[1]


def test_fidelity_mismatch_twice_returns_warning_metadata():
    response = json.dumps(bloated_superposition_ir())
    outcome = translate_with_fidelity("Put one qubit in superposition and measure it", MockLLM([response, response]))
    assert outcome.ir["num_qubits"] == 2
    assert outcome.simplified_removed == 4
    assert outcome.warning == "This may not match your request — expected 1 qubit, got 2."


def test_nl_endpoint_exposes_warning_simplification_and_interpretation(monkeypatch):
    import app.main as main_module

    response = json.dumps(bloated_superposition_ir())
    mock = MockLLM([response, response])
    monkeypatch.setattr(main_module, "LocalLLM", lambda: mock)
    payload = TestClient(main_module.app).post(
        "/nl2circuit",
        json={"text": "Put one qubit in superposition and measure it", "backend": "qiskit"},
    ).json()
    assert payload["warning"].startswith("This may not match your request")
    assert payload["simplification"]["removed"] == 4
    assert payload["interpretation"].startswith("Built: 2 qubits")


def test_step_cursor_exposes_bell_state_evolution():
    after_h = run(bell_ir(), backend="qiskit", cursor=1)
    after_cnot = run(bell_ir(), backend="qiskit", cursor=2)
    assert {item["basis"] for item in after_h.statevector} == {"00", "10"}
    assert {item["basis"] for item in after_cnot.statevector} == {"00", "11"}
    assert after_h.cursor == 1 and after_cnot.cursor == 2


def test_template_endpoint_expands_without_llm():
    from app.main import template_endpoint

    payload = template_endpoint(
        {"template": "ghz", "params": {"qubits": 3}, "backend": "qiskit"}
    )
    assert payload["template"] == {"name": "ghz", "params": {"qubits": 3}}
    assert payload["ir"]["num_qubits"] == 3
    assert [gate["op"] for gate in payload["ir"]["gates"]] == ["H", "CNOT", "CNOT", "measure"]


def test_drug_score_includes_per_rule_lipinski_breakdown():
    result = score_molecule("CC(=O)OC1=CC=CC=C1C(=O)O")
    assert set(result["lipinski"]) == {"molecular_weight", "logp", "h_bond_donors", "h_bond_acceptors"}
    assert all(set(rule) >= {"value", "limit", "pass"} for rule in result["lipinski"].values())


def test_qubo_result_accounts_for_all_reads():
    result = run_qubo(
        {
            "version": "1.0",
            "kind": "qubo",
            "variables": ["a", "b", "c"],
            "linear": {"a": -2, "b": -2, "c": -2},
            "quadratic": {"a,b": 2, "b,c": 2, "a,c": 2},
            "num_reads": 75,
            "seed": 42,
        }
    )
    assert sum(sample["reads"] for sample in result["samples"]) == 75


def test_provider_intent_router_explains_selected_paradigm():
    from app.providers import route_intent

    anneal = route_intent("split a triangle graph into two groups")
    circuit = route_intent("entangle two qubits")
    assert anneal["paradigm"] == "annealing" and "optimization" in anneal["reason"].lower()
    assert circuit["paradigm"] == "circuit" and "gate" in circuit["reason"].lower()
