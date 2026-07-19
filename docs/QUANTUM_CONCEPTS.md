# Quantum Concepts & Icon System

This is both the teaching content the product presents and the canonical icon map.
Every concept below has (a) a one-line beginner explanation the UI shows on hover,
(b) an icon, and (c) the visualization it triggers.

## Design principle

A classical bit is usefully compared with a light switch: its recorded value is
0 or 1. A spinning coin can introduce uncertainty, but a **qubit is not literally
a coin** and superposition is not just an unknown classical face. Every metaphor
in the product must state where it stops working. The interactive lesson then
replaces the metaphor with amplitudes, phase, and an experiment.

The foundational sequence is classical bit -> qubit state -> amplitude and
probability -> phase -> gates and circuits -> measurement and shots ->
interference -> entanglement -> algorithms, noise, and backends. Bell states are
introduced only after the learner can distinguish amplitudes from counts.

## Concept → icon → visualization map

| Concept | Icon (suggested glyph) | One-line explanation (hover text) | Visualization |
|---|---|---|---|
| Qubit | ◐ circle half-filled | A two-level quantum system whose state predicts measurement outcomes. | Bloch sphere |
| Superposition | ⚖ balance / overlapping waves | A state with nonzero amplitudes in more than one basis state. | Bloch sphere + amplitude view |
| Hadamard (H) | 🌓 / split-circle | Puts a qubit into an even 50/50 superposition. | Bloch sphere flips to equator |
| Pauli-X (X) | ⟲ / arrow-flip | Quantum NOT: flips 0↔1. | Bloch vector rotates π about X |
| Pauli-Y / Z | Y, Z badges | Phase/axis rotations; Z flips the sign of \|1⟩. | Bloch rotation |
| Phase (S, T) | ∠ angle | Adds a phase without changing measurement probabilities alone. | Bloch rotation about Z |
| Rotation (RX/RY/RZ) | ⟳θ dial | Rotate the qubit by any angle θ — the "analog knob." | Bloch rotation by θ |
| CNOT | ●──⊕ (dot + XOR) | Controlled-NOT: if control is 1, flip the target. The entangler. | 2-qubit link animation |
| CZ | ●──● | Controlled-Z: conditional phase flip. | link animation |
| SWAP | ⤫ crossed arrows | Exchange the states of two qubits. | crossing lines |
| Entanglement | 🔗 linked rings | Two qubits become one shared state; measuring one tells you the other. | linked Bloch pair + correlated histogram |
| Measurement | 📏 / meter | Produces one classical result per shot; repeated shots estimate probabilities. | histogram of outcomes |
| Interference | 〜 overlapping waves | Amplitudes add/cancel to boost the right answer (the engine of Shor's, etc.). | amplitude bar animation |

> Keep the icon set in one source file (`icons.ts`) so the palette, the inline
> circuit diagram, and the docs all pull from the same definitions.

## Advanced teaching examples

These examples follow the seven Quantum 101 modules. Both run end-to-end via the
natural-language box and via hand-written IR.

### Lesson A — "Make a Bell pair" (entanglement in 2 gates)
- **Story:** individual results look random while joint results are correlated.
  A classical shared plan is a useful first comparison, but it does not reproduce
  entangled correlations across measurement bases.
- **Circuit:** `H` on qubit 0, then `CNOT(0→1)`, then measure both.
- **What students see:** the histogram shows only `00` and `11` (~50/50), never
  `01` or `10`. Measuring qubit 0 fixes qubit 1. This is the concrete payoff of the
  "measuring one tells you the other" line.
- **CNOT is the quantum cousin of XOR:** if the control is 1, it flips the target.
  Call this out explicitly — it connects to classical logic students already know.

### Lesson B — "Why factoring falls" (Shor's, conceptually)
- **Goal:** intuition, not a full fault-tolerant Shor's implementation.
- **Story:** RSA security relies partly on the cost of classical integer
  factoring. Shor's algorithm uses coherent modular arithmetic and the **quantum
  Fourier transform** to sample information about a period; classical
  post-processing can then recover factors. It does not expose every candidate
  answer for us to read.
- **What students see:** a small QFT demo circuit and a histogram where one outcome
  dominates after interference. Pair it with a plain-English panel: "public key is
  shared to encrypt; only the private key decrypts; factoring the public modulus
  would recover the private key — classically infeasible, quantum-mechanically
  tractable in principle."
- **Scale caveat, shown in the UI:** breaking real RSA needs far more (error-
  corrected) qubits than any simulator or current device has. This is a *concept*
  demo.

## Framework note for the lesson text
Two industry frameworks power the simulation and both should be selectable so
students can compare:
- **Qiskit** — IBM's open-source framework (default backend here).
- **Cirq** — Google's open-source framework (alternate backend).
Same Circuit IR compiles to both; showing the two generated sources side by side is
itself a good lesson ("same idea, two vendors").
