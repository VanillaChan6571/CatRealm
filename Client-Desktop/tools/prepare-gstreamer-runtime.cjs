const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// The bundled GStreamer runtime is Windows-only (PE import closure, D3D/MediaFoundation
// plugins, rcedit). Linux/macOS builds ship without it — capture is unsupported there.
if (process.platform !== 'win32') {
  console.log(`[gstreamer] Skipping bundled runtime staging: Windows-only step (platform: ${process.platform}).`);
  process.exit(0);
}

// Builds the trimmed GStreamer runtime that ships INSIDE the installer (unpacked
// from ASAR via electron/native/**). Instead of copying every bin\*.dll (~174 MB),
// it copies only the transitive PE-import closure of the curated plugins + tools
// (~25 MB) so the runtime is small enough to bundle. A validation gate then loads
// the critical elements to prove the closure is complete.

const projectRoot = path.resolve(__dirname, '..');
const defaultSourceRoot = 'C:\\Program Files\\GStreamer\\1.0\\msvc_x86_64';
const sourceRoot = path.resolve(process.env.CATREALM_GSTREAMER_ROOT || process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64 || defaultSourceRoot);
const targetRoot = path.join(projectRoot, 'electron', 'native', 'gstreamer', 'win-msvc-x64');
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const appVersion = String(packageJson.version || '0.0.0');

// The publisher process is shipped as CatRealmStreamer.exe (a renamed, icon'd copy
// of gst-launch-1.0.exe) so it shows as CatRealm — not "gst-launch" — in Task
// Manager. gst-launch is a thin launcher that loads co-located DLLs, so the
// filename doesn't matter to GStreamer. gst-inspect/gst-device-monitor keep their
// names (short-lived probes).
const BUNDLED_LAUNCHER = 'CatRealmStreamer.exe';
const APP_ICON = path.join(projectRoot, 'public', 'icon.ico');
const VERSION_LANG_ID = 0x0409;
const VERSION_CODEPAGE = 0x04b0;
const RCEDIT_CANDIDATES = [
  'node_modules/electron-winstaller/vendor/rcedit.exe',
  'node_modules/rcedit/bin/rcedit-x64.exe',
  'node_modules/app-builder-bin/win/x64/rcedit.exe',
];

const pluginDlls = [
  // Visible native device WHIP pipeline elements.
  'gstmediafoundation.dll',
  'gstd3d11.dll',
  'gstd3d12.dll',
  'gstwinscreencap.dll',
  'gstvideorate.dll',
  'gstvideoconvertscale.dll',
  'gstvideoparsersbad.dll',
  'gstrtp.dll',
  'gstwasapi2.dll',
  'gstaudioconvert.dll',
  'gstaudioresample.dll',
  'gstopus.dll',
  'gstnvcodec.dll',
  // AMD AMF hardware H.264 encoder (amfh264enc) for AMD GPUs. mfh264enc (a
  // vendor-agnostic Media Foundation HW encoder) already ships via
  // gstmediafoundation.dll as a generic fallback.
  'gstamfcodec.dll',
  'gstcoreelements.dll',
  'gstwebrtchttp.dll',
  'gstrswebrtc.dll',
  // whipclientsink/webrtcsink (gstrswebrtc) build an encoder-discovery pipeline at
  // runtime from registry lookups (NOT static imports): appsrc/appsink (gstapp),
  // errorignore (gstdebugutilsbad), and the GCC bwe element rtpgccbwe (gstrsrtp).
  // With these it uses nvh264enc — no software (GPL x264) encoder needed.
  'gstapp.dll',
  'gstdebugutilsbad.dll',
  'gstrsrtp.dll',

  // Dynamically-created WebRTC transport elements used by whipsink/webrtcsink.
  'gstwebrtc.dll',
  'gstdtls.dll',
  'gstsrtp.dll',
  'gstnice.dll',
  'gstrtpmanager.dll',
  'gstudp.dll',
];

const toolExes = ['gst-launch-1.0.exe', 'gst-device-monitor-1.0.exe', 'gst-inspect-1.0.exe'];

