# Drug-Discovery Module (flagship lesson)

> **Educational / not for clinical use.** Every output of this module renders a
> visible banner with that text. Binding numbers here teach the *pipeline and the
> physics intuition*, not real affinities.

## The teaching thesis (say this in the UI)

Two reasons quantum computing is compelling for drug discovery, and the module
teaches both:

1. **The physics is native.** Proteins and ligands are made of atoms; binding is
   governed by electrons, whose behavior is quantum-mechanical (wave-like,
   interfering, tunneling). Classical docking must *approximate* that quantum
   behavior. A quantum computer runs on the same quantum mechanics, so in principle
   it can represent molecular electronic structure more faithfully.
2. **The search is native.** Superposition lets a quantum routine explore many
   molecular configurations at once, and interference amplifies favorable ones —
   in principle more efficient than trying conformations one by one.

The module makes clear we're **simulating** this intuition on a laptop, not getting
real quantum advantage.

## Inputs the user provides

- **Target**: an amino-acid sequence (single-letter codes, e.g. `MKTAYIAKQR...`)
  representing the disease target / protein pocket. Used for context and a simple
  pocket descriptor; the full 3D fold is out of scope for the demo.
- **Ligand**: a **SMILES** string for the candidate drug molecule
  (e.g. aspirin `CC(=O)OC1=CC=CC=C1C(=O)O`).
- Optionally, a **proposed improved SMILES** to compare against the original —
  matching the "predict a better SMILES with better binding" workflow.

## Pipeline (what the module does)

1. **Parse & validate** the SMILES with RDKit. Show the 2D structure. Reject
   invalid SMILES with a friendly message.
2. **Compute classical descriptors** (fast, deterministic, RDKit):
   - **QED** — quantitative estimate of drug-likeness (0–1).
   - **Synthetic accessibility (SA) score** — how hard to make (1 easy → 10 hard).
   - **Lipinski / Veber flags** — MW, logP, H-bond donors/acceptors, rotatable bonds.
   - **Toxicity proxy** — structural-alert (PAINS/Brenk-style) hit count. Label it
     clearly as a heuristic proxy, not a real tox prediction.
3. **Illustrative quantum binding step.** Build a small **VQE-style** circuit that
   stands in for "estimate the interaction energy of this ligand in the pocket."
   - Map a handful of interaction features to a few qubits (keep it ≤ ~6 qubits so
     it simulates instantly).
   - Use a parameterized ansatz (e.g. `RY` rotations + `CNOT` entanglers) and a toy
     Hamiltonian derived from the descriptors, then minimize expectation value to
     produce an **illustrative binding-energy score**.
   - The point is pedagogical: students see the ansatz, the entanglers, and the
     variational loop — the *shape* of a real quantum-chemistry routine.
4. **Multi-objective scorecard.** Combine the above into a panel so students learn
   drug discovery is never just binding.

## The multi-objective scorecard (core teaching artifact)

Render a radar/spider chart + table across these axes. Higher-is-better is
normalized to 0–1 for the chart; show raw values in the table.

| Objective | Source | Notes to show the student |
|---|---|---|
| Binding (illustrative) | VQE-style circuit | "simulated interaction energy — teaching value only" |
| Drug-likeness (QED) | RDKit | 0–1, higher better |
| Synthetic accessibility | RDKit SA score | lower raw score = easier to synthesize |
| Toxicity risk (proxy) | structural alerts | fewer alerts better; heuristic only |
| Lipinski/Veber | RDKit descriptors | pass/fail flags for oral-drug rules |

When the user supplies an **improved SMILES**, show the two molecules side by side
with a delta on every axis — this is the "did we actually make it better, and at
what cost elsewhere?" lesson. A molecule can bind better yet become harder to
synthesize or more toxic; the scorecard makes those trade-offs visible.

## Visualizations
- 2D molecule render (RDKit) for each SMILES.
- The VQE-style **circuit diagram** (reuse the core circuit renderer).
- Convergence curve of the variational loop (energy vs iteration).
- The multi-objective **radar chart** + comparison table.

## Guardrails (must implement)
- Persistent "educational / not for clinical use" banner on every panel.
- No claims of real binding affinity or real quantum advantage.
- Deterministic where possible (seed the ansatz init) so evals are stable.
- Fail gracefully on malformed SMILES / non-standard amino-acid letters.
