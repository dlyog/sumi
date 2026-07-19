import json
from pathlib import Path
from subprocess import run


ROOT = Path(__file__).resolve().parents[1]


def test_shareable_sumi_framework_guide_has_required_brand_and_three_provider_contracts():
    guide = (ROOT / "docs" / "SumiFramework.html").read_text(encoding="utf-8")

    assert "1StopQuantum — Powered by Sumi" in guide
    assert "Speech-to-text" in guide
    assert "LLM" in guide
    assert "Text-to-speech" in guide
    assert "sumi-framework init" in guide


def test_sumi_cli_scaffolds_provider_neutral_screen_adapter(tmp_path):
    result = run(
        [
            "node",
            str(ROOT / "scripts" / "sumi-framework-cli.js"),
            "init",
            "--screen",
            "lesson-lab",
            "--title",
            "Lesson Lab",
            "--out",
            str(tmp_path),
        ],
        capture_output=True,
        check=False,
        text=True,
    )

    assert result.returncode == 0, result.stderr
    assert (tmp_path / "sumi.config.json").is_file()
    assert (tmp_path / "lesson-lab.registry.json").is_file()
    registry = json.loads((tmp_path / "lesson-lab.registry.json").read_text(encoding="utf-8"))
    assert set(registry["screens"]["lesson-lab"]["allowed_actions"]) == {
        entry["id"] for entry in registry["actions"]
    }
    adapter = (tmp_path / "lesson-lab.adapter.js").read_text(encoding="utf-8")
    assert "SumiFramework" in adapter
    assert "SUMI_STT_URL" in adapter
    assert "SUMI_LLM_URL" in adapter
    assert "SUMI_TTS_URL" in adapter
    assert "uiActions" in adapter


def test_sumi_cli_validates_the_bundled_screen_registry():
    result = run(
        [
            "node",
            str(ROOT / "scripts" / "sumi-framework-cli.js"),
            "validate",
            str(ROOT / "public" / "sumi-screen-registry.json"),
        ],
        capture_output=True,
        check=False,
        text=True,
    )

    assert result.returncode == 0, result.stderr
    assert "valid" in result.stdout.lower()
