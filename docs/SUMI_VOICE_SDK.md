# Sumi Voice SDK

For distributable application orchestration and CLI scaffolding, pair this low-level
voice session with `public/sumi-framework.js`. Generate a provider-neutral screen
adapter with:

```sh
npm run sumi-framework -- init --screen lesson-lab --title "Lesson Lab" --out ./public/sumi
npm run sumi-framework -- validate ./public/sumi/lesson-lab.registry.json
```

The generated contract requires three server endpoints: speech-to-text, an LLM,
and text-to-speech. Provider keys remain server-side. The shareable integration
guide is `docs/SumiFramework.html`.

`public/sumi-voice-sdk.js` is a dependency-free browser voice-session layer. It
keeps voice mechanics separate from screen permissions so the same Sumi control
can be added to another workspace without copying microphone, VAD, recording,
playback, or interruption code.

## What the SDK owns

- One opt-in `getUserMedia` stream with echo cancellation, noise suppression,
  automatic gain control, and mono capture.
- Continuous RMS voice detection while hands-free mode is enabled.
- Optional 16 kHz PCM streaming through an AudioWorklet/WebSocket transport,
  with server-side Silero VAD and automatic MediaRecorder/RMS fallback.
- Automatic recording when speech begins and endpointing after 650 ms of
  silence by default.
- Immediate playback interruption and an `onBargeIn` callback when the learner
  speaks while the assistant is busy.
- Push-to-talk capture, audio playback, and complete stream/context cleanup.
- A responsible-AI rejection callback for audio/transcripts that fail server-side
  RMS, Whisper confidence, hallucination, or text-sanity gates.

The SDK does not call an LLM, select an application action, or touch screen
controls. Each screen adapter owns transcription, context, action policy, and
rendering. Algorithm Studio is the reference adapter in `public/app.js`.

`SumiFramework` is the optional layer above the SDK. It loads a versioned JSON
registry, validates LLM actions against stable IDs, invokes only application-owned
handlers, prefers prepared audio, and delegates unmatched narration to the supplied
TTS adapter.

`public/sumi-ui-actions.js` is the reusable browser tool bridge. It adds typed,
whitelisted actions without exposing arbitrary selectors or JavaScript. A screen
registers handlers and enables only the action IDs listed by its screen registry:

```js
window.SumiUIActions.register("set_learning_level", ({ level }) => {
  screenStore.setLearningLevel(level);
  return { text: `Learning level is now ${level}.` };
}, {
  type: "object",
  properties: { level: { type: "string", enum: ["High school", "Undergraduate", "Master's"] } },
  required: ["level"],
});
window.SumiUIActions.allow(screenRegistry.screens.learn.allowed_actions);
await window.SumiUIActions.execute("set_learning_level", { level: "High school" });
```

The optional WebSocket bridge uses the same MCP-shaped envelope for future
agentic turns: `{type:"action", call_id, name, args}` from the agent and
`{type:"action_result", call_id, ok, result, data}` from the browser. The
1StopQuantum adapter currently performs the first tool turn through its local
Gemma route, then speaks the verified browser result. This keeps actions useful
even when the configured local model does not expose native function-calling.

## Add Sumi to another screen

Load `sumi-voice-sdk.js` before the screen bundle, then create one session:

```js
const session = new window.SumiVoiceSession({
  transportUrl: "ws://127.0.0.1:5152/api/duplex",
  workletUrl: "/sumi-mic-worklet.js",
  onBargeIn: () => currentTurn?.abort(),
  onRecordingStart: () => renderVoiceState("listening"),
  onTranscript: (text) => handleScreenTranscript(text),
  onRejected: ({ text, clipId, silent, reason }) => handleRejectedSpeech({ text, clipId, silent, reason }),
  onUtterance: (audio, metadata) => handleScreenUtterance(audio, metadata),
  onError: () => renderVoiceState("error"),
});
```

Connect the reusable lifecycle to that screen's controls:

```js
await session.setHandsFree(true);  // explicit learner opt-in
await session.startPushToTalk();   // icon/push-to-talk alternative
await session.stopUtterance();

session.setAssistantBusy(true);    // enables barge-in during LLM work
const completed = await session.playAudio(kokoroBlobOrUrl);
session.setAssistantBusy(false);

await session.setHandsFree(false); // release the mic when leaving the screen
await session.destroy();           // final teardown
```

With `transportUrl`, the SDK sends continuous PCM16 frames and delivers the
server's local Whisper result through `onTranscript`. If AudioWorklet or the
WebSocket is unavailable, it automatically uses browser VAD and delivers a
recorded `Blob` through `onUtterance`. The adapter then sends the transcript to
a screen-specific Gemma boundary and passes spoken text to Kokoro. Abort those
requests from `onBargeIn`; do not put selectors or arbitrary model-provided
actions in the voice SDK.

## Responsible noise gate

`app/voice_gatekeeper.py` runs before Sumi's LLM and action router. Raw PCM must
pass an utterance RMS gate before Whisper. Whisper output must then pass its
`no_speech_prob` and `avg_logprob` thresholds, a known-hallucination denylist,
and repeated-token/pronounceability checks. Rejected text never becomes an LLM
prompt and never selects a screen action.

The per-connection clarification policy plays prepared `noise_clarify_1.wav`
and `noise_clarify_2.wav` for the first two consecutive unclear utterances.
Further noise is silently ignored until valid speech arrives or the 20-second
quiet-reset window expires. Tune local microphones through
`VOICE_SILERO_THRESHOLD`, `VOICE_MIN_PCM_RMS`, `VOICE_MAX_NO_SPEECH_PROB`,
`VOICE_MIN_AVG_LOGPROB`, and `VOICE_MIN_WORD_CONFIDENCE`; rejected reason and a
bounded transcript excerpt are written only to the local voice-service log.

## Runtime boundary

This is a fast interruptible STT -> text LLM -> TTS pipeline, not native
simultaneous speech-to-speech. Microphone PCM streams continuously for VAD and
barge-in, while the current Whisper and Kokoro models still consume completed
utterance/text requests. The persistent mic, 600 ms server endpoint, cancellable
requests, immediate playback stop, and browser echo cancellation provide the
natural full-duplex feeling supported by those local models.
