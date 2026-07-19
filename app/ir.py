from __future__ import annotations

from copy import deepcopy
from typing import Any


ALLOWED_OPS = {"H", "X", "Y", "Z", "S", "T", "RX", "RY", "RZ", "CNOT", "CZ", "SWAP", "measure"}
ROTATION_OPS = {"RX", "RY", "RZ"}
CONTROLLED_OPS = {"CNOT", "CZ"}


class IRValidationError(ValueError):
    """Raised when a Circuit IR document is invalid."""


def _require_int(value: Any, name: str, minimum: int | None = None) -> int:
    if not isinstance(value, int) or isinstance(value, bool):
        raise IRValidationError(f"{name} must be an integer")
    if minimum is not None and value < minimum:
        raise IRValidationError(f"{name} must be >= {minimum}")
    return value


def _validate_indices(indices: Any, *, name: str, num_qubits: int, min_len: int = 1) -> list[int]:
    if not isinstance(indices, list) or len(indices) < min_len:
        raise IRValidationError(f"{name} must be a list with at least {min_len} item(s)")
    clean = []
    for index in indices:
        _require_int(index, name)
        if index < 0 or index >= num_qubits:
            raise IRValidationError(f"{name} index {index} is outside 0..{num_qubits - 1}")
        clean.append(index)
    if len(set(clean)) != len(clean):
        raise IRValidationError(f"{name} contains duplicate qubits")
    return clean


def normalize_ir(ir: dict[str, Any]) -> dict[str, Any]:
    """Return a validated copy of Circuit IR with defaults filled in.

    The IR is intentionally small because it is the shared teaching contract
    between the natural-language layer, simulator, and browser visualizations.
    """
    if not isinstance(ir, dict):
        raise IRValidationError("Circuit IR must be a JSON object")

    clean = deepcopy(ir)
    if clean.get("version") != "1.0":
        raise IRValidationError("version must be '1.0'")

    num_qubits = _require_int(clean.get("num_qubits"), "num_qubits", minimum=1)
    gates = clean.get("gates")
    if not isinstance(gates, list):
        raise IRValidationError("gates must be a list")

    for i, gate in enumerate(gates):
        if not isinstance(gate, dict):
            raise IRValidationError(f"gate {i} must be an object")
        op = gate.get("op")
        if op not in ALLOWED_OPS:
            raise IRValidationError(f"gate {i} has unsupported op {op!r}")

        targets = _validate_indices(gate.get("targets"), name=f"gate {i} targets", num_qubits=num_qubits)
        controls = gate.get("controls", [])
        if controls:
            controls = _validate_indices(controls, name=f"gate {i} controls", num_qubits=num_qubits)

        if set(targets) & set(controls):
            raise IRValidationError(f"gate {i} cannot control and target the same qubit")

        if op in CONTROLLED_OPS and (len(controls) != 1 or len(targets) != 1):
            raise IRValidationError(f"{op} requires exactly one control and one target")
        if op not in CONTROLLED_OPS and controls:
            raise IRValidationError(f"{op} does not accept controls")
        if op == "SWAP" and len(targets) != 2:
            raise IRValidationError("SWAP requires exactly two targets")
        if op not in {"SWAP", "measure"} and op not in CONTROLLED_OPS and len(targets) != 1:
            raise IRValidationError(f"{op} requires exactly one target")

        params = gate.get("params", [])
        if op in ROTATION_OPS:
            if not isinstance(params, list) or len(params) != 1 or not isinstance(params[0], (int, float)):
                raise IRValidationError(f"{op} requires one numeric angle parameter")
        elif params:
            raise IRValidationError(f"{op} does not accept params")

        if op == "measure":
            classical = gate.get("classical", targets)
            if not isinstance(classical, list) or len(classical) != len(targets):
                raise IRValidationError("measure classical bits must match targets length")
            for bit in classical:
                _require_int(bit, "classical bit", minimum=0)
            gate["classical"] = classical

    shots = clean.get("shots", 1024)
    clean["shots"] = _require_int(shots, "shots", minimum=1)
    if "seed" in clean:
        _require_int(clean["seed"], "seed", minimum=0)
    return clean


def validate_ir(ir: dict[str, Any]) -> None:
    normalize_ir(ir)

