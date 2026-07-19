from app.nl2circuit import known_request_fallback

import app.main as main_module


def test_three_qubit_entangle_falls_back_to_ghz_template():
    ir = known_request_fallback("Entangle three qubits and measure them.")
    assert ir is not None
    assert ir["num_qubits"] == 3
    assert [gate["op"] for gate in ir["gates"]] == ["H", "CNOT", "CNOT", "measure"]


def test_non_quantum_text_has_no_deterministic_fallback():
    assert known_request_fallback("What is the weather today?") is None


def test_endpoint_uses_template_fallback_after_invalid_llm_json(monkeypatch):
    def fail_translation(text, llm):
        raise main_module.NLIRValidationError("malformed local-model JSON")

    monkeypatch.setattr(main_module, "translate", fail_translation)
    payload = main_module.nl2circuit_endpoint(
        {"text": "Entangle three qubits and measure them.", "backend": "qiskit"}
    )
    assert payload["ir"]["num_qubits"] == 3
    assert payload["translation"]["source"] == "deterministic-template-fallback"
