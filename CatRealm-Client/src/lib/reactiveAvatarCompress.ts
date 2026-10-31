import { BufferTarget, Output, VideoSample, VideoSampleSource, WebMOutputFormat } from 'mediabunny';

/**
 * Cat Lab — compress reactive avatar art that is too big to be practical.
 *
 * Animations become VP9 WebM (optionally with an alpha channel, which plays in
 * the OBS browser source), resampled to at most 30 fps; stills become WebP.
 * The target is a file size: each attempt aims its bitrate at the target and
 * only steps the resolution down when the bitrate per pixel would get too thin
 * to look good, or when an encode still overshoots.
 */
export type ReactiveCompressOptions = {
  targetBytes: number;
  /** Keep the animation (false = first frame as a still). */
  animated: boolean;
  /** Keep transparency (false suits art on a green-screen background). */
  transparent: boolean;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
};

export type ReactiveCompressResult = {
  bytes: Uint8Array;
  width: number;
  height: number;
  animated: boolean;
};

const MAX_OUTPUT_DIMENSION = 1024;
const MIN_OUTPUT_DIMENSION = 128;
const MAX_FPS = 30;
/** Below this many bits per pixel per frame VP9 starts to look smeared. */
const MIN_BITS_PER_PIXEL = 0.04;
const SIZE_STEP = 0.75;

type SourceInfo = {
  decoder: ImageDecoder;
  width: number;
  height: number;
  frameCount: number;
  durationUs: number;
};

async function openSource(file: Blob): Promise<SourceInfo> {
  const decoder = new ImageDecoder({ data: file.stream(), type: file.type || 'image/webp' });
  await decoder.completed;
  await decoder.tracks.ready;
  const track = decoder.tracks.selectedTrack;
  const frameCount = track?.frameCount ?? 1;
  const first = (await decoder.decode({ frameIndex: 0 })).image;
  const info = { width: first.displayWidth, height: first.displayHeight };
  first.close();
  // Sum real frame durations; animated WebP frames carry their own timing.
  let durationUs = 0;
  if (frameCount > 1) {
    for (let i = 0; i < frameCount; i++) {
      const frame = (await decoder.decode({ frameIndex: i, completeFramesOnly: true })).image;
      durationUs += frame.duration ?? 1_000_000 / MAX_FPS;
      frame.close();
    }
  }
  return { decoder, ...info, frameCount, durationUs };
}

function fitWithin(width: number, height: number, maxSide: number) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  // VP9 needs even dimensions.
  const even = (n: number) => Math.max(2, Math.round((n * scale) / 2) * 2);
  return { width: even(width), height: even(height) };
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Compression cancelled', 'AbortError');
}

async function encodeAnimation(
  src: SourceInfo,
  width: number,
  height: number,
  bitrate: number,
  transparent: boolean,
  onFrame: (index: number) => void,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const output = new Output({ format: new WebMOutputFormat(), target: new BufferTarget() });
  const source = new VideoSampleSource({
    codec: 'vp9',
    bitrate,
    alpha: transparent ? 'keep' : 'discard',
    keyFrameInterval: 2,
  });
  output.addVideoTrack(source, { frameRate: MAX_FPS });
  await output.start();

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { alpha: transparent });
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.imageSmoothingQuality = 'high';

  const frameStepUs = 1_000_000 / MAX_FPS;
  let sourceTimeUs = 0;
  let nextOutputUs = 0;
  let outputIndex = 0;
  for (let i = 0; i < src.frameCount; i++) {
    throwIfAborted(signal);
    const frame = (await src.decoder.decode({ frameIndex: i, completeFramesOnly: true })).image;
    const durationUs = frame.duration ?? frameStepUs;
    // Emit an output frame for every 1/30 s boundary this source frame covers.
    while (nextOutputUs < sourceTimeUs + durationUs) {
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(frame, 0, 0, width, height);
      const sample = new VideoSample(canvas, {
        timestamp: outputIndex / MAX_FPS,
        duration: 1 / MAX_FPS,
      });
      await source.add(sample);
      sample.close();
      outputIndex += 1;
      nextOutputUs += frameStepUs;
    }
    sourceTimeUs += durationUs;
    frame.close();
    onFrame(i);
  }
  await output.finalize();
  const buffer = output.target.buffer;
  if (!buffer) throw new Error('Encoder produced no output');
  return new Uint8Array(buffer);
}

