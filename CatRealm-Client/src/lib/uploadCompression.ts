import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
} from 'mediabunny';

/**
 * Cat Lab — "Auto Compress Upload on Max Limit Hit".
 *
 * Shrinks an upload that is over the server's limit so it fits. Stills become
 * WebP (JPEG where WebP can't be encoded) at the highest quality/size that
 * fits. Videos are re-encoded to a bitrate aimed at the limit: Sparky uses its
 * bundled GStreamer (NVENC/AMF/Media Foundation), everything else WebCodecs.
 * Resolution only steps down when the bitrate per pixel would get too thin,
 * or when an encode still overshoots.
 */

export type UploadCompressionOptions = {
  targetBytes: number;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
};

export type UploadCompressionFailure = 'unsupported' | 'too-small' | 'failed' | 'cancelled';

export class UploadCompressionError extends Error {
  readonly reason: UploadCompressionFailure;

  constructor(message: string, reason: UploadCompressionFailure) {
    super(message);
    this.name = 'UploadCompressionError';
    this.reason = reason;
  }
}

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const VIDEO_TYPES = new Set(['video/mp4', 'video/webm']);

/** Whether an upload of this type can be compressed at all. */
export function canCompressUpload(file: File) {
  return IMAGE_TYPES.has(file.type) || VIDEO_TYPES.has(file.type);
}

export async function compressUploadToFit(file: File, options: UploadCompressionOptions): Promise<File> {
  if (IMAGE_TYPES.has(file.type)) return compressImage(file, options);
  if (VIDEO_TYPES.has(file.type)) return compressVideo(file, options);
  throw new UploadCompressionError('This file type can’t be compressed.', 'unsupported');
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new UploadCompressionError('Compression cancelled', 'cancelled');
}

function renamed(file: File, extension: string) {
  const base = file.name.replace(/\.[^.]+$/, '') || 'upload';
  return `${base}.${extension}`;
}

/** Scale (width, height) to fit `maxSide` on the long side, with even dimensions. */
function fitWithin(width: number, height: number, maxSide: number) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const even = (n: number) => Math.max(2, Math.round((n * scale) / 2) * 2);
  return { width: even(width), height: even(height) };
}

// ---------------------------------------------------------------- images

const MIN_IMAGE_SIDE = 320;
const IMAGE_SIZE_STEP = 0.85;
const IMAGE_QUALITIES = [0.92, 0.85, 0.75, 0.65];

async function isAnimatedImage(file: File) {
  if (typeof ImageDecoder === 'undefined') return false;
  try {
    const decoder = new ImageDecoder({ data: file.stream(), type: file.type });
    await decoder.tracks.ready;
    const animated = !!decoder.tracks.selectedTrack?.animated;
    decoder.close();
    return animated;
  } catch {
    return false;
  }
}

async function encodeCanvas(canvas: OffscreenCanvas, quality: number): Promise<Blob> {
  const webp = await canvas.convertToBlob({ type: 'image/webp', quality });
  // Browsers without a WebP encoder silently return PNG; fall back to JPEG.
  return webp.type === 'image/webp' ? webp : canvas.convertToBlob({ type: 'image/jpeg', quality });
}

