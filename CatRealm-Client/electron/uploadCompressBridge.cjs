const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveGstLaunchAsync, gstRuntimeEnv, availableH264EncodersAsync } = require('./whipPublisherBridge.cjs');

/**
 * Cat Lab "Auto Compress Upload": re-encodes a video that is over the upload
 * limit with the bundled GStreamer (GPU H.264 + AAC in MP4). The renderer picks
 * the target bitrates and size; this side only runs a fixed-shape pipeline over
 * its own temp files, so nothing the renderer sends can reach a path or element.
 */

const INPUT_EXTENSIONS = new Set(['mp4', 'webm']);
// A listed encoder can still fail to open (driver mismatch, session limits), so
// each is tried in turn: NVENC > AMF > Media Foundation.
const ENCODER_ORDER = ['nvh264enc', 'amfh264enc', 'mfh264enc'];

let active = null;

function clampInt(value, min, max) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

function evenInt(value, min, max) {
  const n = clampInt(value, min, max);
  return n === null ? null : n - (n % 2);
}

// gst-launch joins its argv and re-parses it, so paths (which may hold spaces)
// must be quoted, with backslashes escaped.
function gstQuoted(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function encoderTokens(encoder, kbps, gop) {
  if (encoder === 'amfh264enc') {
    return ['amfh264enc', 'usage=transcoding', 'rate-control=cbr', `bitrate=${kbps}`, `gop-size=${gop}`];
  }
  if (encoder === 'mfh264enc') {
    return ['mfh264enc', 'rc-mode=cbr', `bitrate=${kbps}`, `gop-size=${gop}`];
  }
  return ['nvh264enc', 'rc-mode=cbr', `bitrate=${kbps}`, `gop-size=${gop}`];
}

function buildArgs({ inputPath, outputPath, encoder, videoKbps, audioKbps, width, height, hasAudio }) {
  const args = [
    '-q', '-e',
    'filesrc', `location=${gstQuoted(inputPath)}`, '!', 'decodebin', 'name=d',
    'd.', '!', 'queue', '!', 'videoconvert', '!', 'videoscale', '!',
    `video/x-raw,format=NV12,width=${width},height=${height},pixel-aspect-ratio=1/1`, '!',
    ...encoderTokens(encoder, videoKbps, 120), '!',
    'h264parse', '!', 'queue', '!',
    'mp4mux', 'faststart=true', 'name=m', '!', 'filesink', `location=${gstQuoted(outputPath)}`,
  ];
  // Only link audio when the source has some: mp4mux waits for every requested
  // pad, so an audio branch that never gets data would stall the mux.
  if (hasAudio) {
    args.push(
      'd.', '!', 'queue', '!', 'audioconvert', '!', 'audioresample', '!',
      'audio/x-raw,rate=48000,channels=2', '!',
      'mfaacenc', `bitrate=${audioKbps * 1000}`, '!', 'queue', '!', 'm.',
    );
  }
  return args;
}

function runPipeline(gstPath, args, { expectedBytes, outputPath, onProgress }) {
  return new Promise((resolve) => {
    const child = spawn(gstPath, args, { env: gstRuntimeEnv(gstPath), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-4000); });
    active = { child, cancelled: false };
    const run = active;
    // CBR output grows about linearly, so its size tracks progress.
    const timer = setInterval(() => {
      fs.stat(outputPath, (err, stat) => {
        if (!err && expectedBytes > 0) onProgress(Math.min(0.99, stat.size / expectedBytes));
      });
    }, 500);
    child.on('error', (error) => {
      clearInterval(timer);
      resolve({ ok: false, cancelled: run.cancelled, message: error.message });
    });
    child.on('close', (code) => {
      clearInterval(timer);
      if (active === run) active = null;
      resolve({ ok: code === 0 && !run.cancelled, cancelled: run.cancelled, message: stderr.trim() });
    });
  });
}

async function compressVideo(opts = {}, onProgress = () => {}) {
  if (process.platform !== 'win32') return { ok: false, reason: 'unsupported' };
  if (active) return { ok: false, reason: 'busy', message: 'Another video is already being compressed.' };

  const extension = String(opts.inputExtension || '').toLowerCase();
  const width = evenInt(opts.width, 64, 3840);
  const height = evenInt(opts.height, 64, 2160);
  const videoKbps = clampInt(opts.videoKbps, 100, 50000);
  const audioKbps = clampInt(opts.audioKbps, 32, 320);
  const expectedBytes = clampInt(opts.expectedBytes, 1, 4 * 1024 * 1024 * 1024);
  const data = opts.data;
  if (!INPUT_EXTENSIONS.has(extension) || !width || !height || !videoKbps || !audioKbps || !expectedBytes
    || !(data instanceof ArrayBuffer || ArrayBuffer.isView(data))) {
    return { ok: false, reason: 'bad-options' };
  }

  const gstPath = await resolveGstLaunchAsync();
  if (!gstPath) return { ok: false, reason: 'missing-gstreamer' };
  const available = await availableH264EncodersAsync();
  const encoders = ENCODER_ORDER.filter((encoder) => available.includes(encoder));
  if (!encoders.length) return { ok: false, reason: 'no-encoder' };

  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'catrealm-compress-'));
  try {
    const inputPath = path.join(dir, `input.${extension}`);
    const outputPath = path.join(dir, 'output.mp4');
    await fs.promises.writeFile(inputPath, Buffer.from(data instanceof ArrayBuffer ? data : data.buffer));
    let lastMessage = '';
    for (const encoder of encoders) {
      await fs.promises.rm(outputPath, { force: true });
      const args = buildArgs({ inputPath, outputPath, encoder, videoKbps, audioKbps, width, height, hasAudio: opts.hasAudio === true });
      const result = await runPipeline(gstPath, args, { expectedBytes, outputPath, onProgress });
      if (result.cancelled) return { ok: false, reason: 'cancelled' };
      if (result.ok) {
        const output = await fs.promises.readFile(outputPath);
        onProgress(1);
        return { ok: true, encoder, data: output };
      }
      lastMessage = result.message;
    }
    return { ok: false, reason: 'encode-failed', message: lastMessage };
  } finally {
    fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function cancel() {
  if (!active) return false;
  active.cancelled = true;
  active.child.kill();
  return true;
}

module.exports = { compressVideo, cancel };
