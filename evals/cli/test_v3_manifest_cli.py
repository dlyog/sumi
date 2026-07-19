from __future__ import annotations

import base64
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


BELL_MANIFEST_YAML = """\
apiVersion: quantumyog.dev/v1
kind: Circuit
metadata:
  name: bell-state
  description: Prepare and measure a Bell pair.
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
    shots: 256
    seed: 42
"""


def test_yaml_and_json_manifests_compile_to_the_same_ir():
    from app.manifest import dump_manifest, load_manifest

    yaml_document = load_manifest(BELL_MANIFEST_YAML)
    json_document = load_manifest(dump_manifest(yaml_document.manifest, "json"))
    assert yaml_document.ir == json_document.ir
    assert yaml_document.backend == "qiskit"
    assert yaml_document.manifest["metadata"]["name"] == "bell-state"


def test_manifest_template_expands_deterministically():
    from app.manifest import load_manifest

    document = load_manifest(
        """
apiVersion: quantumyog.dev/v1
kind: Circuit
metadata: {name: ghz-lesson}
spec:
  backend: cirq
  template:
    name: ghz
    parameters: {qubits: 3, shots: 128, seed: 7}
"""
    )
    assert document.backend == "cirq"
    assert document.ir["num_qubits"] == 3
    assert [gate["op"] for gate in document.ir["gates"]] == ["H", "CNOT", "CNOT", "measure"]


def test_manifest_rejects_unknown_fields_and_ambiguous_specs():
    from app.manifest import ManifestValidationError, load_manifest

    with pytest.raises(ManifestValidationError, match="unknown top-level field"):
        load_manifest(BELL_MANIFEST_YAML + "unexpected: true\n")
    with pytest.raises(ManifestValidationError, match="exactly one of circuit or template"):
        load_manifest(
            """
apiVersion: quantumyog.dev/v1
kind: Circuit
metadata: {name: invalid}
spec: {backend: qiskit}
"""
        )


def test_cli_validate_plan_compile_run_and_visualize(tmp_path, capsys):
    from app.cli import main

    manifest_path = tmp_path / "bell.qyog.yaml"
    manifest_path.write_text(BELL_MANIFEST_YAML)

    assert main(["validate", str(manifest_path)]) == 0
    assert "Success" in capsys.readouterr().out

    assert main(["plan", str(manifest_path)]) == 0
    plan = capsys.readouterr().out
    assert "2 qubits" in plan and "3 operations" in plan and "qiskit" in plan

    source_path = tmp_path / "bell.py"
    assert main(["compile", str(manifest_path), "--target", "qiskit", "--output", str(source_path)]) == 0
    assert "QuantumCircuit" in source_path.read_text()

    assert main(["run", str(manifest_path), "--json"]) == 0
    result = json.loads(capsys.readouterr().out)
    assert set(result["counts"]) == {"00", "11"}

    assert main(["visualize", str(manifest_path), "--no-open", "--base-url", "http://localhost:8080"]) == 0
    url = capsys.readouterr().out.strip()
    encoded = url.split("#manifest=", 1)[1]
    padding = "=" * (-len(encoded) % 4)
    payload = json.loads(base64.urlsafe_b64decode(encoded + padding))
    assert payload["metadata"]["name"] == "bell-state"


def test_cli_generate_turns_natural_language_into_a_manifest(tmp_path, monkeypatch, capsys):
    import app.cli as cli_module
    from app.manifest import load_manifest_file

    ir = {
        "version": "1.0",
        "num_qubits": 1,
        "gates": [{"op": "H", "targets": [0]}, {"op": "measure", "targets": [0]}],
        "shots": 1024,
        "seed": 42,
    }

    class MockLLM:
        def complete(self, system, user):
            return json.dumps(ir)

    monkeypatch.setattr(cli_module, "LocalLLM", MockLLM)
    output = tmp_path / "superposition.qyog.yaml"
    assert cli_module.main([
        "generate",
        "Put one qubit in superposition and measure it",
        "--name",
        "superposition",
        "--output",
        str(output),
    ]) == 0
    assert "Generated" in capsys.readouterr().out
    document = load_manifest_file(output)
    assert document.manifest["metadata"]["sourcePrompt"].startswith("Put one qubit")
    assert [gate["op"] for gate in document.ir["gates"]] == ["H", "measure"]


def test_manifest_api_and_nl_manifest_endpoint(monkeypatch):
    import app.main as main_module

    client = TestClient(main_module.app)
    compiled = client.post("/manifests/compile", json={"document": BELL_MANIFEST_YAML}).json()
    assert compiled["manifest"]["metadata"]["name"] == "bell-state"
    assert compiled["ir"]["num_qubits"] == 2

    minimal = {
        "version": "1.0",
        "num_qubits": 1,
        "gates": [{"op": "H", "targets": [0]}, {"op": "measure", "targets": [0]}],
        "shots": 1024,
        "seed": 42,
    }

    class MockLLM:
        def complete(self, system, user):
            return json.dumps(minimal)

    monkeypatch.setattr(main_module, "LocalLLM", MockLLM)
    generated = client.post(
        "/nl2manifest",
        json={"text": "Put one qubit in superposition and measure it", "name": "first-h"},
    ).json()
    assert generated["manifest"]["apiVersion"] == "quantumyog.dev/v1"
    assert generated["manifest"]["metadata"]["name"] == "first-h"
    assert generated["ir"]["num_qubits"] == 1


def test_academic_guide_and_language_reference_exist():
    root = Path(__file__).resolve().parents[2]
    guide = (root / "docs" / "ACADEMIC_GUIDE.md").read_text()
    language = (root / "docs" / "MANIFEST_LANGUAGE.md").read_text()
    assert all(section in guide for section in ("Learning path", "First circuit", "Step-through", "CLI workflow", "Exercises"))
    assert all(section in language for section in ("apiVersion", "JSON", "YAML", "validate", "plan", "compile", "visualize"))
    assert (root / "examples" / "bell.qyog.yaml").is_file()
    assert (root / "qyog").is_file()
