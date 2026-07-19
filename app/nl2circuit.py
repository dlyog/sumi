from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from typing import Any

from .ir import IRValidationError, normalize_ir
from .simplify import simplify_ir
from .templates import expand_template


class NotACircuitError(ValueError):
    """Raised when the request is not asking for a quantum circuit."""


SYSTEM_PROMPT = """You are the JSON compiler for a quantum-computing teaching app.
Return exactly one JSON object. Do not return prose or invent fields.

For an ordinary circuit request, return this Circuit IR shape:
{"version":"1.0","num_qubits":2,"gates":[{"op":"H","targets":[0]},{"op":"CNOT","controls":[0],"targets":[1]},{"op":"measure","targets":[0,1]}],"shots":1024,"seed":42}

Circuit rules:
- Allowed ops are H, X, Y, Z, S, T, RX, RY, RZ, CNOT, CZ, SWAP, measure.
- Qubit indices are zero-based and less than num_qubits.
- RX, RY, and RZ require params with one angle in radians.
- CNOT and CZ require exactly one control and one target.
- SWAP uses exactly two targets.
- End with one measure gate over all requested qubits.
- Entangling two qubits is an ordinary circuit: H on 0, then CNOT 0 to 1.
- "Entangle three qubits and measure them" means the GHZ template:
  {"template":"ghz","params":{"qubits":3}}.

Only these named algorithms may use a template object:
- {"template":"ghz","params":{"qubits":3}}
- {"template":"grover","params":{"marked":"11"}}
- {"template":"deutsch_jozsa","params":{"input_qubits":2,"oracle":"constant"}}
- {"template":"qrng","params":{"qubits":1}}
Never invent another template name. If unsure, emit a full Circuit IR instead.

If the request is not about a quantum circuit or one of those algorithms, return
{"error":"not a circuit request"}."""


NUMBER_WORDS = {
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
    "eleven": 11,
    "twelve": 12,
}


@dataclass
class TranslationOutcome:
    ir: dict[str, Any]
    warning: str | None = None
    simplified_removed: int = 0
    template: dict[str, Any] | None = None


def _strip_fences(text: str) -> str:
    value = text.strip()
    fenced = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", value, flags=re.DOTALL | re.IGNORECASE)
    if fenced:
        return fenced.group(1).strip()
    first, last = value.find("{"), value.rfind("}")
    if first != -1 and last != -1 and last > first:
        return value[first:last + 1]
    return value


def _parse_response(text: str) -> dict[str, Any]:
    try:
        obj = json.loads(_strip_fences(text))
    except Exception as exc:
        raise IRValidationError(f"LLM did not return valid JSON: {exc}") from exc
    if not isinstance(obj, dict):
        raise IRValidationError("LLM JSON must be an object")
    if obj.get("error") == "not a circuit request":
        raise NotACircuitError("That does not look like a quantum circuit request.")
    return obj


def _decode_ir(response: str) -> tuple[dict[str, Any], dict[str, Any] | None]:
    obj = _parse_response(response)
    template = None
    if obj.get("template"):
        template = {"name": str(obj["template"]), "params": obj.get("params", {})}
    return normalize_ir(expand_template(obj)), template


def _expected_qubits(text: str) -> int | None:
    lower = text.lower()
    digit = re.search(r"\b(\d+)\s*[- ]?\s*qubits?\b", lower)
    if digit:
        return int(digit.group(1))
    words = "|".join(NUMBER_WORDS)
    word = re.search(rf"\b({words})\s+qubits?\b", lower)
    return NUMBER_WORDS[word.group(1)] if word else None


def _fidelity_warning(text: str, ir: dict[str, Any]) -> str | None:
    expected = _expected_qubits(text)
    actual = ir["num_qubits"]
    if expected is not None and expected != actual:
        noun = "qubit" if expected == 1 else "qubits"
        return f"This may not match your request — expected {expected} {noun}, got {actual}."
    if expected == 1 and any(gate["op"] in {"CNOT", "CZ", "SWAP"} for gate in ir["gates"]):
        return "This may not match your request — a single-qubit request contains an entangling gate."
    return None


