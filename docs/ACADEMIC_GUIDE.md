# 1StopQuantum Academic Guide

1StopQuantum is a local teaching environment for learning circuit-model quantum
computing. It combines natural-language generation, a declarative JSON/YAML
language, Qiskit/Cirq simulation, and visual inspection. No real quantum hardware
is used, so every experiment is repeatable on a laptop.

## Learning path

The recommended sequence is:

1. Connect a familiar classical bit to a qubit and measurement.
2. Explore amplitude, probability, and phase on the Bloch sphere.
3. Predict and simulate one-qubit gates, superposition, and interference.
4. Build a Bell pair only after the one-qubit model is stable.
5. Describe a circuit in natural language and review the generated manifest.
6. Edit the manifest, compare Qiskit/Cirq output, and reproduce it with the CLI.
7. Evaluate a real-world use case against its best classical baseline, available
   hardware, resource assumptions, and strength of published evidence.
8. Use the Podcast queue for review, then submit a research or reviewer request
   through the moderated Community workflow.

Start the local stack from the project directory:

```bash
make demo
```

Open `http://localhost:8080`. Existing manifests and browser-local examples
simulate even if the configured LLM is unavailable; only free-form
natural-language generation depends on that provider. Provider status and
credentials are intentionally not shown to learners.

## Classical-to-quantum bridge

Quantum computers are specialized accelerators, not replacements for classical
computers. Classical systems still own data preparation, control, networking,
optimization orchestration, error correction, and interpretation. A quantum
candidate is worth studying only when the problem has an appropriate formulation,
a credible algorithm, realistic qubit and error requirements, and a fair
comparison with the best classical method.

Use the beginner introduction for familiar switches, probability, and repeated
measurement. Use the executive introduction for readiness decisions: post-quantum
cryptography migration, supply-chain and route optimization limits, chemistry and
materials simulation, evidence gaps, and full workflow cost. The Use Case Center
then records the classical baseline, quantum candidate, hardware constraint,
provider fit, and source for every claim.

## Listening and publishing

The four saved Podcast episodes can be played sequentially without a running TTS
service. Transcripts and downloads make the same material available without
sound. Research, contributor, and reviewer requests enter a private moderation
queue; only explicitly approved fields become public. The API contracts and
privacy boundaries are documented in `PODCAST_API.md` and `COMMUNITY_API.md`.

## Quantum computing 101

Open **Learn**, the first workspace in the navigation. Choose the explanation
depth that matches the course:

- **High school** begins with switches, repeated trials, and wave interference.
  Equations appear only when they clarify a visible result.
- **Undergraduate** adds state vectors, complex amplitudes, matrices, basis
  notation, and the Born rule.
- **Master's** adds Hilbert-space language, density operators, reduced states,
  compilation constraints, noise, and resource reasoning.

The simulator result is identical at every depth; only the explanatory layer
changes. Complete the modules in order: **Bits and qubits**, **Qubit state**,
**Gates**, **Measurement**, **Interference**, **Entanglement**, and
**Algorithms**.

Each module uses the same learning loop:

1. Follow **Prepare -> Transform -> Measure** and read the expected observation.
2. Read the classical comparison and where that analogy stops.
3. Manipulate the state angle and phase on the Three.js/WebGL Bloch sphere.
4. Read the matching D3 classical-versus-quantum probability chart.
5. Choose a prediction before enabling the simulator.
6. Explain the counts and open the exact IR in Circuit Studio.
7. Answer the checkpoint; progress is stored in the browser on this machine.

On a tablet, the glossary moves below the lesson and the module row scrolls
horizontally. This keeps the lesson text large without hiding any course module.
Use **Start from basics** at any time to return to the first high-school lesson.
The left gate palette remains available while learning. Selecting a gate opens
Circuit Studio and appends it to the current circuit, so a learner never has to
guess why a palette action appeared to do nothing.

For the first exercise, choose **Measurement**, predict **About 50/50**, and run
the H-plus-measure circuit for 1,024 shots. Each shot returns one value. The
balanced pattern appears only across repeated, identically prepared shots.

## First circuit

After completing the one-qubit modules, use a Bell pair to combine superposition
and entanglement.

1. Open **Circuits**.
2. Keep **Natural language** selected.
3. Enter `Entangle two qubits and measure them.` and select **Run**.
4. Confirm the circuit is `H q0`, `CNOT q0 -> q1`, then measurement.
5. Confirm the measurement histogram contains `00` and `11`, but not `01` or
   `10`.

The Hadamard gate makes q0 an equal superposition. CNOT does not copy an unknown
quantum state; it correlates the two qubits. The result is a joint state that
cannot be factored into independent q0 and q1 states.

