from __future__ import annotations

import json
import math
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from statistics import mean
from typing import Any


PROJECT = Path(__file__).resolve().parents[1]
SNAPSHOT_PATH = PROJECT / "data" / "metriq" / "benchmark_snapshot.json"
DARPA_QBI_URL = "https://www.darpa.mil/research/programs/quantum-benchmarking-initiative"

WORKLOAD_BENCHMARKS = {
    "optimization": {"Linear Ramp QAOA"},
    "machine-learning": {"QML Kernel"},
    "general-circuits": {"Mirror Circuits", "EPLG", "BSEQ"},
    "throughput": {"CLOPS"},
    "fourier": {"Quantum Fourier Transform"},
}

USE_CASES = [
    {
        "sector": "Energy",
        "problem": "Unit commitment and grid restoration planning",
        "quantum_approach": "Constrained optimization / QAOA research",
        "classical_baseline": "Mixed-integer optimization with modern presolve and decomposition",
        "decision_gate": "Beat solution quality, wall time, and total operating cost on the same instances.",
        "evidence_status": "research",
    },
    {
        "sector": "Logistics",
        "problem": "Fleet routing under operational constraints",
        "quantum_approach": "QUBO or hybrid optimization research",
        "classical_baseline": "Constraint programming and vehicle-routing heuristics",
        "decision_gate": "Include encoding overhead and compare against tuned classical solvers.",
        "evidence_status": "research",
    },
    {
        "sector": "Materials",
        "problem": "Ground-state energy estimation for candidate materials",
        "quantum_approach": "Hamiltonian simulation or variational eigensolvers",
        "classical_baseline": "Coupled-cluster, density-functional, and tensor-network methods",
        "decision_gate": "Demonstrate decision-relevant accuracy at lower full-system cost.",
        "evidence_status": "emerging",
    },
    {
        "sector": "Public services",
        "problem": "Resource allocation and emergency scheduling",
        "quantum_approach": "Hybrid discrete optimization research",
        "classical_baseline": "Robust optimization, simulation, and operations-research heuristics",
        "decision_gate": "Validate resilience, fairness constraints, auditability, and cost before deployment.",
        "evidence_status": "research",
    },
]


def _load_snapshot() -> dict[str, Any]:
    if not SNAPSHOT_PATH.is_file():
        raise RuntimeError("Bundled Metriq snapshot is missing; run scripts/import_metriq.py")
    return json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))


