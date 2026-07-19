from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor

from app import engine


def test_framework_simulation_uses_one_stable_worker(monkeypatch):
    active = 0
    max_active = 0
    framework_threads: set[int] = set()
    guard = threading.Lock()

    def fake_framework_state(ir, backend):
        nonlocal active, max_active
        with guard:
            active += 1
            max_active = max(max_active, active)
            framework_threads.add(threading.get_ident())
        time.sleep(0.03)
        state = engine._simulate_state(ir)
        with guard:
            active -= 1
        return state, "test simulator"

    monkeypatch.setattr(engine, "_framework_state", fake_framework_state)
    ir = {
        "version": "1.0",
        "num_qubits": 2,
        "gates": [
            {"op": "H", "targets": [0]},
            {"op": "CNOT", "controls": [0], "targets": [1]},
            {"op": "measure", "targets": [0, 1]},
        ],
        "shots": 64,
        "seed": 42,
    }

    with ThreadPoolExecutor(max_workers=4) as callers:
        results = list(callers.map(lambda _: engine.run(ir), range(8)))

    assert all(result.counts for result in results)
    assert max_active == 1
    assert len(framework_threads) == 1
