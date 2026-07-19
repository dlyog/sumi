# 1StopQuantum learning gap analysis

## Finding

The previous academic guide opened with a Bell circuit. That is a useful first
*experiment*, but it assumed learners already knew what a classical bit, qubit,
state, gate, circuit, measurement, amplitude, and shot meant. The circuit studio
also opened before the learner had a mental model for what its controls changed.

The content described concepts but did not form a curriculum. High school,
undergraduate, and Master's learners received the same vocabulary and depth.
There was no formative assessment, no prediction before simulation, no saved
lesson progress, and no deliberate classical comparison to anchor abstract ideas.

## Product response

| Gap | Learning design response | Product surface |
| --- | --- | --- |
| Bell state arrives too early | Foundations before superposition and entanglement | Seven-module Quantum 101 path |
| Terms are assumed | Plain-language glossary with equations introduced by level | Searchable in-app glossary |
| One explanation for every learner | High school, Undergraduate, and Master's depth | Persistent level selector |
| Passive reading | Predict, simulate, explain, then modify | Practical lesson lab |
| Quantum ideas lack anchors | Compare a known classical bit with measured qubit behavior | D3 probability comparison |
| Bloch sphere is static and abstract | Directly manipulate polar and phase angles | Three.js WebGL sphere |
| No knowledge check | Immediate explanatory feedback | Formative checkpoint per module |
| Lessons and tools are separate | Send the lesson's validated IR into the studio | Open in Circuit Studio action |

## Interaction principles

1. Start with what the learner knows: switches, probabilities, waves, vectors.
2. Ask for a prediction before revealing simulator output.
3. Change one variable at a time and keep the diagram, formula, and chart in sync.
4. State where an analogy breaks. A qubit is not literally a spinning coin.
5. Show equations progressively; do not remove rigor from advanced levels.
6. Keep every experiment local and reproducible with a fixed simulation seed.

## Visualization choice

D3 renders the classical/quantum probability comparison because it provides
accessible SVG labels and deterministic data joins. Three.js renders the Bloch
sphere through WebGL, the browser's OpenGL-style graphics API, so rotation angles
map directly to a visible state vector. Neither library is loaded from a CDN.
