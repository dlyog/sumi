import pytest

from app.persistence import MemoryStore


CIRCUIT = {
    "version": "1.0",
    "num_qubits": 1,
    "gates": [{"op": "H", "targets": [0]}, {"op": "measure", "targets": [0]}],
    "shots": 128,
    "seed": 42,
}


def test_explorer_plan_limits_active_scheduled_jobs():
    store = MemoryStore()
    account = store.create_account(
        email="limit@example.edu", display_name="Limit", plan="explorer", password="quantum-limit"
    )
    body = {
        "user_id": account["id"],
        "circuit": CIRCUIT,
        "objective": "Review the circuit",
        "schedule_at": "2099-01-01T00:00:00Z",
        "max_iterations": 2,
    }

    store.create_job(body)
    with pytest.raises(ValueError, match="active scheduled-job limit"):
        store.create_job(body)


def test_completed_job_releases_the_active_job_quota():
    store = MemoryStore()
    account = store.create_account(
        email="release@example.edu", display_name="Release", plan="explorer", password="quantum-release"
    )
    body = {
        "user_id": account["id"],
        "circuit": CIRCUIT,
        "objective": "Review the circuit",
        "max_iterations": 2,
        "run_now": True,
    }

    assert store.create_job(body)["status"] == "completed"
    assert store.create_job(body)["status"] == "completed"
