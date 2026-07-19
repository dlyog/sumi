import json
import os
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_1stopquantum_brand_keeps_existing_protocol_identifiers_compatible():
    from app.main import app
    from app.manifest import API_VERSION
    from app.mcp_server import WIDGET_URI, circuit_widget_resource

    assert app.title == "1StopQuantum local simulator"
    assert API_VERSION == "quantumyog.dev/v1"
    assert WIDGET_URI.startswith("ui://quantumyog/")
    assert "1StopQuantum circuit" in circuit_widget_resource()["text"]


def test_user_facing_surfaces_do_not_use_the_quantumlab_name():
    files = [
        ROOT / "README.md",
        ROOT / "public" / "index.html",
        ROOT / "public" / "app.js",
        ROOT / "docs" / "ACADEMIC_GUIDE.md",
        ROOT / "docs" / "MANIFEST_LANGUAGE.md",
    ]
    for path in files:
        text = path.read_text(encoding="utf-8")
        assert "1StopQuantum" in text, path
        assert "QuantumLab" not in text, path


def test_quantumyog_package_and_cli_metadata():
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    assert package["name"] == "quantumyog"

    cli = ROOT / "qyog"
    assert cli.is_file()
    assert os.access(cli, os.X_OK)
