// AudioWorkletProcessor wrapping RNNoise WASM.
// The WASM binary is received via processorOptions.wasmBinary (ArrayBuffer).
// Maintains ring buffers to feed exact 480-sample frames to RNNoise and return
// processed audio with the same latency. Passes through unmodified until ready.
//
// WASM export names (Emscripten minified):
//   c = memory,  d = __wasm_call_ctors,  e = malloc,  f = free
//   g = rnnoise_init,  h = rnnoise_create,  i = rnnoise_destroy
//   j = rnnoise_process_frame(state, out*, in*): f32  (returns VAD prob)
// WASM import names:
//   a.a = _emscripten_resize_heap(size): i32
//   a.b = _emscripten_memcpy_big(dst, src, n): void

const FRAME = 480; // samples per RNNoise frame at 48 kHz
const RING  = FRAME * 16; // ring buffer size (must be power-of-2 multiple of FRAME)

interface Exports {
  c: WebAssembly.Memory;
  d: () => void;
  e: (n: number) => number;
  f: (p: number) => void;
  g: () => void;
  h: (model: number) => number;
  i: (st: number) => void;
  j: (st: number, out: number, inp: number) => number;
}

class RNNoiseProcessor extends AudioWorkletProcessor {
  private ready = false;
  private exp: Exports | null = null;
  private mem: WebAssembly.Memory | null = null;
  private HEAPF32: Float32Array = new Float32Array(0);
  private HEAPU8: Uint8Array = new Uint8Array(0);
  private st = 0;    // DenoiseState*
  private inPtr = 0; // WASM heap input float[480]
  private outPtr = 0;// WASM heap output float[480]

  // Input ring: accumulate raw samples
  private inRing  = new Float32Array(RING);
  private inWrite = 0; // total samples written
  private inRead  = 0; // total samples consumed (passed to RNNoise)

  // Output ring: hold processed samples
  private outRing  = new Float32Array(RING);
  private outWrite = 0; // total samples written into outRing
  private outRead  = 0; // total samples consumed from outRing

  constructor(opts?: AudioWorkletNodeOptions) {
    super(opts);
    const bin: ArrayBuffer | undefined = opts?.processorOptions?.wasmBinary;
    if (bin) this.initWasm(bin).catch(() => {/* stay in pass-through */});
  }

  private refreshViews() {
    this.HEAPF32 = new Float32Array(this.mem!.buffer);
    this.HEAPU8  = new Uint8Array(this.mem!.buffer);
  }

  private async initWasm(binary: ArrayBuffer) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    const imports = {
      a: {
        a: (req: number): number => {
          // _emscripten_resize_heap
          try {
            const delta = req - self.mem!.buffer.byteLength;
            const pages = Math.ceil(delta / 65536);
            self.mem!.grow(pages > 0 ? pages : 1);
            self.refreshViews();
            return 1;
          } catch { return 0; }
        },
        b: (dst: number, src: number, n: number) => {
          // _emscripten_memcpy_big
          self.HEAPU8.copyWithin(dst, src, src + n);
        },
      },
    };

    const { instance } = await WebAssembly.instantiate(binary, imports);
    const exp = instance.exports as unknown as Exports;

    this.exp  = exp;
    this.mem  = exp.c;
    this.refreshViews();

    exp.d(); // __wasm_call_ctors
    exp.g(); // rnnoise_init
    this.st     = exp.h(0);             // rnnoise_create(null model)
    this.inPtr  = exp.e(FRAME * 4);     // malloc float[480]
    this.outPtr = exp.e(FRAME * 4);     // malloc float[480]

    this.ready = true;
  }

  private processFrame(src: Float32Array, srcOff: number): void {
    const exp    = this.exp!;
    const hf32   = this.HEAPF32;
    const inBase = this.inPtr  >> 2;
    const ouBase = this.outPtr >> 2;

    // RNNoise uses int16 range scaled as float32
    for (let i = 0; i < FRAME; i++) {
      hf32[inBase + i] = src[(srcOff + i) % RING] * 32768;
    }

    exp.j(this.st, this.outPtr, this.inPtr);

    const outOff = this.outWrite % RING;
    for (let i = 0; i < FRAME; i++) {
      this.outRing[(outOff + i) % RING] = hf32[ouBase + i] / 32768;
    }
    this.outWrite += FRAME;
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const inp = inputs[0];
    const out = outputs[0];
    if (!inp?.length || !out?.length) return true;

    const src = inp[0];
    const Q   = src.length; // 128

    if (!this.ready) {
      for (let c = 0; c < Math.min(inp.length, out.length); c++) out[c].set(inp[c]);
      return true;
    }

    // Feed input ring
    const writeBase = this.inWrite % RING;
    for (let i = 0; i < Q; i++) {
      this.inRing[(writeBase + i) % RING] = src[i];
    }
    this.inWrite += Q;

    // Process complete 480-sample frames
    while (this.inWrite - this.inRead >= FRAME) {
      this.processFrame(this.inRing, this.inRead % RING);
      this.inRead += FRAME;
    }

    // Drain output ring into current quantum
    const outCh = out[0];
    if (this.outWrite - this.outRead >= Q) {
      const readBase = this.outRead % RING;
      for (let i = 0; i < Q; i++) {
        outCh[i] = this.outRing[(readBase + i) % RING];
      }
      this.outRead += Q;
      for (let c = 1; c < out.length; c++) out[c].set(outCh);
    } else {
      // Not enough processed audio yet (startup gap) – pass through
      for (let c = 0; c < Math.min(inp.length, out.length); c++) out[c].set(inp[c]);
    }

    return true;
  }
}

registerProcessor('rnnoise-processor', RNNoiseProcessor);
