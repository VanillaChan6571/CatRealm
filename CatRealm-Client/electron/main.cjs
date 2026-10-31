const { app, BrowserWindow, ipcMain, desktopCapturer, shell, powerMonitor, session, Tray, Menu, Notification, crashReporter, nativeImage, net } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const { autoUpdater } = require('electron-updater');
const { GameActivityService } = require('./gameActivityService.cjs');
const windowsAppAudioBridge = require('./windowsAppAudioBridge.cjs');
const whipPublisherBridge = require('./whipPublisherBridge.cjs');
const { createScreenShareGpuDiscovery } = require('./screenShareGpuDiscovery.cjs');
const { createAppSecurity, isHttpUrl, isPasskeyUrl, isOverlayHostAllowed } = require('./appSecurity.cjs');
const { createReactiveAvatarFiles } = require('./reactiveAvatarFiles.cjs');
const listScreenShareGpus = createScreenShareGpuDiscovery(whipPublisherBridge.availableH264EncodersAsync);

// --- Thumbnail helper mode -------------------------------------------------------------
// This binary is re-spawned as a throwaway child purely to grab WINDOW thumbnails in
// isolation. Window capture forces the WGC fallback (compile-time RTC_ENABLE_WIN_WGC) which
// hardcrashes below JS on some capture-card drivers; running it here means such a crash kills
// only this short-lived process. The parent detects the abnormal exit and degrades to emoji.
// We branch BEFORE any normal init (single-instance lock, windows, tray, updater, IPC) and
// return so none of it runs.
if (process.env.CATREALM_THUMB_HELPER === '1') {
  const outPath = process.env.CATREALM_THUMB_OUT;
  const parsed = Number.parseInt(process.env.CATREALM_THUMB_HELPER_PX ?? '150', 10);
  const px = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 320) : 150;
  // Same app identity as the main instance so this throwaway helper groups under
  // CatRealm rather than appearing as a stray "Electron" process.
  if (process.platform === 'win32') app.setAppUserModelId('app.catrealm.client');
  app.whenReady().then(async () => {
    let result = [];
    try {
      const windows = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: px, height: px },
        fetchWindowIcons: false,
      });
      result = windows.map((s) => ({
        id: s.id,
        thumbnail: s.thumbnail && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : null,
      }));
    } catch {
      result = [];
    }
    try { if (outPath) fs.writeFileSync(outPath, JSON.stringify(result), 'utf8'); } catch {}
    app.exit(0);
  });
  return;
}

const isDev = !app.isPackaged;
const appSecurity = createAppSecurity({ indexPath: path.join(__dirname, '..', 'dist', 'index.html'), isDev });
const handleAppIpc = (channel, handler) => appSecurity.handle(ipcMain, channel, handler);
// Dev-only: expose the Chrome DevTools Protocol on a localhost port so external
// tooling can attach to the renderer for performance profiling / evaluation.
// Enabled only via the manual dev launcher (which sets ELECTRON_REMOTE_DEBUG);
// never active in packaged builds.
if (isDev && process.env.ELECTRON_REMOTE_DEBUG) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.ELECTRON_REMOTE_DEBUG);
  app.commandLine.appendSwitch('remote-allow-origins', '*');
}
const isWindows = process.platform === 'win32';
// Give every CatRealm process (main + renderer/GPU/utility children + the native
// capture/thumbnail helpers) the same Windows app identity, so they group under a
// single "CatRealm" entry in Task Manager / the taskbar and notifications are
// attributed to CatRealm. Matches `build.appId` in package.json. No-op off Windows.
if (isWindows) app.setAppUserModelId('app.catrealm.client');
const canAutoUpdate = !isDev && isWindows;
const gotSingleInstanceLock = app.requestSingleInstanceLock();
const SAFE_UPDATE_CHANNEL_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const STABLE_UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;
const DEV_UPDATE_CHECK_INTERVAL_MS = 3 * 60 * 1000;
// Must match `updaterCacheDirName` in electron-builder config / app-update.yml.
const UPDATER_CACHE_DIR_NAME = 'catrealm-client-updater';
// A `checkForUpdates()` call that never resolves would freeze the banner on
// "Checking..." forever (electron-updater has no request timeout of its own).
const UPDATE_CHECK_TIMEOUT_MS = 90 * 1000;
// Download-stall watchdog: if the transferred byte count doesn't advance for
// this long while downloading, clear the partial download and retry. Guards
// against a differential/full download hanging at a fixed offset on a flaky
// network (observed as a 0-byte temp installer left in the updater cache).
const UPDATE_STALL_TIMEOUT_MS = 3 * 60 * 1000;
const UPDATE_STALL_POLL_MS = 15 * 1000;
const UPDATE_STALL_MAX_AUTO_RETRIES = 3;
let updateStatus = { state: 'idle' };
let updateDownloaded = false;
let updateChannel = 'latest';
let queuedUpdateAction = null;
let allowStableDowngradeOverride = false;
let periodicUpdateCheckTimer = null;
let nextUpdateCheckAt = null;
let updateStallTimer = null;
let lastUpdateProgressAt = 0;
let lastUpdateTransferredBytes = -1;
let updateStallAutoRetries = 0;
let clearAndRetryInFlight = false;
let activeUpdateCancellationToken = null;
let quitRequested = false;
let isSystemShuttingDown = false;
let minimizeToTrayEnabled = false;
let openLinksInApp = false;
let tray = null;
const activeDesktopNotifications = new Map();
const notificationIconCache = new Map();
const NOTIFICATION_ICON_CACHE_LIMIT = 50;
const NOTIFICATION_ICON_MAX_BYTES = 1024 * 1024;