// Non-hardware-gated elements that must register on ANY Windows build machine
// (MediaFoundation/WASAPI/WebRTC are always present; nvh264enc is deliberately
// excluded because it only registers when an NVIDIA GPU/driver is present, so
// we'd get false failures on GPU-less CI runners — its plugin DLL presence is
// checked instead).
const validationElements = [
  'whipsink', 'whipclientsink', 'webrtcbin', 'rtpbin', 'wasapi2src', 'mfvideosrc',
  'opusenc', 'rtpopuspay', 'rtph264pay', 'h264parse', 'videoconvert', 'videorate',
  'audioconvert', 'audioresample', 'queue', 'dtlssrtpenc', 'nicesink', 'udpsink',
  // appsrc/appsink (gstapp) + the GCC bwe element are instantiated at runtime by
  // webrtcsink; element registration of whipclientsink alone does NOT prove they
  // (or webrtcsink's discovery chain) are present — validateWebrtcsinkChain does.
  'appsrc', 'appsink', 'rtpgccbwe',
];

// Both publish paths are supported: the production whipsink path (we encode H.264
// ourselves with nvh264enc and publish pre-encoded — see gstH264Profile, which the
// app always sets) AND the whipclientsink path (webrtcsink discovers nvh264enc at
// runtime). The latter needs gstapp/gstdebugutilsbad/gstrsrtp bundled (appsink/
// errorignore/rtpgccbwe) — all small, no GPL software encoder required.

function fail(message) {
  console.error(`[prepare-gstreamer-runtime] ${message}`);
  process.exit(1);
}

function requireGstreamerBranding() {
  return /^(1|true|yes|on)$/i.test(String(process.env.CATREALM_REQUIRE_GSTREAMER_BRANDING || '').trim());
}

function u16z(text) {
  return Buffer.from(`${text}\0`, 'utf16le');
}

function word(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value & 0xffff, 0);
  return buffer;
}

function dword(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0, 0);
  return buffer;
}

function pad4(length) {
  return Buffer.alloc((4 - (length % 4)) % 4);
}

function resourceBlock({ key, type = 1, value = Buffer.alloc(0), valueLength = 0, children = [] }) {
  const header = Buffer.concat([word(0), word(valueLength), word(type), u16z(key)]);
  const beforeValue = Buffer.concat([header, pad4(header.length)]);
  const afterValuePad = pad4(beforeValue.length + value.length);
  const childData = Buffer.concat(children);
  const block = Buffer.concat([beforeValue, value, afterValuePad, childData]);
  block.writeUInt16LE(block.length, 0);
  return block;
}

function versionQuad(version) {
  const parts = String(version || '0.0.0')
    .split(/[^\d]+/)
    .filter(Boolean)
    .map((part) => Math.max(0, Math.min(65535, Number(part) || 0)));
  while (parts.length < 4) parts.push(0);
  return parts.slice(0, 4);
}

function fixedFileInfo(versionParts) {
  const [major, minor, patch, build] = versionParts;
  return Buffer.concat([
    dword(0xfeef04bd),
    dword(0x00010000),
    dword((major << 16) | minor),
    dword((patch << 16) | build),
    dword((major << 16) | minor),
    dword((patch << 16) | build),
    dword(0x0000003f),
    dword(0x00000000),
    dword(0x00040004),
    dword(0x00000001),
    dword(0x00000000),
    dword(0x00000000),
    dword(0x00000000),
  ]);
}

function stringResource(key, value) {
  const text = String(value || '');
  return resourceBlock({
    key,
    type: 1,
    value: u16z(text),
    valueLength: text.length + 1,
  });
}

function createVersionInfoResource() {
  const versionParts = versionQuad(appVersion);
  const fileVersion = versionParts.join('.');
  const strings = {
    CompanyName: 'CatRealm',
    FileDescription: 'CatRealm Screenshare Publisher',
    FileVersion: fileVersion,
    InternalName: 'CatRealmStreamer',
    OriginalFilename: BUNDLED_LAUNCHER,
    ProductName: 'CatRealm',
    ProductVersion: appVersion,
  };
  const stringTable = resourceBlock({
    key: `${VERSION_LANG_ID.toString(16).padStart(4, '0')}${VERSION_CODEPAGE.toString(16).padStart(4, '0')}`.toUpperCase(),
    type: 1,
    children: Object.entries(strings).map(([key, value]) => stringResource(key, value)),
  });
  const stringFileInfo = resourceBlock({ key: 'StringFileInfo', type: 1, children: [stringTable] });
  const translation = Buffer.concat([word(VERSION_LANG_ID), word(VERSION_CODEPAGE)]);
  const varInfo = resourceBlock({
    key: 'Translation',
    type: 0,
    value: translation,
    valueLength: translation.length,
  });
  const varFileInfo = resourceBlock({ key: 'VarFileInfo', type: 1, children: [varInfo] });
  return resourceBlock({
    key: 'VS_VERSION_INFO',
    type: 0,
    value: fixedFileInfo(versionParts),
    valueLength: 52,
    children: [stringFileInfo, varFileInfo],
  });
}