def translate_with_fidelity(text: str, llm) -> TranslationOutcome:
    user = f"Translate this request to Circuit IR JSON: {text}"
    last_error = ""
    previous_response = ""
    ir: dict[str, Any] | None = None
    template: dict[str, Any] | None = None

    # Schema repair remains exactly one retry, preserving the v0.1 contract.
    for attempt in range(2):
        prompt = user
        if attempt == 1:
            prompt = (
                f"{user}\n\nYour previous JSON was rejected:\n{previous_response}\n\n"
                f"Validation error: {last_error}\nReturn one corrected JSON object now."
            )
        try:
            previous_response = llm.complete(SYSTEM_PROMPT, prompt)
            ir, template = _decode_ir(previous_response)
            break
        except NotACircuitError:
            raise
        except IRValidationError as exc:
            last_error = str(exc)
    if ir is None:
        raise IRValidationError(last_error or "invalid Circuit IR")

    simplified, removed = simplify_ir(ir)
    warning = _fidelity_warning(text, simplified)
    if warning:
        retry_prompt = (
            f"{user}\n\nYour previous circuit was valid JSON but failed semantic fidelity:\n"
            f"{warning}\nPrevious JSON:\n{previous_response}\n\n"
            "Return one corrected JSON object that matches the requested qubit count and operations."
        )
        try:
            retry_response = llm.complete(SYSTEM_PROMPT, retry_prompt)
            retry_ir, retry_template = _decode_ir(retry_response)
            retry_simplified, retry_removed = simplify_ir(retry_ir)
            retry_warning = _fidelity_warning(text, retry_simplified)
            simplified, removed, warning = retry_simplified, retry_removed, retry_warning
            template = retry_template
        except (IRValidationError, NotACircuitError):
            pass
    return TranslationOutcome(simplified, warning, removed, template)


def translate(text: str, llm) -> dict[str, Any]:
    return translate_with_fidelity(text, llm).ir


def known_request_fallback(text: str) -> dict[str, Any] | None:
    """Expand only high-confidence requests when a small local model emits bad JSON.

    This runs after both LLM attempts fail. It intentionally handles a narrow set
    of common teaching phrases instead of guessing at arbitrary user intent.
    """
    lower = text.lower().strip()
    rotation = re.search(
        r"\brotate\s+qubit\s+(\d+)\s+by\s+([-+]?(?:\d+(?:\.\d*)?|\.\d+))\s*"
        r"(?:degrees?|°)\s+(?:around|about)\s+([xyz])\b",
        lower,
    )
    if rotation:
        qubit = int(rotation.group(1))
        angle = math.radians(float(rotation.group(2)))
        axis = rotation.group(3).upper()
        return normalize_ir(
            {
                "version": "1.0",
                "num_qubits": qubit + 1,
                "gates": [
                    {"op": f"R{axis}", "targets": [qubit], "params": [angle]},
                    {"op": "measure", "targets": [qubit]},
                ],
                "shots": 1024,
                "seed": 42,
            }
        )
    single_qubit = bool(re.search(r"\b(?:a|one|1)[ -]?qubit\b", lower))
    if "superposition" in lower and single_qubit:
        return normalize_ir(
            {
                "version": "1.0",
                "num_qubits": 1,
                "gates": [
                    {"op": "H", "targets": [0]},
                    {"op": "measure", "targets": [0]},
                ],
                "shots": 1024,
                "seed": 42,
            }
        )
    match = re.search(
        r"\bentangle\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+qubits?\b",
        lower,
    )
    if not match:
        return None
    token = match.group(1)
    count = int(token) if token.isdigit() else NUMBER_WORDS[token]
    if count == 2:
        return normalize_ir(
            {
                "version": "1.0",
                "num_qubits": 2,
                "gates": [
                    {"op": "H", "targets": [0]},
                    {"op": "CNOT", "controls": [0], "targets": [1]},
                    {"op": "measure", "targets": [0, 1]},
                ],
                "shots": 1024,
                "seed": 42,
            }
        )
    if 3 <= count <= 12:
        return normalize_ir(expand_template({"template": "ghz", "params": {"qubits": count}}))
    return None
