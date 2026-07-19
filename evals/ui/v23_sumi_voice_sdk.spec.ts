import { expect, test } from "@playwright/test";

test.describe("v23 reusable Sumi voice SDK", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const calls: MediaStreamConstraints[] = [];
      const track = { stopped: false, stop() { this.stopped = true; } };
      const stream = { getTracks: () => [track] };
      Object.assign(window, { __sumiMediaCalls: calls, __sumiTrack: track });
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          async getUserMedia(constraints: MediaStreamConstraints) {
            calls.push(constraints);
            return stream;
          },
        },
      });
      class Recorder {
        state = "inactive";
        mimeType = "audio/webm";
        ondataavailable: ((event: { data: Blob }) => void) | null = null;
        onstop: (() => void) | null = null;
        start() { this.state = "recording"; }
        stop() {
          this.state = "inactive";
          this.ondataavailable?.({ data: new Blob(["voice"], { type: this.mimeType }) });
          this.onstop?.();
        }
      }
      let analyserReads = 0;
      class AudioContextStub {
        createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
        createAnalyser() {
          return {
            fftSize: 0,
            disconnect() {},
            getByteTimeDomainData(values: Uint8Array) {
              analyserReads += 1;
              values.fill(analyserReads <= 5 ? 174 : 128);
            },
          };
        }
        async close() {}
      }
      Object.defineProperty(window, "MediaRecorder", { configurable: true, value: Recorder });
      Object.defineProperty(window, "AudioContext", { configurable: true, value: AudioContextStub });
    });
    await page.goto("/?view=circuits");
  });

  test("opens one persistent echo-cancelled microphone session", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const VoiceSession = (window as any).SumiVoiceSession;
      const session = new VoiceSession({ silenceMs: 120 });
      await session.setHandsFree(true);
      await session.setHandsFree(true);
      const calls = (window as any).__sumiMediaCalls as MediaStreamConstraints[];
      const constraints = calls[0].audio as MediaTrackConstraints;
      await session.destroy();
      return {
        callCount: calls.length,
        echoCancellation: constraints.echoCancellation,
        noiseSuppression: constraints.noiseSuppression,
        autoGainControl: constraints.autoGainControl,
        trackStopped: (window as any).__sumiTrack.stopped,
      };
    });

    expect(result).toEqual({
      callCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      trackStopped: true,
    });
  });

  test("detects barge-in while Sumi is busy and endpoints the new utterance", async ({ page }) => {
    await page.evaluate(async () => {
      const VoiceSession = (window as any).SumiVoiceSession;
      (window as any).__sumiEvents = [];
      const session = new VoiceSession({
        silenceMs: 120,
        speechFrames: 2,
        onBargeIn: () => (window as any).__sumiEvents.push("barge-in"),
        onRecordingStart: () => (window as any).__sumiEvents.push("recording"),
        onUtterance: (audio: Blob) => (window as any).__sumiEvents.push(`utterance:${audio.size}`),
      });
      session.setAssistantBusy(true);
      await session.setHandsFree(true);
      (window as any).__sumiSession = session;
    });

    await expect.poll(() => page.evaluate(() => (window as any).__sumiEvents)).toEqual([
      "barge-in",
      "recording",
      "utterance:5",
    ]);
    expect(await page.evaluate(() => (window as any).__sumiMediaCalls.length)).toBe(1);
    expect(await page.evaluate(() => (window as any).__sumiTrack.stopped)).toBe(false);
    await page.evaluate(() => (window as any).__sumiSession.destroy());
  });

  test("supports reusable AudioWorklet and WebSocket transport callbacks", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const events: string[] = [];
      class SocketStub {
        static instance: SocketStub;
        readyState = 0;
        sent: unknown[] = [];
        onopen: (() => void) | null = null;
        onmessage: ((event: { data: string }) => void) | null = null;
        onclose: (() => void) | null = null;
        onerror: (() => void) | null = null;
        constructor(public url: string) {
          SocketStub.instance = this;
          window.setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 0);
        }
        send(data: unknown) { this.sent.push(data); }
        close() { this.readyState = 3; this.onclose?.(); }
        emit(message: object) { this.onmessage?.({ data: JSON.stringify(message) }); }
      }
      class TransportContext {
        audioWorklet = { addModule: async (url: string) => events.push(`worklet:${url}`) };
        destination = {};
        createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
        createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
        async close() {}
      }
      class WorkletStub {
        static instance: WorkletStub;
        port: { onmessage: ((event: { data: ArrayBuffer }) => void) | null } = { onmessage: null };
        constructor() { WorkletStub.instance = this; }
        connect() {}
        disconnect() {}
      }
      const VoiceSession = (window as any).SumiVoiceSession;
      const session = new VoiceSession({
        transportUrl: "ws://127.0.0.1:5152/api/duplex",
        workletUrl: "/sumi-mic-worklet.js",
        AudioContextClass: TransportContext,
        AudioWorkletNodeClass: WorkletStub,
        WebSocketClass: SocketStub,
        onBargeIn: () => events.push("barge-in"),
        onRecordingStart: () => events.push("speech-start"),
        onTranscript: (text: string) => events.push(`final:${text}`),
      });
      await session.setHandsFree(true);
      session.setAssistantBusy(true);
      SocketStub.instance.emit({ type: "interrupt" });
      SocketStub.instance.emit({ type: "speech_start" });
      SocketStub.instance.emit({ type: "final", text: "Show Bell" });
      WorkletStub.instance.port.onmessage?.({ data: new ArrayBuffer(1024) });
      const snapshot = {
        events,
        transportActive: session.transportActive,
        socketUrl: SocketStub.instance.url,
        binaryFrames: SocketStub.instance.sent.filter((item) => item instanceof ArrayBuffer).length,
      };
      await session.destroy();
      return snapshot;
    });

    expect(result).toEqual({
      events: ["worklet:/sumi-mic-worklet.js", "barge-in", "speech-start", "final:Show Bell"],
      transportActive: true,
      socketUrl: "ws://127.0.0.1:5152/api/duplex",
      binaryFrames: 1,
    });
  });

  test("suppresses the intro echo without swallowing the next learner turn", async ({ page }) => {
    const events = await page.evaluate(async () => {
      const received: string[] = [];
      const VoiceSession = (window as any).SumiVoiceSession;
      const session = new VoiceSession({
        onBargeIn: () => received.push("barge-in"),
        onRecordingStart: () => received.push("speech-start"),
        onTranscript: (text: string) => received.push(`final:${text}`),
      });
      session.setAssistantBusy(true);
      session.suppressSpeech(20);
      session._handleTransportMessage(JSON.stringify({ type: "interrupt" }));
      session._handleTransportMessage(JSON.stringify({ type: "speech_start" }));
      session._handleTransportMessage(JSON.stringify({ type: "final", text: "Hi, I am Sumi" }));
      await new Promise((resolve) => window.setTimeout(resolve, 30));
      session._handleTransportMessage(JSON.stringify({ type: "speech_start" }));
      session._handleTransportMessage(JSON.stringify({ type: "final", text: "Skip intro" }));
      return received;
    });

    expect(events).toEqual(["speech-start", "final:Skip intro"]);
  });
});