function powershellExe() {
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  const candidate = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return fs.existsSync(candidate) ? candidate : 'powershell.exe';
}

function addVersionInfoResource(exePath) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'catrealm-verinfo-'));
  const resourcePath = path.join(tmpDir, 'version-info.bin');
  const scriptPath = path.join(tmpDir, 'update-version-resource.ps1');
  fs.writeFileSync(resourcePath, createVersionInfoResource());
  fs.writeFileSync(scriptPath, `
param([string]$ExePath, [string]$ResourcePath)
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class CatRealmResourceUpdate {
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern IntPtr BeginUpdateResource(string pFileName, bool bDeleteExistingResources);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool UpdateResource(IntPtr hUpdate, IntPtr lpType, IntPtr lpName, ushort wLanguage, byte[] lpData, uint cbData);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool EndUpdateResource(IntPtr hUpdate, bool fDiscard);
  public static void ThrowLastWin32Error(string action) {
    throw new Win32Exception(Marshal.GetLastWin32Error(), action);
  }
}
"@
$data = [System.IO.File]::ReadAllBytes($ResourcePath)
$handle = [CatRealmResourceUpdate]::BeginUpdateResource($ExePath, $false)
if ($handle -eq [IntPtr]::Zero) { [CatRealmResourceUpdate]::ThrowLastWin32Error('BeginUpdateResource failed') }
$done = $false
try {
  if (-not [CatRealmResourceUpdate]::UpdateResource($handle, [IntPtr]16, [IntPtr]1, ${VERSION_LANG_ID}, $data, $data.Length)) {
    [CatRealmResourceUpdate]::ThrowLastWin32Error('UpdateResource VERSIONINFO failed')
  }
  if (-not [CatRealmResourceUpdate]::EndUpdateResource($handle, $false)) {
    [CatRealmResourceUpdate]::ThrowLastWin32Error('EndUpdateResource failed')
  }
  $done = $true
} finally {
  if (-not $done -and $handle -ne [IntPtr]::Zero) {
    [void][CatRealmResourceUpdate]::EndUpdateResource($handle, $true)
  }
}
`, 'utf8');
  try {
    const result = spawnSync(powershellExe(), ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, exePath, resourcePath], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30000,
    });
    if (result.status !== 0) {
      const message = `VERSIONINFO resource update failed: ${(result.stderr || result.stdout || '').trim()}`;
      if (requireGstreamerBranding()) fail(message);
      console.warn(`[prepare-gstreamer-runtime] ${message}`);
      return false;
    }
    return true;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function assertLauncherVersionInfo(exePath) {
  const quotedPath = String(exePath).replace(/'/g, "''");
  const result = spawnSync(powershellExe(), [
    '-NoProfile',
    '-Command',
    `$v=(Get-Item -LiteralPath '${quotedPath}').VersionInfo; @($v.FileDescription,$v.ProductName,$v.InternalName,$v.OriginalFilename) -join "\`n"`,
  ], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  if (result.status !== 0) {
    const message = `could not verify CatRealmStreamer VERSIONINFO: ${(result.stderr || result.stdout || '').trim()}`;
    if (requireGstreamerBranding()) fail(message);
    console.warn(`[prepare-gstreamer-runtime] ${message}`);
    return false;
  }
  const [description, productName, internalName, originalFilename] = String(result.stdout || '').trim().split(/\r?\n/);
  if (
    description !== 'CatRealm Screenshare Publisher'
    || productName !== 'CatRealm'
    || internalName !== 'CatRealmStreamer'
    || originalFilename !== BUNDLED_LAUNCHER
  ) {
    const message = `CatRealmStreamer VERSIONINFO verification failed: ${(result.stdout || '').trim() || '<empty>'}`;
    if (requireGstreamerBranding()) fail(message);
    console.warn(`[prepare-gstreamer-runtime] ${message}`);
    return false;
  }
  return true;
}

function brandLauncherWithVersionInfo(exePath) {
  const hasVersionInfo = addVersionInfoResource(exePath);
  const rcedit = RCEDIT_CANDIDATES.map((c) => path.join(projectRoot, c)).find((c) => fs.existsSync(c));
  if (!rcedit || !fs.existsSync(APP_ICON)) {
    console.warn('[prepare-gstreamer-runtime] rcedit or icon not found - shipping CatRealmStreamer.exe without a custom icon.');
    if (hasVersionInfo) assertLauncherVersionInfo(exePath);
    return;
  }
  const result = spawnSync(rcedit, [exePath, '--set-icon', APP_ICON], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20000,
  });
  if (result.status !== 0) {
    console.warn(`[prepare-gstreamer-runtime] rcedit icon failed (non-fatal): ${(result.stderr || result.stdout || '').trim().slice(0, 200)}`);
  }
  if (hasVersionInfo) assertLauncherVersionInfo(exePath);
}

function copyFile(source, target) {
  if (!fs.existsSync(source)) fail(`missing required file: ${source}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function copyDirectory(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir)) fail(`missing required directory: ${sourceDir}`);
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const source = path.join(sourceDir, entry.name);
    const target = path.join(targetDir, entry.name);
    if (entry.isDirectory()) copyDirectory(source, target);
    else if (entry.isFile()) copyFile(source, target);
  }
}

function directorySize(root) {
  let files = 0;
  let bytes = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.isFile()) { files += 1; bytes += fs.statSync(fullPath).size; }
    }
  };
  walk(root);
  return { files, mb: Math.round((bytes / 1024 / 1024) * 10) / 10 };
}

// Parse the imported DLL names (regular + delay-load) from a PE file. Used to
// compute which bin\ DLLs the curated plugins/tools actually link.
function importedDllNames(file) {
  let buf;
  try { buf = fs.readFileSync(file); } catch { return []; }
  if (buf.length < 0x40 || buf.readUInt16LE(0) !== 0x5a4d) return [];
  const peOff = buf.readUInt32LE(0x3c);
  if (peOff + 24 > buf.length || buf.readUInt32LE(peOff) !== 0x00004550) return [];
  const coff = peOff + 4;
  const numSections = buf.readUInt16LE(coff + 2);
  const optSize = buf.readUInt16LE(coff + 16);
  const optStart = coff + 20;
  const magic = buf.readUInt16LE(optStart);
  const dataDirOff = optStart + (magic === 0x20b ? 112 : 96);
  const dir = (i) => ({ rva: buf.readUInt32LE(dataDirOff + i * 8) });
  const importRva = dir(1).rva;
  const delayRva = dir(13).rva;

  const sections = [];
  const secStart = optStart + optSize;
  for (let i = 0; i < numSections; i++) {
    const off = secStart + i * 40;
    sections.push({
      va: buf.readUInt32LE(off + 12),
      vsize: buf.readUInt32LE(off + 8),
      rawSize: buf.readUInt32LE(off + 16),
      rawPtr: buf.readUInt32LE(off + 20),
    });
  }
  const rvaToOff = (rva) => {
    for (const s of sections) {
      const size = Math.max(s.vsize, s.rawSize);
      if (rva >= s.va && rva < s.va + size) return rva - s.va + s.rawPtr;
    }
    return -1;
  };
  const readCStr = (off) => {
    if (off < 0 || off >= buf.length) return '';
    let end = off;
    while (end < buf.length && buf[end] !== 0) end++;
    return buf.toString('ascii', off, end);
  };

  const names = new Set();
  if (importRva) {
    let p = rvaToOff(importRva);
    while (p >= 0 && p + 20 <= buf.length) {
      const nameRva = buf.readUInt32LE(p + 12);
      if (buf.readUInt32LE(p) === 0 && nameRva === 0) break;
      if (nameRva) { const n = readCStr(rvaToOff(nameRva)); if (n) names.add(n.toLowerCase()); }
      p += 20;
    }
  }
  if (delayRva) {
    let p = rvaToOff(delayRva);
    while (p >= 0 && p + 32 <= buf.length) {
      const nameRva = buf.readUInt32LE(p + 4);
      if (nameRva === 0) break;
      const n = readCStr(rvaToOff(nameRva));
      if (n) names.add(n.toLowerCase());
      p += 32;
    }
  }
  return [...names];
}

function computeBinClosure(sourceBin, sourcePlugins, sourceLibexec) {
  const binByLower = new Map();
  for (const f of fs.readdirSync(sourceBin)) if (/\.dll$/i.test(f)) binByLower.set(f.toLowerCase(), f);

  const needed = new Set();
  const queue = [];
  for (const exe of toolExes) { const p = path.join(sourceBin, exe); if (fs.existsSync(p)) queue.push(p); }
  const scanner = path.join(sourceLibexec, 'gst-plugin-scanner.exe');
  if (fs.existsSync(scanner)) queue.push(scanner);
  for (const dll of pluginDlls) queue.push(path.join(sourcePlugins, dll));

  while (queue.length) {
    const file = queue.shift();
    for (const imp of importedDllNames(file)) {
      if (!binByLower.has(imp) || needed.has(imp)) continue;
      needed.add(imp);
      queue.push(path.join(sourceBin, binByLower.get(imp)));
    }
  }
  return [...needed].map((n) => binByLower.get(n));
}

function buildGstEnv(root) {
  const binDir = path.join(root, 'bin');
  const pluginDir = path.join(root, 'lib', 'gstreamer-1.0');
  const scanner = path.join(root, 'libexec', 'gstreamer-1.0', 'gst-plugin-scanner.exe');
  return {
    ...process.env,
    PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`,
    GST_PLUGIN_PATH: pluginDir,
    GST_PLUGIN_SYSTEM_PATH: pluginDir,
    GST_PLUGIN_SCANNER: scanner,
    GST_PLUGIN_PATH_1_0: pluginDir,
    GST_PLUGIN_SYSTEM_PATH_1_0: pluginDir,
    GST_PLUGIN_SCANNER_1_0: scanner,
  };
}

function validate() {
  const env = buildGstEnv(targetRoot);
  const gstLaunch = path.join(targetRoot, 'bin', BUNDLED_LAUNCHER);
  const smoke = spawnSync(gstLaunch, ['-q', 'fakesrc', 'num-buffers=1', '!', 'fakesink'], {
    encoding: 'utf8', env, windowsHide: true, timeout: 20000,
  });
  if (smoke.status !== 0) {
    fail(`smoke test failed:\n${(smoke.stdout || '') + (smoke.stderr || '')}`.trim());
  }
  // Load each critical element from the TRIMMED runtime. A missing bin dependency
  // makes gst-inspect fail to load that element's plugin -> the closure is bad.
  const gstInspect = path.join(targetRoot, 'bin', 'gst-inspect-1.0.exe');
  const broken = [];
  for (const el of validationElements) {
    const r = spawnSync(gstInspect, [el], { encoding: 'utf8', env, windowsHide: true, timeout: 15000 });
    if (r.status !== 0) broken.push(el);
  }
  if (broken.length) {
    fail(`trimmed runtime is missing dependencies — these elements failed to load: ${broken.join(', ')}`);
  }
  // nvh264enc is hardware-gated (only registers with an NVIDIA GPU), so verify its
  // plugin DLL is present rather than that the element registers.
  if (!fs.existsSync(path.join(targetRoot, 'lib', 'gstreamer-1.0', 'gstnvcodec.dll'))) {
    fail('gstnvcodec.dll (nvh264enc) is missing from the runtime.');
  }
  // amfh264enc (AMD) is likewise hardware-gated — it only registers on a machine
  // with an AMD GPU + AMF runtime, so verify the plugin DLL presence instead.
  if (!fs.existsSync(path.join(targetRoot, 'lib', 'gstreamer-1.0', 'gstamfcodec.dll'))) {
    fail('gstamfcodec.dll (amfh264enc) is missing from the runtime.');
  }
  validateWebrtcsinkChain(env);
}

// whipclientsink/webrtcsink build their encode chain by instantiating elements
// from the registry at PAD-ACTIVATION / discovery time (appsrc/appsink, errorignore,
// rtpgccbwe, encoders), which gst-inspect does NOT exercise — a missing one only
// surfaces when frames flow. Actually link a source into whipclientsink so any such
// gap fails the build here instead of at a user's first share. Endpoint is a dead
// local port: we only care that the chain BUILDS, not that signalling succeeds.
function validateWebrtcsinkChain(env) {
  const testSrc = path.join(sourcePlugins, 'gstvideotestsrc.dll');
  if (!fs.existsSync(testSrc)) {
    console.warn('[prepare-gstreamer-runtime] videotestsrc not in source install — skipping webrtcsink chain test');
    return;
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gst-vchk-'));
  try {
    fs.copyFileSync(testSrc, path.join(tmpDir, 'gstvideotestsrc.dll'));
    const chainEnv = {
      ...env,
      GST_PLUGIN_PATH: `${path.join(targetRoot, 'lib', 'gstreamer-1.0')}${path.delimiter}${tmpDir}`,
      GST_REGISTRY: path.join(tmpDir, 'registry.bin'),
    };
    const gstLaunch = path.join(targetRoot, 'bin', BUNDLED_LAUNCHER);
    const r = spawnSync(gstLaunch, [
      '-e', 'videotestsrc', 'is-live=true', 'num-buffers=10',
      '!', 'videoconvert', '!', 'video/x-raw,width=320,height=240,framerate=15/1', '!', 'queue',
      '!', 'whipclientsink', 'name=whip', 'signaller::whip-endpoint=http://127.0.0.1:1/whip', 'video-caps=video/x-h264',
    ], { encoding: 'utf8', env: chainEnv, windowsHide: true, timeout: 30000 });
    const out = `${r.stdout || ''}\n${r.stderr || ''}`;
    // A missing runtime element/encoder shows up as one of these BEFORE any
    // networking; a network failure (expected — dead port) does not match these.
    const m = out.match(/element factory '([^']+)' not found|Failed to activate pad|could not link \w+ to whip|no codec present|No caps found for stream|no codec discovered/i);
    if (m) {
      fail(`webrtcsink chain failed to build (missing runtime plugin/encoder${m[1] ? `: ${m[1]}` : ''}). Add it to pluginDlls.`);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

if (/^(1|true|yes|on)$/i.test(String(process.env.CATREALM_SKIP_GSTREAMER_BUNDLE || '').trim())) {
  console.log('[prepare-gstreamer-runtime] skipped by CATREALM_SKIP_GSTREAMER_BUNDLE');
  process.exit(0);
}

if (process.platform !== 'win32') {
  const message = 'GStreamer bundle preparation is Windows-only.';
  if (/^(1|true|yes|on)$/i.test(String(process.env.CATREALM_REQUIRE_GSTREAMER_BUNDLE || '').trim())) fail(message);
  console.warn(`[prepare-gstreamer-runtime] ${message} Skipping on ${process.platform}.`);
  process.exit(0);
}

const sourceBin = path.join(sourceRoot, 'bin');
const sourcePlugins = path.join(sourceRoot, 'lib', 'gstreamer-1.0');
const sourceLibexec = path.join(sourceRoot, 'libexec', 'gstreamer-1.0');
const sourceLicenses = path.join(sourceRoot, 'share', 'licenses');

if (!fs.existsSync(path.join(sourceBin, 'gst-launch-1.0.exe'))) {
  fail(`GStreamer was not found at ${sourceRoot}. Install the MSVC x86_64 runtime or set CATREALM_GSTREAMER_ROOT.`);
}

fs.rmSync(targetRoot, { recursive: true, force: true });

// Only the transitive PE-import closure of the tools + curated plugins, not all
// of bin\ (drops ~110 unused codec/UI DLLs: x265, SvtAv1Enc, avcodec, gtk, ...).
const closureDlls = computeBinClosure(sourceBin, sourcePlugins, sourceLibexec);
for (const dll of closureDlls) {
  copyFile(path.join(sourceBin, dll), path.join(targetRoot, 'bin', dll));
}
// gst-inspect / gst-device-monitor keep their names (probe tools); gst-launch is
// shipped as the branded CatRealmStreamer.exe (the visible publisher process).
copyFile(path.join(sourceBin, 'gst-device-monitor-1.0.exe'), path.join(targetRoot, 'bin', 'gst-device-monitor-1.0.exe'));
copyFile(path.join(sourceBin, 'gst-inspect-1.0.exe'), path.join(targetRoot, 'bin', 'gst-inspect-1.0.exe'));
copyFile(path.join(sourceBin, 'gst-launch-1.0.exe'), path.join(targetRoot, 'bin', BUNDLED_LAUNCHER));
brandLauncherWithVersionInfo(path.join(targetRoot, 'bin', BUNDLED_LAUNCHER));
for (const plugin of pluginDlls) {
  copyFile(path.join(sourcePlugins, plugin), path.join(targetRoot, 'lib', 'gstreamer-1.0', plugin));
}
copyFile(
  path.join(sourceLibexec, 'gst-plugin-scanner.exe'),
  path.join(targetRoot, 'libexec', 'gstreamer-1.0', 'gst-plugin-scanner.exe'),
);
copyDirectory(sourceLicenses, path.join(targetRoot, 'share', 'licenses'));

validate();

const size = directorySize(targetRoot);
console.log(`[prepare-gstreamer-runtime] bundled ${size.files} files (${size.mb} MB) from ${sourceRoot} — ${closureDlls.length} bin DLLs (closure)`);
