from __future__ import annotations

import cmath
import random
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from dataclasses import dataclass
from math import cos, pi, sin, sqrt
from typing import Any

from .ir import normalize_ir
from .simplify import simplify_ir


@dataclass
class Result:
    ir: dict[str, Any]
    counts: dict[str, int]
    statevector: list[dict[str, float]]
    bloch: list[dict[str, float]]
    qiskit_source: str
    cirq_source: str
    backend: str
    engine: str
    simplified_removed: int = 0
    cursor: int | None = None
    step_count: int = 0
    entanglement: list[dict[str, int]] | None = None
    simulated: bool = True


Matrix = tuple[tuple[complex, complex], tuple[complex, complex]]
_FRAMEWORK_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="quantumyog-simulator")


def _single_qubit_matrix(op: str, params: list[float] | None = None) -> Matrix:
    i = 1j
    if op == "H":
        s = 1 / sqrt(2)
        return ((s, s), (s, -s))
    if op == "X":
        return ((0, 1), (1, 0))
    if op == "Y":
        return ((0, -i), (i, 0))
    if op == "Z":
        return ((1, 0), (0, -1))
    if op == "S":
        return ((1, 0), (0, i))
    if op == "T":
        return ((1, 0), (0, cmath.exp(i * pi / 4)))
    theta = float(params[0])
    if op == "RX":
        return ((cos(theta / 2), -i * sin(theta / 2)), (-i * sin(theta / 2), cos(theta / 2)))
    if op == "RY":
        return ((cos(theta / 2), -sin(theta / 2)), (sin(theta / 2), cos(theta / 2)))
    if op == "RZ":
        return ((cmath.exp(-i * theta / 2), 0), (0, cmath.exp(i * theta / 2)))
    raise ValueError(f"unsupported single-qubit op {op}")


def _bit(index: int, qubit: int, num_qubits: int) -> int:
    return (index >> (num_qubits - qubit - 1)) & 1


def _flip(index: int, qubit: int, num_qubits: int) -> int:
    return index ^ (1 << (num_qubits - qubit - 1))


def _apply_single(state: list[complex], matrix: Matrix, target: int, num_qubits: int) -> list[complex]:
    out = state[:]
    for idx in range(len(state)):
        if _bit(idx, target, num_qubits) == 0:
            pair = _flip(idx, target, num_qubits)
            a0, a1 = state[idx], state[pair]
            out[idx] = matrix[0][0] * a0 + matrix[0][1] * a1
            out[pair] = matrix[1][0] * a0 + matrix[1][1] * a1
    return out


def _apply_cnot(state: list[complex], control: int, target: int, num_qubits: int) -> list[complex]:
    out = [0j] * len(state)
    for idx, amp in enumerate(state):
        dest = _flip(idx, target, num_qubits) if _bit(idx, control, num_qubits) else idx
        out[dest] += amp
    return out


def _apply_cz(state: list[complex], control: int, target: int, num_qubits: int) -> list[complex]:
    out = state[:]
    for idx in range(len(state)):
        if _bit(idx, control, num_qubits) and _bit(idx, target, num_qubits):
            out[idx] *= -1
    return out


def _apply_swap(state: list[complex], q0: int, q1: int, num_qubits: int) -> list[complex]:
    out = [0j] * len(state)
    for idx, amp in enumerate(state):
        b0, b1 = _bit(idx, q0, num_qubits), _bit(idx, q1, num_qubits)
        dest = _flip(_flip(idx, q0, num_qubits), q1, num_qubits) if b0 != b1 else idx
        out[dest] += amp
    return out


def _simulate_state(ir: dict[str, Any]) -> list[complex]:
    num_qubits = ir["num_qubits"]
    state = [0j] * (2**num_qubits)
    state[0] = 1 + 0j
    for gate in ir["gates"]:
        op = gate["op"]
        if op == "measure":
            continue
        if op in {"H", "X", "Y", "Z", "S", "T", "RX", "RY", "RZ"}:
            state = _apply_single(state, _single_qubit_matrix(op, gate.get("params")), gate["targets"][0], num_qubits)
        elif op == "CNOT":
            state = _apply_cnot(state, gate["controls"][0], gate["targets"][0], num_qubits)
        elif op == "CZ":
            state = _apply_cz(state, gate["controls"][0], gate["targets"][0], num_qubits)
        elif op == "SWAP":
            state = _apply_swap(state, gate["targets"][0], gate["targets"][1], num_qubits)
    return state


