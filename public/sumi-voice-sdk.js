(function installSumiVoiceSDK(global) {
  "use strict";

  const DEFAULT_CONSTRAINTS = Object.freeze({
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  });

  class SumiVoiceSession {
    constructor(options = {}) {
      this.options = options;
      this.silenceMs = Number(options.silenceMs || 650);
      this.speechThreshold = Number(options.speechThreshold || 0.035);
      this.speechFrames = Number(options.speechFrames || 2);
      this.mediaDevices = options.mediaDevices || global.navigator?.mediaDevices;
      this.MediaRecorderClass = options.MediaRecorderClass || global.MediaRecorder;
      this.AudioContextClass = options.AudioContextClass || global.AudioContext || global.webkitAudioContext;
      this.AudioClass = options.AudioClass || global.Audio;
      this.AudioWorkletNodeClass = options.AudioWorkletNodeClass || global.AudioWorkletNode;
      this.WebSocketClass = options.WebSocketClass || global.WebSocket;
      this.transportUrl = options.transportUrl || "";
      this.workletUrl = options.workletUrl || "/sumi-mic-worklet.js";
      this.constraints = { ...DEFAULT_CONSTRAINTS, ...(options.audioConstraints || {}) };
      this.stream = null;
      this.recorder = null;
      this.chunks = [];
      this.audioContext = null;
      this.playbackContext = null;
      this.audioSource = null;
      this.analyser = null;
      this.vadFrame = null;
      this.socket = null;
      this.workletNode = null;
      this.silentGain = null;
      this.transportActive = false;
      this.remoteSpeech = false;
      this.closingTransport = false;
      this.voiceDetected = false;
      this.voicedFrames = 0;
      this.lastVoiceAt = 0;
      this.handsFree = false;
      this.assistantBusy = false;
      this.discardRecording = false;
      this.stopWaiters = [];
      this.player = null;
      this.playbackSource = null;
      this.playerFinish = null;
      this.playerObjectUrl = "";
      this.destroyed = false;
      this.speechSuppressedUntil = 0;
      this.suppressedRemoteUtterance = false;
    }

    get isRecording() { return this.recorder?.state === "recording" || this.remoteSpeech; }
    get isPlaying() { return Boolean(this.player); }

    _emit(name, ...args) {
      const callback = this.options[name];
      if (typeof callback !== "function") return undefined;
      try { return callback(...args); } catch (_) { return undefined; }
    }

    async ensureMicrophone() {
      if (this.destroyed) throw new Error("Voice session has been destroyed");
      if (this.stream) return this.stream;
      if (!this.mediaDevices?.getUserMedia) throw new Error("Browser voice capture is unavailable");
      this.stream = await this.mediaDevices.getUserMedia({ audio: this.constraints });
      return this.stream;
    }

    async setHandsFree(enabled) {
      const next = Boolean(enabled);
      if (next) {
        this.handsFree = true;
        await this.ensureMicrophone();
        if (!this.transportActive && !this.analyser) {
          const connected = await this._startTransport();
          if (!connected) this._startMonitor();
        }
        return;
      }
      this.handsFree = false;
      await this._stopRecording(true);
      this._releaseMicrophone();
    }

    setAssistantBusy(busy) {
      this.assistantBusy = Boolean(busy);
    }

    async unlockAudio() {
      // Preserve the user's click gesture across microphone permission awaits.
      // A muted, one-sample playback unlocks subsequent Kokoro Audio elements
      // in browsers that otherwise reject the first spoken response.
      try {
        const AudioContextClass = global.AudioContext || global.webkitAudioContext;
        if (AudioContextClass) {
          this.playbackContext ||= new AudioContextClass();
          await this.playbackContext.resume();
          if (this.playbackContext.createBuffer && this.playbackContext.createBufferSource) {
            const buffer = this.playbackContext.createBuffer(1, 1, 22050);
            const source = this.playbackContext.createBufferSource();
            source.buffer = buffer;
            source.connect(this.playbackContext.destination);
            source.start();
          }
        }
      } catch (_) {}
      try {
        const probe = new this.AudioClass();
        probe.muted = true;
        probe.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAESsAAABAAgAZGF0YQAAAAA=";
        await probe.play();
        probe.pause();
      } catch (_) {}
    }

    suppressSpeech(durationMs = 1000) {
      const duration = Math.max(0, Number(durationMs) || 0);
      this.speechSuppressedUntil = Date.now() + duration;
      this.suppressedRemoteUtterance = false;
    }

    _speechIsSuppressed() {
      return Date.now() < this.speechSuppressedUntil;
    }

    async startPushToTalk() {
      await this.ensureMicrophone();
      if (!this.transportActive && !this.analyser) this._startMonitor();
      this._beginRecording(false);
    }

    async stopUtterance(options = {}) {
      if (this.transportActive && this.remoteSpeech && !options.discard) {
        try { this.socket?.send(JSON.stringify({ type: "commit" })); } catch (_) {}
        return;
      }
      await this._stopRecording(Boolean(options.discard));
      if (!this.handsFree) this._releaseMicrophone();
    }

    async _startTransport() {
      if (!this.transportUrl || !this.WebSocketClass || !this.AudioWorkletNodeClass || !this.AudioContextClass || !this.stream) return false;
      const context = new this.AudioContextClass();
      if (!context.audioWorklet?.addModule) {
        Promise.resolve(context.close()).catch(() => {});
        return false;
      }
      try {
        await context.audioWorklet.addModule(this.workletUrl);
        const socket = new this.WebSocketClass(this.transportUrl);
        socket.binaryType = "arraybuffer";
        await new Promise((resolve, reject) => {
          const timeout = global.setTimeout(() => reject(new Error("Duplex voice connection timed out")), 1400);
          socket.onopen = () => { global.clearTimeout(timeout); resolve(); };
          socket.onerror = () => { global.clearTimeout(timeout); reject(new Error("Duplex voice connection failed")); };
        });
        this._stopMonitor();
        this.audioContext = context;
        this.socket = socket;
        this.audioSource = context.createMediaStreamSource(this.stream);
        this.workletNode = new this.AudioWorkletNodeClass(context, "sumi-mic-capture", { processorOptions: { targetRate: 16000 } });
        this.silentGain = context.createGain?.() || null;
        this.audioSource.connect(this.workletNode);
        if (this.silentGain) {
          this.silentGain.gain.value = 0;
          this.workletNode.connect(this.silentGain);
          this.silentGain.connect(context.destination);
        }
        this.workletNode.port.onmessage = (event) => {
          if (this.socket?.readyState === 1) this.socket.send(event.data);
        };
        socket.onmessage = (event) => this._handleTransportMessage(event.data);
        socket.onclose = () => this._handleTransportClose();
        socket.onerror = () => {};
        this.transportActive = true;
        this._emit("onTransportChange", { transport: "websocket", connected: true });
        return true;
      } catch (error) {
        try { context.close(); } catch (_) {}
        this._emit("onTransportChange", { transport: "media-recorder", connected: false, error });
        return false;
      }
    }

    _handleTransportMessage(data) {
      if (typeof data !== "string") return;
      let message;
      try { message = JSON.parse(data); } catch (_) { return; }
      if (message.type === "interrupt") {
        if (this._speechIsSuppressed()) {
          this.suppressedRemoteUtterance = true;
          return;
        }
        const interrupted = this.assistantBusy || this.isPlaying;
        if (interrupted) {
          this.stopPlayback();
          this.assistantBusy = false;
          this._emit("onBargeIn");
        }
      } else if (message.type === "speech_start") {
        if (this._speechIsSuppressed() || this.suppressedRemoteUtterance) {
          this.suppressedRemoteUtterance = true;
          return;
        }
        this.remoteSpeech = true;
        this._emit("onRecordingStart", { handsFree: true, transport: "websocket" });
      } else if (message.type === "final") {
        if (this.suppressedRemoteUtterance) {
          this.suppressedRemoteUtterance = false;
          this.remoteSpeech = false;
          return;
        }
        this.remoteSpeech = false;
        if (message.text) this._emit("onTranscript", String(message.text));
      } else if (message.type === "rejected") {
        this.remoteSpeech = false;
        this._emit("onRejected", {
          reason: String(message.reason || "unclear_audio"),
          text: String(message.text || ""),
          clipId: String(message.clip_id || ""),
          silent: Boolean(message.silent),
        });
      } else if (message.type === "action") {
        // The reusable browser tool bridge owns validation and execution;
        // the voice transport only forwards the typed request.
        this._emit("onAction", message, this.socket);
      } else if (message.type === "state") {
        this._emit("onRemoteState", message.value);
      } else if (message.type === "error") {
        this.remoteSpeech = false;
        this._emit("onError", new Error(message.text || "Duplex voice service error"));
      }
    }

    _handleTransportClose() {
      if (this.closingTransport) return;
      this._stopTransport(false);
      if (this.handsFree && this.stream) {
        this._startMonitor();
        this._emit("onTransportChange", { transport: "media-recorder", connected: true });
      }
    }

    _stopTransport(closeSocket = true) {
      this.closingTransport = true;
      const socket = this.socket;
      this.socket = null;
      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        if (closeSocket) try { socket.close(); } catch (_) {}
      }
      try { this.workletNode?.disconnect(); } catch (_) {}
      try { this.silentGain?.disconnect(); } catch (_) {}
      this.workletNode = null;
      this.silentGain = null;
      this.transportActive = false;
      this.remoteSpeech = false;
      this.closingTransport = false;
    }

    _startMonitor() {
      this._stopMonitor();
      if (!this.AudioContextClass || !this.stream) return;
      try {
        this.audioContext = new this.AudioContextClass();
        this.audioSource = this.audioContext.createMediaStreamSource(this.stream);
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 1024;
        this.audioSource.connect(this.analyser);
        const values = new Uint8Array(this.analyser.fftSize);
        const inspect = (now) => {
          if (!this.analyser || this.destroyed) return;
          if (this._speechIsSuppressed()) {
            this.voicedFrames = 0;
            this.vadFrame = global.requestAnimationFrame(inspect);
            return;
          }
          this.analyser.getByteTimeDomainData(values);
          let energy = 0;
          for (const value of values) {
            const sample = (value - 128) / 128;
            energy += sample * sample;
          }
          const rms = Math.sqrt(energy / values.length);
          if (rms >= this.speechThreshold) {
            this.voicedFrames += 1;
            if (this.voicedFrames >= this.speechFrames) {
              this.lastVoiceAt = now;
              if (this.handsFree && !this.isRecording) {
                const interrupted = this.assistantBusy || this.isPlaying;
                if (interrupted) {
                  this.stopPlayback();
                  this.assistantBusy = false;
                  this._emit("onBargeIn");
                }
                this._beginRecording(true);
              }
              if (this.isRecording) this.voiceDetected = true;
            }
          } else {
            this.voicedFrames = 0;
          }
          if (this.isRecording && this.handsFree && this.voiceDetected && now - this.lastVoiceAt >= this.silenceMs) {
            this._stopRecording(false);
          }
          this.vadFrame = global.requestAnimationFrame(inspect);
        };
        this.vadFrame = global.requestAnimationFrame(inspect);
      } catch (error) {
        this._stopMonitor();
        this._emit("onError", error);
      }
    }

    _beginRecording(autoEndpoint) {
      if (!this.stream || !this.MediaRecorderClass || this.isRecording) return;
      const recorder = new this.MediaRecorderClass(this.stream);
      this.recorder = recorder;
      this.chunks = [];
      this.discardRecording = false;
      this.voiceDetected = Boolean(autoEndpoint);
      this.lastVoiceAt = global.performance?.now?.() || Date.now();
      recorder.ondataavailable = (event) => { if (event.data?.size) this.chunks.push(event.data); };
      recorder.onstop = () => this._handleRecorderStop(recorder);
      recorder.start(250);
      this._emit("onRecordingStart", { handsFree: this.handsFree });
    }

    _handleRecorderStop(recorder) {
      if (this.recorder !== recorder) return;
      const discarded = this.discardRecording;
      const type = recorder.mimeType || "audio/webm";
      const audio = new Blob(this.chunks, { type });
      this.recorder = null;
      this.chunks = [];
      this.voiceDetected = false;
      this.discardRecording = false;
      const waiters = this.stopWaiters.splice(0);
      waiters.forEach((resolve) => resolve());
      if (!discarded && audio.size) this._emit("onUtterance", audio, { mimeType: type });
      if (!this.handsFree) this._releaseMicrophone();
    }

    _stopRecording(discard) {
      if (!this.isRecording) return Promise.resolve();
      this.discardRecording = this.discardRecording || discard;
      return new Promise((resolve) => {
        this.stopWaiters.push(resolve);
        try { this.recorder.stop(); } catch (_) { resolve(); }
      });
    }

    async playAudio(source) {
      this.stopPlayback();
      const playbackContext = this.playbackContext;
      if (playbackContext?.decodeAudioData && playbackContext.createBufferSource) {
        try {
          await playbackContext.resume();
          const response = source instanceof Blob
            ? source
            : await fetch(String(source || ""));
          if (!(response instanceof Blob) && !response.ok) throw new Error(`Audio HTTP ${response.status}`);
          const bytes = await response.arrayBuffer();
          const buffer = await playbackContext.decodeAudioData(bytes.slice(0));
          const player = playbackContext.createBufferSource();
          player.buffer = buffer;
          player.connect(playbackContext.destination);
          this.player = player;
          this.playbackSource = player;
          this.assistantBusy = true;
          return new Promise((resolve) => {
            const finish = (played) => {
              if (this.playerFinish !== finish) return;
              this.player = null;
              this.playbackSource = null;
              this.playerFinish = null;
              player.onended = null;
              this.assistantBusy = false;
              resolve(played);
            };
            this.playerFinish = finish;
            player.onended = () => finish(true);
            player.start();
          });
        } catch (_) {
          this.player = null;
          this.playbackSource = null;
          this.playerFinish = null;
          this.assistantBusy = false;
        }
      }
      const url = source instanceof Blob ? URL.createObjectURL(source) : String(source || "");
      if (!url || !this.AudioClass) return false;
      if (source instanceof Blob) this.playerObjectUrl = url;
      this.player = new this.AudioClass(url);
      this.assistantBusy = true;
      return new Promise((resolve) => {
        const finish = (played) => {
          if (this.playerFinish !== finish) return;
          const player = this.player;
          this.player = null;
          this.playerFinish = null;
          if (player) { player.onended = null; player.onerror = null; }
          this._revokePlayerUrl();
          this.assistantBusy = false;
          resolve(played);
        };
        this.playerFinish = finish;
        this.player.onended = () => finish(true);
        this.player.onerror = () => finish(false);
        Promise.resolve(this.player.play()).catch(() => finish(false));
      });
    }

    stopPlayback() {
      const player = this.player;
      const finish = this.playerFinish;
      if (player) {
        player.onended = null;
        player.onerror = null;
        try { player.pause(); } catch (_) {}
        try { player.stop?.(); } catch (_) {}
      }
      if (finish) {
        finish(false);
      } else {
        this.player = null;
        this._revokePlayerUrl();
        this.assistantBusy = false;
      }
    }

    _revokePlayerUrl() {
      if (!this.playerObjectUrl) return;
      URL.revokeObjectURL(this.playerObjectUrl);
      this.playerObjectUrl = "";
    }

    _stopMonitor() {
      if (this.vadFrame) global.cancelAnimationFrame(this.vadFrame);
      this.vadFrame = null;
      try { this.audioSource?.disconnect(); } catch (_) {}
      try { this.analyser?.disconnect(); } catch (_) {}
      this.audioSource = null;
      this.analyser = null;
      const context = this.audioContext;
      this.audioContext = null;
      if (context) Promise.resolve(context.close()).catch(() => {});
    }

    _releaseMicrophone() {
      this._stopTransport();
      this._stopMonitor();
      this.stream?.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    async destroy() {
      if (this.destroyed) return;
      this.handsFree = false;
      this.stopPlayback();
      await this._stopRecording(true);
      this._releaseMicrophone();
      try { await this.playbackContext?.close?.(); } catch (_) {}
      this.playbackContext = null;
      this.destroyed = true;
    }
  }

  global.SumiVoiceSession = SumiVoiceSession;
})(window);