async function compressImage(file: File, { targetBytes, onProgress, signal }: UploadCompressionOptions): Promise<File> {
  // Re-encoding would keep only the first frame; never flatten an animation.
  if (await isAnimatedImage(file)) {
    throw new UploadCompressionError('Animated images can’t be compressed yet.', 'unsupported');
  }
  const bitmap = await createImageBitmap(file);
  try {
    const sides: number[] = [];
    for (let side = Math.max(bitmap.width, bitmap.height); side >= MIN_IMAGE_SIDE; side = Math.floor(side * IMAGE_SIZE_STEP)) {
      sides.push(side);
    }
    const attempts = sides.length * IMAGE_QUALITIES.length;
    let attempt = 0;
    for (const side of sides) {
      const { width, height } = fitWithin(bitmap.width, bitmap.height, side);
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new UploadCompressionError('Canvas unavailable', 'failed');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, width, height);
      for (const quality of IMAGE_QUALITIES) {
        throwIfAborted(signal);
        const blob = await encodeCanvas(canvas, quality);
        onProgress?.(++attempt / attempts);
        if (blob.size <= targetBytes) {
          const extension = blob.type === 'image/webp' ? 'webp' : 'jpg';
          onProgress?.(1);
          return new File([blob], renamed(file, extension), { type: blob.type });
        }
      }
    }
  } finally {
    bitmap.close();
  }
  throw new UploadCompressionError('Couldn’t make the image small enough.', 'too-small');
}

// ---------------------------------------------------------------- videos

const MAX_VIDEO_SIDE = 1920;
const MIN_VIDEO_SIDE = 426;
const VIDEO_SIZE_STEP = 0.75;
/** Below this many bits per pixel per frame H.264 turns to mush. */
const MIN_BITS_PER_PIXEL = 0.05;
/** Lowest video bitrate worth producing at all. */
const MIN_VIDEO_BPS = 150_000;
/** Share of the budget kept back for container overhead and encoder overshoot. */
const SIZE_HEADROOM = 0.92;
const MAX_ATTEMPTS = 3;

type VideoSourceInfo = {
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  hasAudio: boolean;
};

async function readVideoInfo(file: File): Promise<VideoSourceInfo> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new UploadCompressionError('This video has no picture to compress.', 'unsupported');
    const audio = await input.getPrimaryAudioTrack();
    const durationSec = await input.computeDuration();
    const stats = await video.computePacketStats(120);
    return {
      width: video.displayWidth,
      height: video.displayHeight,
      fps: Math.min(60, Math.max(1, stats.averagePacketRate || 30)),
      durationSec,
      hasAudio: !!audio,
    };
  } finally {
    input.dispose();
  }
}

type VideoPlan = { width: number; height: number; videoBps: number; audioBps: number };

function planVideo(info: VideoSourceInfo, targetBytes: number, sizeStep = 0): VideoPlan {
  if (!(info.durationSec > 0)) throw new UploadCompressionError('Couldn’t read the video length.', 'failed');
  const totalBps = (targetBytes * 8 * SIZE_HEADROOM) / info.durationSec;
  const audioBps = info.hasAudio ? (totalBps > 1_500_000 ? 128_000 : 64_000) : 0;
  const videoBps = Math.floor(totalBps - audioBps);
  if (videoBps < MIN_VIDEO_BPS) {
    throw new UploadCompressionError('This video is too long to fit the upload limit.', 'too-small');
  }
  let side = Math.min(MAX_VIDEO_SIDE, Math.max(info.width, info.height));
  for (let i = 0; i < sizeStep && side > MIN_VIDEO_SIDE; i++) side = Math.floor(side * VIDEO_SIZE_STEP);
  let size = fitWithin(info.width, info.height, side);
  while (side > MIN_VIDEO_SIDE && videoBps / (size.width * size.height * info.fps) < MIN_BITS_PER_PIXEL) {
    side = Math.max(MIN_VIDEO_SIDE, Math.floor(side * VIDEO_SIZE_STEP));
    size = fitWithin(info.width, info.height, side);
  }
  return { ...size, videoBps, audioBps };
}

async function compressVideo(file: File, options: UploadCompressionOptions): Promise<File> {
  const { targetBytes, onProgress, signal } = options;
  const info = await readVideoInfo(file);
  let budget = targetBytes;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    throwIfAborted(signal);
    const plan = planVideo(info, budget, attempt);
    // Progress follows the current attempt; a retry (rare) starts it over.
    const report = (fraction: number) => onProgress?.(Math.min(0.99, fraction));
    const result = window.electron?.compressVideoForUpload
      ? await encodeVideoNative(file, info, plan, budget, report, signal)
      : await encodeVideoWebCodecs(file, plan, report, signal);
    if (result.size <= targetBytes) {
      onProgress?.(1);
      return result;
    }
    // Overshot: aim lower next time, proportionally to the miss.
    budget = Math.floor(budget * (targetBytes / result.size) * 0.95);
  }
  throw new UploadCompressionError('Couldn’t make the video small enough.', 'too-small');
}

