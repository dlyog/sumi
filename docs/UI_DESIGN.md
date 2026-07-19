# UI & Visual Design

The product uses a fluid white canvas, near-black typography, restrained teal and
amber semantic accents, and visible structure instead of decorative cards. A
beginner, researcher, or public-sector analyst should get oriented in seconds.

## Audio-first course shell

Learn begins with a short-course player rather than a marketing hero. Its stable
order is: title and depth, course/lesson position, narration controls, four-course
catalog, lab tabs, visual lesson, objectives/readings, interactive experiment,
and checkpoint. Course contents opens in a native modal tree so a 16-lesson
outline does not narrow the tablet reading column.

The persistent top-right music control opens a screen-specific guide containing
a concise purpose, written how-to, saved narration, seek control, and transcript.
It follows Learn, Circuits, Drug discovery, Providers, Benchmark, Improve, and
Docs. Audio never autoplays and every action remains available without sound.

Course visuals use local raster assets with CSS motion layered above them. Motion
communicates signal flow, entanglement, fading coherence, or evidence progression;
`prefers-reduced-motion` disables it. Generated visuals require meaningful alt
text and manual review even after automated size/nonblank checks pass. An adjacent
information control discloses the saved generation prompt and model; it never
starts a generation job.

Each lesson ends with a small Helpful action and a report-inaccuracy path for
guests and signed-in learners. A deterministic FAQ assistant answers only curated
product questions and links to the full FAQ. The compact global footer keeps AI
use, privacy, terms, disclaimer, copyright, and trademark independence available
without dominating lesson content.

## Layout (three columns)

```
┌───────────────┬───────────────────────────────┬───────────────────────────┐
│ CONCEPT       │  EDITOR / CIRCUIT CANVAS      │  VISUALIZATION PANELS      │
│ PALETTE       │                               │                           │
│ (icons)       │  ┌─ NL input box ───────────┐ │  ┌ Bloch sphere ────────┐ │
│               │  │ "entangle two qubits"    │ │  │        ◐              │ │
│ ◐ Qubit       │  └──────────────────────────┘ │  └──────────────────────┘ │
│ 🌓 Hadamard   │                               │  ┌ Probability histogram┐ │
│ ⟲ X  Y  Z     │  circuit diagram (drag icons  │  │ 00 ▓▓▓▓  11 ▓▓▓▓       │ │
│ ⟳θ Rotations  │  here, or generated from NL)  │  └──────────────────────┘ │
│ ●⊕ CNOT / CZ  │                               │  ┌ Generated source ────┐ │
│ ⤫ SWAP        │  [ Run ▸ ]   backend: Qiskit ▾│  │ Qiskit | Cirq tabs    │ │
│ 🔗 Entangle   │                               │  └──────────────────────┘ │
│ 📏 Measure    │                               │                           │
└───────────────┴───────────────────────────────┴───────────────────────────┘
```

- **Left — Concept palette.** Every gate/concept from `QUANTUM_CONCEPTS.md` as a
  labeled icon. Hover shows the one-line explanation. Drag onto the canvas to insert;
  click for a short "what is this?" popover with the metaphor.
- **Center — Circuit canvas + composer.** A segmented control switches between
  natural-language input and the canonical JSON/YAML manifest editor. Below it,
  the visual circuit shows qubit lines and gate glyphs. Run button + backend
  selector (Qiskit default / Cirq). A final-IR interpretation line explains what
  was built, while simplification and fidelity notices appear only when relevant.
- **Right — Visualization panels.** Bloch sphere (per selected qubit), probability
  histogram (updates on run), phase-aware state amplitudes, and execution metadata.
  Generated source remains below the circuit with Qiskit/Cirq tabs so learners
  connect the picture to real code.

## Circuit controls and learning states

- The circuit toolbar exposes `first`, `previous`, `next`, and `last` step controls.
  The statevector, amplitudes, measurement preview, and Bloch panels reflect the
  selected gate cursor; the just-applied gate is highlighted on its wire.
- A Bell/GHZ qubit whose reduced Bloch vector is mixed shows an amber wire link and
  the explicit message that an entangled qubit has no individual arrow. The joint
  amplitudes remain visible for the lesson.
- Measurement labels use the Qiskit display convention and always include the
  caption: "Read right-to-left: rightmost bit is q0 (Qiskit convention)." Cirq
  results are converted to the same display ordering.
- State-amplitude bars use a phase hue wheel and a compact legend. Measurement
  counts remain neutral amber because sampled counts do not carry phase.
- The template row provides one-click GHZ (3 qubits), Grover `|11>`,
  Deutsch-Jozsa, and QRNG circuits. The chosen template and parameters appear next
  to the build interpretation.
