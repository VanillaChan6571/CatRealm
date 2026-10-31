const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { runHardwareProbe, createCachedProbe } = require('./hardwareProbe.cjs');

const activePublishers = new Map();
let cachedSupport = null;
let cachedDshowDevices = null;
const DEFAULT_WHIP_TS_BUFFER_SIZE = 16 * 1024 * 1024;
const CATREALM_FFMPEG_EXE = 'CatRealm-ffmpeg.exe';
const LEGACY_FFMPEG_EXE = 'ffmpeg.exe';

function truthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value ?? '').trim());
}

function candidateFfmpegPaths() {
  const candidates = [];
  if (process.env.CATREALM_FFMPEG_BIN) candidates.push(process.env.CATREALM_FFMPEG_BIN);
  const unpackedDir = __dirname.includes(`${path.sep}app.asar${path.sep}`)
    ? __dirname.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`)
    : __dirname;
  const nativeBinDirs = [
    path.join(unpackedDir, 'native', 'win-whip-publisher', 'bin'),
    path.join(process.cwd(), 'electron', 'native', 'win-whip-publisher', 'bin'),
    path.join(__dirname, '..', 'electron', 'native', 'win-whip-publisher', 'bin'),
  ];
  if (process.resourcesPath) {
    nativeBinDirs.push(
      path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'native', 'win-whip-publisher', 'bin'),
      path.join(process.resourcesPath, 'electron', 'native', 'win-whip-publisher', 'bin'),
    );
  }
  nativeBinDirs.push(path.join(__dirname, 'native', 'win-whip-publisher', 'bin'));
  for (const binDir of nativeBinDirs) {
    candidates.push(path.join(binDir, CATREALM_FFMPEG_EXE));
    candidates.push(path.join(binDir, LEGACY_FFMPEG_EXE));
  }
  candidates.push(CATREALM_FFMPEG_EXE);
  candidates.push(LEGACY_FFMPEG_EXE);
  candidates.push('ffmpeg');
  return Array.from(new Set(candidates.filter(Boolean)));
}

function commandWorks(command, args = ['-hide_banner', '-version']) {
  try {
    const result = spawnSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: 8000,
    });
    return {
      ok: result.status === 0,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      error: result.error ? result.error.message : null,
    };
  } catch (error) {
    return { ok: false, stdout: '', stderr: '', error: error instanceof Error ? error.message : String(error) };
  }
}

function commandWorksAsync(command, args = ['-hide_banner', '-version']) {
  return runHardwareProbe(command, args);
}

function parseFfmpegTlsBackends(buildConf) {
  const text = String(buildConf || '');
  return {
    gnutls: /--enable-gnutls\b/i.test(text),
    openssl: /--enable-openssl\b/i.test(text),
    schannel: /--enable-schannel\b/i.test(text),
  };
}

function isWhipDtlsCompatible(tlsBackends) {
  if (tlsBackends.gnutls || tlsBackends.openssl) return true;
  return !tlsBackends.schannel || truthy(process.env.CATREALM_ALLOW_SCHANNEL_WHIP);
}

function inspectFfmpegCandidate(candidate) {
  if (candidate.includes(path.sep) && !fs.existsSync(candidate)) return null;
  const probe = commandWorks(candidate);
  if (!probe.ok) return null;
  const buildConfResult = commandWorks(candidate, ['-hide_banner', '-buildconf']);
  const buildConf = `${buildConfResult.stdout}\n${buildConfResult.stderr}`.trim();
  const tlsBackends = parseFfmpegTlsBackends(buildConf);
  return {
    path: candidate,
    version: `${probe.stdout}\n${probe.stderr}`.trim(),
    tlsBackends,
    whipDtlsCompatible: isWhipDtlsCompatible(tlsBackends),
  };
}

function resolveFfmpegPath() {
  let fallback = null;
  for (const candidate of candidateFfmpegPaths()) {
    const inspected = inspectFfmpegCandidate(candidate);
    if (!inspected) continue;
    fallback ??= inspected;
    if (inspected.whipDtlsCompatible) return inspected;
  }
  return fallback;
}

async function inspectFfmpegCandidateAsync(candidate) {
  if (candidate.includes(path.sep) && !fs.existsSync(candidate)) return null;
  const probe = await commandWorksAsync(candidate);
  if (!probe.ok) return null;
  const buildConfResult = await commandWorksAsync(candidate, ['-hide_banner', '-buildconf']);
  const buildConf = `${buildConfResult.stdout}\n${buildConfResult.stderr}`.trim();
  const tlsBackends = parseFfmpegTlsBackends(buildConf);
  return {
    path: candidate,
    version: `${probe.stdout}\n${probe.stderr}`.trim(),
    tlsBackends,
    whipDtlsCompatible: isWhipDtlsCompatible(tlsBackends),
  };
}

async function resolveFfmpegPathAsync() {
  let fallback = null;
  for (const candidate of candidateFfmpegPaths()) {
    const inspected = await inspectFfmpegCandidateAsync(candidate);
    if (!inspected) continue;
    fallback ??= inspected;
    if (inspected.whipDtlsCompatible) return inspected;
  }
  return fallback;
}

function hasFeature(output, pattern) {
  return pattern.test(output || '');
}

// Reuse the cached probe when valid. A bundled FFmpeg's capabilities are
// immutable for the process lifetime, and probing them runs blocking spawnSync
// calls that freeze the main process — so a SUCCESSFUL probe is cached for the
// whole session; only a failure is re-checked periodically (e.g. FFmpeg became
// available after launch). This is what stops Settings → Voice from hitching
// every time the panel re-mounts.
function cachedSupportIfFresh(forceRefresh) {
  if (forceRefresh || !cachedSupport) return null;
  if (cachedSupport.ok || Date.now() - cachedSupport.checkedAt < 5 * 60_000) return cachedSupport;
  return null;
}

function nonWindowsSupport() {
  return {
    ok: false,
    platform: process.platform,
    reason: 'native WHIP publishing is Windows-only',
    checkedAt: Date.now(),
  };
}

function ffmpegNotFoundSupport() {
  return {
    ok: false,
    platform: process.platform,
    reason: 'CatRealm-ffmpeg.exe or ffmpeg.exe was not found in PATH or CatRealm native publisher bin',
    checkedAt: Date.now(),
  };
}

// Interpret the four capability probes (sync or async produce the same shapes)
// into the support result. Single source of truth so the sync and warm paths
// can't drift.
function interpretSupport(ffmpeg, { muxers, filters, encoders, devices }) {
  const muxerOutput = `${muxers.stdout}\n${muxers.stderr}`;
  const filterOutput = `${filters.stdout}\n${filters.stderr}`;
  const encoderOutput = `${encoders.stdout}\n${encoders.stderr}`;
  const deviceOutput = `${devices.stdout}\n${devices.stderr}`;
  const features = {
    whipMuxer: muxers.ok && hasFeature(muxerOutput, /(?:^|\n)\s*E\s+whip\b/m),
    ddagrab: filters.ok && hasFeature(filterOutput, /(?:^|\n)\s*\.{2,}\s*ddagrab\b/m),
    gfxcapture: filters.ok && hasFeature(filterOutput, /(?:^|\n)\s*\.{2,}\s*gfxcapture\b/m),
    dshowInput: devices.ok && hasFeature(deviceOutput, /(?:^|\n)\s*D\s+dshow\b/m),
    h264Nvenc: encoders.ok && hasFeature(encoderOutput, /(?:^|\n)\s*V\S*\s+h264_nvenc\b/m),
    libopus: encoders.ok && hasFeature(encoderOutput, /(?:^|\n)\s*A\S*\s+libopus\b/m),
    whipDtlsBackend: ffmpeg.whipDtlsCompatible,
  };
  const missing = Object.entries(features).filter(([, available]) => !available).map(([name]) => name);
  return {
    ok: missing.length === 0,
    platform: process.platform,
    ffmpegPath: ffmpeg.path,
    reason: missing.length
      ? missing.includes('whipDtlsBackend')
        ? 'ffmpeg WHIP DTLS needs a GnuTLS/OpenSSL build; the available FFmpeg is Schannel-only'
        : `ffmpeg is missing: ${missing.join(', ')}`
      : null,
    tlsBackends: ffmpeg.tlsBackends,
    features,
    checkedAt: Date.now(),
  };
}

function getSupport({ forceRefresh = false } = {}) {
  const fresh = cachedSupportIfFresh(forceRefresh);
  if (fresh) return fresh;
  if (process.platform !== 'win32') {
    cachedSupport = nonWindowsSupport();
    return cachedSupport;
  }
  const ffmpeg = resolveFfmpegPath();
  if (!ffmpeg) {
    cachedSupport = ffmpegNotFoundSupport();
    return cachedSupport;
  }
  cachedSupport = interpretSupport(ffmpeg, {
    muxers: commandWorks(ffmpeg.path, ['-hide_banner', '-muxers']),
    filters: commandWorks(ffmpeg.path, ['-hide_banner', '-filters']),
    encoders: commandWorks(ffmpeg.path, ['-hide_banner', '-encoders']),
    devices: commandWorks(ffmpeg.path, ['-hide_banner', '-devices']),
  });
  return cachedSupport;
}

let warmSupportPromise = null;

/**
 * Populate the support cache WITHOUT blocking the main process (async spawn).
 * Call once shortly after app launch so the first Settings/share reads a warm
 * cache and never triggers the synchronous spawnSync probe. Safe to call
 * repeatedly — it no-ops once a successful probe is cached and dedupes
 * concurrent calls. Never throws.
 */
function warmSupport({ forceRefresh = false } = {}) {
  if (warmSupportPromise) return warmSupportPromise;
  const fresh = cachedSupportIfFresh(forceRefresh);
  if (fresh) return Promise.resolve(fresh);
  warmSupportPromise = Promise.resolve().then(async () => {
    try {
      if (process.platform !== 'win32') {
        cachedSupport = nonWindowsSupport();
        return cachedSupport;
      }
      const ffmpeg = await resolveFfmpegPathAsync();
      if (!ffmpeg) {
        cachedSupport = ffmpegNotFoundSupport();
        return cachedSupport;
      }
      const [muxers, filters, encoders, devices] = await Promise.all([
        commandWorksAsync(ffmpeg.path, ['-hide_banner', '-muxers']),
        commandWorksAsync(ffmpeg.path, ['-hide_banner', '-filters']),
        commandWorksAsync(ffmpeg.path, ['-hide_banner', '-encoders']),
        commandWorksAsync(ffmpeg.path, ['-hide_banner', '-devices']),
      ]);
      cachedSupport = interpretSupport(ffmpeg, { muxers, filters, encoders, devices });
      return cachedSupport;
    } catch (error) {
      cachedSupport = { ok: false, platform: process.platform, reason: error instanceof Error ? error.message : String(error), checkedAt: Date.now() };
      return cachedSupport;
    }
  }).finally(() => { warmSupportPromise = null; });
  return warmSupportPromise;
}

function numberOption(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function deviceFrameFilter(baseFilter) {
  // Keep DirectShow capture timestamps intact for WHIP. Rewriting PTS from the
  // frame index can make sparse capture look like a valid 60fps clock while the
  // muxer only sends a few real frames per second.
  return baseFilter;
}

function dshowInputFramerate(width, height, fps) {
  // Always request a real DirectShow cadence. If no framerate is requested,
  // FFmpeg can negotiate a very low input cadence while the output filter only
  // rewrites timestamps, which looks like a published 60fps stream carrying
  // about 1 real frame per second.
  return fps;
}

function dshowInputFramerateAttempts(width, height, fps) {
  const attempts = [dshowInputFramerate(width, height, fps)];
  if (width === 2560 && height === 1440 && fps <= 60) attempts.push(120);
  attempts.push(null);
  return Array.from(new Set(attempts));
}

function ffmpegStatusLevel(text) {
  return /blocked|could not|conversion failed|error|failed|invalid|terminating|task finished/i.test(text) ? 'warn' : 'debug';
}

function shouldEmitFfmpegStatus(text) {
  if (truthy(process.env.CATREALM_NATIVE_WHIP_DEBUG)) return true;
  if (/\bframe=\s*\d+.*\bfps=\s*[\d.]+/i.test(text)) return true;
  if (/blocked|could not|conversion failed|error muxing|error writing|failed|invalid|terminating|task finished/i.test(text)) return true;
  if (/^(Input|Output) #/m.test(text)) return true;
  return false;
}

function parseDesktopSource(sourceId) {
  const raw = String(sourceId || '');
  const parts = raw.split(':');
  if (parts[0] === 'screen') {
    const index = Number.parseInt(parts[1] || '0', 10);
    return { kind: 'screen', index: Number.isFinite(index) && index >= 0 ? index : 0 };
  }
  if (parts[0] === 'window') {
    const hwnd = Number.parseInt(parts[1] || '0', 10);
    return Number.isFinite(hwnd) && hwnd > 0 ? { kind: 'window', hwnd } : null;
  }
  return null;
}

function joinWhipEndpoint(url, streamKey) {
  const base = String(url || '').trim().replace(/\/+$/, '');
  const key = String(streamKey || '').trim();
  if (!base) return '';
  if (!key || base.endsWith(`/${key}`)) return base;
  return `${base}/${encodeURIComponent(key)}`;
}

function bitrateKbps(value) {
  const bits = numberOption(value, 8_000_000, 500_000, 80_000_000);
  return `${Math.max(500, Math.round(bits / 1000))}k`;
}

function normalizeDeviceLabel(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\([^)]*\)\s*$/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parseDshowDevices(output) {
  const devices = { video: [], audio: [] };
  let section = null;
  let last = null;
  for (const line of String(output || '').split(/\r?\n/)) {
    if (/DirectShow video devices/i.test(line)) {
      section = 'video';
      last = null;
      continue;
    }
    if (/DirectShow audio devices/i.test(line)) {
      section = 'audio';
      last = null;
      continue;
    }
    const nameMatch = line.match(/"([^"]+)"/);
    if (!nameMatch) continue;
    const name = nameMatch[1];
    if (/Alternative name/i.test(line)) {
      if (last) last.alternativeNames.push(name);
      continue;
    }
    const inlineKindMatch = line.match(/\((video|audio)\)\s*$/i);
    if (inlineKindMatch) {
      section = inlineKindMatch[1].toLowerCase();
    }
    if (!section) continue;
    last = { name, alternativeNames: [] };
    devices[section].push(last);
  }
  return devices;
}

function listDshowDevices(ffmpegPath, { forceRefresh = false } = {}) {
  if (!forceRefresh && cachedDshowDevices && Date.now() - cachedDshowDevices.checkedAt < 30_000) {
    return cachedDshowDevices;
  }
  const result = commandWorks(ffmpegPath, ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy']);
  const output = `${result.stdout}\n${result.stderr}`;
  const parsed = parseDshowDevices(output);
  cachedDshowDevices = {
    checkedAt: Date.now(),
    ok: /DirectShow video devices/i.test(output)
      || /DirectShow audio devices/i.test(output)
      || parsed.video.length > 0
      || parsed.audio.length > 0,
    ...parsed,
  };
  return cachedDshowDevices;
}

function findDshowDevice(devices, kind, label) {
  const requested = String(label || '').trim();
  if (!requested) return null;
  const normalizedRequested = normalizeDeviceLabel(requested);
  const entries = Array.isArray(devices?.[kind]) ? devices[kind] : [];
  const allNames = (entry) => [entry.name, ...(entry.alternativeNames || [])];
  const exact = entries.find((entry) => allNames(entry).some((name) => name === requested));
  if (exact) return exact.name;
  const normalizedExact = entries.find((entry) => allNames(entry).some((name) => normalizeDeviceLabel(name) === normalizedRequested));
  if (normalizedExact) return normalizedExact.name;
  const contains = entries.find((entry) => allNames(entry).some((name) => {
    const normalizedName = normalizeDeviceLabel(name);
    return normalizedName && normalizedRequested && (
      normalizedName.includes(normalizedRequested) || normalizedRequested.includes(normalizedName)
    );
  }));
  return contains?.name ?? null;
}

function formatDshowValue(value) {
  return String(value || '').replace(/"/g, '');
}

function buildArgs(options, overrides = {}) {
  const fps = numberOption(options.fps, 60, 1, 240);
  const bitrate = bitrateKbps(options.bitrate);
  const gop = Math.max(1, fps * 2);
  const mode = options.captureMode === 'window-wgc'
    ? 'window-wgc'
    : options.captureMode === 'device-dshow'
      ? 'device-dshow'
      : 'monitor-dxgi';
  const endpoint = joinWhipEndpoint(options.whip?.url, options.whip?.streamKey);
  if (!endpoint) throw new Error('Missing WHIP endpoint.');

  let inputArgs;
  let audioArgs = ['-an'];
  let audioFilterArgs = [];
  let videoFilterArgs = [];
  if (mode === 'window-wgc') {
    const source = parseDesktopSource(options.sourceId);
    if (!source) throw new Error('Unsupported desktop source id for native WHIP publishing.');
    if (source.kind !== 'window') throw new Error('Window / WGC mode requires a window source.');
    inputArgs = ['-f', 'lavfi', '-i', `gfxcapture=hwnd=${source.hwnd}:max_framerate=${fps}:capture_cursor=1`];
  } else if (mode === 'device-dshow') {
    const support = getSupport();
    if (!support.ffmpegPath) throw new Error('FFmpeg is unavailable.');
    const dshowDevices = listDshowDevices(support.ffmpegPath);
    const videoName = findDshowDevice(dshowDevices, 'video', options.deviceLabel || options.sourceName);
    if (!videoName) throw new Error(`DirectShow video device was not found for "${options.deviceLabel || options.sourceName || options.sourceId || 'unknown'}".`);
    const requestedAudioLabel = String(options.audioDeviceLabel || '').trim();
    const audioName = requestedAudioLabel ? findDshowDevice(dshowDevices, 'audio', requestedAudioLabel) : null;
    if (requestedAudioLabel && !audioName) {
      throw new Error(`DirectShow audio device was not found for "${requestedAudioLabel}".`);
    }
    const width = numberOption(options.width, Math.round((numberOption(options.height, 1080, 1, 4320) * 16) / 9), 16, 7680);
    const height = numberOption(options.height, 1080, 16, 4320);
    const inputFps = Object.prototype.hasOwnProperty.call(overrides, 'dshowInputFps')
      ? overrides.dshowInputFps
      : dshowInputFramerate(width, height, fps);
    const pixelFormat = width === 2560 && height === 1440 ? 'nv12' : 'yuyv422';
    const inputName = audioName
      ? `video=${formatDshowValue(videoName)}:audio=${formatDshowValue(audioName)}`
      : `video=${formatDshowValue(videoName)}`;
    inputArgs = [
      '-fflags', '+genpts',
      '-thread_queue_size', '512',
      '-rtbufsize', '1024M',
      '-f', 'dshow',
      '-video_size', `${width}x${height}`,
      '-pixel_format', pixelFormat,
      ...(inputFps === null ? [] : ['-framerate', String(inputFps)]),
      '-i', inputName,
    ];
    videoFilterArgs = ['-vf', deviceFrameFilter(`fps=${fps},format=nv12`, fps)];
    if (audioName) {
      audioFilterArgs = ['-af', 'aresample=async=1000:first_pts=0,asetpts=N/SR/TB'];
      audioArgs = ['-c:a', 'libopus', '-b:a', '128k', '-ar', '48000', '-ac', '2'];
    } else {
      audioArgs = ['-an'];
    }
  } else {
    const source = parseDesktopSource(options.sourceId);
    if (!source) throw new Error('Unsupported desktop source id for native WHIP publishing.');
    const outputIdx = source.kind === 'screen' ? source.index : numberOption(options.monitorIndex, 0, 0, 32);
    inputArgs = ['-f', 'lavfi', '-i', `ddagrab=output_idx=${outputIdx}:framerate=${fps}:dup_frames=1:output_fmt=bgra`];
  }

  return [
    '-hide_banner',
    '-nostdin',
    '-loglevel', truthy(process.env.CATREALM_NATIVE_WHIP_DEBUG) ? 'verbose' : 'info',
    '-stats_period', '1',
    '-flags', '+low_delay',
    ...inputArgs,
    ...videoFilterArgs,
    ...audioFilterArgs,
    '-fps_mode:v', 'cfr',
    '-r:v', String(fps),
    '-c:v', 'h264_nvenc',
    '-preset', 'p4',
    '-tune', 'ull',
    '-rc', 'cbr',
    '-profile:v', 'baseline',
    '-bf', '0',
    '-delay', '0',
    '-zerolatency', '1',
    '-aud', '1',
    '-g', String(gop),
    '-forced-idr', '1',
    '-b:v', bitrate,
    '-maxrate', bitrate,
    '-bufsize', bitrateKbps(numberOption(options.bitrate, 8_000_000, 500_000, 80_000_000) * 2),
    ...audioArgs,
    '-muxdelay', '0',
    '-muxpreload', '0',
    '-flush_packets', '1',
    '-f', 'whip',
    '-ts_buffer_size', String(numberOption(process.env.CATREALM_WHIP_TS_BUFFER_SIZE, DEFAULT_WHIP_TS_BUFFER_SIZE, 4096, 256 * 1024 * 1024)),
    endpoint,
  ];
}

function buildArgAttempts(options) {
  if (options.captureMode !== 'device-dshow') {
    return [{ label: 'default', args: buildArgs(options) }];
  }
  const fps = numberOption(options.fps, 60, 1, 240);
  const height = numberOption(options.height, 1080, 16, 4320);
  const width = numberOption(options.width, Math.round((height * 16) / 9), 16, 7680);
  return dshowInputFramerateAttempts(width, height, fps).map((dshowInputFps) => ({
    label: dshowInputFps === null ? 'device-dshow-auto-framerate' : `device-dshow-${dshowInputFps}fps`,
    args: buildArgs(options, { dshowInputFps }),
  }));
}

function shouldRetryDshowAttempt(options, attemptIndex, attempts, stderrText) {
  if (options.captureMode !== 'device-dshow') return false;
  if (attemptIndex >= attempts.length - 1) return false;
  return /could not set video options|could not set video|error opening input|video device/i.test(stderrText);
}

// ── GStreamer WHIP backend ────────────────────────────────────────────────────
// FFmpeg's whip muxer is RTT-bound and collapses to ~3fps on real networks.
// GStreamer (whipsink/whipclientsink, async webrtcbin) sustains the stream, so
// it is preferred whenever a GStreamer install is found; packaged clients
// without GStreamer fall back to the bundled FFmpeg for desktop/window capture.
// Native device/capture-card publishing is GStreamer-only; FFmpeg DirectShow is
// too timing-sensitive for WHIP and can collapse to dropped-frame / ~1fps spam.
// CATREALM_WHIP_BACKEND=gstreamer|ffmpeg forces desktop/window capture only.
const DEFAULT_GST_LAUNCH = 'C:\\Program Files\\GStreamer\\1.0\\msvc_x86_64\\bin\\gst-launch-1.0.exe';
const DEFAULT_GST_DEVICE_MONITOR = 'C:\\Program Files\\GStreamer\\1.0\\msvc_x86_64\\bin\\gst-device-monitor-1.0.exe';

let cachedWhipBackend = null;
let cachedGstAudioDevices = null;
let cachedGstAudioDevicesAt = 0;
function forcedWhipBackend() {
  const forced = String(process.env.CATREALM_WHIP_BACKEND || '').trim();
  if (/^gst(reamer)?$/i.test(forced)) return 'gstreamer';
  if (/^ffmpeg$/i.test(forced)) return 'ffmpeg';
  return null;
}

function whipBackend(options = {}) {
  if (options.captureMode === 'device-dshow') return 'gstreamer';
  const forced = forcedWhipBackend();
  if (forced) return forced;
  if (cachedWhipBackend) return cachedWhipBackend;
  cachedWhipBackend = resolveGstLaunch() ? 'gstreamer' : 'ffmpeg';
  return cachedWhipBackend;
}

function gstLaunchCandidates() {
  const candidates = [];
  if (process.env.CATREALM_GSTREAMER_BIN) candidates.push(process.env.CATREALM_GSTREAMER_BIN);
  const unpackedDir = __dirname.includes(`${path.sep}app.asar${path.sep}`)
    ? __dirname.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`)
    : __dirname;
  const bundledGstDirs = [
    path.join(unpackedDir, 'native', 'gstreamer', 'win-msvc-x64', 'bin'),
    path.join(process.cwd(), 'electron', 'native', 'gstreamer', 'win-msvc-x64', 'bin'),
    path.join(__dirname, '..', 'electron', 'native', 'gstreamer', 'win-msvc-x64', 'bin'),
  ];
  if (process.resourcesPath) {
    bundledGstDirs.push(
      path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'native', 'gstreamer', 'win-msvc-x64', 'bin'),
      path.join(process.resourcesPath, 'electron', 'native', 'gstreamer', 'win-msvc-x64', 'bin'),
    );
  }
  bundledGstDirs.push(path.join(__dirname, 'native', 'gstreamer', 'win-msvc-x64', 'bin'));
  // Bundled runtime ships the launcher renamed to CatRealmStreamer.exe (branded
  // process name); prefer it, fall back to gst-launch-1.0.exe for older bundles.
  for (const binDir of bundledGstDirs) {
    candidates.push(path.join(binDir, 'CatRealmStreamer.exe'));
    candidates.push(path.join(binDir, 'gst-launch-1.0.exe'));
  }
  const root = process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64;
  if (root) candidates.push(path.join(root, 'bin', 'gst-launch-1.0.exe'));
  candidates.push(DEFAULT_GST_LAUNCH);
  return [...new Set(candidates)];
}