// Sender avatars for DM toasts. Best effort: any failure shows the toast without an icon.
async function loadNotificationIcon(iconUrl) {
  if (typeof iconUrl !== 'string' || iconUrl.length > 2048 || !/^https?:\/\//i.test(iconUrl)) return undefined;
  if (notificationIconCache.has(iconUrl)) return notificationIconCache.get(iconUrl);
  let icon;
  try {
    const response = await net.fetch(iconUrl, { signal: AbortSignal.timeout(3000) });
    const length = Number(response.headers.get('content-length') || 0);
    if (response.ok && length <= NOTIFICATION_ICON_MAX_BYTES) {
      const buffer = Buffer.from(await response.arrayBuffer());
      const image = buffer.length <= NOTIFICATION_ICON_MAX_BYTES ? nativeImage.createFromBuffer(buffer) : null;
      if (image && !image.isEmpty()) icon = image.resize({ width: 128, height: 128, quality: 'good' });
    }
  } catch {}
  if (notificationIconCache.size >= NOTIFICATION_ICON_CACHE_LIMIT) {
    notificationIconCache.delete(notificationIconCache.keys().next().value);
  }
  notificationIconCache.set(iconUrl, icon);
  return icon;
}
let voiceDebugConsoleEnabled = false;
let voiceDebugWindow = null;
let screenshareWizardWindow = null;
const voiceDebugEntries = [];
let voiceDebugLogPath = null;

function getDebugLogsDir() {
  const override = String(process.env.CATREALM_DEBUG_LOG_DIR || '').trim();
  if (override) return override;
  return path.join(app.getPath('userData'), 'logs');
}

function initVoiceDebugLogFile() {
  try {
    const logsDir = getDebugLogsDir();
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    const current = path.join(logsDir, 'voice-debug.log');
    const prev = path.join(logsDir, 'voice-debug-prev.log');
    if (fs.existsSync(current)) {
      try { fs.renameSync(current, prev); } catch {}
    }
    voiceDebugLogPath = current;
    fs.writeFileSync(voiceDebugLogPath, JSON.stringify({
      session: true, at: Date.now(), version: app.getVersion(), platform: process.platform, pid: process.pid,
    }) + '\n', 'utf8');
  } catch {}
}

function writeVoiceDebugEntryToFile(entry) {
  if (!voiceDebugLogPath) return;
  try { fs.appendFileSync(voiceDebugLogPath, JSON.stringify(entry) + '\n', 'utf8'); } catch {}
}

let clientDebugLogPath = null;

function initClientDebugLogFile() {
  try {
    const logsDir = getDebugLogsDir();
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    const current = path.join(logsDir, 'client-debug.log');
    const prev = path.join(logsDir, 'client-debug-prev.log');
    if (fs.existsSync(current)) {
      try { fs.renameSync(current, prev); } catch {}
    }
    clientDebugLogPath = current;
    fs.writeFileSync(clientDebugLogPath, JSON.stringify({
      session: true, at: Date.now(), version: app.getVersion(), platform: process.platform, pid: process.pid,
    }) + '\n', 'utf8');
  } catch {}
}

function writeClientDebugEntryToFile(entry) {
  if (!clientDebugLogPath) return;
  try { fs.appendFileSync(clientDebugLogPath, JSON.stringify(entry) + '\n', 'utf8'); } catch {}
}

function appendClientDebugLog(raw) {
  const entry = (typeof raw === 'object' && raw !== null)
    ? { at: Date.now(), ...raw }
    : { at: Date.now(), message: String(raw) };
  writeClientDebugEntryToFile(entry);
  return { ok: true };
}

const gameActivityService = new GameActivityService();
const loginWindows = new Map(); // Map<string, BrowserWindow> — prevents duplicate popups
const appAudioCaptures = new Map();
const VIDEO_ENCODING_BACKENDS = new Set(['auto', 'd3d11', 'vulkan']);
const DEFAULT_VIDEO_ENCODING_CONFIG = {
  hardwareEncoding: true,
  encoderBackend: 'auto',
};

// Collect native (C++) crash minidumps. The desktopCapturer thumbnail grab can
// fault inside the GPU/capture-card driver below the JS layer, where try/catch and
// 'uncaughtException' never fire. Minidumps land in app.getPath('crashDumps') and are
// the only artifact that survives such a crash. uploadToServer:false keeps them local.
try {
  crashReporter.start({ uploadToServer: false, compress: true });
} catch {}

// Opt-in Chromium stderr logging. WGC/DXGI/D3D errors are usually printed right
// before a capture fault, so this is how we see the cause of the thumbnail crash.
// Enable on the affected machine with CATREALM_CHROMIUM_LOG=1.
if (process.env.CATREALM_CHROMIUM_LOG === '1') {
  try {
    const logsDir = getDebugLogsDir();
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    app.commandLine.appendSwitch('enable-logging');
    app.commandLine.appendSwitch('log-file', path.join(logsDir, 'chromium.log'));
    app.commandLine.appendSwitch('v', '1');
  } catch {}
}

// Background throttling is controlled per renderer at runtime. App.tsx keeps it
// disabled only while voice, calls, or theater media are active; leaving global
// Chromium opt-outs here prevented idle/hidden Sparky windows from ever sleeping.

function getVideoEncodingConfigPath() {
  return path.join(app.getPath('userData'), 'screen-video-encoding.json');
}

function normalizeVideoEncodingConfig(value) {
  const hardwareEncoding = value?.hardwareEncoding !== false;
  const encoderBackend = VIDEO_ENCODING_BACKENDS.has(value?.encoderBackend)
    ? value.encoderBackend
    : DEFAULT_VIDEO_ENCODING_CONFIG.encoderBackend;
  return { hardwareEncoding, encoderBackend };
}

function readVideoEncodingConfig() {
  try {
    const raw = fs.readFileSync(getVideoEncodingConfigPath(), 'utf8');
    const parsed = JSON.parse(raw);
    const normalized = normalizeVideoEncodingConfig(parsed);
    if (Object.prototype.hasOwnProperty.call(parsed || {}, 'captureBackend')) {
      writeVideoEncodingConfig(normalized);
    }
    return normalized;
  } catch {
    return { ...DEFAULT_VIDEO_ENCODING_CONFIG };
  }
}

function writeVideoEncodingConfig(config) {
  const normalized = normalizeVideoEncodingConfig(config);
  fs.mkdirSync(path.dirname(getVideoEncodingConfigPath()), { recursive: true });
  fs.writeFileSync(getVideoEncodingConfigPath(), JSON.stringify(normalized, null, 2), 'utf8');
  return normalized;
}

function powershellExe() {
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  const candidate = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return fs.existsSync(candidate) ? candidate : 'powershell.exe';
}

function encodePowerShell(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function quotePowerShellString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function resolveBundledCatRealmStreamerPath() {
  const unpackedDir = __dirname.includes(`${path.sep}app.asar${path.sep}`)
    ? __dirname.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`)
    : __dirname;
  const candidates = [
    path.join(unpackedDir, 'native', 'gstreamer', 'win-msvc-x64', 'bin', 'CatRealmStreamer.exe'),
    path.join(process.cwd(), 'electron', 'native', 'gstreamer', 'win-msvc-x64', 'bin', 'CatRealmStreamer.exe'),
    path.join(__dirname, '..', 'electron', 'native', 'gstreamer', 'win-msvc-x64', 'bin', 'CatRealmStreamer.exe'),
    path.join(__dirname, 'native', 'gstreamer', 'win-msvc-x64', 'bin', 'CatRealmStreamer.exe'),
  ];
  if (process.resourcesPath) {
    candidates.push(
      path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'native', 'gstreamer', 'win-msvc-x64', 'bin', 'CatRealmStreamer.exe'),
      path.join(process.resourcesPath, 'electron', 'native', 'gstreamer', 'win-msvc-x64', 'bin', 'CatRealmStreamer.exe'),
    );
  }
  return Array.from(new Set(candidates)).find((candidate) => fs.existsSync(candidate)) || null;
}

function sendScreenshareFirewallRuleStatus(event, level, message) {
  if (!event?.sender || event.sender.isDestroyed()) return;
  event.sender.send('screenshare-firewall-rule-status', {
    at: Date.now(),
    level,
    message,
  });
}

function runPowerShell(args, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const child = spawn(powershellExe(), args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const timeout = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      finish({
        status: null,
        stdout,
        stderr,
        error: new Error('Timed out waiting for Windows administrator approval.'),
      });
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      finish({ status: null, stdout, stderr, error });
    });
    child.on('close', (status) => {
      finish({ status, stdout, stderr, error: null });
    });
  });
}

function pollScreenshareFirewallStatus(statusPath, onStatus) {
  let seenLines = 0;
  const flush = () => {
    if (!fs.existsSync(statusPath)) return;
    let content = '';
    try {
      content = fs.readFileSync(statusPath, 'utf8');
    } catch {
      return;
    }
    const lines = content.split(/\r?\n/).filter(Boolean);
    for (const line of lines.slice(seenLines)) {
      const cleaned = line.replace(/^\uFEFF/, '');
      const parts = cleaned.split('\t');
      const message = parts.length > 1 ? parts.slice(1).join('\t') : cleaned;
      if (message.trim()) onStatus(message.trim());
    }
    seenLines = lines.length;
  };
  const timer = setInterval(flush, 250);
  return {
    flush,
    stop: () => clearInterval(timer),
  };
}

async function fixScreenshareFirewallRule(event) {
  if (!isWindows) {
    return { ok: false, reason: 'unsupported', message: 'Stream firewall rules are only available on Windows.' };
  }

  sendScreenshareFirewallRuleStatus(event, 'info', 'Looking for the bundled CatRealmStreamer.exe...');
  const programPath = resolveBundledCatRealmStreamerPath();
  if (!programPath) {
    sendScreenshareFirewallRuleStatus(event, 'error', 'CatRealmStreamer.exe was not found.');
    return {
      ok: false,
      reason: 'missing-streamer',
      message: 'CatRealmStreamer.exe was not found. Rebuild the GStreamer runtime or use a packaged desktop build.',
    };
  }

  const ruleName = 'CatRealm Screenshare Publisher';
  const statusPath = path.join(app.getPath('temp'), `catrealm-firewall-rule-${Date.now()}-${Math.random().toString(36).slice(2)}.log`);
  try {
    fs.writeFileSync(statusPath, '', 'utf8');
  } catch {}

  const innerScript = `
$ErrorActionPreference = 'Stop'
$program = ${quotePowerShellString(programPath)}
$displayName = ${quotePowerShellString(ruleName)}
$statusPath = ${quotePowerShellString(statusPath)}
function Write-CatRealmStatus([string]$Message) {
  Add-Content -LiteralPath $statusPath -Encoding UTF8 -Value ((Get-Date -Format o) + [char]9 + $Message)
}
try {
  Write-CatRealmStatus "Admin PowerShell accepted. Checking streamer path."
  if (-not (Test-Path -LiteralPath $program)) {
    throw "CatRealmStreamer.exe was not found at $program"
  }
  $existingRules = @(Get-NetFirewallRule -DisplayName $displayName -ErrorAction SilentlyContinue)
  if ($existingRules.Count -gt 0) {
    Write-CatRealmStatus "Removing $($existingRules.Count) existing firewall rule(s)."
    $existingRules | Remove-NetFirewallRule
  } else {
    Write-CatRealmStatus "No existing CatRealm stream firewall rule found."
  }
  Write-CatRealmStatus "Adding inbound allow rule for CatRealmStreamer.exe."
  New-NetFirewallRule -DisplayName $displayName -Direction Inbound -Action Allow -Program $program -Profile Private,Public -Enabled True -Description 'Allows CatRealmStreamer.exe to receive WebRTC/WHIP screenshare traffic.' | Out-Null
  Write-CatRealmStatus "Verifying the new firewall rule."
  $createdRule = Get-NetFirewallRule -DisplayName $displayName -ErrorAction Stop | Select-Object -First 1
  if (-not $createdRule -or $createdRule.Enabled -ne 'True') {
    throw "The firewall rule was created but could not be verified."
  }
  Write-CatRealmStatus "Firewall rule is ready."
  exit 0
} catch {
  Write-CatRealmStatus ("Error: " + $_.Exception.Message)
  throw
}
`;
  const encodedInnerScript = encodePowerShell(innerScript);
  const elevatedCommand = `
$ErrorActionPreference = 'Stop'
$statusPath = ${quotePowerShellString(statusPath)}
function Write-CatRealmStatus([string]$Message) {
  Add-Content -LiteralPath $statusPath -Encoding UTF8 -Value ((Get-Date -Format o) + [char]9 + $Message)
}
try {
  Write-CatRealmStatus "Opening Windows administrator approval prompt."
  $process = Start-Process -FilePath ${quotePowerShellString(powershellExe())} -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${encodedInnerScript}')
  Write-CatRealmStatus "Administrator task exited with code $($process.ExitCode)."
  exit $process.ExitCode
} catch {
  Write-CatRealmStatus ("Error: Windows administrator approval was cancelled or failed. " + $_.Exception.Message)
  Write-Error $_
  exit 1
}
`;
  sendScreenshareFirewallRuleStatus(event, 'info', `Found streamer: ${programPath}`);
  const statusPoller = pollScreenshareFirewallStatus(statusPath, (message) => {
    sendScreenshareFirewallRuleStatus(event, message.startsWith('Error:') ? 'error' : 'info', message);
  });
  const result = await runPowerShell([
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    encodePowerShell(elevatedCommand),
  ]);
  statusPoller.flush();
  statusPoller.stop();
  try {
    fs.unlinkSync(statusPath);
  } catch {}

  if (result.error) {
    sendScreenshareFirewallRuleStatus(event, 'error', result.error.message);
    return { ok: false, reason: 'spawn-failed', message: result.error.message };
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    sendScreenshareFirewallRuleStatus(event, 'error', detail || 'Windows did not apply the firewall rule.');
    return {
      ok: false,
      reason: 'failed',
      message: detail || 'Windows did not apply the firewall rule. The UAC prompt may have been cancelled.',
    };
  }
  sendScreenshareFirewallRuleStatus(event, 'success', 'Firewall rule added for CatRealm Screenshare Publisher.');
  return { ok: true, ruleName, programPath };
}

function applyVideoEncodingConfig() {
  const config = readVideoEncodingConfig();
  const enableFeatures = [];
  const disableFeatures = [];

  // Chromium otherwise launches a dedicated ~130 MB Video Capture utility the
  // first time media devices are queried and supervises it if killed. Its
  // supported in-browser mode keeps the same service on a dedicated background
  // thread without the extra Chromium process.
  enableFeatures.push('RunVideoCaptureServiceInBrowserProcess');

  // Core Performance Switches
  // Expose V8's collector so the renderer can reclaim large, short-lived
  // Settings trees during an idle callback instead of retaining them until
  // Chromium eventually observes system memory pressure.
  app.commandLine.appendSwitch('js-flags', '--expose-gc');
  app.commandLine.appendSwitch('video-threads', '8');
  app.commandLine.appendSwitch('enable-zero-copy');
  app.commandLine.appendSwitch('enable-hardware-overlays');
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('enable-native-gpu-memory-buffers');
  app.commandLine.appendSwitch('enable-accelerated-mjpeg-decode');
  app.commandLine.appendSwitch('enable-accelerated-video-decode');

  if (!config.hardwareEncoding) {
    app.commandLine.appendSwitch('disable-accelerated-video-encode');
  } else {
    app.commandLine.appendSwitch('enable-accelerated-video-encode');
    app.commandLine.appendSwitch('enable-gpu-memory-buffer-video-frames');
    app.commandLine.appendSwitch('enable-webrtc-hw-encoding');
    app.commandLine.appendSwitch('enable-webrtc-hw-decoding');
    app.commandLine.appendSwitch('force-high-performance-gpu');

    // NOTE: do NOT enable WebRtcVideoEncoderBuiltinH264 — that forces WebRTC onto
    // Chromium's built-in *software* H.264 encoder (OpenH264), which cannot sustain
    // 1440p60 and pegs the CPU (~45ms/frame) until the renderer stalls and A/V
    // desyncs. With it gone, WebRTC uses the hardware MediaFoundation/NVENC H.264
    // path enabled by enable-accelerated-video-encode + D3D11VideoEncoder below.
    enableFeatures.push('ZeroCopyVideoCapture');
    enableFeatures.push('D3D11VideoDecoder');
    enableFeatures.push('D3D11VideoEncoder');
    enableFeatures.push('GpuVideoEncoding');
    enableFeatures.push('GpuVideoDecoding');
    enableFeatures.push('HardwareVideoEncoder');
    enableFeatures.push('HardwareVideoDecoder');
    enableFeatures.push('MediaFoundationVideoEncoder');
    enableFeatures.push('WebRtc-H264HighProfile');

    if (process.platform === 'win32') {
      enableFeatures.push('PlatformHEVCEncoderSupport');
      const angleBackend = config.encoderBackend === 'auto' ? 'd3d11' : config.encoderBackend;
      if (angleBackend === 'd3d11' || angleBackend === 'vulkan') {
        app.commandLine.appendSwitch('use-angle', angleBackend);
      }
      if (config.encoderBackend === 'vulkan') {
        enableFeatures.push('Vulkan');
      }
    }
  }

  if (process.platform === 'win32') {
    enableFeatures.push('MediaFoundationVideoCapture');
  }

  if (enableFeatures.length > 0) {
    app.commandLine.appendSwitch('enable-features', enableFeatures.join(','));
  }
  if (disableFeatures.length > 0) {
    app.commandLine.appendSwitch('disable-features', disableFeatures.join(','));
  }
  return config;
}

const appliedVideoEncodingConfig = applyVideoEncodingConfig();
let latestGpuDiagnostics = null;
let gpuDiagnosticsPromise = null;

function summarizeVideoEncodeDiagnostics(diagnostics = latestGpuDiagnostics) {
  const featureStatus = diagnostics?.featureStatus ?? null;
  const gpuInfo = diagnostics?.gpuInfo ?? null;
  const chromiumVideoEncode = typeof featureStatus?.video_encode === 'string'
    ? featureStatus.video_encode
    : null;
  const chromiumGpuCompositing = typeof featureStatus?.gpu_compositing === 'string'
    ? featureStatus.gpu_compositing
    : null;
  const rawProfiles = Array.isArray(gpuInfo?.videoEncodeAcceleratorSupportedProfiles)
    ? gpuInfo.videoEncodeAcceleratorSupportedProfiles
    : null;
  const hardwareEncodeProfiles = rawProfiles?.map((profile) => ({
    profile: profile?.profile ?? null,
    minResolutionWidth: profile?.minResolutionWidth ?? null,
    minResolutionHeight: profile?.minResolutionHeight ?? null,
    maxResolutionWidth: profile?.maxResolutionWidth ?? null,
    maxResolutionHeight: profile?.maxResolutionHeight ?? null,
    maxFramerateNumerator: profile?.maxFramerateNumerator ?? null,
    maxFramerateDenominator: profile?.maxFramerateDenominator ?? null,
  })) ?? null;
  const hardwareEncodeAvailable = chromiumVideoEncode === 'enabled'
    && Array.isArray(hardwareEncodeProfiles)
    && hardwareEncodeProfiles.length > 0;
  let reason = null;
  if (!diagnostics) {
    reason = 'pending';
  } else if (featureStatus?.error) {
    reason = 'feature-status-error';
  } else if (gpuInfo?.error) {
    reason = 'gpu-info-error';
  } else if (chromiumVideoEncode && chromiumVideoEncode !== 'enabled') {
    reason = `chromium-video-encode-${chromiumVideoEncode}`;
  } else if (!Array.isArray(hardwareEncodeProfiles) || hardwareEncodeProfiles.length === 0) {
    reason = 'no-video-encode-profiles';
  }

  return {
    hardwareEncodeAvailable,
    chromiumVideoEncode,
    chromiumGpuCompositing,
    hardwareEncodeProfiles,
    reason,
  };
}

async function logGpuDiagnostics() {
  const switches = [
    'use-angle',
    'force-high-performance-gpu',
    'enable-gpu-rasterization',
    'enable-zero-copy',
    'enable-accelerated-video-encode',
    'enable-accelerated-video-decode',
    'enable-gpu-memory-buffer-video-frames',
    'enable-features',
    'disable-features',
  ].reduce((acc, name) => {
    acc[name] = app.commandLine.hasSwitch(name)
      ? (app.commandLine.getSwitchValue(name) || true)
      : false;
    return acc;
  }, {});

  const diagnostics = {
    config: appliedVideoEncodingConfig,
    switches,
    featureStatus: null,
    gpuInfo: null,
  };

  try {
    diagnostics.featureStatus = app.getGPUFeatureStatus();
  } catch (error) {
    diagnostics.featureStatus = { error: error?.message ?? String(error) };
  }

  try {
    const info = await app.getGPUInfo('complete');
    diagnostics.gpuInfo = {
      auxAttributes: info?.auxAttributes ?? null,
      gpuDevice: info?.gpuDevice ?? null,
      videoDecodeAcceleratorCapabilities: info?.videoDecodeAcceleratorCapabilities ?? null,
      videoEncodeAcceleratorSupportedProfiles: info?.videoEncodeAcceleratorSupportedProfiles ?? null,
    };
  } catch (error) {
    diagnostics.gpuInfo = { error: error?.message ?? String(error) };
  }

  latestGpuDiagnostics = diagnostics;
  appendMainProcessVoiceDebug('electron', 'gpu diagnostics', diagnostics);
  writeClientDebugEntryToFile({ at: Date.now(), level: 'info', scope: 'electron', message: 'gpu diagnostics', details: diagnostics });
}

async function ensureGpuDiagnostics() {
  if (latestGpuDiagnostics) return latestGpuDiagnostics;
  if (!gpuDiagnosticsPromise) {
    gpuDiagnosticsPromise = Promise.race([
      logGpuDiagnostics(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('GPU diagnostics timed out.')), 5000);
      }),
    ]).catch((error) => {
      if (!latestGpuDiagnostics) {
        latestGpuDiagnostics = {
          config: appliedVideoEncodingConfig,
          switches: null,
          featureStatus: null,
          gpuInfo: { error: error?.message ?? String(error) },
        };
        writeClientDebugEntryToFile({
          at: Date.now(),
          level: 'warn',
          scope: 'electron',
          message: 'gpu diagnostics unavailable',
          details: latestGpuDiagnostics,
        });
      }
    }).finally(() => {
      gpuDiagnosticsPromise = null;
    });
  }
  await gpuDiagnosticsPromise;
  return latestGpuDiagnostics;
}

process.on('uncaughtException', (err) => {
  const entry = { at: Date.now(), level: 'error', scope: 'main-process', message: 'uncaughtException', details: { message: err?.message, stack: err?.stack } };
  writeVoiceDebugEntryToFile(entry);
  writeClientDebugEntryToFile(entry);
});
process.on('unhandledRejection', (reason) => {
  const entry = { at: Date.now(), level: 'error', scope: 'main-process', message: 'unhandledRejection', details: { reason: String(reason), stack: reason?.stack ?? null } };
  writeVoiceDebugEntryToFile(entry);
  writeClientDebugEntryToFile(entry);
});

app.on('render-process-gone', (_event, webContents, details) => {
  const d = { url: webContents?.getURL?.() ?? null, ...details };
  appendMainProcessVoiceDebug('electron', 'render process gone', d, 'error');
  writeClientDebugEntryToFile({ at: Date.now(), level: 'error', scope: 'electron', message: 'render process gone', details: d });
});
app.on('child-process-gone', (_event, details) => {
  const level = details?.type === 'GPU' ? 'warn' : 'error';
  appendMainProcessVoiceDebug('electron', 'child process gone', details, level);
  writeClientDebugEntryToFile({ at: Date.now(), level, scope: 'electron', message: 'child process gone', details });
});

const EMBED_LOGIN_CONFIG = {
  youtube: {
    loginUrl: 'https://accounts.google.com/signin/v2/identifier?service=youtube',
    title: 'Log in to YouTube',
    cookieChecks: [{ name: 'SID', domain: '.youtube.com' }],
    logoutDomains: ['.youtube.com', '.google.com', '.googleapis.com', '.googlevideo.com', '.gstatic.com'],
    allowedNavDomains: ['google.com', 'accounts.google.com', 'youtube.com', 'gstatic.com', 'googleusercontent.com', 'googleapis.com'],
  },
  x: {
    loginUrl: 'https://x.com/i/flow/login',
    title: 'Log in to X',
    cookieChecks: [{ name: 'auth_token', domain: '.x.com' }],
    logoutDomains: ['.x.com', '.twitter.com', '.twimg.com'],
    allowedNavDomains: ['x.com', 'twitter.com', 'abs.twimg.com', 't.co'],
  },
};
const YOUTUBE_EMBED_REFERRER = 'https://catrealm.app/app';
const YOUTUBE_EMBED_ORIGIN = 'https://catrealm.app';
const THEATER_YOUTUBE_COOKIE_PARTITION = 'persist:catrealm-theater-youtube-cookies';
const THEATER_YOUTUBE_COOKIE_TITLE = 'Authorize YouTube Cookies for Theater';
const THEATER_YOUTUBE_ALLOWED_DOMAINS = [
  'google.com',
  'accounts.google.com',
  'youtube.com',
  'gstatic.com',
  'googleusercontent.com',
  'googleapis.com',
  'googlevideo.com',
  'ytimg.com',
];
const THEATER_YOUTUBE_COOKIE_CHECKS = [
  { name: 'SID', domain: '.youtube.com' },
  { name: 'SAPISID', domain: '.youtube.com' },
];
const THEATER_YOUTUBE_COOKIE_EXPORT_DOMAINS = [
  'youtube.com',
  'google.com',
  'googlevideo.com',
  'googleapis.com',
  'gstatic.com',
  'ytimg.com',
];

function resolveTrayIconPath() {
  const candidates = isWindows
    ? [
        path.join(process.resourcesPath, 'icon.ico'),
        path.join(process.resourcesPath, 'app.asar', 'dist', 'icon.ico'),
        path.join(__dirname, '..', 'dist', 'icon.ico'),
        path.join(__dirname, '..', 'public', 'icon.ico'),
      ]
    : [
        path.join(process.resourcesPath, 'favicon-96x96.png'),
        path.join(process.resourcesPath, 'app.asar', 'dist', 'favicon-96x96.png'),
        path.join(__dirname, '..', 'dist', 'favicon-96x96.png'),
        path.join(__dirname, '..', 'public', 'favicon-96x96.png'),
      ];

  for (const candidate of candidates) {
    try {
      if (candidate && require('fs').existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // Ignore resolution failures and keep checking fallbacks.
    }
  }

  return null;
}

function startupSettingsSupported() {
  return process.platform === 'win32' || process.platform === 'darwin';
}

function getOpenOnStartupSettings() {
  if (!startupSettingsSupported()) {
    return { supported: false, enabled: false };
  }

  try {
    const settings = app.getLoginItemSettings();
    return {
      supported: true,
      enabled: !!settings.openAtLogin,
    };
  } catch (error) {
    console.error('Failed to read startup settings:', error == null ? 'unknown' : error);
    return { supported: true, enabled: false };
  }
}

function setOpenOnStartupEnabled(enabled) {
  if (!startupSettingsSupported()) {
    return { ok: false, supported: false, enabled: false, reason: 'unsupported' };
  }

  try {
    const openAtLogin = !!enabled;
    if (process.platform === 'win32' && !app.isPackaged) {
      app.setLoginItemSettings({
        openAtLogin,
        path: process.execPath,
        args: [app.getAppPath()],
      });
    } else {
      app.setLoginItemSettings({ openAtLogin });
    }

    const current = getOpenOnStartupSettings();
    return {
      ok: true,
      supported: current.supported,
      enabled: current.enabled,
    };
  } catch (error) {
    console.error('Failed to update startup settings:', error == null ? 'unknown' : error);
    const current = getOpenOnStartupSettings();
    return {
      ok: false,
      supported: current.supported,
      enabled: current.enabled,
      reason: 'apply_failed',
      message: error instanceof Error ? error.message : 'Failed to update startup setting',
    };
  }
}

function traySupported() {
  return process.platform === 'win32' || process.platform === 'darwin' || process.platform === 'linux';
}

function getMinimizeToTraySettings() {
  return {
    supported: traySupported(),
    enabled: !!minimizeToTrayEnabled,
  };
}

function showMainWindow() {
  const win = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed()) ?? null;
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.setSkipTaskbar(false);
  win.show();
  win.focus();
}

function dismissDesktopNotifications(target) {
  for (const [id, entry] of activeDesktopNotifications) {
    if (entry.sourceKind !== target.sourceKind || entry.sourceId !== target.sourceId) continue;
    if (target.subsourceId && entry.subsourceId !== target.subsourceId) continue;
    activeDesktopNotifications.delete(id);
    entry.notification.close();
  }
}

handleAppIpc('desktop-notification-show', async (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed() || (win.isVisible() && !win.isMinimized() && win.isFocused())) return { ok: false };
  if (!Notification.isSupported() || !payload || typeof payload !== 'object') return { ok: false };
  if (!['dm', 'server'].includes(payload.sourceKind)
    || typeof payload.id !== 'string' || !payload.id || payload.id.length > 128
    || typeof payload.sourceId !== 'string' || !payload.sourceId || payload.sourceId.length > 2048
    || (payload.subsourceId != null && (typeof payload.subsourceId !== 'string' || payload.subsourceId.length > 128))
    || typeof payload.title !== 'string' || typeof payload.body !== 'string') return { ok: false };
  if (activeDesktopNotifications.has(payload.id)) return { ok: true };
  const icon = await loadNotificationIcon(payload.iconUrl);
  if (win.isDestroyed() || activeDesktopNotifications.has(payload.id)) return { ok: true };
  dismissDesktopNotifications(payload);
  const notification = new Notification({
    title: payload.title.slice(0, 120),
    body: payload.body.slice(0, 300),
    silent: true,
    ...(icon ? { icon } : {}),
  });
  activeDesktopNotifications.set(payload.id, { notification, sourceKind: payload.sourceKind, sourceId: payload.sourceId, subsourceId: payload.subsourceId });
  notification.on('click', () => {
    dismissDesktopNotifications(payload);
    if (win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.setSkipTaskbar(false);
    win.show();
    win.focus();
    win.webContents.send('desktop-notification-click', {
      id: payload.id,
      sourceKind: payload.sourceKind,
      sourceId: payload.sourceId,
      subsourceId: payload.subsourceId,
    });
  });
  notification.on('close', () => activeDesktopNotifications.delete(payload.id));
  notification.show();
  return { ok: true };
});

handleAppIpc('desktop-notification-dismiss', (_event, target) => {
  if (!target || !['dm', 'server'].includes(target.sourceKind) || typeof target.sourceId !== 'string') return { ok: false };
  dismissDesktopNotifications(target);
  return { ok: true };
});

function createTrayIfNeeded() {
  if (!traySupported() || tray) return tray;
  const iconPath = resolveTrayIconPath();
  if (!iconPath) {
    console.error('Failed to resolve tray icon path');
    return null;
  }
  tray = new Tray(iconPath);
  tray.setToolTip('CatRealm');
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: 'Open CatRealm',
      click: () => showMainWindow(),
    },
    {
      label: 'Quit',
      click: () => safeQuitApp(),
    },
  ]));
  tray.on('click', () => {
    showMainWindow();
  });
  return tray;
}

function setMinimizeToTrayEnabled(enabled) {
  minimizeToTrayEnabled = !!enabled;
  if (minimizeToTrayEnabled) {
    createTrayIfNeeded();
  }
  return {
    ok: true,
    supported: traySupported(),
    enabled: minimizeToTrayEnabled,
  };
}

function getHeaderValue(headers, name) {
  const matchKey = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase());
  if (!matchKey) return null;
  return headers[matchKey];
}

function setHeaderValue(headers, name, value) {
  const matchKey = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase());
  headers[matchKey || name] = value;
}

function setupYouTubeEmbedHeaderFallback() {
  const defaultSession = session.defaultSession;
  if (!defaultSession) return;

  defaultSession.webRequest.onBeforeSendHeaders(
    {
      urls: [
        'https://youtube.com/*',
        'https://*.youtube.com/*',
        'https://youtu.be/*',
        'https://youtube-nocookie.com/*',
        'https://*.youtube-nocookie.com/*',
        'https://*.googlevideo.com/*',
        'https://i.ytimg.com/*',
      ],
    },
    (details, callback) => {
      const requestHeaders = { ...(details.requestHeaders || {}) };
      const referer = String(getHeaderValue(requestHeaders, 'Referer') || '').trim().toLowerCase();
      const origin = String(getHeaderValue(requestHeaders, 'Origin') || '').trim().toLowerCase();

      if (!referer || referer.startsWith('file://') || referer.startsWith('app://')) {
        setHeaderValue(requestHeaders, 'Referer', YOUTUBE_EMBED_REFERRER);
      }

      if (
        (/youtube\.com\/embed\//i.test(details.url) || /youtube-nocookie\.com\/embed\//i.test(details.url)) &&
        (!origin || origin === 'null' || origin.startsWith('file://') || origin.startsWith('app://'))
      ) {
        setHeaderValue(requestHeaders, 'Origin', YOUTUBE_EMBED_ORIGIN);
      }

      callback({ requestHeaders });
    }
  );
}

function setupMediaPermissionHandlers() {
  const defaultSession = session.defaultSession;
  if (!defaultSession) return;

  const isAllowedPermission = (permission) => (
    permission === 'media'
    || permission === 'microphone'
    || permission === 'camera'
    || permission === 'display-capture'
    || permission === 'fullscreen'
  );
  const isAllowedRequest = (webContents, permission, details) => {
    if (!isAllowedPermission(permission)) return false;
    // Embedded video players may use fullscreen when the iframe/browser
    // permits it. Media capture remains limited to the application main frame.
    if (permission === 'fullscreen') {
      return appSecurity.isAppContents(webContents) && appSecurity.isAppUrl(webContents.getURL());
    }
    return appSecurity.isMediaRequestAllowed(webContents, details);
  };

  defaultSession.setPermissionCheckHandler((webContents, permission, _requestingOrigin, details) => (
    isAllowedRequest(webContents, permission, details)
  ));

  defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(isAllowedRequest(webContents, permission, details));
  });
}

function getUpdateCheckIntervalMs(channel = updateChannel) {
  return channel === 'latest' ? STABLE_UPDATE_CHECK_INTERVAL_MS : DEV_UPDATE_CHECK_INTERVAL_MS;
}

function startPeriodicUpdateChecks() {
  if (!canAutoUpdate) return;
  if (periodicUpdateCheckTimer) {
    clearInterval(periodicUpdateCheckTimer);
  }
  const intervalMs = getUpdateCheckIntervalMs();
  nextUpdateCheckAt = Date.now() + intervalMs;
  periodicUpdateCheckTimer = setInterval(() => {
    nextUpdateCheckAt = Date.now() + intervalMs;
    checkForUpdatesNow().catch(() => {});
  }, intervalMs);
}

function stopPeriodicUpdateChecks() {
  if (periodicUpdateCheckTimer) {
    clearInterval(periodicUpdateCheckTimer);
    periodicUpdateCheckTimer = null;
  }
  nextUpdateCheckAt = null;
}

function cleanupBeforeQuit() {
  if (periodicUpdateCheckTimer) {
    clearInterval(periodicUpdateCheckTimer);
    periodicUpdateCheckTimer = null;
  }
  stopUpdateStallWatchdog();
  nextUpdateCheckAt = null;
  whipPublisherBridge.stopAll();
  // During Windows shutdown/logoff, never attempt updater-driven install on quit.
  if (canAutoUpdate && isSystemShuttingDown) {
    autoUpdater.autoInstallOnAppQuit = false;
  }
}

function safeQuitApp() {
  cleanupBeforeQuit();
  if (quitRequested) return;
  quitRequested = true;
  app.quit();
}

function applyUpdateChannel(channel) {
  const requestedChannel = String(channel || '').trim().toLowerCase();
  const nextChannel = SAFE_UPDATE_CHANNEL_ID.test(requestedChannel) ? requestedChannel : 'latest';
  updateChannel = nextChannel;

  if (!canAutoUpdate) return nextChannel;

  autoUpdater.channel = nextChannel;
  autoUpdater.allowPrerelease = nextChannel !== 'latest';
  // electron-updater's channel setter enables downgrades. A persisted Dev
  // preference must not roll a manually installed stable release backward.
  // Only the explicit "Downgrade to Stable" action may relax version ordering.
  autoUpdater.allowDowngrade = nextChannel === 'latest' && allowStableDowngradeOverride;
  return nextChannel;
}

function formatQueuedUpdateMessage(kind) {
  if (kind === 'downgrade-stable') {
    return 'Waiting for the next stable desktop build. It will install automatically when found.';
  }
  return 'The next desktop update will install automatically when it finishes downloading.';
}

function emitUpdateStatus(next) {
  updateStatus = queuedUpdateAction && next?.state !== 'queued'
    ? { ...next, queuedAction: queuedUpdateAction }
    : next;
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send('app-update-status', updateStatus);
    }
  });
}

function emitGameActivityState(next) {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send('game-activity-state', next);
    }
  });
}

function normalizeVoiceDebugEntry(raw) {
  const level = raw?.level === 'warn' || raw?.level === 'error' || raw?.level === 'debug' ? raw.level : 'info';
  return {
    at: Number.isFinite(raw?.at) ? Number(raw.at) : Date.now(),
    level,
    scope: String(raw?.scope || 'voice'),
    message: String(raw?.message || ''),
    details: raw?.details ?? null,
  };
}

function voiceDebugConsoleHtml() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>CatRealm Voice Debug Console</title>
  <style>
    :root { color-scheme: dark; font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace; }
    body { margin: 0; background: #111214; color: #dcddde; }
    header { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; background: #1e1f22; border-bottom: 1px solid #313338; }
    h1 { margin: 0; font: 600 13px system-ui, sans-serif; color: #f2f3f5; }
    .controls { display: flex; align-items: center; justify-content: flex-end; gap: 6px; flex-wrap: wrap; }
    button { border: 1px solid #3f4147; border-radius: 4px; background: #2b2d31; color: #f2f3f5; padding: 5px 9px; font: 12px system-ui, sans-serif; cursor: pointer; }
    button:hover { background: #35373c; }
    button:disabled { opacity: 0.55; cursor: default; }
    #copy-status { min-width: 70px; color: #a5d6a7; font: 12px system-ui, sans-serif; text-align: right; }
    #log { padding: 10px 12px 20px; white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.45; }
    .entry { padding: 2px 0; border-bottom: 1px solid rgba(255,255,255,0.04); }
    .time { color: #949ba4; }
    .scope { color: #87ceeb; }
    .warn { color: #f0b232; }
    .error { color: #f23f42; }
    .debug { color: #b5bac1; }
    .details { color: #a5d6a7; }
  </style>
</head>
<body>
  <header>
    <h1>CatRealm Voice Debug Console</h1>
    <div class="controls">
      <span id="copy-status" aria-live="polite"></span>
      <button type="button" data-copy="all" title="Copy all debug lines">Copy</button>
      <button type="button" data-copy="livekit" title="Copy LiveKit lines only">Copy LiveKit</button>
      <button type="button" data-copy="media-core" title="Copy Media Core lines only">Copy Media Core</button>
      <button type="button" data-copy="voice" title="Copy Voice lines only">Copy Voice</button>
      <button type="button" data-copy="issues" title="Copy warning and error lines">Copy Issues</button>
      <button type="button" id="pause" title="Pause rendering new lines">Pause</button>
      <button type="button" id="clear">Clear</button>
    </div>
  </header>
  <main id="log"></main>
  <script>
    const log = document.getElementById('log');
    const copyStatus = document.getElementById('copy-status');
    const pauseButton = document.getElementById('pause');
    const entries = [];
    const pausedEntries = [];
    let paused = false;
    let copyStatusTimer = null;
    document.getElementById('clear').addEventListener('click', () => {
      entries.length = 0;
      pausedEntries.length = 0;
      log.textContent = '';
      updatePauseButton();
      setCopyStatus('');
    });
    function append(entry) {
      entries.push(entry);
      while (entries.length > 1000) entries.shift();
      if (paused) {
        pausedEntries.push(entry);
        updatePauseButton();
        return;
      }
      renderEntry(entry);
    }
    function renderEntry(entry) {
      const row = document.createElement('div');
      row.className = 'entry ' + (entry.level || 'info');
      const time = new Date(entry.at || Date.now()).toLocaleTimeString();
      const details = entry.details == null ? '' : ' ' + JSON.stringify(entry.details);
      row.innerHTML = '<span class="time">[' + time + ']</span> <span class="scope">' + escapeHtml(entry.scope || 'voice') + '</span> ' + escapeHtml(entry.message || '') + (details ? ' <span class="details">' + escapeHtml(details) + '</span>' : '');
      log.appendChild(row);
      while (log.childElementCount > 1000) log.removeChild(log.firstElementChild);
      window.scrollTo(0, document.body.scrollHeight);
    }
    function updatePauseButton() {
      pauseButton.textContent = paused ? (pausedEntries.length > 0 ? 'Resume (' + pausedEntries.length + ')' : 'Resume') : 'Pause';
      pauseButton.title = paused ? 'Resume rendering new lines' : 'Pause rendering new lines';
    }
    pauseButton.addEventListener('click', () => {
      paused = !paused;
      if (!paused) {
        const pending = pausedEntries.splice(0);
        pending.forEach(renderEntry);
      }
      updatePauseButton();
    });
    function formatEntry(entry) {
      const time = new Date(entry.at || Date.now()).toLocaleTimeString();
      const details = entry.details == null ? '' : '  ' + JSON.stringify(entry.details);
      return '[' + time + '] ' + (entry.scope || 'voice') + ' ' + (entry.message || '') + details;
    }
    function getEntriesForMode(mode) {
      if (mode === 'issues') return entries.filter((entry) => entry.level === 'warn' || entry.level === 'error');
      if (mode === 'all') return entries;
      return entries.filter((entry) => entry.scope === mode);
    }
    async function writeClipboard(text) {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      textarea.remove();
      return copied;
    }
    function setCopyStatus(text) {
      copyStatus.textContent = text;
      if (copyStatusTimer) clearTimeout(copyStatusTimer);
      if (text) copyStatusTimer = setTimeout(() => { copyStatus.textContent = ''; }, 1600);
    }
    async function copyMode(mode) {
      const selected = getEntriesForMode(mode);
      if (selected.length === 0) {
        setCopyStatus('No lines');
        return;
      }
      try {
        await writeClipboard(selected.map(formatEntry).join('\\n'));
        setCopyStatus('Copied');
      } catch {
        setCopyStatus('Copy failed');
      }
    }
    document.querySelectorAll('[data-copy]').forEach((button) => {
      button.addEventListener('click', () => copyMode(button.dataset.copy || 'all'));
    });
    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }
    window.__catrealmVoiceDebugAppend = append;
    window.__catrealmVoiceDebugReplay = (replayEntries) => replayEntries.forEach(append);
    updatePauseButton();
  </script>
</body>
</html>`;
}

function sendVoiceDebugEntryToWindow(entry) {
  if (!voiceDebugWindow || voiceDebugWindow.isDestroyed()) return;
  if (voiceDebugWindow.webContents.isLoading()) return;
  const script = `window.__catrealmVoiceDebugAppend && window.__catrealmVoiceDebugAppend(${JSON.stringify(entry)});`;
  voiceDebugWindow.webContents.executeJavaScript(script).catch(() => {});
}

function openVoiceDebugWindow() {
  if (voiceDebugWindow && !voiceDebugWindow.isDestroyed()) {
    voiceDebugWindow.show();
    voiceDebugWindow.focus();
    return;
  }
  voiceDebugWindow = new BrowserWindow({
    width: 900,
    height: 540,
    minWidth: 520,
    minHeight: 320,
    title: 'CatRealm Voice Debug Console',
    backgroundColor: '#111214',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  voiceDebugWindow.on('closed', () => {
    voiceDebugWindow = null;
  });
  voiceDebugWindow.webContents.once('did-finish-load', () => {
    const script = `window.__catrealmVoiceDebugReplay && window.__catrealmVoiceDebugReplay(${JSON.stringify(voiceDebugEntries)});`;
    voiceDebugWindow?.webContents.executeJavaScript(script).catch(() => {});
  });
  voiceDebugWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(voiceDebugConsoleHtml())}`);
}

function setVoiceDebugConsoleEnabled(enabled) {
  voiceDebugConsoleEnabled = !!enabled;
  if (voiceDebugConsoleEnabled) {
    openVoiceDebugWindow();
  } else if (voiceDebugWindow && !voiceDebugWindow.isDestroyed()) {
    voiceDebugWindow.close();
  }
  return { ok: true, enabled: voiceDebugConsoleEnabled };
}

function appendVoiceDebugLog(raw) {
  const entry = normalizeVoiceDebugEntry(raw);
  voiceDebugEntries.push(entry);
  if (voiceDebugEntries.length > 1000) {
    voiceDebugEntries.splice(0, voiceDebugEntries.length - 1000);
  }
  writeVoiceDebugEntryToFile(entry);
  if (voiceDebugConsoleEnabled && voiceDebugWindow && !voiceDebugWindow.isDestroyed()) {
    sendVoiceDebugEntryToWindow(entry);
  }
  return { ok: true };
}

function appendMainProcessVoiceDebug(scope, message, details, level = 'info') {
  appendVoiceDebugLog({
    at: Date.now(),
    level,
    scope,
    message,
    details,
  });
}

function formatUpdaterError(error) {
  const rawMessage = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : 'Failed to check for updates.';

  if (/error code:\s*522/i.test(rawMessage)) {
    return 'The update server was temporarily unreachable (HTTP 522). Please try again in a few minutes.';
  }

  if (/error code:\s*404/i.test(rawMessage)) {
    return 'Update metadata for the selected channel was not found.';
  }

  if (/(ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION)/i.test(rawMessage)) {
    return 'The app could not reach the update server. Check your connection and try again.';
  }

  return 'Failed to check for updates. Please try again later.';
}

function queueUpdateAction(kind) {
  queuedUpdateAction = kind;
  emitUpdateStatus({
    state: 'queued',
    queuedAction: kind,
    message: formatQueuedUpdateMessage(kind),
  });
}

function clearQueuedUpdateAction() {
  queuedUpdateAction = null;
  allowStableDowngradeOverride = false;
  if (canAutoUpdate) {
    applyUpdateChannel(updateChannel);
  }
}

function withUpdateTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

async function checkForUpdatesNow() {
  if (!canAutoUpdate) {
    return { ok: false, reason: 'unsupported', message: 'Desktop updates are only available on packaged Windows builds.' };
  }

  try {
    markUpdateProgress();
    emitUpdateStatus({ state: 'checking' });
    // checkForUpdatesAndNotify resolves once the version check completes; with
    // autoDownload=true the download then proceeds in the background (watched by
    // the stall watchdog). The timeout only guards the check itself.
    const result = await withUpdateTimeout(
      autoUpdater.checkForUpdatesAndNotify(),
      UPDATE_CHECK_TIMEOUT_MS,
      'Update check timed out.',
    );
    activeUpdateCancellationToken = result?.cancellationToken ?? null;
    return { ok: true };
  } catch (error) {
    console.error('Failed to check for updates:', error == null ? 'unknown' : error);
    stopUpdateStallWatchdog();
    const message = formatUpdaterError(error);
    emitUpdateStatus({ state: 'error', message });
    return {
      ok: false,
      reason: 'check_failed',
      message,
    };
  }
}

// Records forward progress so the stall watchdog knows the updater is alive.
function markUpdateProgress(transferredBytes) {
  lastUpdateProgressAt = Date.now();
  if (typeof transferredBytes === 'number') {
    lastUpdateTransferredBytes = transferredBytes;
  }
}

function startUpdateStallWatchdog() {
  markUpdateProgress();
  if (updateStallTimer) return;
  updateStallTimer = setInterval(() => {
    // Only the downloading phase is byte-driven; the check phase is guarded by
    // UPDATE_CHECK_TIMEOUT_MS instead.
    if (!updateStatus || updateStatus.state !== 'downloading') return;
    if (Date.now() - lastUpdateProgressAt < UPDATE_STALL_TIMEOUT_MS) return;
    handleUpdateStall();
  }, UPDATE_STALL_POLL_MS);
  if (typeof updateStallTimer.unref === 'function') updateStallTimer.unref();
}

function stopUpdateStallWatchdog() {
  if (updateStallTimer) {
    clearInterval(updateStallTimer);
    updateStallTimer = null;
  }
}

function handleUpdateStall() {
  if (clearAndRetryInFlight) return;
  // Reset the clock so we don't re-fire while the retry spins back up.
  markUpdateProgress();
  if (updateStallAutoRetries >= UPDATE_STALL_MAX_AUTO_RETRIES) {
    stopUpdateStallWatchdog();
    emitUpdateStatus({
      state: 'error',
      stalled: true,
      canRetry: true,
      message: 'Update download keeps stalling. Check your connection, then Clear & Retry.',
    });
    return;
  }
  updateStallAutoRetries += 1;
  console.warn(
    `Update download stalled for ${Math.round(UPDATE_STALL_TIMEOUT_MS / 1000)}s; clearing and retrying `
    + `(${updateStallAutoRetries}/${UPDATE_STALL_MAX_AUTO_RETRIES}).`,
  );
  emitUpdateStatus({
    state: 'error',
    stalled: true,
    message: `Download stalled — clearing and retrying (${updateStallAutoRetries}/${UPDATE_STALL_MAX_AUTO_RETRIES})…`,
  });
  clearAndRetryUpdate({ auto: true }).catch(() => {});
}

async function clearPendingUpdateDownload() {
  const localAppData = process.env.LOCALAPPDATA
    || (process.env.APPDATA ? path.join(process.env.APPDATA, '..', 'Local') : null)
    || app.getPath('userData');
  const pendingDir = path.join(localAppData, UPDATER_CACHE_DIR_NAME, 'pending');
  // On Windows the stalled temp file can stay briefly locked after cancel; retry.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await fs.promises.rm(pendingDir, { recursive: true, force: true });
      return true;
    } catch (error) {
      if (attempt === 2) {
        console.error('Failed to clear pending update download:', error);
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  return false;
}

async function clearAndRetryUpdate({ auto = false } = {}) {
  if (!canAutoUpdate) {
    return { ok: false, reason: 'unsupported', message: 'Desktop updates are only available on packaged Windows builds.' };
  }
  if (clearAndRetryInFlight) {
    return { ok: false, reason: 'busy', message: 'A retry is already in progress.' };
  }
  clearAndRetryInFlight = true;
  try {
    // A manual retry is a fresh start: refill the auto-retry budget.
    if (!auto) updateStallAutoRetries = 0;
    stopUpdateStallWatchdog();
    // Cancel any in-flight download so its file handle releases before delete.
    try { activeUpdateCancellationToken?.cancel(); } catch { /* no active download */ }
    activeUpdateCancellationToken = null;
    updateDownloaded = false;
    await clearPendingUpdateDownload();
    return await checkForUpdatesNow();
  } finally {
    clearAndRetryInFlight = false;
  }
}

function openUnprivilegedUrl(url) {
  if (!isHttpUrl(url)) return;
  if (!openLinksInApp) {
    shell.openExternal(url).catch(() => {});
    return;
  }
  const child = new BrowserWindow({
    width: 1100,
    height: 750,
    title: new URL(url).hostname,
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  const restrictNavigation = (event, nextUrl) => {
    if (!isHttpUrl(nextUrl)) event.preventDefault();
  };
  child.webContents.on('will-navigate', restrictNavigation);
  child.webContents.on('will-redirect', restrictNavigation);
  child.webContents.setWindowOpenHandler(({ url: nextUrl }) => {
    if (isHttpUrl(nextUrl)) shell.openExternal(nextUrl).catch(() => {});
    return { action: 'deny' };
  });
  child.loadURL(url);
}

// Electron has no popup blocker, so a sandboxed ad frame with allow-popups can
// window.open() on load and we would hand that URL to the browser. While the
// renderer reports a mounted ad frame, a popup is honoured only right after a
// real mouse press that happened after the ad appeared — an ad (or link) click.
const AD_POPUP_GESTURE_MS = 1000;
const adPopupGuards = new WeakMap();

function getAdPopupGuard(webContents) {
  let guard = adPopupGuards.get(webContents);
  if (!guard) {
    guard = { adFrames: 0, adsSince: 0, lastMouseDown: 0 };
    adPopupGuards.set(webContents, guard);
  }
  return guard;
}

function isPopupAllowedByAdGuard(webContents) {
  const guard = adPopupGuards.get(webContents);
  if (!guard || guard.adFrames === 0) return true;
  return guard.lastMouseDown > guard.adsSince && Date.now() - guard.lastMouseDown < AD_POPUP_GESTURE_MS;
}

handleAppIpc('ad-frame-mounted', (event, mounted) => {
  const guard = getAdPopupGuard(event.sender);
  if (mounted === true) {
    guard.adFrames += 1;
    guard.adsSince = Date.now();
  } else {
    guard.adFrames = Math.max(0, guard.adFrames - 1);
  }
  return { ok: true };
});

handleAppIpc('open-protected-link', (_event, url) => {
  if (!isHttpUrl(url)) return { ok: false, reason: 'invalid_url' };
  openUnprivilegedUrl(url);
  return { ok: true };
});

function secureAppWindow(win) {
  appSecurity.register(win.webContents);
  // External URLs never open straight from here: the UI runs them through the
  // user's domain allowlist (Content & Social) first, so window.open from an ad
  // or any other frame can't skip it. Allowed ones come back via open-protected-link.
  const requestProtectedOpen = (url) => {
    if (isHttpUrl(url) && !win.webContents.isDestroyed()) win.webContents.send('protected-link-request', url);
  };
  const restrictNavigation = (event, url) => {
    if (appSecurity.isAppUrl(url)) return;
    event.preventDefault();
    requestProtectedOpen(url);
  };
  win.webContents.on('will-navigate', restrictNavigation);
  win.webContents.on('will-redirect', restrictNavigation);
  win.webContents.on('input-event', (_event, input) => {
    if (input.type === 'mouseDown') getAdPopupGuard(win.webContents).lastMouseDown = Date.now();
  });
  // A reload drops every ad frame without their unmount reports.
  win.webContents.on('did-navigate', () => { getAdPopupGuard(win.webContents).adFrames = 0; });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isPopupAllowedByAdGuard(win.webContents)) requestProtectedOpen(url);
    return { action: 'deny' };
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    title: 'CatRealm',
    backgroundColor: '#1e1f22',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
      // Keep message sockets and desktop alerts responsive while minimized or in the tray.
      backgroundThrottling: false,
    },
  });

  secureAppWindow(win);

  if (isDev) {
    win.loadURL('http://localhost:5173');
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // Enable zoom shortcuts (Ctrl/Cmd +, -, 0)
  win.webContents.setVisualZoomLevelLimits(1, 3).catch(() => {});
  win.webContents.on('before-input-event', (event, input) => {
    const isZoomKey =
      (input.control || input.meta) &&
      (input.key === '+' || input.key === '=' || input.key === '-' || input.key === '0');
    if (!isZoomKey) return;
    event.preventDefault();
    const current = win.webContents.getZoomFactor();
    if (input.key === '0') {
      win.webContents.setZoomFactor(1);
      return;
    }
    const delta = input.key === '-' ? -0.1 : 0.1;
    const next = Math.min(2, Math.max(0.5, Number((current + delta).toFixed(2))));
    win.webContents.setZoomFactor(next);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    appendMainProcessVoiceDebug('electron', 'render process gone', details, 'error');
  });
  win.webContents.on('unresponsive', () => {
    appendMainProcessVoiceDebug('electron', 'main window unresponsive', null, 'warn');
  });

  win.on('close', (event) => {
    if (quitRequested || isSystemShuttingDown || !minimizeToTrayEnabled) return;
    event.preventDefault();
    createTrayIfNeeded();
    win.setSkipTaskbar(true);
    win.hide();
  });

  win.on('show', () => {
    win.setSkipTaskbar(false);
  });

  win.webContents.once('did-finish-load', () => {
    emitGameActivityState(gameActivityService.getState());
    // Warm the native-WHIP capability cache so the first Settings → Voice / share
    // reads a ready cache and never triggers the blocking spawnSync probe.
    // warmSupport() probes via async spawn, so it never blocks the main process
    // (Windows only; no-ops elsewhere). GPU diagnostics warmed alongside so the
    // encoder status line is ready too.
    setTimeout(() => {
      void whipPublisherBridge.warmSupport();
      void listScreenShareGpus().catch(() => {});
      void ensureGpuDiagnostics().catch(() => {});
    }, 4000);
  });

  win.on('enter-full-screen', () => win.webContents.send('window-fullscreen-changed', true));
  win.on('leave-full-screen', () => win.webContents.send('window-fullscreen-changed', false));
}

function createScreenshareWizardWindow(parentWindow) {
  if (screenshareWizardWindow && !screenshareWizardWindow.isDestroyed()) {
    screenshareWizardWindow.focus();
    return screenshareWizardWindow;
  }

  const win = new BrowserWindow({
    width: 1120,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    title: 'CatRealm - Screenshare Setup',
    backgroundColor: '#1e1f22',
    autoHideMenuBar: true,
    parent: parentWindow && !parentWindow.isDestroyed() ? parentWindow : undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
      backgroundThrottling: false,
    },
  });

  secureAppWindow(win);
  screenshareWizardWindow = win;
  win.on('closed', () => {
    if (screenshareWizardWindow === win) screenshareWizardWindow = null;
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    appendMainProcessVoiceDebug('electron', 'screenshare wizard render process gone', details, 'error');
  });
  win.webContents.on('unresponsive', () => {
    appendMainProcessVoiceDebug('electron', 'screenshare wizard window unresponsive', null, 'warn');
  });

  if (isDev) {
    win.loadURL('http://localhost:5173/?standalone=screenshare-wizard');
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), {
      hash: '/?standalone=screenshare-wizard',
    });
  }

  return win;
}

function setupAutoUpdater() {
  applyUpdateChannel(updateChannel);
  autoUpdater.autoDownload = true;
  // We only install updates via explicit "Restart to update" action.
  // This avoids native shutdown-time crashes on Windows when the OS is ending session.
  autoUpdater.autoInstallOnAppQuit = false;
  // The generic feed's differential (blockmap) download has been stalling at
  // 0 bytes on flaky networks; full-file downloads are more reliable here.
  autoUpdater.disableDifferentialDownload = true;

  autoUpdater.on('error', (error) => {
    console.error('Auto updater error:', error == null ? 'unknown' : error);
    stopUpdateStallWatchdog();
    emitUpdateStatus({
      state: 'error',
      message: formatUpdaterError(error),
    });
  });

  autoUpdater.on('update-available', (info) => {
    if (updateDownloaded && info?.version === updateStatus.version) {
      return;
    }
    updateDownloaded = false;
    // Stop polling — we found something; no need to keep hammering the update server
    stopPeriodicUpdateChecks();
    // A fresh download is starting: reset the byte baseline and arm the watchdog.
    lastUpdateTransferredBytes = -1;
    startUpdateStallWatchdog();
    emitUpdateStatus({
      state: 'downloading',
      version: info?.version ?? null,
      percent: 0,
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    const transferred = typeof progress?.transferred === 'number' ? progress.transferred : null;
    // Only reset the stall clock when bytes actually advance.
    if (transferred === null) {
      markUpdateProgress();
    } else if (transferred > lastUpdateTransferredBytes) {
      markUpdateProgress(transferred);
    }
    emitUpdateStatus({
      state: 'downloading',
      version: updateStatus.version ?? null,
      percent: Math.max(0, Math.min(100, Math.round(progress?.percent ?? 0))),
    });
  });

  autoUpdater.on('update-not-available', () => {
    stopUpdateStallWatchdog();
    updateStallAutoRetries = 0;
    if (updateDownloaded) {
      // A newer update wasn't found, but the already-downloaded one is still ready — keep that state
      emitUpdateStatus(updateStatus);
    } else if (queuedUpdateAction) {
      emitUpdateStatus({
        state: 'not-available',
        message: formatQueuedUpdateMessage(queuedUpdateAction),
      });
    } else {
      emitUpdateStatus({ state: 'not-available' });
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    stopUpdateStallWatchdog();
    updateStallAutoRetries = 0;
    activeUpdateCancellationToken = null;
    updateDownloaded = true;
    const queuedActionAtDownload = queuedUpdateAction;
    emitUpdateStatus({
      state: 'downloaded',
      version: info?.version ?? null,
    });
    if (queuedActionAtDownload) {
      clearQueuedUpdateAction();
      setTimeout(() => {
        autoUpdater.quitAndInstall();
      }, 900);
    }
  });

  setTimeout(() => {
    checkForUpdatesNow().catch(() => {});
  }, 3000);
  startPeriodicUpdateChecks();
}

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      return;
    }
    showMainWindow();
  });

  app.whenReady().then(() => {
    initVoiceDebugLogFile();
    initClientDebugLogFile();
    appendClientDebugLog({
      level: 'info',
      scope: 'capture-debug',
      message: 'startup',
      details: {
        captureTestDebug: process.env.CATREALM_CAPTURE_TEST_DEBUG === '1',
        chromiumLog: process.env.CATREALM_CHROMIUM_LOG === '1',
        nativeWhipDebug: process.env.CATREALM_NATIVE_WHIP_DEBUG === '1',
        debugLogsDir: getDebugLogsDir(),
        isDev,
        userData: app.getPath('userData'),
        pid: process.pid,
      },
    });
    setupYouTubeEmbedHeaderFallback();
    setupMediaPermissionHandlers();
    gameActivityService.on('state', emitGameActivityState);
    createWindow();
    setTimeout(() => { logGpuDiagnostics().catch(() => {}); }, 1500);
    if (canAutoUpdate) {
      setupAutoUpdater();
    }
    if (isWindows) {
      powerMonitor.on('shutdown', () => {
        isSystemShuttingDown = true;
        cleanupBeforeQuit();
      });
      powerMonitor.on('session-end', () => {
        isSystemShuttingDown = true;
        cleanupBeforeQuit();
      });
    }
  });
}

// Grab WINDOW thumbnails out-of-process. Spawns this same binary in helper mode (see the
// CATREALM_THUMB_HELPER branch at the top of the file) so a WGC hardcrash kills only the
// child. Returns [{ id, thumbnail }] or null on crash/timeout/failure. Short-cached and
// single-flighted so re-opening the picker doesn't re-spawn repeatedly.
let thumbHelperInFlight = null;
let thumbHelperCache = { at: 0, value: null };
const THUMB_HELPER_TTL_MS = 4000;

function captureWindowThumbnailsViaHelper(px = 150, timeoutMs = 8000) {
  const now = Date.now();
  if (thumbHelperCache.value && (now - thumbHelperCache.at) < THUMB_HELPER_TTL_MS) {
    return Promise.resolve(thumbHelperCache.value);
  }
  if (thumbHelperInFlight) return thumbHelperInFlight;

  thumbHelperInFlight = new Promise((resolve) => {
    let outPath;
    try {
      outPath = path.join(app.getPath('temp'), `catrealm-thumbs-${process.pid}-${Date.now()}.json`);
    } catch {
      resolve(null);
      return;
    }
    const helperDataDir = path.join(app.getPath('userData'), 'thumb-helper');
    let settled = false;
    let timer = null;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { fs.unlinkSync(outPath); } catch {}
      if (val != null) thumbHelperCache = { at: Date.now(), value: val };
      resolve(val);
    };

    let child;
    try {
      const args = [];
      if (!app.isPackaged) args.push(app.getAppPath());
      args.push(`--user-data-dir=${helperDataDir}`);
      child = spawn(process.execPath, args, {
        env: {
          ...process.env,
          CATREALM_THUMB_HELPER: '1',
          CATREALM_THUMB_OUT: outPath,
          CATREALM_THUMB_HELPER_PX: String(px),
          CATREALM_CHROMIUM_LOG: '0',
        },
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch (err) {
      appendMainProcessVoiceDebug('electron', 'thumb-helper: spawn failed', { message: err?.message }, 'warn');
      finish(null);
      return;
    }

    timer = setTimeout(() => {
      appendMainProcessVoiceDebug('electron', 'thumb-helper: timeout, killing', { timeoutMs }, 'warn');
      try { child.kill(); } catch {}
      finish(null);
    }, timeoutMs);

    child.on('error', (err) => {
      appendMainProcessVoiceDebug('electron', 'thumb-helper: child error', { message: err?.message }, 'warn');
      finish(null);
    });
    child.on('exit', (code, signal) => {
      if (code !== 0 || signal) {
        appendMainProcessVoiceDebug('electron', 'thumb-helper: abnormal exit (WGC crash?)', { code, signal }, 'warn');
        finish(null);
        return;
      }
      try {
        const parsed = JSON.parse(fs.readFileSync(outPath, 'utf8'));
        const value = Array.isArray(parsed) ? parsed : null;
        appendMainProcessVoiceDebug('electron', 'thumb-helper: ok', { count: value ? value.length : 0 });
        finish(value);
      } catch (err) {
        appendMainProcessVoiceDebug('electron', 'thumb-helper: read failed', { message: err?.message }, 'warn');
        finish(null);
      }
    });
  }).finally(() => {
    thumbHelperInFlight = null;
  });

  return thumbHelperInFlight;
}

handleAppIpc('desktop-sources', async (_event, opts) => {
  const types = opts?.types ?? ['screen', 'window'];
  const includeWindowThumbnails = opts?.includeWindowThumbnails === true;
  const sources = [];

  // Thumbnail capture is split by source type because the two use different native
  // backends. SCREEN capture uses DirectX (DXGI) + GDI fallback — confirmed safe at 150
  // even on the Elgato 4K60 Pro Mk.2 repro machine. WINDOW capture falls back to Windows
  // Graphics Capture (WGC), compiled in via RTC_ENABLE_WIN_WGC (set_allow_wgc_capturer_fallback)
  // and NOT runtime-gateable; on some capture-card drivers its StartCapture fails with
  // E_INVALIDARG and hardcrashes the process below JS. So screens default ON (150) and windows
  // default OFF (0) until per-source isolation (a separate thumbnail helper process) lands.
  // CATREALM_THUMB_SIZE overrides both; CATREALM_THUMB_SCREEN / CATREALM_THUMB_WINDOW override per pass.
  // The (before)/(after) breadcrumbs flush synchronously, so a fault leaves the log ending
  // on a "(before)" line, pinpointing which pass crashed.
  const parseThumb = (raw) => {
    const n = Number.parseInt(raw ?? '', 10);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 320) : 0;
  };
  const baseThumb = parseThumb(process.env.CATREALM_THUMB_SIZE);
  const sizeFor = (perPass, dflt) => {
    if (perPass != null) return parseThumb(perPass);
    if (process.env.CATREALM_THUMB_SIZE != null) return baseThumb;
    return dflt;
  };
  const screenThumb = sizeFor(process.env.CATREALM_THUMB_SCREEN, 150);
  const windowThumb = sizeFor(process.env.CATREALM_THUMB_WINDOW, 0);

  if (types.includes('screen')) {
    try {
      appendMainProcessVoiceDebug('electron', 'desktop-sources: grab screens (before)', { thumbPx: screenThumb });
      const screens = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: screenThumb, height: screenThumb },
        fetchWindowIcons: false,
      });
      appendMainProcessVoiceDebug('electron', 'desktop-sources: grab screens (after)', { count: screens.length });
      sources.push(...screens);
    } catch (err) {
      appendMainProcessVoiceDebug('electron', 'desktop-sources: screens failed', { message: err?.message }, 'error');
    }
  }

  if (types.includes('window')) {
    try {
      appendMainProcessVoiceDebug('electron', 'desktop-sources: grab windows (before)', { thumbPx: windowThumb });
      const windows = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: windowThumb, height: windowThumb },
        fetchWindowIcons: false,
      });
      appendMainProcessVoiceDebug('electron', 'desktop-sources: grab windows (after)', { count: windows.length });
      sources.push(...windows);
    } catch (err) {
      appendMainProcessVoiceDebug('electron', 'desktop-sources: windows failed', { message: err?.message }, 'error');
    }
  }

  // Window thumbnails: captured out-of-process so a WGC crash can't kill us. Windows were
  // enumerated above at windowThumb (0 by default → no in-process grab), so their thumbnails
  // are null here; the helper fills them in by id. If the helper crashes/times out we keep null.
  let windowThumbs = null;
  if (includeWindowThumbnails && types.includes('window')) {
    const helperResult = await captureWindowThumbnailsViaHelper(150).catch(() => null);
    if (Array.isArray(helperResult)) {
      windowThumbs = new Map(helperResult.filter((r) => r && r.id).map((r) => [r.id, r.thumbnail ?? null]));
    }
  }

  appendMainProcessVoiceDebug('electron', 'desktop-sources: getSources ok', {
    count: sources.length, screenThumb, windowThumb, windowThumbs: windowThumbs ? windowThumbs.size : null,
  });
  return sources.map((s) => {
    let thumbnail = s.thumbnail && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : null;
    if (!thumbnail && windowThumbs && windowThumbs.has(s.id)) {
      thumbnail = windowThumbs.get(s.id);
    }
    return { id: s.id, name: s.name, thumbnail, appIcon: null };
  });
});

handleAppIpc('desktop-audio-capture-support', async () => {
  const appAudio = windowsAppAudioBridge.getCapabilities();
  return {
    platform: process.platform,
    appAudio,
    systemAudio: {
      available: isWindows,
      reason: isWindows ? undefined : 'Desktop loopback audio support depends on the operating system and Chromium capture backend.',
    },
  };
});

handleAppIpc('native-whip-publisher-support', async (_event, opts = {}) => (
  whipPublisherBridge.getSupportAsync({ forceRefresh: opts?.forceRefresh === true })
));

// --- GPU chooser for native screen-share encoding ------------------------------
// Enumerate the physical display adapters and pair each with the H.264 encoder
// that targets its vendor (NVIDIA->nvh264enc, AMD->amfh264enc, else->mfh264enc),
// keeping only GPUs whose encoder actually registers in the bundled runtime.
handleAppIpc('list-screenshare-gpus', async () => listScreenShareGpus());

handleAppIpc('native-whip-publisher-start', async (event, opts = {}) => (
  whipPublisherBridge.start(opts, event.sender)
));

handleAppIpc('native-whip-publisher-stop', async (_event, publisherId) => (
  whipPublisherBridge.stop(typeof publisherId === 'string' ? publisherId : undefined)
));


function parseDesktopSourceWindowId(sourceId) {
  if (typeof sourceId !== 'string' || !sourceId.startsWith('window:')) return null;
  const raw = sourceId.split(':')[1];
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : null;
}

handleAppIpc('app-audio-capture-start', async (event, opts = {}) => {
  const helperPath = windowsAppAudioBridge.getHelperPath();
  if (!helperPath) {
    return { ok: false, reason: 'unavailable', message: 'Windows app audio capture helper is not available.' };
  }
  const hwnd = parseDesktopSourceWindowId(opts.sourceId);
  if (!hwnd && !opts.processId) {
    return { ok: false, reason: 'bad-source', message: 'Selected app source did not include a capturable window id.' };
  }

  const captureId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const sampleRate = 48000;
  const channels = 2;
  const args = [
    '--format', 'f32le',
    '--sample-rate', String(sampleRate),
    '--channels', String(channels),
    '--include-child-processes',
  ];
  if (opts.processId) {
    args.push('--pid', String(Math.trunc(Number(opts.processId))));
  } else {
    args.push('--hwnd', String(hwnd));
  }

  const child = spawn(helperPath, args, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const sender = event.sender;
  appAudioCaptures.set(captureId, child);
  sender.send('app-audio-capture-status', {
    captureId,
    message: `info: spawn helper=${helperPath} sourceId=${opts.sourceId ?? null} hwnd=${hwnd ?? null} processId=${opts.processId ?? null} args=${args.join(' ')}`,
  });

  child.stdout.on('data', (chunk) => {
    if (sender.isDestroyed()) return;
    sender.send('app-audio-capture-data', {
      captureId,
      chunk: chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength),
    });
  });
  child.stderr.on('data', (chunk) => {
    if (sender.isDestroyed()) return;
    sender.send('app-audio-capture-status', {
      captureId,
      message: chunk.toString('utf8'),
    });
  });
  child.on('exit', (code, signal) => {
    appAudioCaptures.delete(captureId);
    if (sender.isDestroyed()) return;
    sender.send('app-audio-capture-stopped', {
      captureId,
      code,
      signal,
    });
  });
  child.on('error', (error) => {
    appAudioCaptures.delete(captureId);
    if (sender.isDestroyed()) return;
    sender.send('app-audio-capture-stopped', {
      captureId,
      code: null,
      signal: null,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  return { ok: true, captureId, sampleRate, channels };
});

handleAppIpc('app-audio-capture-stop', async (_event, captureId) => {
  const child = appAudioCaptures.get(captureId);
  if (!child) return { ok: true };
  appAudioCaptures.delete(captureId);
  try {
    child.kill();
  } catch {
    // Already stopped.
  }
  return { ok: true };
});

handleAppIpc('get-app-version', async () => ({ version: app.getVersion() }));
handleAppIpc('open-screenshare-wizard', async (event) => {
  const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined;
  createScreenshareWizardWindow(parent);
  return { ok: true };
});
handleAppIpc('app-relaunch', async () => {
  // Used by the GPU Encoding restart-&-reconnect flow. Defer so the invoke
  // response reaches the renderer before the process exits.
  setImmediate(() => {
    app.relaunch();
    app.exit(0);
  });
  return { ok: true };
});
handleAppIpc('check-for-updates', async () => checkForUpdatesNow());
handleAppIpc('set-update-channel', async (_event, channel) => {
  const previousChannel = updateChannel;
  if (channel !== 'latest') {
    allowStableDowngradeOverride = false;
    if (queuedUpdateAction === 'downgrade-stable') {
      queuedUpdateAction = null;
    }
  }
  const nextChannel = applyUpdateChannel(channel);
  if (nextChannel !== previousChannel) {
    updateDownloaded = false;
    updateStallAutoRetries = 0;
    stopUpdateStallWatchdog();
    emitUpdateStatus({ state: 'idle' });
    startPeriodicUpdateChecks();
    checkForUpdatesNow().catch(() => {});
  }
  return { ok: true, channel: nextChannel };
});
handleAppIpc('get-update-channel', async () => ({ channel: updateChannel }));
handleAppIpc('get-update-status', async () => {
  if (!canAutoUpdate) {
    return { state: 'unsupported' };
  }
  return updateStatus;
});
handleAppIpc('get-next-update-check-at', async () => ({
  nextCheckAt: canAutoUpdate ? nextUpdateCheckAt : null,
}));
handleAppIpc('set-voice-debug-console-enabled', async (_event, enabled) => setVoiceDebugConsoleEnabled(enabled));
handleAppIpc('voice-debug-log', async (_event, entry) => appendVoiceDebugLog(entry));
handleAppIpc('client-debug-log', async (_event, entry) => appendClientDebugLog(entry));
handleAppIpc('get-debug-log-paths', async () => {
  let crashDumps = null;
  try { crashDumps = app.getPath('crashDumps'); } catch {}
  return {
    voiceDebug: voiceDebugLogPath,
    clientDebug: clientDebugLogPath,
    logsDir: getDebugLogsDir(),
    crashDumps,
  };
});

// Per-process memory/CPU breakdown. workingSetSize is reported in KB; convert to MB.
handleAppIpc('get-app-metrics', async () => {
  let rows = [];
  try {
    const windowNameByPid = new Map(
      BrowserWindow.getAllWindows()
        .filter((window) => !window.isDestroyed() && !window.webContents.isDestroyed())
        .map((window) => [window.webContents.getOSProcessId(), window.getTitle()])
    );
    rows = app.getAppMetrics().map((m) => ({
      pid: m.pid,
      type: m.type,
      name: windowNameByPid.get(m.pid) || m.name || m.serviceName || null,
      memMB: Math.round(((m.memory?.workingSetSize ?? 0) / 1024) * 10) / 10,
      privateMB: Math.round(((m.memory?.privateBytes ?? 0) / 1024) * 10) / 10,
      cpu: Math.round((m.cpu?.percentCPUUsage ?? 0) * 10) / 10,
    })).sort((a, b) => b.memMB - a.memMB);
  } catch (err) {
    appendMainProcessVoiceDebug('electron', 'get-app-metrics failed', { message: err?.message }, 'warn');
  }
  const totalMB = Math.round(rows.reduce((sum, r) => sum + r.memMB, 0) * 10) / 10;
  const privateTotalMB = Math.round(rows.reduce((sum, r) => sum + r.privateMB, 0) * 10) / 10;
  const summary = { at: Date.now(), count: rows.length, totalMB, privateTotalMB, rows };
  writeClientDebugEntryToFile({ at: summary.at, level: 'info', scope: 'metrics', message: 'app metrics', details: summary });
  return summary;
});

handleAppIpc('set-background-media-active', async (event, _active) => {
  if (!event.sender.isDestroyed()) {
    // Chat delivery must remain active even without a live voice session.
    event.sender.setBackgroundThrottling(false);
  }
  return { ok: true };
});
handleAppIpc('get-open-on-startup', async () => getOpenOnStartupSettings());
handleAppIpc('set-open-on-startup', async (_event, enabled) => setOpenOnStartupEnabled(enabled));
handleAppIpc('get-minimize-to-tray', async () => getMinimizeToTraySettings());
handleAppIpc('set-minimize-to-tray', async (_event, enabled) => setMinimizeToTrayEnabled(enabled));
handleAppIpc('fix-screenshare-firewall-rule', async (event) => fixScreenshareFirewallRule(event));
handleAppIpc('get-open-links-in-app', async () => ({ enabled: openLinksInApp }));
handleAppIpc('set-open-links-in-app', async (_event, enabled) => {
  openLinksInApp = !!enabled;
  return { ok: true, enabled: openLinksInApp };
});
handleAppIpc('get-screen-share-video-encoding', async () => {
  await ensureGpuDiagnostics();
  const saved = readVideoEncodingConfig();
  return {
    ...saved,
    applied: appliedVideoEncodingConfig,
    diagnostics: summarizeVideoEncodeDiagnostics(),
    requiresRestart: (
      saved.hardwareEncoding !== appliedVideoEncodingConfig.hardwareEncoding ||
      saved.encoderBackend !== appliedVideoEncodingConfig.encoderBackend
    ),
  };
});
handleAppIpc('set-screen-share-video-encoding', async (_event, config) => {
  const saved = writeVideoEncodingConfig(config);
  await ensureGpuDiagnostics();
  return {
    ok: true,
    ...saved,
    applied: appliedVideoEncodingConfig,
    diagnostics: summarizeVideoEncodeDiagnostics(),
    requiresRestart: (
      saved.hardwareEncoding !== appliedVideoEncodingConfig.hardwareEncoding ||
      saved.encoderBackend !== appliedVideoEncodingConfig.encoderBackend
    ),
  };
});
handleAppIpc('get-game-activity-state', async () => gameActivityService.getState());
handleAppIpc('set-game-activity-enabled', async (_event, enabled) => gameActivityService.setEnabled(enabled));
handleAppIpc('invalidate-game-activity-catalog', async () => {
  gameActivityService.invalidateCatalog();
  const state = await gameActivityService.refreshNow().catch(() => gameActivityService.getState());
  return { ok: true, state };
});
handleAppIpc('quit-app', async () => {
  safeQuitApp();
  return { ok: true };
});
handleAppIpc('install-update', async () => {
  if (!canAutoUpdate) {
    return { ok: false, reason: 'unsupported', message: 'Desktop updates are only available on packaged Windows builds.' };
  }

  // Before installing, always check if there is an even newer update available.
  // This prevents the "update chain" annoyance where a user updates to 1.0.1
  // only to find 1.0.2 was already available while they were looking at the banner.
  try {
    const previousStatus = { ...updateStatus };
    emitUpdateStatus({ ...updateStatus, state: 'checking' });
    const result = await autoUpdater.checkForUpdates();
    if (result && result.updateInfo.version !== updateStatus.version) {
      // A newer version was found on the server than what we currently have ready.
      // autoUpdater will start downloading it automatically (autoDownload=true).
      return {
        ok: false,
        reason: 'newer_available',
        message: `A newer version (${result.updateInfo.version}) was found and is being downloaded.`,
      };
    }
    // No newer update found, restore the previous status (which was 'downloaded')
    emitUpdateStatus(previousStatus);
  } catch (err) {
    // If the check fails, we might be offline. Proceed with what we have if possible.
    console.error('Pre-install update check failed:', err);
  }

  if (!updateDownloaded) {
    return { ok: false, reason: 'not_ready', message: 'Update is still downloading or unavailable.' };
  }
  clearQueuedUpdateAction();
  setImmediate(() => {
    autoUpdater.quitAndInstall();
  });
  return { ok: true };
});

handleAppIpc('queue-next-update-install', async () => {
  if (!canAutoUpdate) {
    return { ok: false, reason: 'unsupported', message: 'Desktop updates are only available on packaged Windows builds.' };
  }
  if (updateDownloaded) {
    try {
      const previousStatus = { ...updateStatus };
      emitUpdateStatus({ ...updateStatus, state: 'checking' });
      const result = await autoUpdater.checkForUpdates();
      if (result && result.updateInfo.version !== updateStatus.version) {
        return {
          ok: false,
          reason: 'newer_available',
          message: `A newer version (${result.updateInfo.version}) was found and is being downloaded.`,
        };
      }
      emitUpdateStatus(previousStatus);
    } catch (err) {
      console.error('Pre-install queue check failed:', err);
    }

    clearQueuedUpdateAction();
    setImmediate(() => {
      autoUpdater.quitAndInstall();
    });
    return { ok: true };
  }
  allowStableDowngradeOverride = false;
  queueUpdateAction('force-next');
  checkForUpdatesNow().catch(() => {});
  return { ok: true };
});

handleAppIpc('downgrade-client', async () => {
  if (!canAutoUpdate) {
    return { ok: false, reason: 'unsupported', message: 'Desktop updates are only available on packaged Windows builds.' };
  }
  updateDownloaded = false;
  allowStableDowngradeOverride = true;
  applyUpdateChannel('latest');
  queueUpdateAction('downgrade-stable');
  checkForUpdatesNow().catch(() => {});
  return { ok: true };
});

handleAppIpc('clear-and-retry-update', async () => clearAndRetryUpdate({ auto: false }));

handleAppIpc('set-window-fullscreen', (_event, fullscreen) => {
  const win = BrowserWindow.fromWebContents(_event.sender);
  if (win) win.setFullScreen(!!fullscreen);
});

handleAppIpc('get-window-fullscreen', (_event) => {
  const win = BrowserWindow.fromWebContents(_event.sender);
  return win ? win.isFullScreen() : false;
});

handleAppIpc('open-external-url', async (_event, url) => {
  if (typeof url !== 'string') {
    return { ok: false, reason: 'invalid_url' };
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'unsupported_protocol' };
  }

  try {
    await shell.openExternal(parsed.toString());
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: 'open_failed',
      message: error instanceof Error ? error.message : 'Failed to open external URL',
    };
  }
});

handleAppIpc('open-passkey-window', async (_event, url) => {
  if (typeof url !== 'string') {
    return { ok: false, reason: 'invalid_url' };
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }

  if (!isPasskeyUrl(parsed.toString(), isDev)) {
    return { ok: false, reason: 'unsupported_origin' };
  }

  const parent = BrowserWindow.fromWebContents(_event.sender) ?? undefined;
  const child = new BrowserWindow({
    width: 500,
    height: 650,
    minWidth: 420,
    minHeight: 520,
    title: 'CatRealm Passkey',
    parent,
    modal: Boolean(parent),
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition: `catrealm-passkey-${Date.now()}`,
    },
  });
  const restrictAuthNavigation = (event, nextUrl) => {
    if (!isPasskeyUrl(nextUrl, isDev)) event.preventDefault();
  };
  child.webContents.on('will-navigate', restrictAuthNavigation);
  child.webContents.on('will-redirect', restrictAuthNavigation);
  child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  child.loadURL(parsed.toString());
  return { ok: true };
});

// ─── OBS Voice Overlay HTTP/SSE Server ───────────────────────────────────────

let overlayServer = null;
const overlayClients = new Set();
let latestOverlayState = null;
let reactiveAvatarFiles = null;

function getReactiveAvatarFiles() {
  if (!reactiveAvatarFiles) {
    reactiveAvatarFiles = createReactiveAvatarFiles(path.join(app.getPath('userData'), 'reactive-avatars'));
  }
  return reactiveAvatarFiles;
}

function getOverlayHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CatRealm Voice Overlay</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: transparent;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    padding: 12px;
    overflow: hidden;
  }
  #users {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 10px;
    align-items: flex-end;
  }
  .user-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    transition: opacity 0.2s;
  }
  .avatar-wrap {
    position: relative;
    display: inline-block;
  }
  .avatar-wrap img {
    display: block;
    object-fit: cover;
    transition: filter 0.2s;
  }
  .avatar-wrap .ring {
    position: absolute;
    inset: -3px;
    border: 3px solid transparent;
    transition: border-color 0.15s;
    pointer-events: none;
  }
  .avatar-wrap .ring.speaking {
    border-color: #23d18b;
    box-shadow: 0 0 6px #23d18b88;
  }
  .user-name {
    font-size: 12px;
    font-weight: 600;
    color: #ffffff;
    text-shadow: 0 1px 3px rgba(0,0,0,0.8), 0 0 6px rgba(0,0,0,0.6);
    max-width: 100px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: center;
  }
  .mute-badge {
    position: absolute;
    bottom: -2px;
    right: -2px;
    width: 16px;
    height: 16px;
    background: #ed4245;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .mute-badge svg { width: 10px; height: 10px; fill: white; }
  /* Reactive avatars: one stacked <img> per state, kept loaded so a state change
     never waits on a network load. Inactive layers are visibility:hidden (not
     just transparent) so Chromium stops advancing their animations — four 60 fps
     lossless loops would otherwise all decode at once. Motion is transform-only. */
  .reactive-stack { position: relative; width: 100%; height: 100%; }
  .reactive-stack img, .reactive-stack video {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    visibility: hidden;
  }
  .reactive-stack .active { visibility: visible; }
  .user-card.reactive .ring { display: none; }
  .user-card.reactive .reactive-stack { transition: transform 0.12s ease-out; }
  .user-card.reactive.motion-pop.is-speaking .reactive-stack { transform: scale(1.08); }
  .user-card.reactive.motion-bounce.is-speaking .reactive-stack { animation: reactiveBounce 0.42s ease-in-out infinite; }
  @keyframes reactiveBounce {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-8%); }
  }
</style>
</head>
<body>
<div id="users"></div>
<script>
  var state = { inVoice: false, users: [], settings: { showNames: true, avatarSize: 64, grayscaleWhenSilent: false, hideWhenSilent: false, squareIcons: true } };

  function render() {
    var container = document.getElementById('users');
    var s = state.settings;
    var users = state.users;

    // Build keyed map of existing cards for diff
    var existing = {};
    container.querySelectorAll('.user-card').forEach(function(el) {
      existing[el.dataset.userId] = el;
    });

    var seen = new Set();
    users.forEach(function(user) {
      var silent = !user.speaking;
      if (s.hideWhenSilent && silent) return;
      seen.add(user.id);

      var card = existing[user.id];
      if (!card) {
        card = document.createElement('div');
        card.className = 'user-card';
        card.dataset.userId = user.id;
        card.innerHTML = '<div class="avatar-wrap"><img /><div class="ring"></div></div><div class="user-name"></div>';
        container.appendChild(card);
      }

      var avatarWrap = card.querySelector('.avatar-wrap');
      var img = card.querySelector('img');
      var ring = card.querySelector('.ring');
      var nameEl = card.querySelector('.user-name');

      // Avatar size
      var sz = s.avatarSize;
      img.style.width = sz + 'px';
      img.style.height = sz + 'px';
      avatarWrap.style.width = sz + 'px';
      avatarWrap.style.height = sz + 'px';

      // Shape
      var radius = s.squareIcons ? '6px' : '50%';
      img.style.borderRadius = radius;
      ring.style.borderRadius = s.squareIcons ? '9px' : '50%';

      // Avatar src
      var src = user.avatarUrl || '';
      if (img.src !== src) img.src = src;
      img.alt = user.username;

      // Reactive avatar (Cat Lab): per-state art replaces the plain avatar. Missing
      // states fall back down the chain deafened -> muted -> idle -> profile avatar.
      var r = user.reactive;
      var reactive = r && (r.idle || r.speaking || r.muted || r.deafened) ? r : null;
      card.classList.toggle('reactive', !!reactive);
      card.classList.toggle('is-speaking', !!user.speaking);
      card.classList.toggle('motion-bounce', !!reactive && reactive.motion === 'bounce');
      card.classList.toggle('motion-pop', !!reactive && reactive.motion === 'pop');
      var stack = card.querySelector('.reactive-stack');
      if (reactive) {
        img.style.display = 'none';
        if (!stack) {
          stack = document.createElement('div');
          stack.className = 'reactive-stack';
          avatarWrap.insertBefore(stack, avatarWrap.firstChild);
        }
        var base = reactive.idle || user.avatarUrl || '';
        var urls = {
          idle: base,
          speaking: reactive.speaking || base,
          muted: reactive.muted || base,
          deafened: reactive.deafened || reactive.muted || base,
        };
        var current = user.deafened ? 'deafened' : user.muted ? 'muted' : user.speaking ? 'speaking' : 'idle';
        ['idle', 'speaking', 'muted', 'deafened'].forEach(function(st) {
          // CatRealm-compressed animations are WebM (VP9 + alpha) and need <video>.
          var tag = /\.webm$/.test(urls[st]) ? 'VIDEO' : 'IMG';
          var layer = stack.querySelector('[data-state="' + st + '"]');
          if (layer && layer.tagName !== tag) {
            layer.remove();
            layer = null;
          }
          if (!layer) {
            layer = document.createElement(tag.toLowerCase());
            layer.dataset.state = st;
            if (tag === 'VIDEO') {
              layer.muted = true;
              layer.loop = true;
              layer.playsInline = true;
            } else {
              layer.alt = '';
            }
            stack.appendChild(layer);
          }
          if (layer.getAttribute('src') !== urls[st]) layer.setAttribute('src', urls[st]);
          var isActive = st === current;
          layer.classList.toggle('active', isActive);
          if (tag === 'VIDEO') {
            if (isActive && layer.paused) layer.play().catch(function() {});
            if (!isActive && !layer.paused) layer.pause();
          }
        });
      } else {
        img.style.display = '';
        if (stack) stack.remove();
      }

      // Grayscale (reactive art has its own idle state, so it is left as drawn)
      img.style.filter = (!reactive && s.grayscaleWhenSilent && silent) ? 'grayscale(100%) brightness(0.7)' : '';

      // Speaking ring
      if (user.speaking) {
        ring.classList.add('speaking');
      } else {
        ring.classList.remove('speaking');
      }

      // Mute badge
      var badge = card.querySelector('.mute-badge');
      var hasStateArt = !!reactive && (user.deafened ? !!(reactive.deafened || reactive.muted) : !!reactive.muted);
      if ((user.muted || user.deafened) && !hasStateArt) {
        if (!badge) {
          badge = document.createElement('div');
          badge.className = 'mute-badge';
          badge.innerHTML = '<svg viewBox="0 0 24 24"><path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/></svg>';
          avatarWrap.appendChild(badge);
        }
      } else {
        if (badge) badge.remove();
      }

      // Name
      if (s.showNames) {
        nameEl.textContent = user.username;
        nameEl.style.display = '';
      } else {
        nameEl.style.display = 'none';
      }
    });

    // Remove cards for users no longer present
    Object.keys(existing).forEach(function(id) {
      if (!seen.has(id)) existing[id].remove();
    });
  }

  function connect() {
    var es = new EventSource('/events');
    es.onmessage = function(e) {
      try { state = JSON.parse(e.data); } catch(err) { return; }
      render();
    };
    es.onerror = function() {
      es.close();
      setTimeout(connect, 3000);
    };
  }

  connect();
</script>
</body>
</html>`;
}

function startOverlayServer(port) {
  if (overlayServer) {
    overlayServer.close(() => {});
    overlayServer = null;
    overlayClients.clear();
  }
  const srv = http.createServer((req, res) => {
    // Reject DNS-rebinding requests as well as keeping the listener local.
    if (!isOverlayHostAllowed(req.headers.host, port)) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (req.url === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write(':ok\n\n');
      if (latestOverlayState !== null) {
        res.write('data: ' + JSON.stringify(latestOverlayState) + '\n\n');
      }
      overlayClients.add(res);
      req.on('close', () => overlayClients.delete(res));
    } else if (req.url === '/state') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(latestOverlayState ?? {}));
    } else if (req.url.startsWith('/reactive/')) {
      // Content-addressed ids never change, so OBS can cache them indefinitely.
      const image = getReactiveAvatarFiles().read(req.url.slice('/reactive/'.length));
      if (!image) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, {
        'Content-Type': image.mime,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(image.bytes);
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(getOverlayHTML());
    }
  });
  srv.on('error', (err) => {
    console.error('[OBS Overlay] Server error:', err.message);
  });
  srv.listen(port, '127.0.0.1', () => {
    console.log('[OBS Overlay] Listening on port', port);
  });
  overlayServer = srv;
}

function stopOverlayServer() {
  if (overlayServer) {
    overlayServer.close(() => {});
    overlayServer = null;
  }
  overlayClients.forEach((res) => { try { res.end(); } catch (_) {} });
  overlayClients.clear();
  latestOverlayState = null;
}

function pushOverlayState(state) {
  latestOverlayState = state;
  const payload = 'data: ' + JSON.stringify(state) + '\n\n';
  overlayClients.forEach((res) => {
    try { res.write(payload); } catch (_) { overlayClients.delete(res); }
  });
}

handleAppIpc('obs-overlay-set-enabled', async (_event, { enabled, port }) => {
  if (enabled) {
    const safePort = Math.max(1, Math.min(65535, Math.round(Number(port) || 42069)));
    startOverlayServer(safePort);
  } else {
    stopOverlayServer();
  }
  return { ok: true };
});

handleAppIpc('obs-overlay-update-state', async (_event, state) => {
  if (overlayServer) pushOverlayState(state);
  return { ok: true };
});

// References are tracked per requesting origin: an installed build and a dev
// build share userData but not localStorage, and must not prune each other's art.
function reactiveAvatarOwner(event) {
  try {
    return new URL(event.senderFrame?.url || '').origin || 'default';
  } catch {
    return 'default';
  }
}

handleAppIpc('reactive-avatar-save-image', async (event, bytes, options) => {
  if (!(bytes instanceof Uint8Array)) return { ok: false, error: 'empty' };
  return getReactiveAvatarFiles().save(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), {
    owner: reactiveAvatarOwner(event),
    received: options?.received === true,
  });
});

handleAppIpc('reactive-avatar-read-image', async (_event, id) => {
  const image = getReactiveAvatarFiles().read(id);
  return image ? { ok: true, bytes: new Uint8Array(image.bytes), mime: image.mime } : { ok: false };
});

handleAppIpc('reactive-avatar-prune', async (event, keepIds) => {
  return { ok: true, removed: getReactiveAvatarFiles().prune(reactiveAvatarOwner(event), keepIds) };
});

function matchesAllowedHost(hostname, allowedDomains) {
  const host = String(hostname || '').replace(/^\./, '').replace(/^www\./, '').toLowerCase();
  return allowedDomains.some((domain) => host === domain || host.endsWith('.' + domain));
}

function getTheaterYouTubeSession() {
  return session.fromPartition(THEATER_YOUTUBE_COOKIE_PARTITION);
}

async function getTheaterYouTubeCookieSnapshot() {
  const ses = getTheaterYouTubeSession();
  const cookies = await ses.cookies.get({});
  return cookies.filter((cookie) => matchesAllowedHost(cookie.domain, THEATER_YOUTUBE_COOKIE_EXPORT_DOMAINS));
}

function cookieToNetscapeLine(cookie) {
  const domain = String(cookie.domain || '').trim();
  const includeSubdomains = domain.startsWith('.') ? 'TRUE' : 'FALSE';
  const cookiePath = String(cookie.path || '/').replace(/[\r\n\t]/g, ' ').trim() || '/';
  const secure = cookie.secure ? 'TRUE' : 'FALSE';
  const expiresAt = cookie.session ? '0' : String(Math.max(0, Math.floor(Number(cookie.expirationDate) || 0)));
  const name = String(cookie.name || '').replace(/[\r\n\t]/g, ' ').trim();
  const value = String(cookie.value || '').replace(/[\r\n\t]/g, ' ').trim();
  return [domain, includeSubdomains, cookiePath, secure, expiresAt, name, value].join('\t');
}

async function getTheaterYouTubeAuthStatus() {
  try {
    const snapshot = await getTheaterYouTubeCookieSnapshot();
    const loggedIn = THEATER_YOUTUBE_COOKIE_CHECKS.some((check) => (
      snapshot.some((cookie) => cookie.name === check.name && matchesAllowedHost(cookie.domain, [check.domain.replace(/^\./, '')]))
    ));
    return { loggedIn, cookieCount: snapshot.length };
  } catch {
    return { loggedIn: false, cookieCount: 0 };
  }
}

async function touchYouTubeRobotsPage() {
  const ses = getTheaterYouTubeSession();
  const win = new BrowserWindow({
    width: 900,
    height: 650,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition: THEATER_YOUTUBE_COOKIE_PARTITION,
    },
  });
  try {
    await win.loadURL('https://www.youtube.com/robots.txt');
    await new Promise((resolve) => setTimeout(resolve, 400));
  } finally {
    if (!win.isDestroyed()) win.destroy();
    try {
      if (typeof ses.flushStorageData === 'function') {
        await ses.flushStorageData();
      }
    } catch {
      // Ignore session flush failures.
    }
  }
}

