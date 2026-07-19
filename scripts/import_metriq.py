#!/usr/bin/env python3
"""Normalize a local Metriq data checkout into 1StopQuantum's portable snapshot."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from collections import defaultdict
from pathlib import Path
from typing import Any


PROJECT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = PROJECT.parents[1] / "metriq-data"
DEFAULT_OUTPUT = PROJECT / "data" / "metriq" / "benchmark_snapshot.json"


def _git_revision(source: Path) -> str | None:
    result = subprocess.run(
        ["git", "-C", str(source), "rev-parse", "HEAD"],
        capture_output=True,
        check=False,
        text=True,
    )
    return result.stdout.strip() or None


def _numeric_metric(value: Any) -> tuple[float, float | None] | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value), None
    if not isinstance(value, dict) or isinstance(value.get("value"), bool):
        return None
    if not isinstance(value.get("value"), (int, float)):
        return None
    uncertainty = value.get("uncertainty")
    return float(value["value"]), float(uncertainty) if isinstance(uncertainty, (int, float)) else None


def _metric_direction(benchmark: str, metric: str) -> str:
    if benchmark == "EPLG" and (metric == "score" or metric.startswith("eplg_")):
        return "lower"
    return "higher"


def _load_lifecycle(source: Path) -> dict[tuple[str, str], dict[str, Any]]:
    catalog_path = source / "scripts" / "platform_catalog.json"
    if not catalog_path.is_file():
        return {}
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    return {
        (item["provider"], item["device"]): item.get("lifecycle", {})
        for item in catalog.get("platforms", [])
    }


def build_snapshot(source: Path) -> dict[str, Any]:
    gym_root = source / "metriq-gym"
    if not gym_root.is_dir():
        raise FileNotFoundError(f"Metriq benchmark data not found: {gym_root}")
    lifecycle = _load_lifecycle(source)
    records: list[dict[str, Any]] = []

    for path in sorted(gym_root.glob("v*/*/*/*.json")):
        if path.name == "results.json":
            continue
        document = json.loads(path.read_text(encoding="utf-8"))
        rows = document if isinstance(document, list) else [document]
        source_path = path.relative_to(source).as_posix()
        for index, row in enumerate(rows):
            platform = row.get("platform", {})
            metadata = platform.get("device_metadata", {})
            benchmark = str(row.get("job_type") or row.get("params", {}).get("benchmark_name") or "Unknown")
            metrics: dict[str, dict[str, Any]] = {}
            for name, value in row.get("results", {}).items():
                parsed = _numeric_metric(value)
                if parsed is None:
                    continue
                metric_value, uncertainty = parsed
                metrics[name] = {
                    "value": metric_value,
                    "uncertainty": uncertainty,
                    "direction": _metric_direction(benchmark, name),
                }
            params = row.get("params", {})
            record_id = hashlib.sha256(f"{source_path}:{index}".encode()).hexdigest()[:16]
            records.append(
                {
                    "id": record_id,
                    "series": path.parts[-4],
                    "timestamp": row.get("timestamp"),
                    "provider": platform.get("provider"),
                    "device": platform.get("device"),
                    "device_metadata": {
                        "num_qubits": metadata.get("num_qubits"),
                        "simulator": bool(metadata.get("simulator", False)),
                        "version": metadata.get("version"),
                    },
                    "lifecycle": lifecycle.get(
                        (platform.get("provider"), platform.get("device")),
                        {"status": "not documented"},
                    ),
                    "benchmark": benchmark,
                    "metrics": metrics,
                    "params": params,
                    "runtime_seconds": row.get("runtime_seconds"),
                    "app_version": row.get("app_version"),
                    "source_path": source_path,
                }
            )

    if not records:
        raise ValueError("No individual Metriq benchmark records were found")
    records.sort(key=lambda item: (item.get("timestamp") or "", item["id"]))
    dates = [item["timestamp"] for item in records if item.get("timestamp")]
    providers = sorted({item["provider"] for item in records if item.get("provider")})
    devices = sorted({item["device"] for item in records if item.get("device")})
    benchmark_counts: dict[str, int] = defaultdict(int)
    for record in records:
        benchmark_counts[record["benchmark"]] += 1

    return {
        "schema_version": "1.0",
        "snapshot_as_of": max(dates),
        "summary": {
            "record_count": len(records),
            "provider_count": len(providers),
            "device_count": len(devices),
            "date_range": [min(dates), max(dates)],
            "benchmark_counts": dict(sorted(benchmark_counts.items())),
        },
        "provenance": {
            "dataset": "metriq-data",
            "publisher": "Unitary Foundation / Metriq contributors",
            "source_url": "https://github.com/unitaryfoundation/metriq-data",
            "source_revision": _git_revision(source),
            "license": "CC BY 4.0",
            "license_url": "https://creativecommons.org/licenses/by/4.0/",
            "attribution": "Uses Metriq benchmark data from the Unitary Foundation and Metriq contributors.",
            "changes": [
                "Reformatted individual Metriq Gym JSON results into one portable snapshot.",
                "Extracted numeric value, uncertainty, metric direction, device metadata, and source path.",
                "Preserved raw metric values; no vendor or benchmark scores were invented.",
            ],
        },
        "records": records,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    snapshot = build_snapshot(args.source.resolve())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(snapshot, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(
        f"Imported {snapshot['summary']['record_count']} Metriq measurements "
        f"from {snapshot['summary']['provider_count']} providers into {args.output}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
