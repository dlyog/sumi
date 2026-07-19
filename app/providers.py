from __future__ import annotations

from collections import Counter
from typing import Any


class QUBOValidationError(ValueError):
    """Raised when the annealing lesson receives an invalid QUBO document."""


PROVIDERS = [
    {
        "id": "qiskit",
        "name": "Qiskit",
        "organization": "IBM",
        "paradigm": "gate",
        "availability": "local",
        "role": "Default SDK and local statevector simulation",
    },
    {
        "id": "cirq",
        "name": "Cirq",
        "organization": "Google",
        "paradigm": "gate",
        "availability": "local",
        "role": "Alternate hardware-aware circuit adapter",
    },
    {
        "id": "ionq",
        "name": "IonQ",
        "organization": "IonQ",
        "paradigm": "gate-hardware",
        "availability": "planned",
        "role": "Future trapped-ion hardware submission through the same Circuit IR",
    },
    {
        "id": "dwave",
        "name": "D-Wave",
        "organization": "D-Wave",
        "paradigm": "annealing",
        "availability": "local-simulated",
        "role": "QUBO optimization lesson using a local simulated annealer",
    },
]


def provider_catalog() -> dict[str, Any]:
    return {
        "default": "qiskit",
        "providers": PROVIDERS,
        "notice": "Local results are simulated. No real quantum hardware is contacted.",
    }


def route_intent(text: str) -> dict[str, str]:
    lower = text.lower().strip()
    optimization_terms = ("optimize", "max-cut", "max cut", "split", "route", "schedule", "knapsack", "graph")
    circuit_terms = ("qubit", "entangle", "gate", "bell", "ghz", "grover", "measure", "superposition")
    if any(term in lower for term in optimization_terms):
        return {
            "paradigm": "annealing",
            "reason": "This is a discrete optimization request, so it maps to QUBO and local simulated annealing.",
        }
    if any(term in lower for term in circuit_terms):
        return {
            "paradigm": "circuit",
            "reason": "This describes qubits or gates, so it maps to Circuit IR and a gate-model simulator.",
        }
    return {
        "paradigm": "unknown",
        "reason": "No clear optimization or gate-model signal was found; rephrase with the desired quantum task.",
    }


def normalize_qubo(value: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise QUBOValidationError("QUBO IR must be a JSON object")
    if value.get("version") != "1.0" or value.get("kind") != "qubo":
        raise QUBOValidationError("QUBO IR requires version '1.0' and kind 'qubo'")

    variables = value.get("variables")
    if (
        not isinstance(variables, list)
        or not 1 <= len(variables) <= 64
        or any(not isinstance(item, str) or not item for item in variables)
        or len(set(variables)) != len(variables)
    ):
        raise QUBOValidationError("variables must contain 1-64 unique names")
    variable_set = set(variables)

    linear = value.get("linear", {})
    quadratic = value.get("quadratic", {})
    if not isinstance(linear, dict) or not isinstance(quadratic, dict):
        raise QUBOValidationError("linear and quadratic must be JSON objects")
    if set(linear) - variable_set:
        raise QUBOValidationError("linear contains an unknown variable")
    if any(not isinstance(weight, (int, float)) for weight in linear.values()):
        raise QUBOValidationError("linear weights must be numeric")

    clean_quadratic: dict[tuple[str, str], float] = {}
    for pair, weight in quadratic.items():
        names = [name.strip() for name in pair.split(",")] if isinstance(pair, str) else []
        if len(names) != 2 or names[0] == names[1] or set(names) - variable_set:
            raise QUBOValidationError(f"invalid quadratic pair {pair!r}")
        if not isinstance(weight, (int, float)):
            raise QUBOValidationError("quadratic weights must be numeric")
        clean_quadratic[(names[0], names[1])] = float(weight)

    num_reads = value.get("num_reads", 100)
    seed = value.get("seed", 42)
    if not isinstance(num_reads, int) or not 1 <= num_reads <= 10000:
        raise QUBOValidationError("num_reads must be an integer from 1 to 10000")
    if not isinstance(seed, int) or seed < 0:
        raise QUBOValidationError("seed must be a non-negative integer")
    return {
        "version": "1.0",
        "kind": "qubo",
        "variables": variables,
        "linear": {name: float(linear.get(name, 0.0)) for name in variables},
        "quadratic": clean_quadratic,
        "num_reads": num_reads,
        "seed": seed,
    }


def run_qubo(value: dict[str, Any]) -> dict[str, Any]:
    import neal

    qubo = normalize_qubo(value)
    matrix: dict[tuple[str, str], float] = {
        (name, name): weight for name, weight in qubo["linear"].items()
    }
    matrix.update(qubo["quadratic"])
    samples = neal.SimulatedAnnealingSampler().sample_qubo(
        matrix,
        num_reads=qubo["num_reads"],
        seed=qubo["seed"],
    )

    frequencies: Counter[tuple[tuple[str, int], ...]] = Counter()
    energies: dict[tuple[tuple[str, int], ...], float] = {}
    energy_frequencies: Counter[float] = Counter()
    for datum in samples.data(fields=["sample", "energy"]):
        key = tuple((name, int(datum.sample[name])) for name in qubo["variables"])
        frequencies[key] += 1
        energies[key] = float(datum.energy)
        energy_frequencies[round(float(datum.energy), 6)] += 1
    ranked = sorted(frequencies, key=lambda key: (energies[key], -frequencies[key], key))
    results = [
        {
            "sample": dict(key),
            "energy": round(energies[key], 6),
            "reads": frequencies[key],
        }
        for key in ranked[:12]
    ]
    return {
        "ir": {
            **qubo,
            "quadratic": {f"{left},{right}": weight for (left, right), weight in qubo["quadratic"].items()},
        },
        "best": results[0],
        "samples": results,
        "energy_histogram": [
            {"energy": energy, "reads": reads, "best": energy == results[0]["energy"]}
            for energy, reads in sorted(energy_frequencies.items())
        ],
        "execution": {
            "backend": "dwave-neal",
            "engine": "local simulated annealing",
            "simulated": True,
        },
    }
