from app.engine import run
from app.providers import provider_catalog, run_qubo
from app.templates import expand_template


def test_ghz_template_expands_to_shared_circuit_ir():
    ir = expand_template({"template": "ghz", "params": {"qubits": 4}})
    assert ir["num_qubits"] == 4
    assert [gate["op"] for gate in ir["gates"]] == ["H", "CNOT", "CNOT", "CNOT", "measure"]


def test_two_qubit_grover_amplifies_the_marked_state():
    ir = expand_template({"template": "grover", "params": {"marked": "11", "shots": 256}})
    result = run(ir, backend="qiskit")
    assert result.counts == {"11": 256}


def test_triangle_qubo_finds_known_max_cut_energy():
    result = run_qubo(
        {
            "version": "1.0",
            "kind": "qubo",
            "variables": ["a", "b", "c"],
            "linear": {"a": -2, "b": -2, "c": -2},
            "quadratic": {"a,b": 2, "b,c": 2, "a,c": 2},
            "num_reads": 100,
            "seed": 42,
        }
    )
    assert result["best"]["energy"] == -2.0
    assert result["execution"]["simulated"] is True


def test_provider_catalog_keeps_hardware_targets_planned():
    catalog = {provider["id"]: provider for provider in provider_catalog()["providers"]}
    assert catalog["qiskit"]["availability"] == "local"
    assert catalog["ionq"]["availability"] == "planned"
    assert catalog["dwave"]["paradigm"] == "annealing"
