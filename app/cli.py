from __future__ import annotations

import argparse
import base64
import json
import sys
import webbrowser
from pathlib import Path

from .engine import compile_source, run
from .llm import LocalLLM
from .manifest import (
    ManifestValidationError,
    default_manifest_name,
    dump_manifest,
    load_manifest_file,
    manifest_from_ir,
)
from .nl2circuit import NotACircuitError, translate_with_fidelity
from .simplify import simplify_ir


def _write(path: str | None, content: str) -> None:
    if path:
        output = Path(path)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(content, encoding="utf-8")
    else:
        print(content, end="")


def _output_format(path: str | None, requested: str | None) -> str:
    if requested:
        return requested
    return "json" if path and Path(path).suffix.lower() == ".json" else "yaml"


def _add_file_argument(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("file", help="1StopQuantum .qyog.yaml or .qyog.json manifest")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="qyog", description="Declarative 1StopQuantum circuit workflow")
    parser.add_argument("--version", action="version", version="1StopQuantum CLI 0.5.4")
    commands = parser.add_subparsers(dest="command", required=True)

    init_parser = commands.add_parser("init", help="Create a starter manifest")
    init_parser.add_argument("directory", nargs="?", default=".")

    fmt_parser = commands.add_parser("fmt", help="Normalize manifest formatting")
    _add_file_argument(fmt_parser)
    fmt_parser.add_argument("--format", choices=("yaml", "json"))
    fmt_parser.add_argument("--check", action="store_true")

    validate_parser = commands.add_parser("validate", help="Validate without executing")
    _add_file_argument(validate_parser)

    plan_parser = commands.add_parser("plan", help="Preview compilation and simplification")
    _add_file_argument(plan_parser)

    show_parser = commands.add_parser("show", help="Print the normalized manifest")
    _add_file_argument(show_parser)
    show_parser.add_argument("--format", choices=("yaml", "json"), default="yaml")

    compile_parser = commands.add_parser("compile", help="Generate Qiskit or Cirq Python")
    _add_file_argument(compile_parser)
    compile_parser.add_argument("--target", choices=("qiskit", "cirq"))
    compile_parser.add_argument("--output", "-o")

    run_parser = commands.add_parser("run", help="Execute on a local simulator")
    _add_file_argument(run_parser)
    run_parser.add_argument("--backend", choices=("qiskit", "cirq"))
    run_parser.add_argument("--json", action="store_true")

    generate_parser = commands.add_parser("generate", help="Generate a manifest from natural language")
    generate_parser.add_argument("prompt")
    generate_parser.add_argument("--name")
    generate_parser.add_argument("--backend", choices=("qiskit", "cirq"), default="qiskit")
    generate_parser.add_argument("--format", choices=("yaml", "json"))
    generate_parser.add_argument("--output", "-o")

    visualize_parser = commands.add_parser("visualize", help="Open a manifest in the browser workspace")
    _add_file_argument(visualize_parser)
    visualize_parser.add_argument("--base-url", default="http://localhost:8080")
    visualize_parser.add_argument("--no-open", action="store_true")
    return parser


def _starter_manifest() -> dict:
    return {
        "apiVersion": "quantumyog.dev/v1",
        "kind": "Circuit",
        "metadata": {"name": "bell-state", "description": "Prepare and measure a Bell pair."},
        "spec": {
            "backend": "qiskit",
            "circuit": {
                "version": "1.0",
                "num_qubits": 2,
                "gates": [
                    {"op": "H", "targets": [0]},
                    {"op": "CNOT", "controls": [0], "targets": [1]},
                    {"op": "measure", "targets": [0, 1]},
                ],
                "shots": 1024,
                "seed": 42,
            },
        },
    }


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "init":
            destination = Path(args.directory) / "main.qyog.yaml"
            if destination.exists():
                raise ManifestValidationError(f"{destination} already exists")
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(dump_manifest(_starter_manifest()), encoding="utf-8")
            print(f"Initialized {destination}")
            return 0

        if args.command == "generate":
            outcome = translate_with_fidelity(args.prompt, LocalLLM())
            manifest = manifest_from_ir(
                outcome.ir,
                name=args.name or default_manifest_name(args.prompt),
                backend=args.backend,
                description="Generated from a natural-language request.",
                source_prompt=args.prompt,
            )
            output_format = _output_format(args.output, args.format)
            _write(args.output, dump_manifest(manifest, output_format))
            if args.output:
                print(f"Generated {args.output}")
            if outcome.warning:
                print(f"Warning: {outcome.warning}", file=sys.stderr)
            return 0

        document = load_manifest_file(args.file)
        if args.command == "validate":
            print(f"Success! {args.file} is a valid 1StopQuantum manifest.")
        elif args.command == "fmt":
            output_format = _output_format(args.file, args.format)
            formatted = dump_manifest(document.manifest, output_format)
            current = Path(args.file).read_text(encoding="utf-8")
            if args.check:
                if current != formatted:
                    print(f"Formatting differs: {args.file}", file=sys.stderr)
                    return 1
            else:
                Path(args.file).write_text(formatted, encoding="utf-8")
                print(args.file)
        elif args.command == "plan":
            simplified, removed = simplify_ir(document.ir)
            print("1StopQuantum execution plan")
            print(f"  Manifest: {document.manifest['metadata']['name']}")
            print(f"  Backend: {document.backend}")
            print(f"  Circuit: {simplified['num_qubits']} qubits, {len(simplified['gates'])} operations")
            print(f"  Simplification: {removed} operations removed")
            print("Plan: validate -> simplify -> compile -> simulate -> visualize")
        elif args.command == "show":
            print(dump_manifest(document.manifest, args.format), end="")
        elif args.command == "compile":
            target = args.target or document.backend
            _write(args.output, compile_source(document.ir, target) + "\n")
            if args.output:
                print(f"Compiled {document.manifest['metadata']['name']} to {args.output}", file=sys.stderr)
        elif args.command == "run":
            backend = args.backend or document.backend
            result = run(document.ir, backend=backend)
            payload = {
                "manifest": document.manifest["metadata"]["name"],
                "backend": backend,
                "engine": result.engine,
                "counts": result.counts,
                "statevector": result.statevector,
                "simplified_removed": result.simplified_removed,
            }
            if args.json:
                print(json.dumps(payload, indent=2))
            else:
                print(f"Applied {payload['manifest']} with {payload['engine']}")
                for outcome, count in result.counts.items():
                    print(f"  {outcome}: {count}")
        elif args.command == "visualize":
            raw = json.dumps(document.manifest, separators=(",", ":")).encode("utf-8")
            encoded = base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")
            url = f"{args.base_url.rstrip('/')}#manifest={encoded}"
            print(url)
            if not args.no_open:
                webbrowser.open(url)
        return 0
    except (ManifestValidationError, NotACircuitError, RuntimeError, ValueError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