async function encodeStill(src: SourceInfo, targetBytes: number, signal?: AbortSignal): Promise<ReactiveCompressResult> {
  const first = (await src.decoder.decode({ frameIndex: 0 })).image;
  try {
    for (let side = Math.min(MAX_OUTPUT_DIMENSION, Math.max(src.width, src.height)); side >= MIN_OUTPUT_DIMENSION; side = Math.floor(side * SIZE_STEP)) {
      const { width, height } = fitWithin(src.width, src.height, side);
      const canvas = new OffscreenCanvas(width, height);
      canvas.getContext('2d')?.drawImage(first, 0, 0, width, height);
      for (const quality of [0.9, 0.8, 0.7]) {
        throwIfAborted(signal);
        const blob = await canvas.convertToBlob({ type: 'image/webp', quality });
        if (blob.size <= targetBytes) {
          return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height, animated: false };
        }
      }
    }
  } finally {
    first.close();
  }
  throw new Error('Could not reach the target size');
}

export async function compressReactiveArt(file: Blob, options: ReactiveCompressOptions): Promise<ReactiveCompressResult> {
  const { targetBytes, transparent, onProgress, signal } = options;
  const src = await openSource(file);
  try {
    if (!options.animated || src.frameCount <= 1) {
      const result = await encodeStill(src, targetBytes, signal);
      onProgress?.(1);
      return result;
    }

    const seconds = src.durationUs / 1_000_000;
    // Leave headroom for container overhead and the separate alpha stream.
    const baseBitrate = Math.floor((targetBytes * 8 * (transparent ? 0.7 : 0.9)) / seconds);
    const sizes: number[] = [];
    for (let side = Math.min(MAX_OUTPUT_DIMENSION, Math.max(src.width, src.height)); side >= MIN_OUTPUT_DIMENSION; side = Math.floor(side * SIZE_STEP)) {
      sizes.push(side);
    }
    const fps = Math.min(MAX_FPS, (src.frameCount * 1_000_000) / src.durationUs);
    // Skip sizes the bitrate can't do justice to (always keep the smallest).
    const candidates = sizes.filter((side, i) => {
      const { width, height } = fitWithin(src.width, src.height, side);
      return i === sizes.length - 1 || baseBitrate / (width * height * fps) >= MIN_BITS_PER_PIXEL;
    });

    const attempts = candidates.length;
    let bitrate = baseBitrate;
    for (let a = 0; a < attempts; a++) {
      const { width, height } = fitWithin(src.width, src.height, candidates[a]);
      const bytes = await encodeAnimation(src, width, height, bitrate, transparent, (i) => {
        onProgress?.((a + (i + 1) / src.frameCount) / attempts);
      }, signal);
      if (bytes.byteLength <= targetBytes) {
        onProgress?.(1);
        return { bytes, width, height, animated: true };
      }
      // Overshot: aim lower next time, proportionally to the miss.
      bitrate = Math.floor(bitrate * (targetBytes / bytes.byteLength) * 0.9);
    }
    throw new Error('Could not reach the target size');
  } finally {
    src.decoder.close();
  }
}

/**
 * Looks at the first frame's corners: any transparency means "keep transparent";
 * solid green corners look like a green-screen background (key it out in OBS).
 */
export async function detectArtSource(file: Blob): Promise<{ animated: boolean; transparent: boolean }> {
  let animated = false;
  try {
    const decoder = new ImageDecoder({ data: file.stream(), type: file.type || 'image/webp' });
    await decoder.tracks.ready;
    animated = !!decoder.tracks.selectedTrack?.animated;
    decoder.close();
  } catch {
    // Unknown to ImageDecoder; treat as a still.
  }
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    ctx?.drawImage(bitmap, 0, 0);
    const corners = [[0, 0], [bitmap.width - 1, 0], [0, bitmap.height - 1], [bitmap.width - 1, bitmap.height - 1]]
      .map(([x, y]) => ctx?.getImageData(x, y, 1, 1).data);
    bitmap.close();
    const hasAlpha = corners.some((px) => px && px[3] < 250);
    const greenScreen = corners.every((px) => px && px[1] > 140 && px[0] < 110 && px[2] < 110);
    return { animated, transparent: hasAlpha || !greenScreen };
  } catch {
    return { animated, transparent: true };
  }
}
