from __future__ import annotations

import json
import re
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from .ir import IRValidationError, normalize_ir
from .templates import expand_template


API_VERSION = "quantumyog.dev/v1"
KIND = "Circuit"
_NAME_PATTERN = re.compile(r"^[a-z][a-z0-9-]{0,62}$")


class ManifestValidationError(ValueError):
    """Raised when a QuantumYog manifest cannot be parsed or validated."""


@dataclass(frozen=True)
class ManifestDocument:
    manifest: dict[str, Any]
    ir: dict[str, Any]
    backend: str


def _unknown_fields(obj: dict[str, Any], allowed: set[str], location: str) -> None:
    unknown = sorted(set(obj) - allowed)
    if unknown:
        label = "field" if len(unknown) == 1 else "fields"
        raise ManifestValidationError(f"unknown {location} {label}: {', '.join(unknown)}")


def _require_mapping(value: Any, location: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ManifestValidationError(f"{location} must be an object")
    return value


def _normalize_manifest(obj: dict[str, Any]) -> ManifestDocument:
    _unknown_fields(obj, {"apiVersion", "kind", "metadata", "spec"}, "top-level")
    if obj.get("apiVersion") != API_VERSION:
        raise ManifestValidationError(f"apiVersion must be {API_VERSION!r}")
    if obj.get("kind") != KIND:
        raise ManifestValidationError(f"kind must be {KIND!r}")

    metadata = _require_mapping(obj.get("metadata"), "metadata")
    _unknown_fields(metadata, {"name", "description", "sourcePrompt"}, "metadata")
    name = metadata.get("name")
    if not isinstance(name, str) or not _NAME_PATTERN.fullmatch(name):
        raise ManifestValidationError(
            "metadata.name must start with a lowercase letter and contain only lowercase letters, digits, or hyphens"
        )
    for field in ("description", "sourcePrompt"):
        if field in metadata and not isinstance(metadata[field], str):
            raise ManifestValidationError(f"metadata.{field} must be a string")

    spec = _require_mapping(obj.get("spec"), "spec")
    _unknown_fields(spec, {"backend", "circuit", "template"}, "spec")
    backend = spec.get("backend", "qiskit")
    if backend not in {"qiskit", "cirq"}:
        raise ManifestValidationError("spec.backend must be 'qiskit' or 'cirq'")
    choices = [key for key in ("circuit", "template") if key in spec]
    if len(choices) != 1:
        raise ManifestValidationError("spec must contain exactly one of circuit or template")

    normalized_spec: dict[str, Any] = {"backend": backend}
    try:
        if "circuit" in spec:
            circuit = _require_mapping(spec["circuit"], "spec.circuit")
            ir = normalize_ir(circuit)
            normalized_spec["circuit"] = ir
        else:
            template = _require_mapping(spec["template"], "spec.template")
            _unknown_fields(template, {"name", "parameters"}, "template")
            template_name = template.get("name")
            parameters = template.get("parameters", {})
            if not isinstance(template_name, str) or not template_name.strip():
                raise ManifestValidationError("spec.template.name is required")
            if not isinstance(parameters, dict):
                raise ManifestValidationError("spec.template.parameters must be an object")
            ir = normalize_ir(expand_template({"template": template_name, "params": parameters}))
            normalized_spec["template"] = {
                "name": template_name.strip().lower().replace("-", "_"),
                "parameters": deepcopy(parameters),
            }
    except IRValidationError as exc:
        raise ManifestValidationError(str(exc)) from exc

    normalized = {
        "apiVersion": API_VERSION,
        "kind": KIND,
        "metadata": deepcopy(metadata),
        "spec": normalized_spec,
    }
    return ManifestDocument(normalized, ir, backend)


def load_manifest(document: str | bytes | dict[str, Any]) -> ManifestDocument:
    if isinstance(document, dict):
        obj = deepcopy(document)
    else:
        if isinstance(document, bytes):
            document = document.decode("utf-8")
        if not isinstance(document, str) or not document.strip():
            raise ManifestValidationError("manifest document is empty")
        try:
            obj = yaml.safe_load(document)
        except yaml.YAMLError as exc:
            raise ManifestValidationError(f"manifest is not valid YAML or JSON: {exc}") from exc
    if not isinstance(obj, dict):
        raise ManifestValidationError("manifest must decode to an object")
    return _normalize_manifest(obj)


def load_manifest_file(path: str | Path) -> ManifestDocument:
    manifest_path = Path(path)
    try:
        return load_manifest(manifest_path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise ManifestValidationError(f"could not read {manifest_path}: {exc}") from exc


def manifest_from_ir(
    ir: dict[str, Any],
    *,
    name: str = "generated-circuit",
    backend: str = "qiskit",
    description: str | None = None,
    source_prompt: str | None = None,
) -> dict[str, Any]:
    metadata: dict[str, Any] = {"name": name}
    if description:
        metadata["description"] = description
    if source_prompt:
        metadata["sourcePrompt"] = source_prompt
    manifest = {
        "apiVersion": API_VERSION,
        "kind": KIND,
        "metadata": metadata,
        "spec": {"backend": backend, "circuit": normalize_ir(ir)},
    }
    return _normalize_manifest(manifest).manifest


def dump_manifest(manifest: dict[str, Any], output_format: str = "yaml") -> str:
    normalized = load_manifest(manifest).manifest
    if output_format == "json":
        return json.dumps(normalized, indent=2) + "\n"
    if output_format != "yaml":
        raise ManifestValidationError("format must be 'yaml' or 'json'")
    return yaml.safe_dump(normalized, sort_keys=False, default_flow_style=False)


def default_manifest_name(text: str) -> str:
    value = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    if not value or not value[0].isalpha():
        value = f"circuit-{value}".strip("-")
    return value[:63].rstrip("-") or "generated-circuit"