def _measure_targets(ir: dict[str, Any]) -> list[int]:
    measured: list[int] = []
    for gate in ir["gates"]:
        if gate["op"] == "measure":
            measured.extend(gate["targets"])
    return measured or list(range(ir["num_qubits"]))


def _sample_counts(state: list[complex], ir: dict[str, Any]) -> dict[str, int]:
    num_qubits = ir["num_qubits"]
    targets = _measure_targets(ir)
    probs = [abs(amp) ** 2 for amp in state]
    total = sum(probs) or 1.0
    cumulative = []
    running = 0.0
    for prob in probs:
        running += prob / total
        cumulative.append(running)

    rng = random.Random(ir.get("seed"))
    counts: dict[str, int] = {}
    for _ in range(ir["shots"]):
        r = rng.random()
        idx = next(i for i, threshold in enumerate(cumulative) if r <= threshold)
        outcome = "".join(str(_bit(idx, q, num_qubits)) for q in targets)
        counts[outcome] = counts.get(outcome, 0) + 1
    return dict(sorted(counts.items()))


def _statevector_payload(state: list[complex], num_qubits: int) -> list[dict[str, float]]:
    return [
        {"basis": format(idx, f"0{num_qubits}b"), "real": float(amp.real), "imag": float(amp.imag)}
        for idx, amp in enumerate(state)
        if abs(amp) > 1e-12
    ]


def _bloch(state: list[complex], num_qubits: int) -> list[dict[str, float]]:
    coords = []
    for qubit in range(num_qubits):
        x = y = z = 0.0
        for idx, amp in enumerate(state):
            prob = abs(amp) ** 2
            z += prob if _bit(idx, qubit, num_qubits) == 0 else -prob
            if _bit(idx, qubit, num_qubits) == 0:
                pair = _flip(idx, qubit, num_qubits)
                coherence = amp.conjugate() * state[pair]
                x += 2 * coherence.real
                y += 2 * coherence.imag
        coords.append({"x": round(x, 6), "y": round(y, 6), "z": round(z, 6)})
    return coords


def _source(ir: dict[str, Any], flavor: str) -> str:
    if flavor == "qiskit":
        lines = ["from qiskit import QuantumCircuit", f"qc = QuantumCircuit({ir['num_qubits']}, {ir['num_qubits']})"]
    else:
        lines = ["import cirq", f"q = cirq.LineQubit.range({ir['num_qubits']})", "circuit = cirq.Circuit()"]
    for gate in ir["gates"]:
        op = gate["op"]
        targets = gate["targets"]
        controls = gate.get("controls", [])
        if flavor == "qiskit":
            name = {"CNOT": "cx", "measure": "measure"}.get(op, op.lower())
            if op in {"RX", "RY", "RZ"}:
                lines.append(f"qc.{name}({gate['params'][0]}, {targets[0]})")
            elif op == "measure":
                lines.append(f"qc.measure({targets}, {gate.get('classical', targets)})")
            else:
                lines.append(f"qc.{name}({', '.join(map(str, controls + targets))})")
        elif op == "measure":
            qubits = ", ".join(f"q[{x}]" for x in targets)
            lines.append(f"circuit.append(cirq.measure({qubits}, key='result'))")
        else:
            args = ", ".join(f"q[{x}]" for x in controls + targets)
            if op in {"RX", "RY", "RZ"}:
                lines.append(f"circuit.append(cirq.{op.lower()}({gate['params'][0]})(q[{targets[0]}]))")
            else:
                lines.append(f"circuit.append(cirq.{op}({args}))")
    return "\n".join(lines)


def compile_source(ir: dict[str, Any], target: str) -> str:
    if target not in {"qiskit", "cirq"}:
        raise ValueError("target must be 'qiskit' or 'cirq'")
    return _source(normalize_ir(ir), target)


def _qiskit_state(ir: dict[str, Any]) -> list[complex]:
    from qiskit import QuantumCircuit
    from qiskit.quantum_info import Statevector

    circuit = QuantumCircuit(ir["num_qubits"])
    for gate in ir["gates"]:
        op = gate["op"]
        targets = gate["targets"]
        controls = gate.get("controls", [])
        if op == "measure":
            continue
        if op in {"H", "X", "Y", "Z", "S", "T"}:
            getattr(circuit, op.lower())(targets[0])
        elif op in {"RX", "RY", "RZ"}:
            getattr(circuit, op.lower())(gate["params"][0], targets[0])
        elif op == "CNOT":
            circuit.cx(controls[0], targets[0])
        elif op == "CZ":
            circuit.cz(controls[0], targets[0])
        elif op == "SWAP":
            circuit.swap(targets[0], targets[1])

    raw = Statevector.from_instruction(circuit).data
    num_qubits = ir["num_qubits"]
    # Qiskit indexes amplitudes little-endian; Circuit IR displays q0 on the left.
    state: list[complex] = []
    for display_index in range(2**num_qubits):
        qiskit_index = 0
        for qubit in range(num_qubits):
            qiskit_index |= _bit(display_index, qubit, num_qubits) << qubit
        state.append(complex(raw[qiskit_index]))
    return state