// ─── Embedding Login ──────────────────────────────────────────────────────────

handleAppIpc('embed-login-open', async (_event, platform) => {
  const config = EMBED_LOGIN_CONFIG[platform];
  if (!config) {
    return { ok: false, reason: 'unknown_platform', message: `Unknown platform: ${platform}` };
  }

  const existing = loginWindows.get(platform);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return { ok: true };
  }

  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    title: config.title,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  loginWindows.set(platform, win);

  win.webContents.setWindowOpenHandler(({ url }) => {
    let parsed;
    try { parsed = new URL(url); } catch { return { action: 'deny' }; }
    const host = parsed.hostname.replace(/^www\./, '');
    const allowed = config.allowedNavDomains.some((d) => host === d || host.endsWith('.' + d));
    return allowed ? { action: 'allow' } : { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    let parsed;
    try { parsed = new URL(url); } catch { event.preventDefault(); return; }
    const host = parsed.hostname.replace(/^www\./, '');
    const allowed = config.allowedNavDomains.some((d) => host === d || host.endsWith('.' + d));
    if (!allowed) event.preventDefault();
  });

  win.on('closed', () => {
    loginWindows.delete(platform);
  });

  win.loadURL(config.loginUrl);
  return { ok: true };
});

handleAppIpc('embed-login-status', async (_event, platform) => {
  const config = EMBED_LOGIN_CONFIG[platform];
  if (!config) return { loggedIn: false };

  try {
    for (const check of config.cookieChecks) {
      const cookies = await session.defaultSession.cookies.get({ name: check.name, domain: check.domain });
      if (!cookies || cookies.length === 0) return { loggedIn: false };
    }
    return { loggedIn: true };
  } catch {
    return { loggedIn: false };
  }
});