function resolveGstLaunch() {
  for (const candidate of gstLaunchCandidates()) {
    if (candidate.includes(path.sep)) {
      if (fs.existsSync(candidate)) return candidate;
    } else if (commandWorks(candidate, ['--version']).ok) {
      return candidate;
    }
  }
  return null;
}

async function resolveGstLaunchAsync() {
  for (const candidate of gstLaunchCandidates()) {
    if (candidate.includes(path.sep)) {
      if (fs.existsSync(candidate)) return candidate;
    } else if ((await commandWorksAsync(candidate, ['--version'])).ok) {
      return candidate;
    }
  }
  return null;
}

function gstRuntimeRoot(gstPath) {
  const binDir = path.dirname(gstPath || '');
  return path.basename(binDir).toLowerCase() === 'bin' ? path.dirname(binDir) : null;
}

function resolveGstDeviceMonitor(gstPath = resolveGstLaunch()) {
  const candidates = [];
  if (process.env.CATREALM_GSTREAMER_DEVICE_MONITOR) candidates.push(process.env.CATREALM_GSTREAMER_DEVICE_MONITOR);
  if (gstPath && gstPath.includes(path.sep)) candidates.push(path.join(path.dirname(gstPath), 'gst-device-monitor-1.0.exe'));
  const root = process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64;
  if (root) candidates.push(path.join(root, 'bin', 'gst-device-monitor-1.0.exe'));
  candidates.push(DEFAULT_GST_DEVICE_MONITOR);
  candidates.push('gst-device-monitor-1.0');
  for (const candidate of Array.from(new Set(candidates.filter(Boolean)))) {
    if (candidate.includes(path.sep)) {
      if (fs.existsSync(candidate)) return candidate;
    } else if (commandWorks(candidate, ['--version']).ok) {
      return candidate;
    }
  }
  return null;
}