def _cirq_state(ir: dict[str, Any]) -> list[complex]:
    import cirq

    qubits = cirq.LineQubit.range(ir["num_qubits"])
    operations = []
    for gate in ir["gates"]:
        op = gate["op"]
        targets = gate["targets"]
        controls = gate.get("controls", [])
        if op == "measure":
            continue
        if op in {"H", "X", "Y", "Z", "S", "T"}:
            operations.append(getattr(cirq, op)(qubits[targets[0]]))
        elif op in {"RX", "RY", "RZ"}:
            operations.append(getattr(cirq, op.lower())(gate["params"][0])(qubits[targets[0]]))
        elif op in {"CNOT", "CZ"}:
            operations.append(getattr(cirq, op)(qubits[controls[0]], qubits[targets[0]]))
        elif op == "SWAP":
            operations.append(cirq.SWAP(qubits[targets[0]], qubits[targets[1]]))

    result = cirq.Simulator(seed=ir.get("seed")).simulate(
        cirq.Circuit(operations), qubit_order=qubits
    )
    return [complex(value) for value in result.final_state_vector]


def _framework_state(ir: dict[str, Any], backend: str) -> tuple[list[complex], str]:
    try:
        if backend == "qiskit":
            return _qiskit_state(ir), "Qiskit Statevector"
        return _cirq_state(ir), "Cirq Simulator"
    except ImportError:
        # The setup script installs both SDKs; this fallback keeps source-only use
        # understandable when a learner opens the backend before running setup.
        return _simulate_state(ir), "1StopQuantum reference simulator"


def _entanglement_links(ir: dict[str, Any], bloch: list[dict[str, float]]) -> list[dict[str, int]]:
    links: list[dict[str, int]] = []
    for gate in ir["gates"]:
        if gate["op"] not in {"CNOT", "CZ"}:
            continue
        control, target = gate["controls"][0], gate["targets"][0]
        control_length = sqrt(sum(bloch[control][axis] ** 2 for axis in ("x", "y", "z")))
        target_length = sqrt(sum(bloch[target][axis] ** 2 for axis in ("x", "y", "z")))
        if control_length < 0.15 and target_length < 0.15:
            link = {"control": control, "target": target}
            if link not in links:
                links.append(link)
    return links


def run(ir: dict[str, Any], backend: str = "qiskit", cursor: int | None = None) -> Result:
    if backend not in {"qiskit", "cirq"}:
        raise ValueError("backend must be 'qiskit' or 'cirq'")
    clean, simplified_removed = simplify_ir(normalize_ir(ir))
    clean = normalize_ir(clean)
    unitary_gates = [gate for gate in clean["gates"] if gate["op"] != "measure"]
    step_count = len(unitary_gates)
    if cursor is not None and (not isinstance(cursor, int) or isinstance(cursor, bool) or not 0 <= cursor <= step_count):
        raise ValueError(f"cursor must be between 0 and {step_count}")

    simulation_ir = clean
    if cursor is not None:
        simulation_ir = deepcopy(clean)
        simulation_ir["gates"] = unitary_gates[:cursor] + [
            {"op": "measure", "targets": list(range(clean["num_qubits"]))}
        ]
        simulation_ir = normalize_ir(simulation_ir)

    state, engine = _FRAMEWORK_EXECUTOR.submit(_framework_state, simulation_ir, backend).result()
    bloch = _bloch(state, clean["num_qubits"])
    return Result(
        ir=clean,
        counts=_sample_counts(state, simulation_ir),
        statevector=_statevector_payload(state, clean["num_qubits"]),
        bloch=bloch,
        qiskit_source=_source(clean, "qiskit"),
        cirq_source=_source(clean, "cirq"),
        backend=backend,
        engine=engine,
        simplified_removed=simplified_removed,
        cursor=cursor,
        step_count=step_count,
        entanglement=_entanglement_links(simulation_ir, bloch),
    )
