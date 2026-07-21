## Inspiration

Sumi began with a voice conversation.

As a student and later as an educator, I have seen the same pattern repeatedly: students are given lectures, videos, readings, and assignments, but when they become confused, the learning material cannot notice, adapt, or demonstrate the next step. My own master's-level study in AI and machine learning also shoId me that the most useful AI systems are not the ones that simply generate more text; they are the ones grounded in a real task, a real interface, and a verifiable outcome.

Using ChatGPT Voice, I explored the idea out loud, the same way a learner often thinks: imperfectly, iteratively, and step by step. That conversation moved the project beyond “another quantum education platform” and toward a more important question:

> What if an AI could do more than ansIr a learner’s question? What if it could understand the current learning screen, demonstrate the next step, operate approved controls safely, and help the learner experiment?

That question became **Sumi**.

Many educational copilots are still question-and-ansIr systems placed beside existing lectures, videos, and assignments. But a beginner often does not know what to ask, which control matters, what result to inspect, why the result changed, or what experiment should come next.

I wanted Sumi to participate in the learning process itself.

Quantum computing became the ideal first proof case because it combines abstract concepts, mathematics, code, visual state changes, simulation, and evidence. If Sumi could make quantum computing more approachable through guided experimentation, the same model could support science, mathematics, engineering, coding, professional training, and other interactive learning applications.

## Why it fits the Education track

Sumi is designed to push AI for education beyond ansIr generation.

For students, Sumi provides contextual guidance, visual demonstration, prediction prompts, and immediate feedback inside the learning activity.

For educators, Sumi provides a structured way to define learning objectives, revieId explanations, approved actions, and safe interaction boundaries.

For educational organizations, the Sumi SDK and Control Plane provide reusable screen registries, action policies, observability, evaluation, and governance across multiple learning applications.

**1StopQuantum is the first proof-case application. Sumi is the reusable education platform.**

## What it does

**1StopQuantum** turns natural-language requests into visible and testable quantum experiments, and **Sumi** extends that interaction model into a reusable SDK, CLI, and control plane.

Learners can:

- Generate quantum circuits from plain-language descriptions
- Run local simulations
- Step through circuits gate by gate
- Inspect Bloch spheres, amplitudes, and measurement probabilities
- View generated Qiskit and Cirq code
- Compare quantum approaches and provider claims
- Explore benchmark evidence and classical baselines

**Sumi**, the AI Learning Companion inside 1StopQuantum, adds the missing educational layer.

Sumi can:

- Understand the learner’s current screen
- Introduce the workspace through voice
- Highlight relevant controls
- Ask the learner to predict an outcome
- Load and run approved experiments
- Pause at meaningful stages
- Explain changes using actual application state
- Compare the learner’s prediction with deterministic simulation results
- Provide contextual follow-up guidance
- Route a learner request into either a bounded explanation or an approved action
- Keep responses grounded in the active screen and its registered capabilities

Sumi follows this learning loop:

> **Ask → Predict → Build → Step Through → Observe → Explain → Verify**

Sumi is now designed as a reusable platform rather than a feature that exists only inside 1StopQuantum. The host application owns the real UI actions, while a separate Sumi Control Plane governs organizations, applications, environments, screens, approved actions, prompt layers, telemetry, and evaluation.