- The source toolbar provides Copy and Download `.py`; the circuit toolbar exports
  the current diagram as SVG or PNG. The latest prompt, circuit, and backend are
  restored from local browser storage after reload.
- The source panel includes a Manifest tab so students can move from the diagram
  to the declarative document and then to equivalent Qiskit or Cirq Python.

## Documentation center

- Help is a persistent 44px `?` icon in the top-right utility bar rather than a
  primary workspace in the left rail. Its tooltip and accessible name are "Help
  and documentation"; opening it preserves the full documentation experience.
- A neighboring `i` icon opens About 1StopQuantum. The native dialog shows the
  version, build ID, local-first runtime, product purpose, simulation-only trust
  boundary, Metriq attribution, and QBI independence statement.
- Docs uses a reference-site layout: grouped navigation on the left, a searchable
  white article in the center, and an on-page outline on the right.
- The first article starts with Quantum 101 foundations and links directly to the
  interactive Learn workspace. Bell-state material follows the one-qubit model.
- Later articles cover NL-to-manifest generation, the `qyog` workflow, circuit
  improvement, ChatGPT/MCP setup, providers, benchmark methodology, API endpoints,
  and core concepts.
- On mobile, search stays visible, article navigation becomes horizontally
  scrollable, and the on-page outline is hidden to protect reading width.

## Membership and circuit improvement

- Signup is available from the workspace rail and docs header. The dialog asks
  for name, email, an 8-128 character password, and an educational plan; there is
  no deceptive checkout.
- Account status remains visible in the rail and is restored locally after reload.
- The Improvement view pairs review controls with the exact current Circuit IR.
  Users choose an objective, schedule time, and bounded iteration count, then run
  now or schedule for later.
- Completed jobs display accepted/unchanged status, before/after gate metrics, and
  a link to the standalone HTML review report. The UI always labels the process as
  a bounded local review.

## Internal administration

- No admin entry point or LLM status appears in normal public navigation.
- Adding `?admin=1` exposes the internal sign-in control; the server still requires
  a password-authenticated account whose database role is `admin`.
- The dashboard shows daily visitor counts, popular page keys, helpful totals,
  and recent reports. Visitor IDs are browser-generated pseudonymous identifiers.
- LLM settings offer a local OpenAI-compatible endpoint or OpenAI. Switching to
  OpenAI clearly states that prompts leave the local machine. Saved API keys are
  write-only in the UI: the server returns only whether a key is configured.

## Icon system
- One source of truth: `icons.ts` exporting `{ concept, glyph, color, hoverText }`.
- Consistent glyph everywhere the concept appears (palette, on-wire, docs).
- Suggested glyphs are in `QUANTUM_CONCEPTS.md`; replace ASCII placeholders with a
  proper icon set (e.g. a small custom SVG set) for the final look. Keep them
  legible at 20px.

## Color language (semantic, not decorative)
- **Canvas** — white and cool off-white surfaces with near-black body text and
  dark gray secondary text. Borders establish hierarchy without floating panels.
- **Superposition / Hadamard** — teal to signal a coherent state change.
- **Entanglement (CNOT/CZ/link)** — a single bold accent (e.g. amber) used for the
  connecting line between control and target so entanglement literally looks linked.
- **Measurement** — a neutral/graphite tone signaling "collapse to definite."
- Monaco, code output, dialogs, charts, and WebGL scenes use the same light system.
- Pick 2 accent colors max besides the base — restraint reads as intentional.

## Motion (subtle, meaningful)
- On **H**: Bloch vector animates to the equator (superposition made visible).
- On **CNOT**: a brief pulse travels control→target along the amber link.
- On **measure**: histogram bars grow in; Bloch vector snaps to a pole.
- Respect `prefers-reduced-motion`; all animations must be skippable.

