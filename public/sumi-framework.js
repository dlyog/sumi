(function installSumiFramework(global) {
  "use strict";

  class SumiFramework {
    constructor(options = {}) {
      this.options = options;
      this.screenId = options.screenId || "default";
      this.registry = options.registry || null;
      this.registryUrl = options.registryUrl || "";
      this.providers = options.providers || {};
      this.actionHandlers = options.actionHandlers || {};
      this.uiActions = options.uiActions || global.SumiUIActions || null;
      this.voiceSession = options.voiceSession || null;
      this.turnController = null;
      this.active = false;
    }

    async initialize() {
      if (!this.registry && this.registryUrl) {
        const response = await fetch(this.registryUrl);
        if (!response.ok) throw new Error(`Sumi registry HTTP ${response.status}`);
        this.registry = await response.json();
      }
      this._validateRegistry();
      if (!this.voiceSession && global.SumiVoiceSession) {
        this.voiceSession = new global.SumiVoiceSession({
          ...(this.options.voice || {}),
          onBargeIn: () => this.interrupt(),
          onTranscript: (text) => this.handleTranscript(text),
          onUtterance: (audio, metadata) => this.handleUtterance(audio, metadata),
          onRecordingStart: () => this._emit("onState", "listening"),
          onError: (error) => this._emit("onError", error),
        });
      }
      return this;
    }

    _validateRegistry() {
      if (!this.registry || typeof this.registry !== "object") throw new Error("A Sumi screen registry is required");
      const actions = this.registry.actions || [];
      if (!Array.isArray(actions) || actions.some((entry) => !entry?.id)) throw new Error("Registry actions must have stable ids");
    }

    _emit(name, ...args) {
      const callback = this.options[name];
      if (typeof callback === "function") return callback(...args);
      return undefined;
    }

    allowedActions() {
      const registered = (this.registry?.actions || []).map((entry) => entry.id);
      const screenAllowed = this.screenContext()?.allowed_actions;
      if (!Array.isArray(screenAllowed)) return registered;
      return screenAllowed.filter((action) => registered.includes(action));
    }

    screenContext() {
      return this.registry?.screens?.[this.screenId] || {
        title: this.registry?.title || this.screenId,
        description: "",
      };
    }

    async start() {
      if (!this.registry) await this.initialize();
      this.active = true;
      await this.voiceSession?.setHandsFree(true);
      this._emit("onState", "listening");
    }

    async stop() {
      this.active = false;
      this.interrupt();
      await this.voiceSession?.setHandsFree(false);
      this._emit("onState", "idle");
    }

    interrupt() {
      this.turnController?.abort();
      this.turnController = null;
      this.voiceSession?.stopPlayback();
      this._emit("onInterrupt");
    }

    async handleUtterance(audio, metadata = {}) {
      if (typeof this.providers.stt !== "function") throw new Error("A speech-to-text adapter is required");
      this._emit("onState", "thinking");
      const text = await this.providers.stt(audio, metadata);
      return this.handleTranscript(text);
    }

    async handleTranscript(text) {
      const learnerText = String(text || "").trim();
      if (!learnerText) return null;
      if (typeof this.providers.llm !== "function") throw new Error("An LLM adapter is required");
      this.interrupt();
      const controller = new AbortController();
      this.turnController = controller;
      this._emit("onTurn", { role: "learner", text: learnerText });
      this._emit("onState", "thinking");
      const decision = await this.providers.llm({
        text: learnerText,
        screenId: this.screenId,
        screen: this.screenContext(),
        allowedActions: this.allowedActions(),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return null;
      const action = String(decision?.action || "answer_question");
      if (!this.allowedActions().includes(action)) throw new Error(`Unregistered Sumi action: ${action}`);
      const handler = this.actionHandlers[action];
      let handled = typeof handler === "function" ? await handler(decision, controller.signal) : null;
      if (!handled && this.uiActions?.has?.(action)) {
        this.uiActions.allow(this.allowedActions());
        handled = await this.uiActions.execute(action, decision.args || {}, { screenId: this.screenId, signal: controller.signal });
      }
      const response = String(handled?.text || handled || decision?.response || "").trim();
      const audioId = String(handled?.audioId || decision?.audioId || "");
      if (response) await this.speak(response, audioId, controller.signal);
      if (this.turnController === controller) this.turnController = null;
      return { ...decision, response };
    }

    async executeAction(name, args = {}, signal = null) {
      if (!this.allowedActions().includes(name)) throw new Error(`Action '${name}' is not registered on ${this.screenId}`);
      if (typeof this.actionHandlers[name] === "function") return this.actionHandlers[name]({ action: name, args }, signal);
      if (!this.uiActions?.has?.(name)) throw new Error(`No browser handler is registered for '${name}'`);
      this.uiActions.allow(this.allowedActions());
      return this.uiActions.execute(name, args, { screenId: this.screenId, signal });
    }

    async speak(text, audioId = "", signal = null) {
      this._emit("onTurn", { role: "assistant", text });
      this._emit("onState", "speaking");
      this.voiceSession?.setAssistantBusy(true);
      let source = null;
      if (audioId && typeof this.options.preparedAudio === "function") source = await this.options.preparedAudio(audioId);
      if (!source) {
        if (typeof this.providers.tts !== "function") throw new Error("A text-to-speech adapter is required");
        source = await this.providers.tts(text, { signal });
      }
      if (signal?.aborted) return false;
      const completed = await this.voiceSession?.playAudio(source);
      this.voiceSession?.setAssistantBusy(false);
      if (this.active) this._emit("onState", "listening");
      return completed;
    }

    async destroy() {
      this.active = false;
      this.interrupt();
      await this.voiceSession?.destroy();
      this.voiceSession = null;
    }
  }

  global.SumiFramework = SumiFramework;
})(window);
