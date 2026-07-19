from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_quantum_101_curriculum_is_level_aware_and_complete():
    curriculum = (ROOT / "docs" / "QUANTUM_101_CURRICULUM.md").read_text()

    for level in ("High school", "Undergraduate", "Master's"):
        assert level in curriculum
    for concept in (
        "classical bit",
        "qubit",
        "state",
        "amplitude",
        "probability",
        "phase",
        "superposition",
        "gate",
        "circuit",
        "measurement",
        "interference",
        "entanglement",
        "Bloch sphere",
        "shots",
        "noise",
        "backend",
    ):
        assert concept.lower() in curriculum.lower()

    assert "Predict" in curriculum
    assert "classical comparison" in curriculum.lower()
    assert "practical" in curriculum.lower()


def test_learning_gap_analysis_drives_the_new_workspace():
    analysis = (ROOT / "docs" / "LEARNING_GAP_ANALYSIS.md").read_text()

    assert "Bell" in analysis
    assert "assumed" in analysis.lower()
    assert "formative" in analysis.lower()
    assert "high school" in analysis.lower()
    assert "master" in analysis.lower()
    assert "D3" in analysis
    assert "Three.js" in analysis


def test_interactive_visualization_dependencies_are_local():
    package = (ROOT / "package.json").read_text()
    visualizer = (ROOT / "public" / "tutorial-viz.js").read_text()

    assert '"d3"' in package
    assert '"three"' in package
    assert 'from "d3"' in visualizer
    assert 'from "three"' in visualizer
    assert "WebGLRenderer" in visualizer