function gstRuntimeEnv(gstPath) {
  const root = gstRuntimeRoot(gstPath);
  const binDir = path.dirname(gstPath);
  const env = {
    ...process.env,
    PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`,
  };
  if (!root) return env;

  const pluginPath = path.join(root, 'lib', 'gstreamer-1.0');
  const scanner = path.join(root, 'libexec', 'gstreamer-1.0', 'gst-plugin-scanner.exe');
  if (fs.existsSync(pluginPath)) {
    env.GST_PLUGIN_PATH = pluginPath;
    env.GST_PLUGIN_SYSTEM_PATH = pluginPath;
    env.GST_PLUGIN_PATH_1_0 = pluginPath;
    env.GST_PLUGIN_SYSTEM_PATH_1_0 = pluginPath;
  }
  if (fs.existsSync(scanner)) {
    env.GST_PLUGIN_SCANNER = scanner;
    env.GST_PLUGIN_SCANNER_1_0 = scanner;
  }
  return env;
}

function gstCongestionControl() {
  // 'gcc' (default, adaptive) | 'disabled' (steady target bitrate). webrtcsink's
  // GCC can't probe upward in this GStreamer build (rtprtxsend lacks
  // stuffing-kbps), so on a clean uplink it stays conservative and oscillates
  // down; 'disabled' holds the target rate (best when the uplink is known-good).
  const v = String(process.env.CATREALM_WHIP_CONGESTION || '').trim().toLowerCase();
  return (v === 'disabled' || v === 'off' || v === 'none') ? 'disabled' : 'gcc';
}

const H264_PROFILE_RE = /^(high|main|baseline|constrained-baseline)$/;

function gstH264Profile(options) {
  // high | main | baseline | constrained-baseline | null. When set, we encode
  // H264 ourselves (nvh264enc, full profile + rate control) and publish via the
  // lower-level whipsink — whipclientsink can't passthrough encoded H264 cleanly
  // and otherwise forces Constrained Baseline. The app passes the user's
  // "Backend CatRealm Encoding" setting in options.h264Profile (default high);
  // CATREALM_WHIP_H264_PROFILE is a dev override. null (tester/legacy callers
  // only) falls back to the whipclientsink raw path.
  const env = String(process.env.CATREALM_WHIP_H264_PROFILE || '').trim().toLowerCase();
  if (H264_PROFILE_RE.test(env)) return env;
  const opt = String(options?.h264Profile || '').trim().toLowerCase();
  return H264_PROFILE_RE.test(opt) ? opt : null;
}

function gstRateControl(options) {
  // 'quality' preset = capped VBR (complex scenes can burst up to the cap);
  // efficiency/compressed/catrealm = CBR (steady, predictable rate).
  // CATREALM_WHIP_RC=cbr|vbr is a dev override.
  const env = String(process.env.CATREALM_WHIP_RC || '').trim().toLowerCase();
  if (env === 'cbr' || env === 'vbr') return env;
  return String(options?.preset || '').trim().toLowerCase() === 'quality' ? 'vbr' : 'cbr';
}

function cleanGstPropertyValue(value) {
  return String(value || '').replace(/\s+\([^)]+\)\s*$/, '').replace(/^"(.*)"$/, '$1').trim();
}

function parseGstAudioDevices(output) {
  const devices = [];
  let current = null;
  const pushCurrent = () => {
    if (!current?.name || !current.id || !/Audio\/Source/i.test(current.className || '')) return;
    if (current.api && current.api !== 'wasapi2') return;
    devices.push(current);
  };

  for (const line of String(output || '').split(/\r?\n/)) {
    if (/^\s*Device found:\s*$/i.test(line)) {
      pushCurrent();
      current = { name: '', className: '', id: '', description: '', actualName: '', loopback: false, api: '' };
      continue;
    }
    if (!current) continue;
    const name = line.match(/^\s*name\s*:\s*(.+)$/i);
    if (name) {
      current.name = name[1].trim();
      continue;
    }
    const className = line.match(/^\s*class\s*:\s*(.+)$/i);
    if (className) {
      current.className = className[1].trim();
      continue;
    }
    const property = line.match(/^\s*([a-z0-9_.-]+)\s*=\s*(.+)$/i);
    if (!property) continue;
    const key = property[1].toLowerCase();
    const value = cleanGstPropertyValue(property[2]);
    if (key === 'device.api') current.api = value;
    if (key === 'device.id') current.id = value;
    if (key === 'wasapi2.device.description') current.description = value;
    if (key === 'device.actual-name') current.actualName = value;
    if (key === 'wasapi2.device.loopback') current.loopback = /^true\b/i.test(value);
  }
  pushCurrent();
  return devices;
}

function getGstAudioDevices(gstPath) {
  if (cachedGstAudioDevices && Date.now() - cachedGstAudioDevicesAt < 15_000) return cachedGstAudioDevices;
  const monitor = resolveGstDeviceMonitor(gstPath);
  if (!monitor) {
    cachedGstAudioDevices = [];
    cachedGstAudioDevicesAt = Date.now();
    return cachedGstAudioDevices;
  }
  const result = commandWorks(monitor, ['Audio/Source']);
  cachedGstAudioDevices = parseGstAudioDevices(`${result.stdout}\n${result.stderr}`);
  cachedGstAudioDevicesAt = Date.now();
  return cachedGstAudioDevices;
}

function normalizeDeviceLabel(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/^default\s*-\s*/i, '')
    .replace(/\s*\(default\)\s*/gi, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function scoreGstAudioDevice(device, requestedLabel) {
  const requested = normalizeDeviceLabel(requestedLabel);
  if (!requested) return 0;
  if (String(device.id || '').toLowerCase() === String(requestedLabel || '').toLowerCase()) return 200;
  const candidates = [device.name, device.description, device.actualName].filter(Boolean).map(normalizeDeviceLabel);
  let score = 0;
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate === requested) score = Math.max(score, 120);
    else if (candidate.includes(requested) || requested.includes(candidate)) score = Math.max(score, 70);
  }
  if (score > 0 && !device.loopback) score += 5;
  return score;
}

function findGstAudioDevice(gstPath, audioDeviceLabel) {
  const requested = String(audioDeviceLabel || '').trim();
  if (!requested) return null;
  return getGstAudioDevices(gstPath)
    .map((device) => ({ device, score: scoreGstAudioDevice(device, requested) }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.device ?? null;
}

function gstString(value) {
  return `"${String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function buildGstWasapiAudioBranch(options, gstPath, sinkTarget, encodedRtp, warnings) {
  const requestedAudioLabel = String(options.audioDeviceLabel || '').trim();
  if (!requestedAudioLabel) return [];
  const audioDevice = findGstAudioDevice(gstPath, requestedAudioLabel);
  if (!audioDevice) {
    // Soft-degrade to video-only rather than killing the whole share: a stale or
    // unresolvable audio label must not take the video stream down with it. The
    // caller surfaces this warning to the renderer.
    warnings?.push(`Audio device "${requestedAudioLabel}" was not found; sharing video only.`);
    return [];
  }

  const rawAudio = [
    'wasapi2src', `device=${gstString(audioDevice.id)}`, ...(audioDevice.loopback ? ['loopback=true'] : []),
    'low-latency=true', 'provide-clock=false', 'do-timestamp=true', 'slave-method=resample',
    'latency-time=10000', 'buffer-time=200000',
    '!', 'queue', 'leaky=downstream', 'max-size-buffers=0', 'max-size-bytes=0', 'max-size-time=200000000',
    '!', 'audioconvert',
    '!', 'audioresample',
    '!', 'audio/x-raw,format=S16LE,rate=48000,channels=2,layout=interleaved',
  ];
  if (!encodedRtp) return [...rawAudio, '!', sinkTarget];
  return [
    ...rawAudio,
    '!', 'opusenc', 'bitrate=128000', 'bitrate-type=cbr', 'audio-type=generic', 'frame-size=20',
    'perfect-timestamp=true', 'hard-resync=true',
    '!', 'rtpopuspay', 'pt=97',
    '!', sinkTarget,
  ];
}

const H264_ENCODERS = ['nvh264enc', 'amfh264enc', 'mfh264enc'];
let cachedEncoders = null;

const availableH264EncodersAsync = createCachedProbe(async () => {
  if (process.platform !== 'win32') return [];
  const gstPath = await resolveGstLaunchAsync();
  if (!gstPath) return [];
  const inspect = path.join(path.dirname(gstPath), 'gst-inspect-1.0.exe');
  const exe = fs.existsSync(inspect) ? inspect : 'gst-inspect-1.0';
  const env = gstRuntimeEnv(gstPath);
  const results = await Promise.all(H264_ENCODERS.map(enc => runHardwareProbe(exe, [enc], { env, timeoutMs: 10000 })));
  cachedEncoders = H264_ENCODERS.filter((_, index) => results[index].ok);
  return cachedEncoders;
}, encoders => encoders.length > 0);

// Which hardware H.264 encoders actually register in the resolved runtime — used
// to enumerate GPU choices (NVIDIA->nvh264enc, AMD->amfh264enc, generic MF
// fallback->mfh264enc) and to fall back if a saved choice isn't available on this
// machine. mfh264enc (MediaFoundation) is vendor-agnostic and ships via
// gstmediafoundation.dll; amfh264enc ships via gstamfcodec.dll.
function availableH264Encoders() {
  if (cachedEncoders) return cachedEncoders;
  const gstPath = resolveGstLaunch();
  if (!gstPath) { cachedEncoders = []; return cachedEncoders; }
  const inspect = path.join(path.dirname(gstPath), 'gst-inspect-1.0.exe');
  const exe = fs.existsSync(inspect) ? inspect : 'gst-inspect-1.0';
  const env = gstRuntimeEnv(gstPath);
  const result = [];
  for (const enc of H264_ENCODERS) {
    const r = spawnSync(exe, [enc], { env, windowsHide: true, timeout: 10000 });
    if (r.status === 0) result.push(enc);
  }
  cachedEncoders = result;
  return result;
}

// Resolve the H.264 encoder element to use. CATREALM_WHIP_VIDEO_ENCODER overrides;
// otherwise options.videoEncoder (set by the GPU chooser). Falls back to the first
// available encoder if the requested one isn't present, preferring NVENC > AMF > MF.
function resolveVideoEncoder(options) {
  const env = String(process.env.CATREALM_WHIP_VIDEO_ENCODER || '').trim().toLowerCase();
  const opt = String(options?.videoEncoder || '').trim().toLowerCase();
  const choice = env || opt;
  const avail = availableH264Encoders();
  if (H264_ENCODERS.includes(choice) && (!avail.length || avail.includes(choice))) return choice;
  for (const enc of H264_ENCODERS) if (avail.includes(enc)) return enc;
  return 'nvh264enc';
}

// Encoder-specific token list for low-latency WebRTC H.264. Same target/units
// (kbit/sec) across encoders; rate-control + low-latency knobs differ per vendor.
function buildH264EncoderTokens(encoder, { kbps, gop, cabac, rcMode }) {
  const maxKbps = Math.round(kbps * 1.5);
  if (encoder === 'amfh264enc') {
    return [
      'amfh264enc', 'usage=ultra-low-latency', `rate-control=${rcMode === 'vbr' ? 'lcvbr' : 'cbr'}`, `bitrate=${kbps}`,
      ...(rcMode === 'vbr' ? [`max-bitrate=${maxKbps}`] : []),
      `gop-size=${gop}`, 'b-frames=0', `cabac=${cabac}`, 'aud=true',
    ];
  }
  if (encoder === 'mfh264enc') {
    return [
      'mfh264enc', 'low-latency=true', `rc-mode=${rcMode === 'vbr' ? 'pcvbr' : 'cbr'}`, `bitrate=${kbps}`,
      ...(rcMode === 'vbr' ? [`max-bitrate=${maxKbps}`] : []),
      `gop-size=${gop}`, `cabac=${cabac}`,
    ];
  }
  // nvh264enc (NVENC) — the default.
  return [
    'nvh264enc', `rc-mode=${rcMode}`, `bitrate=${kbps}`,
    ...(rcMode === 'vbr' ? [`max-bitrate=${maxKbps}`] : []),
    `gop-size=${gop}`, 'bframes=0', 'zerolatency=true', 'repeat-sequence-header=true', `cabac=${cabac}`,
  ];
}

function buildGstDeviceArgs(options) {
  const fps = numberOption(options.fps, 60, 1, 240);
  const height = numberOption(options.height, 1080, 16, 4320);
  const width = numberOption(options.width, Math.round((height * 16) / 9), 16, 7680);
  const device = String(options.deviceLabel || options.sourceName || '').trim();
  if (!device) throw new Error('GStreamer device capture requires a device label.');
  const endpoint = joinWhipEndpoint(options.whip?.url, options.whip?.streamKey);
  if (!endpoint) throw new Error('Missing WHIP endpoint.');
  const gstPath = resolveGstLaunch();
  // GCC bitrate bounds for whipclientsink/webrtcsink. webrtcsink defaults to a
  // 2 Mbps start and (in this build) can't probe upward, so it macroblocks on
  // 1440p60 game content. Start AT the target and hold a HIGH floor (60% of
  // target, ≥3 Mbps) so GCC can't collapse to a blocky ~2 Mbps on a clean path —
  // the dips we saw (6→7.3→2.2 Mbps at 0% loss) were GCC mis-estimating, not real
  // congestion. CATREALM_WHIP_BITRATE overrides the target for A/B testing (1440p60
  // H264-Baseline wants ~12-15 Mbps to look crisp in fast motion).
  const bitrate = numberOption(Number(process.env.CATREALM_WHIP_BITRATE) || options.bitrate, 8000000, 500000, 50000000);
  const startBitrate = bitrate;
  const maxBitrate = bitrate;
  const minBitrate = Math.min(bitrate, Math.max(3000000, Math.round(bitrate * 0.6)));
  const congestion = gstCongestionControl();
  const h264Profile = gstH264Profile(options);
  // Built only for the branch actually taken (avoids a duplicate device-monitor
  // lookup and a duplicate "not found" warning). Soft-degrade warnings collect
  // here and are surfaced by startGstreamer.
  const warnings = [];
  if (h264Profile) {
    // Encode-ourselves → whipsink path (the in-app default: the renderer always
    // passes options.h264Profile). nvh264enc with the requested profile and the
    // preset's rate control (quality = capped VBR, else CBR), bframes=0 +
    // zerolatency for WebRTC, repeat-sequence-header + config-interval=-1 so
    // late/new viewers get SPS/PPS. whipsink only does WHIP transport (no GCC).
    // Validated: ICE completes, SDP advertises the chosen profile (e.g. High =
    // profile-level-id 640033). Same downscale-only caps range as the raw path.
    const kbps = Math.max(500, Math.round(bitrate / 1000));
    const gop = Math.max(15, fps * 2);
    const cabac = h264Profile === 'high' || h264Profile === 'main';
    const rcMode = gstRateControl(options);
    // Encoder chosen by the GPU selector (NVIDIA->nvh264enc, AMD->amfh264enc,
    // generic->mfh264enc). h264parse config-interval=-1 below repeats SPS/PPS for
    // late viewers regardless of encoder, so AMF/MF need no per-encoder repeat flag.
    const videoEncoder = resolveVideoEncoder(options);
    const encoderTokens = buildH264EncoderTokens(videoEncoder, { kbps, gop, cabac, rcMode });
    const rtpAudioBranch = buildGstWasapiAudioBranch(options, gstPath, 'whip.', true, warnings);
    return {
      args: [
        'mfvideosrc', `device-name="${device}"`,
        '!', 'videorate',
        '!', 'videoscale',
        '!', 'videoconvert',
        '!', `video/x-raw,width=(int)[2,${width}],height=(int)[2,${height}],framerate=(fraction)${fps}/1,pixel-aspect-ratio=(fraction)1/1`,
        '!', ...encoderTokens,
        '!', `video/x-h264,profile=(string)${h264Profile},stream-format=(string)byte-stream,alignment=(string)au`,
        '!', 'h264parse', 'config-interval=-1',
        '!', 'rtph264pay', 'config-interval=-1', 'pt=96',
        '!', 'whipsink', 'name=whip', `whip-endpoint=${endpoint}`,
        ...rtpAudioBranch,
      ],
      warnings,
    };
  }
  // Pipeline tokens (gst-launch joins + reparses): mfvideosrc → videorate →
  // videoscale → videoconvert → caps → queue → whipclientsink (force H264 so
  // webrtcsink uses NVENC). The output caps treat width/height as a DOWNSCALE-
  // ONLY range [2,target]: a device at/below the target (e.g. the Elgato Virtual
  // Camera, max 1080p) passes through untouched, anything larger (a 4K card)
  // scales down. videorate adapts the source's native rate to the target fps so
  // a 30/60-only device doesn't hard-fail on a 60 request. This is why pinning
  // exact caps on the source breaks devices that can't hit the requested mode.
  const rawAudioBranch = buildGstWasapiAudioBranch(options, gstPath, 'whip.', false, warnings);
  return {
    args: [
      '-e',
      'mfvideosrc', `device-name="${device}"`,
      '!', 'videorate',
      '!', 'videoscale',
      '!', 'videoconvert',
      '!', `video/x-raw,width=(int)[2,${width}],height=(int)[2,${height}],framerate=(fraction)${fps}/1,pixel-aspect-ratio=(fraction)1/1`,
      '!', 'queue',
      '!', 'whipclientsink', 'name=whip', `signaller::whip-endpoint=${endpoint}`, 'video-caps=video/x-h264', 'audio-caps=audio/x-opus',
      `congestion-control=${congestion}`,
      `start-bitrate=${startBitrate}`, `max-bitrate=${maxBitrate}`, `min-bitrate=${minBitrate}`,
      ...rawAudioBranch,
    ],
    warnings,
  };
}

function shouldEmitGstStatus(text) {
  if (truthy(process.env.CATREALM_NATIVE_WHIP_DEBUG)) return true;
  if (/fraction_range|GStreamer-CRITICAL|GLib-/.test(text)) return false;
  return /ICE connection state|peer connection state|WHIP resource|201 Created|ERROR|fail|could not|not-negotiated|no element|nvh264|Setting pipeline to (PLAYING|NULL)/i.test(text);
}

function startGstreamer(options, sender) {
  if (options.captureMode !== 'device-dshow') {
    return { ok: false, reason: 'unsupported', message: 'GStreamer backend currently supports device capture only.' };
  }
  const gstPath = resolveGstLaunch();
  if (!gstPath) {
    return { ok: false, reason: 'unsupported', message: 'gst-launch-1.0 not found (install GStreamer or set CATREALM_GSTREAMER_BIN).' };
  }
  if (activePublishers.size > 0) {
    for (const publisherId of Array.from(activePublishers.keys())) stop(publisherId);
  }

  let args;
  let warnings = [];
  try {
    ({ args, warnings } = buildGstDeviceArgs(options));
  } catch (error) {
    return { ok: false, reason: 'bad-options', message: error instanceof Error ? error.message : String(error) };
  }

  const publisherId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emitStatus = (message, level = 'info') => {
    if (!sender || sender.isDestroyed()) return;
    sender.send('native-whip-publisher-status', { publisherId, level, message, at: Date.now() });
  };
  for (const warning of warnings) emitStatus(warning, 'warn');
  const env = gstRuntimeEnv(gstPath);
  env.GST_DEBUG = process.env.GST_DEBUG || '2,webrtc-whip-signaller:3,webrtcbin:3,whipsink:3';
  const safeArgs = args.map((arg) => {
    if (arg.startsWith('signaller::whip-endpoint=')) return 'signaller::whip-endpoint=<whip-endpoint>';
    if (arg.startsWith('whip-endpoint=')) return 'whip-endpoint=<whip-endpoint>';
    return arg;
  });

  let child;
  try {
    child = spawn(gstPath, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, env });
  } catch (error) {
    if (sender && !sender.isDestroyed()) {
      sender.send('native-whip-publisher-stopped', { publisherId, code: null, signal: null, error: error instanceof Error ? error.message : String(error), at: Date.now() });
    }
    return { ok: false, reason: 'spawn-failed', message: 'Failed to start gst-launch.' };
  }

  activePublishers.set(publisherId, { child, options, startedAt: Date.now(), backend: 'gstreamer' });
  emitStatus(`spawn gstreamer=${gstPath} args=${safeArgs.join(' ')}`);
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    if (!shouldEmitGstStatus(text)) return;
    emitStatus(text, /error|fail|could not|not-negotiated|no element/i.test(text) ? 'warn' : 'debug');
  });
  child.on('exit', (code, signal) => {
    const active = activePublishers.get(publisherId);
    if (!active || active.child !== child) return;
    activePublishers.delete(publisherId);
    if (!sender || sender.isDestroyed()) return;
    sender.send('native-whip-publisher-stopped', { publisherId, code, signal, at: Date.now() });
  });
  child.on('error', (error) => {
    const active = activePublishers.get(publisherId);
    if (!active || active.child !== child) return;
    activePublishers.delete(publisherId);
    if (!sender || sender.isDestroyed()) return;
    sender.send('native-whip-publisher-stopped', { publisherId, code: null, signal: null, error: error instanceof Error ? error.message : String(error), at: Date.now() });
  });

  return { ok: true, publisherId, backend: 'gstreamer', gstPath, captureMode: options.captureMode, sourceId: options.sourceId };
}