handleAppIpc('embed-login-logout', async (_event, platform) => {
  const config = EMBED_LOGIN_CONFIG[platform];
  if (!config) return { ok: false, reason: 'unknown_platform', message: `Unknown platform: ${platform}` };

  try {
    for (const rawDomain of config.logoutDomains) {
      const cleanDomain = rawDomain.replace(/^\./, '');
      const url = `https://${cleanDomain}`;
      const cookies = await session.defaultSession.cookies.get({ domain: rawDomain });
      for (const cookie of cookies) {
        const cookieUrl = `https://${cookie.domain.replace(/^\./, '')}${cookie.path || '/'}`;
        await session.defaultSession.cookies.remove(cookieUrl, cookie.name);
      }
      try {
        await session.defaultSession.clearStorageData({
          origin: url,
          storages: ['cachestorage', 'indexdb', 'localstorage'],
        });
      } catch {
        // ignore per-origin storage clear failures
      }
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: 'logout_failed',
      message: error instanceof Error ? error.message : 'Failed to log out',
    };
  }
});

handleAppIpc('theater-youtube-cookie-open', async () => {
  const platform = 'theater-youtube-cookie';
  const existing = loginWindows.get(platform);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return { ok: true };
  }

  const win = new BrowserWindow({
    width: 1000,
    height: 760,
    title: THEATER_YOUTUBE_COOKIE_TITLE,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition: THEATER_YOUTUBE_COOKIE_PARTITION,
    },
  });

  loginWindows.set(platform, win);

  win.webContents.setWindowOpenHandler(({ url }) => {
    let parsed;
    try { parsed = new URL(url); } catch { return { action: 'deny' }; }
    return matchesAllowedHost(parsed.hostname, THEATER_YOUTUBE_ALLOWED_DOMAINS)
      ? { action: 'allow' }
      : { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    let parsed;
    try { parsed = new URL(url); } catch { event.preventDefault(); return; }
    if (!matchesAllowedHost(parsed.hostname, THEATER_YOUTUBE_ALLOWED_DOMAINS)) {
      event.preventDefault();
    }
  });

  win.on('closed', () => {
    loginWindows.delete(platform);
  });

  await win.loadURL('https://accounts.google.com/signin/v2/identifier?service=youtube');
  return { ok: true };
});

