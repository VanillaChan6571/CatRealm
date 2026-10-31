// Audio processing pipeline: RNNoise WASM noise suppression + RMS noise gate.
// Inserted between getUserMedia output and RTCPeerConnection.addTrack().
//
// Pipeline:
//   getUserMedia → AudioContext (48kHz) → SourceNode
//     → [NoiseGateWorkletNode?]
//     → [RNNoiseWorkletNode?]
//     → MediaStreamDestinationNode → processedStream → RTC
//
// When both are disabled, buildAudioPipeline() returns null and the raw
// stream is used directly (zero overhead, no AudioContext created).

import noiseGateUrl from './worklets/noiseGateProcessor.ts?worker&url';
import rnnoiseUrl   from './worklets/rnnoiseProcessor.ts?worker&url';

export interface AudioPipelineOptions {
  noiseGateEnabled: boolean;
  noiseGateThreshold: number; // dB, -60 to -10
  rnnoiseEnabled: boolean;
}

export interface AudioPipeline {
  processedStream: MediaStream;
  updateNoiseGateThreshold: (db: number) => void;
  resume: () => void; // re-resume AudioContext if browser suspended it
  destroy: () => void; // closes AudioContext; does NOT stop raw input track
}

// WASM binary cached after first fetch (module-level singleton).
let cachedWasmBuffer: ArrayBuffer | null = null;
let wasmFetchPromise: Promise<ArrayBuffer> | null = null;

async function fetchWasmBinary(): Promise<ArrayBuffer> {
  if (cachedWasmBuffer) return cachedWasmBuffer;
  if (wasmFetchPromise) return wasmFetchPromise;

  wasmFetchPromise = (async () => {
    const url = new URL('@jitsi/rnnoise-wasm/dist/rnnoise.wasm', import.meta.url);
    const resp = await fetch(url.toString());
    if (!resp.ok) throw new Error(`Failed to fetch RNNoise WASM: ${resp.status}`);
    const buf = await resp.arrayBuffer();
    cachedWasmBuffer = buf;
    return buf;
  })();

  return wasmFetchPromise;
}

export async function buildAudioPipeline(
  rawStream: MediaStream,
  opts: AudioPipelineOptions,
): Promise<AudioPipeline | null> {
  const { noiseGateEnabled, noiseGateThreshold, rnnoiseEnabled } = opts;

  // Both disabled → no pipeline, zero overhead
  if (!noiseGateEnabled && !rnnoiseEnabled) return null;

  const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  await ctx.resume();

  // Chrome auto-suspends AudioContexts when the page is backgrounded or loses
  // focus. Re-resume immediately so the AudioWorklet keeps producing frames.
  ctx.addEventListener('statechange', () => {
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  });

  const source = ctx.createMediaStreamSource(rawStream);
  let lastNode: AudioNode = source;

  let gateNode: AudioWorkletNode | null = null;

  if (noiseGateEnabled) {
    await ctx.audioWorklet.addModule(noiseGateUrl);
    const thresholdDb = Math.max(-60, Math.min(-10, noiseGateThreshold));
    gateNode = new AudioWorkletNode(ctx, 'noise-gate-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    gateNode.port.postMessage({ thresholdDb });
    lastNode.connect(gateNode);
    lastNode = gateNode;
  }

  if (rnnoiseEnabled) {
    const wasmBinary = await fetchWasmBinary();
    await ctx.audioWorklet.addModule(rnnoiseUrl);
    const rnNode = new AudioWorkletNode(ctx, 'rnnoise-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { wasmBinary },
    });
    lastNode.connect(rnNode);
    lastNode = rnNode;
  }

  const dest = ctx.createMediaStreamDestination();
  lastNode.connect(dest);

  return {
    processedStream: dest.stream,
    updateNoiseGateThreshold: (db: number) => {
      if (!gateNode) return;
      gateNode.port.postMessage({ thresholdDb: Math.max(-60, Math.min(-10, db)) });
    },
    resume: () => {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    },
    destroy: () => {
      ctx.close().catch(() => {});
    },
  };
}

export async function rebuildAudioPipeline(
  old: AudioPipeline | null,
  rawStream: MediaStream,
  opts: AudioPipelineOptions,
): Promise<{ pipeline: AudioPipeline | null; processedTrack: MediaStreamTrack | null }> {
  old?.destroy();
  const pipeline = await buildAudioPipeline(rawStream, opts);
  const processedTrack = pipeline
    ? pipeline.processedStream.getAudioTracks()[0] ?? null
    : rawStream.getAudioTracks()[0] ?? null;
  return { pipeline, processedTrack };
}
