from __future__ import annotations

from copy import deepcopy
from math import isclose, pi
from typing import Any

from .ir import normalize_ir


SELF_INVERSE = {"H", "X", "Y", "Z", "CNOT", "SWAP"}
ROTATIONS = {"RX", "RY", "RZ"}


def _same_operands(left: dict[str, Any], right: dict[str, Any]) -> bool:
    return left.get("targets") == right.get("targets") and left.get("controls", []) == right.get("controls", [])


def _wrapped_angle(value: float) -> float:
    wrapped = value % (2 * pi)
    if isclose(wrapped, 2 * pi, abs_tol=1e-10) or isclose(wrapped, 0.0, abs_tol=1e-10):
        return 0.0
    return wrapped


def simplify_ir(ir: dict[str, Any]) -> tuple[dict[str, Any], int]:
    """Apply local identities without changing the circuit's unitary behavior."""
    clean = normalize_ir(ir)
    output: list[dict[str, Any]] = []
    removed = 0

    for gate in clean["gates"]:
        candidate = deepcopy(gate)
        if output and candidate["op"] in SELF_INVERSE:
            previous = output[-1]
            if previous["op"] == candidate["op"] and _same_operands(previous, candidate):
                output.pop()
                removed += 2
                continue

        if output and candidate["op"] in ROTATIONS:
            previous = output[-1]
            if previous["op"] == candidate["op"] and _same_operands(previous, candidate):
                total = _wrapped_angle(float(previous["params"][0]) + float(candidate["params"][0]))
                output.pop()
                removed += 1
                if isclose(total, 0.0, abs_tol=1e-10):
                    removed += 1
                else:
                    candidate["params"] = [total]
                    output.append(candidate)
                continue

        output.append(candidate)

    if removed == 0:
        return deepcopy(ir), 0
    simplified = deepcopy(clean)
    simplified["gates"] = output
    return simplified, removed


def describe_ir(ir: dict[str, Any]) -> str:
    clean = normalize_ir(ir)
    parts: list[str] = []
    for gate in clean["gates"]:
        op = gate["op"]
        if op == "measure":
            parts.append("measure")
        elif op in {"CNOT", "CZ"}:
            parts.append(f"{op} q{gate['controls'][0]} to q{gate['targets'][0]}")
        elif op == "SWAP":
            parts.append(f"SWAP q{gate['targets'][0]} with q{gate['targets'][1]}")
        elif op in ROTATIONS:
            parts.append(f"{op}({gate['params'][0]:.4g}) on q{gate['targets'][0]}")
        else:
            parts.append(f"{op} on q{gate['targets'][0]}")
    qubits = clean["num_qubits"]
    noun = "qubit" if qubits == 1 else "qubits"
    sequence = ", then ".join(parts) if parts else "no gates"
    return f"Built: {qubits} {noun} — {sequence} ({clean['shots']} shots)."