async function encodeVideoNative(
  file: File,
  info: VideoSourceInfo,
  plan: VideoPlan,
  budget: number,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<File> {
  const electron = window.electron!;
  const unsubscribe = electron.onVideoForUploadCompressionProgress?.(({ progress }) => onProgress(progress));
  const abort = () => { void electron.cancelVideoForUploadCompression?.(); };
  signal?.addEventListener('abort', abort);
  try {
    const result = await electron.compressVideoForUpload!({
      data: await file.arrayBuffer(),
      inputExtension: file.type === 'video/webm' ? 'webm' : 'mp4',
      width: plan.width,
      height: plan.height,
      videoKbps: Math.floor(plan.videoBps / 1000),
      audioKbps: Math.floor(plan.audioBps / 1000) || 64,
      hasAudio: info.hasAudio,
      expectedBytes: budget,
    });
    throwIfAborted(signal);
    if (!result.ok || !result.data) {
      throw new UploadCompressionError(result.message || `Video compression failed (${result.reason ?? 'unknown'}).`, 'failed');
    }
    return new File([new Uint8Array(result.data)], renamed(file, 'mp4'), { type: 'video/mp4' });
  } finally {
    signal?.removeEventListener('abort', abort);
    unsubscribe?.();
  }
}

async function encodeVideoWebCodecs(
  file: File,
  plan: VideoPlan,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<File> {
  if (typeof VideoEncoder === 'undefined') {
    throw new UploadCompressionError('This browser can’t re-encode video.', 'unsupported');
  }
  const encodeOptions = { width: plan.width, height: plan.height, bitrate: plan.videoBps };
  // H.264/AAC in MP4 plays everywhere; VP9/Opus WebM where H.264 can't be encoded.
  const useAvc = await canEncodeVideo('avc', encodeOptions);
  if (!useAvc && !(await canEncodeVideo('vp9', encodeOptions))) {
    throw new UploadCompressionError('This browser can’t encode video at this size.', 'unsupported');
  }
  const audioCodec = useAvc && (await canEncodeAudio('aac', { bitrate: plan.audioBps || 64_000 })) ? 'aac' : 'opus';

  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  const output = new Output({
    format: useAvc ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
    target: new BufferTarget(),
  });
  try {
    const conversion = await Conversion.init({
      input,
      output,
      video: {
        codec: useAvc ? 'avc' : 'vp9',
        width: plan.width,
        height: plan.height,
        fit: 'contain',
        bitrate: plan.videoBps,
        forceTranscode: true,
      },
      audio: plan.audioBps > 0
        ? { codec: audioCodec, bitrate: plan.audioBps, forceTranscode: true }
        : { discard: true },
    });
    if (!conversion.isValid) {
      throw new UploadCompressionError('This video can’t be re-encoded here.', 'unsupported');
    }
    conversion.onProgress = (progress) => onProgress(progress);
    const abort = () => { void conversion.cancel(); };
    signal?.addEventListener('abort', abort);
    try {
      await conversion.execute();
    } finally {
      signal?.removeEventListener('abort', abort);
    }
    throwIfAborted(signal);
    const buffer = output.target.buffer;
    if (!buffer) throw new UploadCompressionError('The encoder produced no output.', 'failed');
    return useAvc
      ? new File([buffer], renamed(file, 'mp4'), { type: 'video/mp4' })
      : new File([buffer], renamed(file, 'webm'), { type: 'video/webm' });
  } finally {
    input.dispose();
  }
}
