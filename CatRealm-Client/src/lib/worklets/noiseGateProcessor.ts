// AudioWorkletProcessor: RMS-based noise gate with smooth attack/release envelope.
// Runs inside the AudioWorklet global scope — do not import browser/Node APIs here.

class NoiseGateProcessor extends AudioWorkletProcessor {
  private thresholdLinear: number;
  private gain: number;
  // Smoothing coefficients computed from sample rate (48kHz assumed)
  private attackCoeff: number;
  private releaseCoeff: number;
  // Hold counter in samples to avoid rapid gating on transient gaps
  private holdSamples: number;
  private holdCounter: number;

  constructor(options?: AudioWorkletNodeOptions) {
    super(options);

    // Defaults: -40 dB threshold, 10ms attack, 200ms release, 100ms hold
    this.thresholdLinear = Math.pow(10, -40 / 20);
    this.gain = 0;
    const sr = sampleRate; // globalThis.sampleRate in worklet scope
    this.attackCoeff = Math.exp(-1 / (sr * 0.010));
    this.releaseCoeff = Math.exp(-1 / (sr * 0.200));
    this.holdSamples = Math.round(sr * 0.100);
    this.holdCounter = 0;

    this.port.onmessage = (ev) => {
      if (ev.data && typeof ev.data.thresholdDb === 'number') {
        const db = Math.max(-60, Math.min(-10, ev.data.thresholdDb));
        this.thresholdLinear = Math.pow(10, db / 20);
      }
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], _params: Record<string, Float32Array>): boolean {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || input.length === 0) {
      return true;
    }

    const channelCount = Math.min(input.length, output.length);
    const frameCount = input[0].length; // 128 samples

    // Compute RMS across all channels for this quantum
    let sumSq = 0;
    let totalSamples = 0;
    for (let c = 0; c < channelCount; c++) {
      const ch = input[c];
      for (let i = 0; i < ch.length; i++) {
        sumSq += ch[i] * ch[i];
        totalSamples++;
      }
    }
    const rms = totalSamples > 0 ? Math.sqrt(sumSq / totalSamples) : 0;
    const isAboveThreshold = rms >= this.thresholdLinear;

    if (isAboveThreshold) {
      this.holdCounter = this.holdSamples;
    }

    // Apply per-sample smoothed gain
    for (let i = 0; i < frameCount; i++) {
      const inHold = this.holdCounter > 0;
      if (inHold || isAboveThreshold) {
        // Attack: ramp gain up
        this.gain = 1 - (1 - this.gain) * this.attackCoeff;
        if (this.holdCounter > 0) this.holdCounter--;
      } else {
        // Release: ramp gain down
        this.gain = this.gain * this.releaseCoeff;
      }
      const g = this.gain;
      for (let c = 0; c < channelCount; c++) {
        output[c][i] = input[c][i] * g;
      }
    }

    return true;
  }
}

registerProcessor('noise-gate-processor', NoiseGateProcessor);
