// Globals available inside an AudioWorkletProcessor module (AudioWorkletGlobalScope).
// TypeScript's DOM lib exposes AudioWorkletProcessor as an interface but does NOT
// declare the AudioWorkletGlobalScope globals (sampleRate, currentFrame,
// registerProcessor) as ambient names — so worklet files need this declaration.

declare const sampleRate: number;
declare const currentFrame: number;
declare const currentTime: number;

declare abstract class AudioWorkletProcessor {
  constructor(options?: AudioWorkletNodeOptions);
  readonly port: MessagePort;
  abstract process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor,
): void;
