from __future__ import annotations

import math

import app.main as main_module
from app.nl2circuit import known_request_fallback


def test_known_rotation_request_compiles_degrees_to_radians():
    ir = known_request_fallback("Rotate qubit 0 by 90 degrees around X, then measure.")

    assert ir is not None
    assert ir["num_qubits"] == 1
    assert ir["gates"][0]["op"] == "RX"
    assert math.isclose(ir["gates"][0]["params"][0], math.pi / 2)
    assert ir["gates"][1]["op"] == "measure"
    assert ir["gates"][1]["targets"] == [0]


def test_rotation_sample_bypasses_unreliable_llm(monkeypatch):
    def unexpected_translation(*_args, **_kwargs):
        raise AssertionError("documented rotation samples must compile deterministically")

    monkeypatch.setattr(main_module, "_translate_request", unexpected_translation)
    payload = main_module.nl2circuit_endpoint(
        {"text": "Rotate qubit 0 by 90 degrees around X, then measure.", "backend": "cirq"}
    )

    assert payload["translation"]["source"] == "deterministic-known-request"
    assert payload["ir"]["gates"][0]["op"] == "RX"
    assert "cirq.rx" in payload["source"]["cirq"]
