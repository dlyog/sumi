class SumiMicCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetRate = options.processorOptions?.targetRate || 16000;
    this.ratio = sampleRate / this.targetRate;
    this.readPosition = 0;
    this.input = [];
    this.frameSamples = Math.round(this.targetRate * 0.032);
    this.output = new Int16Array(this.frameSamples);
    this.outputPosition = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (const sample of channel) this.input.push(sample);
    while (this.readPosition + this.ratio < this.input.length) {
      const index = Math.floor(this.readPosition);
      const fraction = this.readPosition - index;
      const interpolated = this.input[index] * (1 - fraction) + this.input[index + 1] * fraction;
      const bounded = Math.max(-1, Math.min(1, interpolated));
      this.output[this.outputPosition] = bounded < 0 ? bounded * 0x8000 : bounded * 0x7fff;
      this.outputPosition += 1;
      this.readPosition += this.ratio;
      if (this.outputPosition === this.frameSamples) {
        const frame = this.output.buffer.slice(0);
        this.port.postMessage(frame, [frame]);
        this.outputPosition = 0;
      }
    }
    const consumed = Math.floor(this.readPosition);
    if (consumed) {
      this.input = this.input.slice(consumed);
      this.readPosition -= consumed;
    }
    return true;
  }
}

registerProcessor("sumi-mic-capture", SumiMicCapture);
