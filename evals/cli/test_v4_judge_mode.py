from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_judge_demo_allows_deterministic_features_without_a_running_llm():
    makefile = (ROOT / "Makefile").read_text(encoding="utf-8")
    demo = (ROOT / "scripts" / "demo.sh").read_text(encoding="utf-8")

    assert "judge-demo:" in makefile
    assert "ALLOW_LLM_UNAVAILABLE=1" in makefile
    assert 'ALLOW_LLM_UNAVAILABLE="${ALLOW_LLM_UNAVAILABLE:-0}"' in demo
    assert "deterministic templates and manifests remain available" in demo
