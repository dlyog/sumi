# 1StopQuantum Quantum 101 curriculum

## Audience and depth

- **High school:** intuition first, arithmetic probabilities, familiar classical
  comparisons, and one controlled variable per practical.
- **Undergraduate:** complex amplitudes, vectors, matrices, basis notation, and
  circuit reasoning alongside the same visual model.
- **Master's:** Hilbert-space language, unitary evolution, density matrices,
  reduced states, algorithmic constraints, and explicit limits of each analogy.

The level changes explanatory depth, not the experiment's physical result.

## Short-course map

The machine-readable source of truth is
`public/data/quantum_curriculum.json`. It contains four courses and 16 short
lessons, including objectives, two-part readings, narration, visual metadata,
saved audio paths, and the interactive lab each lesson opens.

1. **Quantum foundations:** Bits and qubits; State and the Bloch sphere; Gates
   and circuits; Measurement and shots.
2. **Quantum effects:** Interference; Entanglement; Noise and decoherence; Error
   correction intuition.
3. **Algorithms through experiments:** How quantum algorithms think;
   Deutsch-Jozsa; Grover search; GHZ states and teleportation.
4. **Hardware & evidence:** Gate model, annealing, and simulation; Hardware
   modalities; Compilation and QPU fit; Benchmarks, QBI, and claims.

The seven existing labs remain reusable experimental primitives. Each tree lesson
declares a `legacy_module` so a new narrative can open a tested simulator without
duplicating quantum logic.

## Learning loop

Every module follows: **Connect -> Explore -> Predict -> Practical simulation ->
Explain -> Checkpoint -> Transfer to Circuit Studio**. Prediction is required
before a run. This makes the learner expose a mental model instead of passively
watching an animation.

Before the interactive state, each module presents a three-block causal model:
**Prepare -> Transform -> Measure**. An animated pulse shows that the blocks are
ordered actions, not three simultaneous properties. The copy starts with an
ordinary switch and one observed 0-or-1 answer; terms such as amplitude and phase
are introduced only after that familiar model is stable.

## Beginner interface contract

- Assume no prior physics, linear algebra, bra-ket notation, or quantum vocabulary.
- Use 16px or larger instructional copy and 44px touch targets at tablet width.
- State what the learner should observe after every block or manipulation.
- Keep the visual simulator identical across depth levels; change explanation,
  notation, and caveats rather than changing the underlying result.
- Preserve the learner's module and checkpoint progress locally, and offer
  **Start from basics** to return to Foundations at High school depth.
- Put narration controls before the lesson media, but never autoplay. Playback
  requires an explicit learner action, exposes elapsed time and speed, and keeps
  the full written lesson available.
- Save every production narration file and course visual inside `public/`. Kokoro
  and ComfyUI are authoring tools, not classroom availability dependencies.
- Give every lesson a distinct reviewed image. Store its authoring prompt and
  model in `visual.provenance`, show that disclosure beside the image, and route
  suspected inaccuracies into the feedback system instead of exposing generation.

## Modules

### 0. Bits and qubits

Start from a **classical bit**, a switch whose recorded value is 0 or 1. Define a
**qubit** as a two-level quantum system with a **state**. Introduce the Bloch
sphere as a map of pure one-qubit states, not a physical ball. Classical
comparison: a classical switch has one definite value; a qubit state can contain
two complex **amplitudes**, but a measurement still records one classical bit.

Practical: move from |0> to |1>, predict the output, and compare both bars.

### 1. State, amplitude, probability, and phase

For |psi> = alpha|0> + beta|1>, an **amplitude** is a complex coefficient and
**probability** is its squared magnitude. Normalization requires
|alpha|^2 + |beta|^2 = 1. **Phase** is the complex angle of an amplitude. It may
not change immediate Z-basis probabilities, but it changes later interference.
The **Bloch sphere** encodes these two angles for a pure qubit.

Practical: adjust theta and phase independently; notice that phase can move the
arrow without changing the two measurement bars.

### 2. Gates and circuits

A quantum **gate** is a reversible unitary transformation. A quantum **circuit**
is an ordered program of gates and measurements on qubit wires. Compare X with a
classical NOT; then show why H has no ordinary deterministic-bit equivalent.

Practical: apply X twice and connect the result to reversible computation.

### 3. Superposition and measurement

**Superposition** means the state has nonzero amplitudes in more than one basis
state. It does not mean we read both values. **Measurement** samples an outcome
and updates the state. Repeating a circuit for many **shots** estimates its output
distribution. A Hadamard gate prepares |+> from |0>, producing about 50/50 counts.

Practical: predict, run H then measurement for 1,024 shots, and inspect counts.

### 4. Interference

**Interference** is addition of amplitudes, including their signs and phases,
before probabilities are calculated. Classical comparison: water waves can add
or cancel, while ordinary probability percentages do not cancel. H followed by H
returns |0> because one path reinforces and the other cancels.

Practical: compare H-measure with H-H-measure.

### 5. Entanglement

**Entanglement** is a joint state that cannot be described as independent states
for each part. H then CNOT prepares a Bell state. Each qubit alone looks random,
but joint outcomes are correlated. This is stronger than two hidden, pre-agreed
classical values; the analogy stops at correlation.

Practical: step through H and CNOT, then compare marginal and joint results.

### 6. Algorithms, noise, and backends

Quantum algorithms arrange interference to increase useful outcomes; they do not
try every answer and read them all. A **backend** is the simulator or hardware
that executes a circuit. **Noise** is unwanted interaction or control error that
changes the intended state. Simulators show an ideal reference; hardware results
must include uncertainty and device constraints.

Practical: compare ideal Bell counts with a simple noisy model and choose whether
a simulator or QPU backend fits the learning question.

## Glossary contract

The in-app glossary defines classical bit, qubit, state, amplitude, probability,
phase, superposition, gate, circuit, measurement, interference, entanglement,
Bloch sphere, shots, noise, and backend in plain language. Advanced notation is
added by the selected level; the base definition remains stable.