## Accessibility (this is the whole point)
- Every icon has a text label and an ARIA label; nothing relies on color alone.
- The NL box is the primary entry path for non-technical users — keep it prominent
  and forgiving (accept messy phrasing; show the friendly error from `/nl2circuit`
  when the request isn't a circuit).
- Keyboard-navigable palette and canvas.
- Readable typography; generous spacing; short sentences in all hover/explainer text.

## Drug-discovery view (its own tab/route)
- Two SMILES input fields (original + optional improved) and a target-sequence field.
- 2D molecule renders, the VQE-style circuit diagram, the convergence curve, and
  the multi-objective radar chart + table.
- When a comparison SMILES is supplied, the scorecard adds Candidate A/B columns,
  highlights the better value for each metric, and shows MW, LogP, HBD, and HBA
  tooltips plus each Lipinski rule's pass/fail result.
- Persistent "educational / not for clinical use" banner at top of the view.

## Provider lab

- Provider cards distinguish local gate simulation, planned IonQ hardware, and
  D-Wave-shaped annealing without implying that a real QPU is connected.
- The QUBO document is editable JSON. Re-run displays validation failures inline,
  the best local sample, and an energy histogram with the minimum marked.
- The intent router accepts a short natural-language task and explains whether it
  selected a circuit or annealing workflow and why.

## Benchmark intelligence

- Landscape uses an animated D3 scatterplot with measured points only. Controls
  expose benchmark family and observation date; the table preserves source paths.
- QPU Match is a compact form followed by a scan-friendly comparison table. Fit
  and evidence coverage are separate columns so sparse data cannot look certain.
- Forecast distinguishes measured history from inferred points and renders the
  uncertainty interval. Confidence and the non-fault-tolerance warning stay in
  the reading path.
- Claims + QBI uses a three-stage evidence checklist and a visible disclaimer:
  the result is an independent educational screen, not a DARPA determination.
- Tabs and data tables scroll inside their own regions at phone widths. Controls
  remain at least 44px high and no workspace creates document-level overflow.

## Initial state / onboarding
- **Learn** is the first navigation item and its curriculum begins with classical
  bits and one-qubit measurement. It is also the default workspace after a normal
  page load or refresh. Circuit Studio retains a complete Bell example so builders
  start with a working circuit rather than an empty canvas.
- The gate palette is a global command surface. Clicking a gate while Learn, Docs,
  Providers, Drug discovery, or Improve is open switches to Circuit Studio and
  inserts that gate; beginning a drag also reveals the circuit drop target. Direct
  links can select Circuit Studio with `?view=circuits` without changing the normal
  Learn-first refresh behavior.
- The Learn workspace has a persistent three-level depth selector, seven compact
  module tabs, progress, an unframed Three.js/WebGL Bloch scene, D3 probability
  comparison, prediction-gated practical, formative checkpoint, and searchable
  glossary. Every module includes an animated prepare -> transform -> measure
  block flow before introducing the visual state. It hands the practical's
  validated IR directly to Circuit Studio.
- Instructional copy is at least 16px at tablet width, touch controls are at least
  44px high, and module tabs have stable 150px cells in an internal horizontal
  scroller. At 1120px and below the glossary moves beneath the lesson so the main
  teaching column remains at least 700px on a 1024px tablet.
- At mobile widths the Bloch canvas, state readout, D3 comparison, practical, and
  checkpoint stack in that order. The chart computes its view box from the live
  container so labels remain readable without horizontal page overflow.
- The app is installable with a local PWA manifest and maskable icons. Its worker
  uses network-first requests, an offline app shell, and a build-scoped cache;
  managed restarts publish a new build ID and remove obsolete application caches.
- A one-line local-simulation disclaimer remains in the footer.

## v0.5 navigation and guided workspaces

- Learn and public trust pages remain available to guests. Circuits, Use Cases,
  Drug Discovery, Providers, Benchmark, Improve, Podcast, and Community show a
  clear sign-in requirement and reopen the requested workspace after authentication.
- Use Cases is the parent decision workspace. Drug Discovery remains a focused
  experiment beneath it instead of acting as the only application example.
- The Podcast uses a stable phone-first queue: one primary Play All command,
  episode rows, chapter and elapsed position, transcript/download actions, speed,
  and Media Session controls. It never starts audio without a user gesture.
- Community intake states purpose, retention, consent, and the privacy link at the
  form. Moderation controls appear only in the authenticated internal dashboard.
- Each primary workspace has one replayable tour. The native dialog highlights an
  actual control, supports previous/next/skip with the keyboard, and ends with a
  practical action. Motion is removed when reduced motion is requested.

## v0.5.1 account access

- Protected navigation reserves fixed columns for icon, label, and lock. The lock
  is an icon with an accessible title; it never wraps into a second label column.
- Sign-in identifies the product, offers a one-click local demo learner, and links
  to challenge-based password recovery. Signup keeps recovery details optional but
  requires question, answer, and non-secret hint together when enabled.
- Admin login remains undiscoverable in public navigation. Analytics, provider
  settings, moderation, and password feedback use distinct live regions so screen
  readers announce the correct operation.

## v0.5.2 learning level

- Learn exposes one audience control: High school, Undergraduate, or Master's.
  It immediately updates the classical introduction, lesson metadata, and detailed
  explanation. Do not add a second Beginner/Executive selector or a reset link;
  those duplicate the learning-level decision.

## Footer hierarchy

The footer uses a short 1StopQuantum statement, two compact link groups, and one
legal line for the 1StopQuantum contributors, AI fallibility, trademark
independence, and copyright. It avoids centered paragraph walls and remains
readable at phone width. On desktop it stays under 96px high so lesson content is
not displaced.
