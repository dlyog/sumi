from __future__ import annotations

import html
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from .engine import _simulate_state
from .ir import normalize_ir
from .simplify import simplify_ir


TOLERANCE = 1e-9


def circuit_metrics(ir: dict[str, Any]) -> dict[str, int]:
    clean = normalize_ir(ir)
    unitary = [gate for gate in clean["gates"] if gate["op"] != "measure"]
    two_qubit = [gate for gate in unitary if len(gate.get("controls", []) + gate["targets"]) == 2]
    levels = [0] * clean["num_qubits"]
    for gate in unitary:
        operands = gate.get("controls", []) + gate["targets"]
        level = 1 + max((levels[qubit] for qubit in operands), default=0)
        for qubit in operands:
            levels[qubit] = level
    return {
        "unitary_gates": len(unitary),
        "two_qubit_gates": len(two_qubit),
        "depth": max(levels, default=0),
    }


def _score(metrics: dict[str, int]) -> tuple[int, int, int]:
    return metrics["two_qubit_gates"], metrics["unitary_gates"], metrics["depth"]


def statevectors_equivalent(before: dict[str, Any], after: dict[str, Any]) -> bool:
    left = _simulate_state(normalize_ir(before))
    right = _simulate_state(normalize_ir(after))
    if len(left) != len(right):
        return False
    pivot = next((index for index, value in enumerate(left) if abs(value) > TOLERANCE), None)
    if pivot is None:
        return all(abs(value) <= TOLERANCE for value in right)
    if abs(right[pivot]) <= TOLERANCE:
        return False
    phase = right[pivot] / left[pivot]
    return all(abs(candidate - phase * reference) <= TOLERANCE for reference, candidate in zip(left, right))


def _report_html(result: dict[str, Any]) -> str:
    accepted = result["accepted"]
    decision = "ACCEPTED" if accepted else "UNCHANGED"
    before = html.escape(json.dumps(result["original_ir"], indent=2))
    after = html.escape(json.dumps(result["improved_ir"], indent=2))
    rows = "".join(
        f"<tr><th>{html.escape(key.replace('_', ' ').title())}</th>"
        f"<td>{result['before_metrics'][key]}</td><td>{result['after_metrics'][key]}</td></tr>"
        for key in ("unitary_gates", "two_qubit_gates", "depth")
    )
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Circuit improvement review</title><style>
:root{{color-scheme:dark;--bg:#0c1216;--panel:#111a20;--line:#293740;--text:#e7eef1;--muted:#9baab2;--teal:#58d6c5;--amber:#f2b654}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--text);font:14px/1.6 system-ui,sans-serif}}
main{{width:min(1040px,calc(100% - 32px));margin:auto;padding:42px 0}}h1{{margin:0;font-size:34px}}p{{color:var(--muted)}}
.decision{{display:inline-block;margin:16px 0;padding:6px 10px;border:1px solid var(--teal);border-radius:4px;color:var(--teal);font-weight:800}}
.grid{{display:grid;grid-template-columns:1fr 1fr;gap:12px}}section{{margin-top:24px;border:1px solid var(--line);border-radius:6px;padding:18px;background:var(--panel)}}
table{{width:100%;border-collapse:collapse}}th,td{{padding:9px;border-bottom:1px solid var(--line);text-align:left}}pre{{overflow:auto;font:11px/1.5 ui-monospace,monospace;color:#c7d3d9}}
@media(max-width:700px){{.grid{{grid-template-columns:1fr}}}}</style></head><body><main>
<p>1StopQuantum bounded optimizer · {datetime.now(UTC).isoformat()}</p><h1>Circuit improvement review</h1>
<div class="decision">{decision}</div><p>{html.escape(result['objective'])}</p>
<section><h2>Review evidence</h2><p><strong>Statevector equivalence:</strong> {str(result['review']['equivalent']).lower()} (global phase ignored)</p>
<p><strong>Policy:</strong> accept only a semantically equivalent circuit with a lower two-qubit gate, total gate, or depth score.</p>
<table><thead><tr><th>Metric</th><th>Before</th><th>After</th></tr></thead><tbody>{rows}</tbody></table></section>
<div class="grid"><section><h2>Before</h2><pre>{before}</pre></section><section><h2>After</h2><pre>{after}</pre></section></div>
<section><h2>Iteration log</h2><pre>{html.escape(json.dumps(result['iterations'], indent=2))}</pre></section>
</main></body></html>"""


def improve_circuit(
    ir: dict[str, Any],
    *,
    objective: str,
    max_iterations: int = 3,
    report_dir: str | Path = "artifacts/improvements",
) -> dict[str, Any]:
    if not isinstance(objective, str) or not objective.strip():
        raise ValueError("objective is required")
    if not isinstance(max_iterations, int) or not 1 <= max_iterations <= 8:
        raise ValueError("max_iterations must be between 1 and 8")

    original = normalize_ir(ir)
    current = original
    history: list[dict[str, Any]] = []
    any_accepted = False
    for iteration in range(1, max_iterations + 1):
        candidate, removed = simplify_ir(current)
        before_metrics = circuit_metrics(current)
        after_metrics = circuit_metrics(candidate)
        equivalent = statevectors_equivalent(current, candidate)
        accepted = equivalent and _score(after_metrics) < _score(before_metrics)
        history.append(
            {
                "iteration": iteration,
                "strategy": "deterministic-peephole",
                "ops_removed": removed,
                "equivalent": equivalent,
                "decision": "accepted" if accepted else "unchanged",
            }
        )
        if not accepted:
            break
        any_accepted = True
        current = candidate

    result: dict[str, Any] = {
        "status": "completed",
        "objective": objective.strip(),
        "accepted": any_accepted,
        "original_ir": original,
        "improved_ir": current,
        "before_metrics": circuit_metrics(original),
        "after_metrics": circuit_metrics(current),
        "review": {
            "equivalent": statevectors_equivalent(original, current),
            "method": "statevector up to global phase",
            "tolerance": TOLERANCE,
        },
        "iterations": history,
    }
    destination = Path(report_dir)
    destination.mkdir(parents=True, exist_ok=True)
    report_path = destination / f"circuit-review-{uuid4()}.html"
    report_path.write_text(_report_html(result), encoding="utf-8")
    result["report_path"] = str(report_path.resolve())
    return result