def _primary_metric(record: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
    metrics = record.get("metrics", {})
    if "score" in metrics:
        return "score", metrics["score"]
    for name, metric in metrics.items():
        return name, metric
    return None


def _scale(record: dict[str, Any]) -> int | float | None:
    params = record.get("params", {})
    for name in ("num_qubits", "width", "chain_length"):
        value = params.get(name)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return value
    return None


def overview() -> dict[str, Any]:
    snapshot = _load_snapshot()
    records = snapshot["records"]
    timeline = []
    for record in records:
        primary = _primary_metric(record)
        if primary is None or not record.get("timestamp"):
            continue
        metric_name, metric = primary
        timeline.append(
            {
                "id": record["id"],
                "timestamp": record["timestamp"],
                "provider": record["provider"],
                "device": record["device"],
                "benchmark": record["benchmark"],
                "metric": metric_name,
                "value": metric["value"],
                "uncertainty": metric.get("uncertainty"),
                "direction": metric.get("direction", "higher"),
                "scale": _scale(record),
                "source_path": record["source_path"],
                "evidence": "measured",
            }
        )

    device_rows: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        device_rows[(record["provider"], record["device"])].append(record)
    devices = []
    for (provider, device), rows in sorted(device_rows.items()):
        latest = max(rows, key=lambda item: item.get("timestamp") or "")
        devices.append(
            {
                "provider": provider,
                "device": device,
                "qubits": latest.get("device_metadata", {}).get("num_qubits"),
                "simulator": latest.get("device_metadata", {}).get("simulator", False),
                "lifecycle": latest.get("lifecycle", {}).get("status", "not documented"),
                "benchmark_runs": len(rows),
                "benchmark_families": sorted({row["benchmark"] for row in rows}),
                "latest_measurement": latest.get("timestamp"),
            }
        )
    summary = snapshot["summary"]
    return {
        "product": "1StopQuantum",
        "record_count": summary["record_count"],
        "provider_count": summary["provider_count"],
        "device_count": summary["device_count"],
        "date_range": summary["date_range"],
        "benchmarks": sorted(summary["benchmark_counts"]),
        "benchmark_counts": summary["benchmark_counts"],
        "devices": devices,
        "timeline": timeline,
        "provenance": snapshot["provenance"],
        "coverage_note": (
            "Coverage is contributed and uneven. Missing measurements mean unknown, not poor performance; "
            "raw scores from different benchmark families are not directly comparable."
        ),
    }


def recommend(body: dict[str, Any]) -> dict[str, Any]:
    try:
        requested_qubits = int(body.get("qubits", 1))
        requested_depth = int(body.get("max_depth", 1))
    except (TypeError, ValueError) as exc:
        raise ValueError("qubits and max_depth must be integers") from exc
    if not 1 <= requested_qubits <= 10000 or not 1 <= requested_depth <= 1000000:
        raise ValueError("qubits and max_depth must be positive and within educational limits")
    workload = str(body.get("workload", "general-circuits"))
    connectivity = str(body.get("connectivity", "any"))
    if workload not in WORKLOAD_BENCHMARKS:
        raise ValueError(f"unsupported workload: {workload}")

    records = _load_snapshot()["records"]
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        grouped[(record["provider"], record["device"])].append(record)
    recommendations = []
    for (provider, device), rows in grouped.items():
        latest = max(rows, key=lambda item: item.get("timestamp") or "")
        metadata = latest.get("device_metadata", {})
        qubits = metadata.get("num_qubits")
        simulator = bool(metadata.get("simulator", False))
        lifecycle = latest.get("lifecycle", {}).get("status", "not documented")
        if not isinstance(qubits, int) or qubits < requested_qubits:
            continue
        if not body.get("include_simulators", False) and simulator:
            continue
        if lifecycle == "retired" and not body.get("include_retired", False):
            continue

        target_benchmarks = WORKLOAD_BENCHMARKS[workload]
        workload_rows = [row for row in rows if row["benchmark"] in target_benchmarks]
        benchmark_families = sorted({row["benchmark"] for row in rows})
        uncertainty_rows = [
            metric
            for row in rows
            for metric in row.get("metrics", {}).values()
            if metric.get("uncertainty") is not None
        ]
        depth_values: list[float] = []
        for row in rows:
            params = row.get("params", {})
            for key in ("depth", "circuit_depth"):
                if isinstance(params.get(key), (int, float)):
                    depth_values.append(float(params[key]))
            layers = params.get("qaoa_layers")
            if isinstance(layers, list):
                depth_values.extend(float(value) for value in layers if isinstance(value, (int, float)))

        capacity_score = max(18.0, 45.0 - min(27.0, (qubits - requested_qubits) / max(requested_qubits, 1) * 18.0))
        workload_score = min(35.0, len(workload_rows) * 4.0) if workload_rows else 0.0
        depth_score = 10.0 if depth_values and max(depth_values) >= requested_depth else (4.0 if depth_values else 2.0)
        lifecycle_score = 10.0 if lifecycle != "retired" else 0.0
        fit_score = min(100.0, capacity_score + workload_score + depth_score + lifecycle_score)
        evidence_score = min(
            100.0,
            len(rows) * 1.4 + len(benchmark_families) * 9.0 + min(15.0, len(uncertainty_rows) * 1.5),
        )
        recommendations.append(
            {
                "rank": 0,
                "provider": provider,
                "device": device,
                "qubits": qubits,
                "simulator": simulator,
                "lifecycle": lifecycle,
                "fit_score": round(fit_score, 1),
                "evidence_score": round(evidence_score, 1),
                "connectivity": "not documented in bundled measurements",
                "reasons": [
                    f"Capacity covers {requested_qubits} requested qubits.",
                    (
                        f"{len(workload_rows)} matching {workload} benchmark runs are available."
                        if workload_rows
                        else f"No directly matching {workload} benchmark is bundled; fit is capacity-based."
                    ),
                    (
                        f"Measured depths/layers reach {int(max(depth_values))}."
                        if depth_values
                        else "Circuit-depth capability is not established by the bundled records."
                    ),
                ],
                "evidence": {
                    "benchmark_runs": len(rows),
                    "matching_workload_runs": len(workload_rows),
                    "benchmark_families": benchmark_families,
                    "reported_uncertainty_runs": len(uncertainty_rows),
                    "latest_measurement": latest.get("timestamp"),
                    "source_paths": sorted({row["source_path"] for row in rows})[:5],
                },
            }
        )
    recommendations.sort(key=lambda item: (-item["fit_score"], -item["evidence_score"], item["device"]))
    for index, item in enumerate(recommendations, start=1):
        item["rank"] = index
    warnings = [
        "Rankings use historical Metriq measurements; they are not live availability, pricing, queue time, or vendor guarantees.",
        "A high suitability score is a screening result, not proof that the workload will outperform its classical baseline.",
    ]
    if connectivity != "any":
        warnings.append(
            f"Requested connectivity '{connectivity}' was not verified because the bundled Metriq records do not define topology."
        )
    if not recommendations:
        warnings.append("No bundled device satisfies the requested qubit capacity and lifecycle filters.")
    return {
        "request": {
            "qubits": requested_qubits,
            "max_depth": requested_depth,
            "workload": workload,
            "connectivity": connectivity,
        },
        "recommendations": recommendations,
        "warnings": warnings,
        "methodology": (
            "Suitability combines qubit capacity, matching workload measurements, observed scale, and lifecycle. "
            "Evidence coverage independently counts runs, benchmark diversity, and reported uncertainty."
        ),
    }


def _matches_selector(record: dict[str, Any], selector: dict[str, Any]) -> bool:
    params = record.get("params", {})
    return all(params.get(key) == value for key, value in selector.items())


def forecast(body: dict[str, Any]) -> dict[str, Any]:
    device = str(body.get("device", "")).strip()
    benchmark = str(body.get("benchmark", "")).strip()
    metric_name = str(body.get("metric", "score")).strip()
    selector = body.get("selector", {})
    if not device or not benchmark or not isinstance(selector, dict):
        raise ValueError("device, benchmark, and selector are required")
    try:
        horizon_days = int(body.get("horizon_days", 365))
    except (TypeError, ValueError) as exc:
        raise ValueError("horizon_days must be an integer") from exc
    if not 30 <= horizon_days <= 3650:
        raise ValueError("horizon_days must be between 30 and 3650")

    points = []
    for record in _load_snapshot()["records"]:
        metric = record.get("metrics", {}).get(metric_name)
        if record["device"] != device or record["benchmark"] != benchmark or metric is None:
            continue
        if not _matches_selector(record, selector):
            continue
        points.append(
            {
                "timestamp": record["timestamp"],
                "value": float(metric["value"]),
                "uncertainty": metric.get("uncertainty"),
                "source_path": record["source_path"],
            }
        )
    points.sort(key=lambda point: point["timestamp"])
    if len(points) < 2:
        raise ValueError("at least two comparable measured points are required for a forecast")

    dates = [datetime.fromisoformat(point["timestamp"]) for point in points]
    origin = dates[0]
    xs = [(date - origin).total_seconds() / 86400 for date in dates]
    ys = [point["value"] for point in points]
    x_mean = mean(xs)
    y_mean = mean(ys)
    denominator = sum((value - x_mean) ** 2 for value in xs)
    slope = sum((x - x_mean) * (y - y_mean) for x, y in zip(xs, ys)) / denominator if denominator else 0.0
    intercept = y_mean - slope * x_mean
    residuals = [y - (intercept + slope * x) for x, y in zip(xs, ys)]
    residual_sigma = math.sqrt(sum(value * value for value in residuals) / max(1, len(points) - 2))
    reported_uncertainty = max(
        [float(point["uncertainty"]) for point in points if isinstance(point.get("uncertainty"), (int, float))]
        or [0.0]
    )
    bounded = all(0 <= value <= 1 for value in ys)
    latest = dates[-1]
    forecast_points = []
    for step in range(1, 7):
        date = latest + timedelta(days=horizon_days * step / 6)
        x = (date - origin).total_seconds() / 86400
        raw = intercept + slope * x
        value = min(1.0, max(0.0, raw)) if bounded else raw
        projection_fraction = (date - latest).total_seconds() / 86400 / max(horizon_days, 1)
        band = max(reported_uncertainty, residual_sigma, abs(value) * 0.05) * (1.0 + 2.0 * projection_fraction)
        lower = value - 1.96 * band
        upper = value + 1.96 * band
        if bounded:
            lower, upper = max(0.0, lower), min(1.0, upper)
        forecast_points.append(
            {
                "timestamp": date.isoformat(),
                "value": round(value, 6),
                "lower": round(lower, 6),
                "upper": round(upper, 6),
                "evidence": "inferred",
            }
        )
    span_days = (dates[-1] - dates[0]).days
    confidence = "low" if len(points) < 6 or span_days < 365 else "moderate"
    return {
        "series": {"device": device, "benchmark": benchmark, "metric": metric_name, "selector": selector},
        "observed": [dict(point, evidence="measured") for point in points],
        "forecast": forecast_points,
        "model": "ordinary least squares with widening 95% exploratory interval",
        "confidence": confidence,
        "slope_per_day": slope,
        "threshold_assessment": {
            "status": "not-a-fault-tolerance-test",
            "reason": (
                "A benchmark score trend alone cannot establish logical error rates, scalable error correction, "
                "system cost, or utility beyond a classical baseline."
            ),
        },
        "disclaimer": (
            "Exploratory projection only. Sparse historical points, hardware changes, and benchmark parameters "
            "can invalidate extrapolation; this is not an investment, procurement, or utility-scale forecast."
        ),
    }


def digest(days: int = 7) -> dict[str, Any]:
    if not 1 <= days <= 365:
        raise ValueError("days must be between 1 and 365")
    records = _load_snapshot()["records"]
    latest = max(datetime.fromisoformat(record["timestamp"]) for record in records if record.get("timestamp"))
    start = latest - timedelta(days=days)
    selected = [
        record for record in records if record.get("timestamp") and datetime.fromisoformat(record["timestamp"]) >= start
    ]
    selected.sort(key=lambda item: item["timestamp"], reverse=True)
    items = []
    for record in selected:
        primary = _primary_metric(record)
        if primary is None:
            continue
        metric_name, metric = primary
        items.append(
            {
                "timestamp": record["timestamp"],
                "provider": record["provider"],
                "device": record["device"],
                "benchmark": record["benchmark"],
                "metric": metric_name,
                "value": metric["value"],
                "uncertainty": metric.get("uncertainty"),
                "source_path": record["source_path"],
                "summary": (
                    f"{record['provider']} reported {record['benchmark']} on {record['device']}: "
                    f"{metric_name} {metric['value']:.4g}."
                ),
            }
        )
    return {
        "title": f"Quantum benchmark digest: latest {days} days in the bundled snapshot",
        "window_start": start.isoformat(),
        "window_end": latest.isoformat(),
        "items": items,
        "provider_counts": dict(Counter(item["provider"] for item in items)),
        "delivery": "Local JSON feed suitable for cron, Slack, Discord, or newsletter adapters.",
        "provenance": _load_snapshot()["provenance"],
    }


def assess_claim(body: dict[str, Any]) -> dict[str, Any]:
    provider = str(body.get("provider", "")).strip()
    claim = str(body.get("claim", "")).strip()
    evidence = body.get("evidence", {})
    if not provider or not claim or not isinstance(evidence, dict):
        raise ValueError("provider, claim, and evidence are required")
    checks = {
        "architecture": bool(evidence.get("architecture")),
        "use_case": bool(evidence.get("use_case")),
        "cost_model": bool(evidence.get("cost_model")),
        "classical_baseline": bool(evidence.get("classical_baseline")),
        "risk_retirement_plan": bool(evidence.get("risk_retirement_plan")),
        "prototype_results": bool(evidence.get("prototype_results")),
        "independent_reproduction": bool(evidence.get("independent_reproduction")),
        "operations_plan": bool(evidence.get("operations_plan")),
    }
    stages = [
        {
            "stage": "A",
            "name": "Plausible utility-scale concept",
            "criteria": ["architecture", "use_case", "cost_model", "classical_baseline"],
        },
        {
            "stage": "B",
            "name": "R&D plan and risk retirement",
            "criteria": ["risk_retirement_plan", "prototype_results"],
        },
        {
            "stage": "C",
            "name": "Independent verification and validation readiness",
            "criteria": ["independent_reproduction", "operations_plan"],
        },
    ]
    for stage in stages:
        complete = sum(1 for key in stage["criteria"] if checks[key])
        stage["complete"] = complete
        stage["total"] = len(stage["criteria"])
        stage["status"] = "ready for review" if complete == len(stage["criteria"]) else "missing evidence"
    missing = sorted(key for key, present in checks.items() if not present)
    completeness = round((len(checks) - len(missing)) / len(checks) * 100)
    critical_missing = {"cost_model", "classical_baseline", "independent_reproduction"}.intersection(missing)
    risk_level = "critical" if len(critical_missing) >= 2 else ("high" if missing else "review-ready")
    return {
        "provider": provider,
        "claim": claim,
        "target_year": body.get("target_year"),
        "evidence_completeness": completeness,
        "risk_level": risk_level,
        "checks": checks,
        "missing_evidence": missing,
        "qbi_inspired_stages": stages,
        "official_darpa_assessment": False,
        "darpa_program_source": DARPA_QBI_URL,
        "disclaimer": (
            "This is an independent educational, QBI-inspired screening rubric, not a DARPA determination, "
            "endorsement, selection decision, or substitute for government verification and validation."
        ),
    }


def use_cases() -> dict[str, Any]:
    return {
        "use_cases": USE_CASES,
        "guidance": (
            "Begin with the public mission decision, define a measurable classical baseline and total cost, "
            "then test whether quantum evidence changes the decision."
        ),
        "darpa_program_source": DARPA_QBI_URL,
    }
