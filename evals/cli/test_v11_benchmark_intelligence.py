from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app


PROJECT = Path(__file__).resolve().parents[2]
SNAPSHOT = PROJECT / "data" / "metriq" / "benchmark_snapshot.json"
ATTRIBUTION = PROJECT / "docs" / "METRIQ_ATTRIBUTION.md"
client = TestClient(app)


def test_normalized_metriq_snapshot_is_bundled_with_provenance():
    assert SNAPSHOT.is_file()
    snapshot = json.loads(SNAPSHOT.read_text(encoding="utf-8"))

    assert snapshot["schema_version"] == "1.0"
    assert len(snapshot["records"]) >= 220
    assert {row["provider"] for row in snapshot["records"]} >= {
        "aws",
        "ibm",
        "origin",
        "quantinuum",
    }
    assert snapshot["provenance"]["license"] == "CC BY 4.0"
    assert "Metriq" in snapshot["provenance"]["attribution"]
    assert snapshot["provenance"]["changes"]
    assert (PROJECT / "scripts" / "import_metriq.py").is_file()
    assert "Creative Commons Attribution 4.0" in ATTRIBUTION.read_text(encoding="utf-8")


def test_overview_exposes_real_measurements_and_coverage_gaps():
    response = client.get("/benchmarking/overview")
    assert response.status_code == 200
    payload = response.json()

    assert payload["product"] == "1StopQuantum"
    assert payload["record_count"] >= 220
    assert payload["provider_count"] >= 4
    assert payload["device_count"] >= 14
    assert payload["date_range"][1].startswith("2026-07-15")
    assert payload["benchmarks"] >= ["BSEQ"]
    assert payload["provenance"]["license"] == "CC BY 4.0"
    assert payload["coverage_note"]
    assert all(point["evidence"] == "measured" for point in payload["timeline"])


def test_qpu_recommendations_rank_fit_and_evidence_separately():
    response = client.post(
        "/benchmarking/recommend",
        json={
            "qubits": 50,
            "max_depth": 60,
            "workload": "optimization",
            "connectivity": "any",
            "include_simulators": False,
        },
    )
    assert response.status_code == 200
    payload = response.json()

    assert len(payload["recommendations"]) >= 3
    assert all(item["qubits"] >= 50 for item in payload["recommendations"])
    assert all(0 <= item["fit_score"] <= 100 for item in payload["recommendations"])
    assert all(0 <= item["evidence_score"] <= 100 for item in payload["recommendations"])
    assert all(item["evidence"]["benchmark_runs"] >= 1 for item in payload["recommendations"])
    assert all(item["lifecycle"] != "retired" for item in payload["recommendations"])
    assert payload["methodology"]
    assert "not live availability" in " ".join(payload["warnings"]).lower()


def test_forecast_has_uncertainty_and_does_not_claim_fault_tolerance():
    response = client.post(
        "/benchmarking/forecast",
        json={
            "device": "ibm_torino",
            "benchmark": "QML Kernel",
            "metric": "score",
            "selector": {"num_qubits": 50},
            "horizon_days": 365,
        },
    )
    assert response.status_code == 200
    payload = response.json()

    assert len(payload["observed"]) == 2
    assert len(payload["forecast"]) >= 2
    assert all(point["lower"] <= point["value"] <= point["upper"] for point in payload["forecast"])
    assert payload["confidence"] == "low"
    assert payload["threshold_assessment"]["status"] == "not-a-fault-tolerance-test"
    assert "exploratory" in payload["disclaimer"].lower()


def test_digest_and_qbi_inspired_assessment_are_evidence_aware():
    digest = client.get("/benchmarking/digest?days=14")
    assert digest.status_code == 200
    digest_payload = digest.json()
    assert digest_payload["window_end"].startswith("2026-07-15")
    assert digest_payload["items"]
    assert all(item["source_path"] for item in digest_payload["items"])

    assessment = client.post(
        "/benchmarking/claims/assess",
        json={
            "provider": "Example Quantum",
            "claim": "Utility-scale system by 2033",
            "target_year": 2033,
            "evidence": {
                "architecture": True,
                "cost_model": False,
                "classical_baseline": False,
                "independent_reproduction": False,
                "risk_retirement_plan": True,
            },
        },
    )
    assert assessment.status_code == 200
    claim = assessment.json()
    assert claim["official_darpa_assessment"] is False
    assert [stage["stage"] for stage in claim["qbi_inspired_stages"]] == ["A", "B", "C"]
    assert claim["risk_level"] in {"high", "critical"}
    assert claim["missing_evidence"] >= ["classical_baseline"]
    assert "not a darpa determination" in claim["disclaimer"].lower()

    use_cases = client.get("/benchmarking/use-cases").json()["use_cases"]
    assert {item["sector"] for item in use_cases} >= {"Energy", "Logistics", "Materials"}
    assert all(item["classical_baseline"] for item in use_cases)
    assert all(item["evidence_status"] in {"research", "emerging", "demonstrated"} for item in use_cases)
