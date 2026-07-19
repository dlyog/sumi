# Sumi Framework Integration Guide

Sumi is a provider-neutral browser framework for adding an AI learning companion
to an existing platform. It separates voice transport, model reasoning, and UI
execution so host applications retain control of learner data and screen actions.

## Package contents

- `public/sumi-framework.js` orchestrates STT → LLM decision → allowed action → TTS.
- `public/sumi-voice-sdk.js` owns microphone capture, duplex transport, barge-in,
  playback, fallback recording, and cleanup.
- `public/sumi-ui-actions.js` validates and executes application-owned UI tools.
- `public/sumi-mic-worklet.js` streams 16 kHz PCM audio when supported.
- `scripts/sumi-framework-cli.js` scaffolds and validates screen registries.

The implementation is dependency-free browser JavaScript. Copy the browser files
into the host application's static asset pipeline or expose them from this service.

## Scaffold a screen

From this repository:

```bash
npm run sumi-framework -- init \
  --screen lesson-lab \
  --title "Lesson Lab" \
  --out ./public/sumi
npm run sumi-framework -- validate ./public/sumi/lesson-lab.registry.json
```

When this package is installed with its npm binary, the equivalent commands begin
with `sumi-framework`. Screen IDs use lowercase letters, digits, and hyphens.
The command creates a provider configuration, a registry, and a browser adapter.

## Provide three server APIs

The generated adapter expects these host-defined URLs:

```js
window.SUMI_STT_URL = "/api/sumi/stt";
window.SUMI_LLM_URL = "/api/sumi/llm";
window.SUMI_TTS_URL = "/api/sumi/tts";
```

- **STT** accepts multipart audio and returns `{ "text": "..." }` or a
  `transcription` field.
- **LLM** accepts the current screen, learner utterance, allowed actions, and
  application context. It returns a response and, optionally, an action plus args.
- **TTS** accepts `{ "text": "..." }` and returns an audio blob.

Provider credentials belong on the server. Do not embed model or speech API keys
in the generated adapter, browser storage, registry, or frontend environment.
The 1StopQuantum reference host keeps MLX Whisper and Kokoro local on port `5152`;
see `docs/LOCAL_AI_SETUP.md` for installation and request-level health checks.

## Register safe application actions

The registry is the permission boundary. Give every action a stable ID and JSON
argument schema, then register a handler owned by the host application:

```js
window.SumiUIActions.register("open_lesson", ({ lessonId }) => {
  lessonRouter.open(lessonId);
  return { text: `Opened lesson ${lessonId}.` };
}, {
  type: "object",
  properties: { lessonId: { type: "string" } },
  required: ["lessonId"],
});
```

List the ID in that screen's `allowed_actions`. Sumi rejects unregistered or
screen-disallowed action names. Handlers should return observed application state
so narration describes what actually happened, not what a model predicted.

## Load and initialize

Load the action bridge, voice SDK, and framework before the generated adapter:

```html
<script src="/sumi-ui-actions.js"></script>
<script src="/sumi-voice-sdk.js"></script>
<script src="/sumi-framework.js"></script>
<script type="module" src="/sumi/lesson-lab.adapter.js"></script>
```

The generated adapter shows the provider callbacks passed to `SumiFramework`.
Call `initialize()` only after the page actions and screen context are ready.
Require explicit learner consent before enabling the microphone, abort in-flight
requests on barge-in, and call `destroy()` when the screen unmounts.

## Production checklist

- Authenticate and rate-limit all three provider endpoints.
- Validate the registry in CI with `sumi-framework validate`.
- Keep action schemas narrow and never expose arbitrary selectors or code execution.
- Filter private learner state before adding it to LLM context.
- Use HTTPS outside localhost; browsers require a secure context for microphone use.
- Surface listening, thinking, speaking, interrupted, rejected, and error states.
- Test keyboard operation, reduced motion, mic denial, network loss, and cleanup.

See `public/sumi-screen-registry.json` and `public/app.js` for the 1StopQuantum
reference implementation. `docs/SumiFramework.html` is a portable visual guide.