function start(options, sender) {
  if (whipBackend(options) === 'gstreamer') return startGstreamer(options, sender);
  if (options.captureMode === 'device-dshow') {
    return { ok: false, reason: 'unsupported', message: 'Native device WHIP capture requires GStreamer; FFmpeg DirectShow device capture is disabled.' };
  }
  const support = getSupport();
  if (!support.ok) {
    return { ok: false, reason: 'unsupported', message: support.reason || 'Native WHIP publishing is unavailable.', support };
  }
  if (activePublishers.size > 0) {
    for (const publisherId of Array.from(activePublishers.keys())) stop(publisherId);
  }

  let attempts;
  try {
    attempts = buildArgAttempts(options);
  } catch (error) {
    return { ok: false, reason: 'bad-options', message: error instanceof Error ? error.message : String(error), support };
  }

  const publisherId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emitStatus = (message, level = 'info') => {
    if (!sender || sender.isDestroyed()) return;
    sender.send('native-whip-publisher-status', {
      publisherId,
      level,
      message,
      at: Date.now(),
    });
  };

  const spawnAttempt = (attemptIndex) => {
    const attempt = attempts[attemptIndex];
    const safeArgs = attempt.args.map((arg, index) => (index === attempt.args.length - 1 ? '<whip-endpoint>' : arg));
    let child;
    try {
      child = spawn(support.ffmpegPath, attempt.args, {
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      activePublishers.delete(publisherId);
      if (!sender || sender.isDestroyed()) return false;
      sender.send('native-whip-publisher-stopped', {
        publisherId,
        code: null,
        signal: null,
        error: error instanceof Error ? error.message : String(error),
        at: Date.now(),
      });
      return false;
    }

    let stderrText = '';
    activePublishers.set(publisherId, { child, options, startedAt: Date.now(), attemptIndex });
    emitStatus(`spawn ffmpeg=${support.ffmpegPath} attempt=${attempt.label} args=${safeArgs.join(' ')}`);
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stderrText = `${stderrText}${text}`.slice(-16_384);
      if (!shouldEmitFfmpegStatus(text)) return;
      emitStatus(text, ffmpegStatusLevel(text));
    });
    child.on('exit', (code, signal) => {
      const active = activePublishers.get(publisherId);
      if (!active || active.child !== child) return;
      if (signal === null && code !== 0 && shouldRetryDshowAttempt(options, attemptIndex, attempts, stderrText)) {
        emitStatus(`retrying native device capture after ${attempt.label} was rejected`, 'warn');
        spawnAttempt(attemptIndex + 1);
        return;
      }
      activePublishers.delete(publisherId);
      if (!sender || sender.isDestroyed()) return;
      sender.send('native-whip-publisher-stopped', { publisherId, code, signal, at: Date.now() });
    });
    child.on('error', (error) => {
      const active = activePublishers.get(publisherId);
      if (!active || active.child !== child) return;
      activePublishers.delete(publisherId);
      if (!sender || sender.isDestroyed()) return;
      sender.send('native-whip-publisher-stopped', {
        publisherId,
        code: null,
        signal: null,
        error: error instanceof Error ? error.message : String(error),
        at: Date.now(),
      });
    });
    return true;
  };

  if (!spawnAttempt(0)) {
    return { ok: false, reason: 'spawn-failed', message: 'Failed to start FFmpeg.', support };
  }

  return {
    ok: true,
    publisherId,
    backend: 'ffmpeg',
    ffmpegPath: support.ffmpegPath,
    captureMode: options.captureMode,
    sourceId: options.sourceId,
    support,
  };
}

function stop(publisherId) {
  if (publisherId) {
    const publisher = activePublishers.get(publisherId);
    if (!publisher) return { ok: true };
    activePublishers.delete(publisherId);
    try { publisher.child.kill('SIGTERM'); } catch {}
    return { ok: true };
  }
  for (const id of Array.from(activePublishers.keys())) stop(id);
  return { ok: true };
}

function stopAll() {
  stop();
}

module.exports = {
  getSupport,
  getSupportAsync: warmSupport,
  warmSupport,
  availableH264Encoders,
  availableH264EncodersAsync,
  start,
  stop,
  stopAll,
};
