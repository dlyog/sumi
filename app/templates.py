from __future__ import annotations

from typing import Any, Callable

from .ir import IRValidationError


TemplateBuilder = Callable[[dict[str, Any]], dict[str, Any]]


def _base(num_qubits: int, gates: list[dict[str, Any]], params: dict[str, Any]) -> dict[str, Any]:
    if not 1 <= num_qubits <= 12:
        raise IRValidationError("algorithm templates support between 1 and 12 qubits")
    return {
        "version": "1.0",
        "num_qubits": num_qubits,
        "gates": gates + [{"op": "measure", "targets": list(range(num_qubits))}],
        "shots": int(params.get("shots", 1024)),
        "seed": int(params.get("seed", 42)),
    }


def _ghz(params: dict[str, Any]) -> dict[str, Any]:
    count = int(params.get("qubits", params.get("num_qubits", 3)))
    if count < 2:
        raise IRValidationError("GHZ requires at least two qubits")
    gates = [{"op": "H", "targets": [0]}]
    gates.extend({"op": "CNOT", "controls": [0], "targets": [q]} for q in range(1, count))
    return _base(count, gates, params)


def _qrng(params: dict[str, Any]) -> dict[str, Any]:
    count = int(params.get("qubits", params.get("num_qubits", 1)))
    gates = [{"op": "H", "targets": [q]} for q in range(count)]
    return _base(count, gates, params)


def _grover(params: dict[str, Any]) -> dict[str, Any]:
    marked = str(params.get("marked", "11"))
    for token in ("|", ">", "⟩", " "):
        marked = marked.replace(token, "")
    if len(marked) != 2 or set(marked) - {"0", "1"}:
        raise IRValidationError("the teaching Grover template requires a two-bit marked state")

    gates: list[dict[str, Any]] = [{"op": "H", "targets": [0]}, {"op": "H", "targets": [1]}]
    zero_qubits = [index for index, bit in enumerate(marked) if bit == "0"]
    gates.extend({"op": "X", "targets": [q]} for q in zero_qubits)
    gates.append({"op": "CZ", "controls": [0], "targets": [1]})
    gates.extend({"op": "X", "targets": [q]} for q in zero_qubits)
    gates.extend({"op": "H", "targets": [q]} for q in range(2))
    gates.extend({"op": "X", "targets": [q]} for q in range(2))
    gates.append({"op": "CZ", "controls": [0], "targets": [1]})
    gates.extend({"op": "X", "targets": [q]} for q in range(2))
    gates.extend({"op": "H", "targets": [q]} for q in range(2))
    return _base(2, gates, params)


def _deutsch_jozsa(params: dict[str, Any]) -> dict[str, Any]:
    inputs = int(params.get("input_qubits", params.get("qubits", 2)))
    if inputs < 1:
        raise IRValidationError("Deutsch-Jozsa requires at least one input qubit")
    total = inputs + 1
    ancilla = total - 1
    oracle = str(params.get("oracle", "constant")).lower()
    if oracle not in {"constant", "balanced"}:
        raise IRValidationError("Deutsch-Jozsa oracle must be 'constant' or 'balanced'")

    gates: list[dict[str, Any]] = [{"op": "X", "targets": [ancilla]}]
    gates.extend({"op": "H", "targets": [q]} for q in range(total))
    if oracle == "balanced":
        gates.extend({"op": "CNOT", "controls": [q], "targets": [ancilla]} for q in range(inputs))
    gates.extend({"op": "H", "targets": [q]} for q in range(inputs))
    ir = _base(total, gates, params)
    ir["gates"][-1] = {"op": "measure", "targets": list(range(inputs))}
    return ir


REGISTRY: dict[str, TemplateBuilder] = {
    "ghz": _ghz,
    "grover": _grover,
    "deutsch_jozsa": _deutsch_jozsa,
    "qrng": _qrng,
}


def expand_template(obj: dict[str, Any]) -> dict[str, Any]:
    raw_name = obj.get("template")
    if not raw_name:
        return obj
    name = str(raw_name).strip().lower().replace("-", "_").replace(" ", "_")
    try:
        builder = REGISTRY[name]
    except KeyError as exc:
        allowed = ", ".join(sorted(REGISTRY))
        raise IRValidationError(f"unknown template {raw_name!r}; allowed templates: {allowed}") from exc
    params = obj.get("params", {})
    if not isinstance(params, dict):
        raise IRValidationError("template params must be a JSON object")
    return builder(params)