![The learning loop ](https://raw.githubusercontent.com/dlyog/sumi/refs/heads/main/public/assets/learner_loop-v1.png)

Sumi is not a general-purpose browser agent. Her behavior is bounded by the current screen and application registry.

The model interprets learner intent. A decision gate selects either a response-only flow or an approved-action flow. Registered host handlers perform the action locally. Deterministic software produces and verifies the result.

![Sumi end-to-end architecture](https://raw.githubusercontent.com/dlyog/sumi/refs/heads/main/public/assets/sumi_architecture-v1.png)

Key points:

- 1StopQuantum is the first proof-case application, not the Sumi platform itself.
- Sumi SDK code runs inside the host application and executes only approved local actions.
- The Control Plane manages organizations, applications, environments, screens, alloId actions, prompt layers, telemetry, and evaluation workflows.
- The Control Plane can govern and observe, but it cannot remotely click or mutate the host UI.
- The SDK and CLI are designed so another learning application can adopt Sumi without importing quantum-specific logic.

## Current end-to-end state

The working submission includes:

- 1StopQuantum as the first proof-case host application
- A reusable Sumi browser SDK and voice layer inside the host app
- A Sumi CLI for scaffolding and validating new screen integrations
- A separate Sumi Control Plane for tenancy, screen registries, approved actions, telemetry, and evaluation
- A front-door proxy that keeps internal backend ports private behind Apache
- Responsive host and admin interfaces across desktop, tablet, and mobile
- Voice interaction with thinking audio, optional waiting audio, Kokoro narration, delayed text reveal, interruption handling, and reset controls
- A separate Control Plane login, enterprise console, and PostgreSQL database
- Real local UI actions verified through screen-scoped handlers
- End-to-end tests that confirm the interface changes, not only the text response

## How I built it

This project was built for the OpenAI hackathon using **Codex with GPT-5.6**.

I used Codex as an engineering partner, not as a one-shot code generator. I set the educational vision, product boundaries, architecture decisions, and acceptance criteria. Codex with GPT-5.6 accelerated repository analysis, implementation, debugging, testing, documentation, and iteration.

![Codex Guidelines](https://raw.githubusercontent.com/dlyog/sumi/main/docs/assets/codex-guidelines.png)

Our workflow folloId five steps.

## Goal

I defined observable vertical slices instead of asking Codex to build the entire platform at once.

For example:

> Activate Sumi, introduce Algorithm Studio, ask the learner for a prediction, build Grover search, step through the circuit, run the local simulator, and compare the result with the prediction.

This gave Codex a concrete user outcome and gave us a clear definition of done.

## Context and constraints

I provided Codex with:

- Repository structure and existing architecture
- Current user interface and screenshots
- Quantum domain models and Circuit IR
- Existing APIs, services, and voice infrastructure
- Product goals and learner scenarios
- Accessibility requirements
- Security and privacy boundaries
- Acceptance tests and expected visual behavior

I required Codex to preserve:

- Existing 1StopQuantum functionality
- Local-first simulation
- Accessibility
- Privacy boundaries
- Approved and typed actions
- Deterministic verification
- Offline and PWA behavior
- Existing test coverage
- Clear separation betIen the host runtime and Sumi Control Plane

## Execution

Codex with GPT-5.6:

- Audited the repository before changing it
- Proposed implementation plans
- Built and refactored the Sumi SDK, CLI, registries, handlers, and control-plane services
- Integrated voice components and UI state
- Added responsive and accessibility improvements
- Diagnosed build, browser, API, and service-worker failures
- Repaired regressions and updated documentation
- Helped turn the 1StopQuantum-specific implementation into a reusable platform architecture

Key human decisions included:

- Making Sumi the platform and 1StopQuantum the first proof case
- Keeping real UI execution inside the host application
- Using typed, screen-scoped actions instead of arbitrary browser control
- Treating deterministic application output as the source of truth
- Separating voice/runtime concerns from governance and observability
- Prioritizing one polished learning loop over a broad but shallow feature set

## Verification

I did not consider generated code complete until it was tested.

Verification included:

- Frontend production builds
- Python tests
- API and proxy checks
- Screen-registry validation
- Action-registry validation
- PostgreSQL and control-plane checks
- Playwright acceptance flows
- Responsive screenshots
- Manual visual inspection
- Voice interruption and reset checks
- Cache and service-worker recovery tests

Playwright verifies that Sumi changes real controls and application state. Screenshot review catches layout, accessibility, and branding regressions that functional tests alone may miss.

## Iterate and improve

Codex with GPT-5.6 helped shorten the feedback loop betIen an idea, a working screen, a failing test, and a repaired implementation.

I repeatedly revieId:

- Voice behavior
- Screen context
- Approved-action execution
- Deterministic results
- Responsive layouts
- Accessibility states
- Control-plane data
- Demo clarity

Each iteration tightened the project around an observable learner outcome rather than expanding into unrelated features.

## Technologies used

The submission combines OpenAI-assisted development with a model-agnostic runtime architecture.

- **Codex with GPT-5.6** — repository analysis, planning, implementation, debugging, testing, refactoring, and documentation
- **ChatGPT Voice** — early product exploration and refinement of the learning vision
- **Whisper** — speech-to-text in the current voice pipeline
- **Text Gemma** — local language-model inference in the current demonstration runtime
- **Kokoro** — text-to-speech narration
- **Qiskit and Cirq** — quantum circuit generation and simulation targets
- **Circuit IR** — shared validated representation across visualization, simulation, stepping, and code generation
- **MCP** — tool and service integration
- **Playwright** — end-to-end browser acceptance testing and screenshots
- **PostgreSQL** — Control Plane persistence
- **Apache and front-door proxy** — public routing without exposing internal service ports
- **PWA and service workers** — installability, offline behavior, and recovery flows

The current runtime can be adapted to other LLM, speech-to-text, and text-to-speech providers. Codex with GPT-5.6 was central to how the project was designed, built, tested, and improved for this hackathon.

## Reusable Sumi architecture

Sumi is the platform layer, not a one-off quantum feature. The architecture separates five responsibilities.

## Voice runtime

Handles:

- Speech input
- Text-to-speech
- Interruption
- Audio unlock
- Listening state
- Voice reset
- Transcript filtering
- Thinking and waiting audio

## Screen registry

Describes:

- The current learning screen
- Concepts on the screen
- Visible controls
- RevieId explanations
- Supported actions
- Learning objectives
- Action aliases and parameters

## Typed action registry

Exposes only approved application actions.

The model cannot invent selectors or execute arbitrary code. It can request only registered actions with validated inputs.

## Application adapter

Connects Sumi actions to the real learning application.

The host application provides deterministic handlers for actions such as:

- Open a lesson
- Change a learning level
- Load an experiment
- Run a simulation
- Inspect a result
- Move through a circuit
- Reset the learning state

Integrators can provide their preferred:

- Language model
- Speech-to-text service
- Text-to-speech service

## Control plane

Owns:

- Organizations, applications, environments, and screen registries
- Approved-action policies and registry versions
- Prompt layers
- Telemetry ingestion and observability
- LLM-as-Judge evaluation
- Admin and revieIr workflows
- Retention, audit, and access control

## Host app

Owns:

- Real UI state
- Screen-specific approved actions
- Local execution and deterministic verification
- Voice-session lifecycle inside the browser
- Public learner experience

The key rule is simple:

> **The Control Plane may govern and observe, but the host application performs the action.**

Example integration:

```bash
npx sumi-framework init ./my-learning-site
npx sumi-framework validate ./sumi-screen-registry.json
npx sumi-framework install
```

This architecture can support science laboratories, mathematics lessons, coding exercises, engineering simulations, product training, and other interactive learning environments.

## Challenges I faced

## Browser voice behavior

Microphone permissions and browser autoplay restrictions behave differently across browsers, devices, and sessions.

## Interruption and barge-in

Sumi needed to stop speaking when the learner interrupted without accidentally transcribing her own voice output.

## Noisy speech transcripts

Whisper can receive background noise, partial words, or accidental audio. I added transcript filtering and decision gates before requests reach the language model or action layer.

## Turning conversation into real action

It was not enough for Sumi to produce a helpful text response. A request such as “show me Grover search” had to change actual application state, run the real experiment, and explain the verified result.

## Safe application control

Every action needed to be:

- Typed
- Screen-specific
- Bounded
- Reversible where possible
- Observable
- Verifiable

## Turning one app into a platform

Separating the host app from a reusable SDK and Control Plane introduced additional requirements:

- Screen registration must be explicit
- Approved actions must be scoped to screen and application
- Prompting must stay bounded to current screen context
- Telemetry must support review without collecting raw audio or arbitrary host internals
- A second application must be able to use Sumi without quantum-specific code
- Governance must not become remote control of the learner’s UI

## Explaining a complex product quickly

1StopQuantum includes learning, experimentation, simulation, provider analysis, benchmarking, voice interaction, an SDK, a CLI, and a Control Plane. Presenting the central value in a public video of less than three minutes required strict prioritization.

## Accomplishments that I are proud of

- **Built a working AI-guided learning experience, not only a chatbot.** Sumi understands the current screen, introduces the activity, asks learners to predict, performs approved actions, and explains verified outcomes.
- **Proved the model with a difficult subject.** 1StopQuantum turns natural-language requests into real circuits, local simulations, step-through views, Bloch visualizations, amplitudes, measurements, and Qiskit/Cirq code.
- **Created a reusable Sumi SDK and CLI.** Another educational application can scaffold a screen registry, validate approved actions, and integrate Sumi without importing quantum-specific logic.
- **Built a separate Sumi Control Plane.** It includes organization, application, environment, screen, action-policy, prompt-layer, observability, evaluation, admin-login, and enterprise-console concepts.
- **Kept real actions safe and local.** Screen-scoped typed handlers perform approved UI actions, while deterministic application code verifies results.
- **Delivered a working voice pipeline.** Whisper handles speech-to-text, Text Gemma provides local inference in the current demo, and Kokoro provides narration, with noise filtering, interruption handling, thinking audio, and explicit reset controls.
- **Designed for accessibility and real use.** The interface is responsive across desktop, tablet, and mobile, with keyboard-focused interaction, visible state, text fallback, and reduced reading burden.
- **Verified the product as software.** Playwright confirms real UI state changes; builds, Python tests, API checks, registry validation, screenshots, and recovery tests guard against regressions.
- **Connected the complete quantum workflow through one Circuit IR.** The same validated artifact drives visualization, simulation, step-through behavior, deterministic results, and Qiskit/Cirq generation.
- **Built deployable platform infrastructure.** PostgreSQL stores Control Plane state, MCP connects tools and services, and an Apache front-door proxy keeps internal backend ports private.
- **Used Codex with GPT-5.6 throughout the engineering lifecycle.** Codex accelerated repository understanding, architecture changes, SDK and control-plane implementation, voice integration, debugging, tests, responsive polish, and documentation.
- **Made deliberate human product decisions.** I defined the educational problem, selected quantum computing as the first proof case, established the action-safety boundary, revieId learner experience, and decided where deterministic software must override model output.
- **Produced a complete judge-ready submission.** The repository includes setup guidance, runnable services, sample configuration, working screens, a public demo narrative, and clear testing instructions.

## What I learned

The difficult part is not adding a chatbot.

The difficult part is designing the learning loop.

A learner may need help discovering:

- What to ask
- What to predict
- Which control to use
- What result to inspect
- Why the result changed
- What experiment should come next

AI becomes more useful in education when it is grounded in visible application state and constrained by deterministic software.

I also learned that explanation alone is not enough. Learning becomes more meaningful when the learner can make a prediction, observe the system, test an idea, and receive immediate feedback.

The most important product principle became:

> **The model explains and proposes. The application acts and verifies.**

I also learned how to work effectively with Codex. Clear goals, sufficient repository context, explicit constraints, observable acceptance criteria, and repeated verification produced far better results than broad prompts.

## What’s next for Sumi and 1StopQuantum

- Finalize Sumi SDK and Control Plane packaging so another app can adopt it without 1StopQuantum imports
- Integrate Sumi into a second non-quantum learning application
- Expand screen registries and action policies for additional education use cases
- Publish clearer educator and developer onboarding through the CLI
- Improve voice latency, audio fallback, multilingual support, and interruption behavior
- Add consent-based learner progress and personalization
- Continue strengthening observability, LLM-as-Judge evaluation, privacy controls, and responsible failure behavior
- Run structured learner studies to evaluate confidence, retention, accessibility, and conceptual understanding
- Continue improving 1StopQuantum as the first proof case while expanding Sumi to more applications

## Attribution and limitations

1StopQuantum and Sumi are independent educational projects.

Quantum SDK names, frameworks, models, and product names belong to their respective owners. Open-source software, datasets, and libraries are attributed in the repository documentation.

This hackathon build is an educational prototype. It may contain AI-assisted inaccuracies and should not be treated as a guarantee of scientific, educational, or production-grade correctness.

Sumi is still evolving and can make mistakes.

For that reason, application actions remain bounded, and simulation results are verified by deterministic software wherever possible.

## Closing vision

> **1StopQuantum is the first proof case. Sumi is the larger education platform.**

The next generation of education may not be static lectures, videos, and assignments with a chatbot added beside them.

It may be interactive learning applications in which AI listens, explains, demonstrates, acts safely, and helps the learner understand how an ansIr is built.