## Step-through

The circuit toolbar contains first, previous, next, and last controls.

1. Select **first** to inspect the initial `|00>` state.
2. Select **next** once. After H, amplitudes appear for `|00>` and `|10>`.
3. Select **next** again. After CNOT, amplitudes appear for `|00>` and `|11>`.
4. Select q0 and q1 in the Bloch panel. Each individual Bloch vector is mixed,
   while the joint state remains pure. 1StopQuantum labels this as entanglement
   rather than displaying an unexplained empty arrow.
5. Compare the amplitude phase colors with the neutral measurement counts.

The amplitude panel describes the state before sampling. The measurement panel
describes repeated classical samples. Phase affects interference but is not
present in a count after measurement.

## Natural language to declarative circuit

Natural language never executes as Python. The configured LLM emits strict Circuit IR,
which is validated, simplified, checked against requested qubit-count signals,
and wrapped in a 1StopQuantum Manifest.

After running a prompt, open the **Manifest** source tab. The manifest is the
portable artifact for the lesson. Download it as `.qyog.yaml`, switch the input
mode to **JSON / YAML manifest**, edit it, and select **Validate and visualize**.

Useful prompts:

- `Put one qubit in superposition and measure it.`
- `Build a 3-qubit GHZ state.`
- `Grover search for |11> on 2 qubits.`
- `Rotate q0 by pi/2 around Y, then measure.`

Always compare the `Built:` line and diagram with the original request. A visible
fidelity warning means the final model response remained structurally different
after one semantic retry.

## CLI workflow

The `qyog` CLI follows a declarative plan-before-run workflow similar to
infrastructure tools. It operates on the same manifest used by the browser.

```bash
./qyog validate examples/bell.qyog.yaml
./qyog plan examples/bell.qyog.yaml
./qyog compile examples/bell.qyog.yaml --target qiskit --output bell.py
./qyog run examples/bell.qyog.yaml
./qyog visualize examples/bell.qyog.yaml
```

`visualize` opens a local URL whose fragment contains the validated manifest. The
fragment is processed in the browser and is not sent to a remote service.

Generate a manifest from text through the configured LLM:

```bash
./qyog generate "Build a 3-qubit GHZ state" \
  --name ghz-lesson \
  --output ghz-lesson.qyog.yaml
./qyog validate ghz-lesson.qyog.yaml
./qyog plan ghz-lesson.qyog.yaml
./qyog run ghz-lesson.qyog.yaml --json
```

Other commands:

```bash
./qyog init my-lesson        # create my-lesson/main.qyog.yaml
./qyog fmt main.qyog.yaml    # canonical YAML formatting
./qyog fmt main.qyog.yaml --check
./qyog show main.qyog.yaml --format json
```

## Drug-discovery lesson

The Drug discovery workspace is a separate illustrative module. Enter a valid
SMILES string and optionally a comparison candidate. RDKit computes descriptors;
binding and VQE convergence values are deterministic teaching indicators, not
physical predictions. Use the per-rule Lipinski output to discuss why a single
score is insufficient for candidate selection.

## Provider lesson

Use Provider lab to distinguish computing paradigms:

- Gate-model requests become Circuit IR and run on Qiskit or Cirq simulators.
- Discrete optimization requests become QUBO and run on a local simulated
  annealer.
- IonQ and D-Wave cards explain future hardware targets. 1StopQuantum does not
  submit to a real QPU.

## Exercises

1. Set the Bloch state to `|0>`, `|1>`, `|+>`, and `|->`. For each state, record
   what changes in the arrow, probabilities, and phase.
2. Compare a classical random bit with `|+>`. Identify the measurement where
   they look alike and the interference experiment that separates them.
3. Replace H with X in the Bell manifest. Predict and then explain the histogram.
4. Add adjacent H gates. Use `qyog plan` and explain why simplification removes
   them.
5. Change GHZ from three to four qubits using the template form. Identify how the
   number of CNOT gates changes.
6. Compile the Bell manifest to Qiskit and Cirq. Mark which syntax differs and
   which circuit semantics remain identical.
7. Add `RZ(pi)` after H. Compare amplitude phase colors before comparing
   measurement counts.
8. Create an invalid controlled gate whose control equals its target. Record the
   validation error and explain why execution must not continue.

## Instructor notes

- Ask students to predict a state before selecting the next step.
- Keep introductory circuits at two to five qubits so the complete statevector is
  inspectable.
- Treat generated manifests as model output that requires review, not as an
  authority.
- Use fixed seeds when comparing backends so sampling noise does not obscure the
  conceptual comparison.
- Reinforce the bit-order caption before interpreting multi-qubit outcomes.