handleAppIpc('theater-youtube-cookie-status', async () => getTheaterYouTubeAuthStatus());

handleAppIpc('theater-youtube-cookie-export', async () => {
  try {
    await touchYouTubeRobotsPage();
    const snapshot = await getTheaterYouTubeCookieSnapshot();
    if (snapshot.length === 0) {
      return {
        ok: false,
        reason: 'not_authorized',
        message: 'No YouTube cookies were found in the dedicated CatRealm session.',
      };
    }
    const cookieText = `# Netscape HTTP Cookie File\n${snapshot.map(cookieToNetscapeLine).join('\n')}\n`;
    return {
      ok: true,
      cookieCount: snapshot.length,
      cookieText,
    };
  } catch (error) {
    return {
      ok: false,
      reason: 'export_failed',
      message: error instanceof Error ? error.message : 'Failed to export YouTube cookies',
    };
  }
});

handleAppIpc('theater-youtube-cookie-clear', async () => {
  const ses = getTheaterYouTubeSession();
  try {
    const cookies = await ses.cookies.get({});
    for (const cookie of cookies) {
      const protocol = cookie.secure ? 'https' : 'http';
      const host = String(cookie.domain || '').replace(/^\./, '');
      if (!matchesAllowedHost(host, THEATER_YOUTUBE_COOKIE_EXPORT_DOMAINS)) continue;
      await ses.cookies.remove(`${protocol}://${host}${cookie.path || '/'}`, cookie.name);
    }
    for (const domain of THEATER_YOUTUBE_COOKIE_EXPORT_DOMAINS) {
      try {
        await ses.clearStorageData({
          origin: `https://${domain}`,
          storages: ['cachestorage', 'indexdb', 'localstorage'],
        });
      } catch {
        // Ignore per-origin cleanup failures.
      }
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: 'clear_failed',
      message: error instanceof Error ? error.message : 'Failed to clear theater YouTube session',
    };
  }
});

// ─────────────────────────────────────────────────────────────────────────────

app.on('window-all-closed', () => {
  safeQuitApp();
});

app.on('before-quit', () => {
  cleanupBeforeQuit();
  quitRequested = true;
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
