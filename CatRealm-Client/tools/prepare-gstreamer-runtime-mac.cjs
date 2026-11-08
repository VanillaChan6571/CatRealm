const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// Builds the trimmed arm64 GStreamer runtime that ships inside the macOS app, unpacked
// from ASAR via electron/native/**. The official package is unpacked without running its
// installer, so this needs no admin rights. Only the plugins below and their dylib
// closure are kept. electron-builder signs the result with the rest of the app.

const projectRoot = path.resolve(__dirname, '..');
const targetRoot = path.join(projectRoot, 'electron', 'native', 'gstreamer', 'mac-arm64');
const helperSource = path.join(__dirname, 'mac-capture-helper', 'CatRealmCaptureHelper.swift');

const GST_VERSION = '1.28.8';
const PKG_NAME = `gstreamer-1.0-${GST_VERSION}-universal.pkg`;
const PKG_URL = `https://gstreamer.freedesktop.org/data/pkg/osx/${GST_VERSION}/${PKG_NAME}`;
// The package itself is unsigned, so this pin is what authenticates it.
const PKG_SHA256 = 'd371ab04a7632713626836c2fc234e863cc98484c74c473eba99b0fbd9b3a3fe';

const BUNDLED_LAUNCHER = 'CatRealmStreamer';
const HELPER_NAME = 'CatRealmCaptureHelper';
const HELPER_TARGET = 'arm64-apple-macos12.0';

const plugins = [
  'applemedia', 'coreelements', 'videorate', 'videoconvertscale', 'videoparsersbad', 'rtp',
  'rawparse', 'audioconvert', 'audioresample', 'opus',
  // whipsink and the WebRTC transport it creates at runtime.
  'webrtchttp', 'webrtc', 'dtls', 'srtp', 'nice', 'rtpmanager', 'udp',
];

const validationElements = [
  'avfvideosrc', 'vtenc_h264_hw', 'videorate', 'videoscale', 'h264parse', 'rtph264pay', 'whipsink', 'webrtcbin',
  'dtlssrtpenc', 'srtpenc', 'nicesink', 'rtpbin', 'fdsrc', 'queue', 'rawaudioparse', 'audioconvert', 'audioresample',
  'opusenc', 'rtpopuspay',
];

function required() {
  return /^(1|true|yes|on)$/i.test(String(process.env.CATREALM_REQUIRE_GSTREAMER_BUNDLE || '').trim());
}

function fail(message) {
  console.error(`[prepare-gstreamer-runtime] ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) {
    fail(`${command} ${args.join(' ')} failed:\n${result.error?.message || ''}${result.stdout || ''}${result.stderr || ''}`);
  }
  return result.stdout;
}

function sha256(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.alloc(1024 * 1024);
  try {
    for (let read = fs.readSync(fd, buffer); read > 0; read = fs.readSync(fd, buffer)) hash.update(buffer.subarray(0, read));
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

async function obtainPackage() {
  const override = String(process.env.CATREALM_GSTREAMER_MAC_PKG || '').trim();
  const cached = override || path.join(os.homedir(), 'Library', 'Caches', 'CatRealm', 'build', PKG_NAME);
  if (!fs.existsSync(cached)) {
    if (override) fail(`CATREALM_GSTREAMER_MAC_PKG does not exist: ${override}`);
    console.log(`[prepare-gstreamer-runtime] downloading ${PKG_URL}`);
    const response = await fetch(PKG_URL);
    if (!response.ok) fail(`download failed: HTTP ${response.status}`);
    fs.mkdirSync(path.dirname(cached), { recursive: true });
    const partial = `${cached}.partial`;
    fs.writeFileSync(partial, Buffer.from(await response.arrayBuffer()));
    fs.renameSync(partial, cached);
  }
  const actual = sha256(cached);
  if (actual !== PKG_SHA256) {
    if (!override) fs.rmSync(cached, { force: true });
    fail(`${cached} has SHA-256 ${actual}, expected ${PKG_SHA256}`);
  }
  return cached;
}

function unpackPackage(pkg, workDir) {
  const expanded = path.join(workDir, 'expanded');
  const sourceRoot = path.join(workDir, 'root');
  run('pkgutil', ['--expand-full', pkg, expanded]);
  fs.mkdirSync(sourceRoot, { recursive: true });
  for (const entry of fs.readdirSync(expanded)) {
    const payload = path.join(expanded, entry, 'Payload');
    if (fs.existsSync(payload)) run('ditto', [payload, sourceRoot]);
  }
  return sourceRoot;
}

function linkedRpathLibraries(file) {
  // The first line names the file itself and, for dylibs, the second is its own install name.
  return run('otool', ['-arch', 'arm64', '-L', file]).split('\n').slice(1)
    .map((line) => line.trim().split(' (')[0])
    .filter((name) => name.startsWith('@rpath/'))
    .map((name) => name.slice('@rpath/'.length));
}

function collectLibraries(sourceRoot, roots) {
  const libDir = path.join(sourceRoot, 'lib');
  const needed = new Set();
  const queue = [...roots];
  while (queue.length) {
    for (const name of linkedRpathLibraries(queue.shift())) {
      const file = path.join(libDir, name);
      if (needed.has(name) || !fs.existsSync(file)) continue;
      needed.add(name);
      queue.push(file);
    }
  }
  return [...needed];
}

function copyThin(source, relativeTarget) {
  const target = path.join(targetRoot, relativeTarget);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  run('lipo', [fs.realpathSync(source), '-thin', 'arm64', '-output', target]);
}

function buildHelper() {
  const target = path.join(targetRoot, 'bin', HELPER_NAME);
  run('xcrun', ['swiftc', '-O', '-target', HELPER_TARGET, helperSource, '-o', target]);
}

function writeNotice() {
  // The macOS package doesn't include the license files that the Windows one does.
  const notice = path.join(targetRoot, 'share', 'licenses', 'NOTICE.txt');
  fs.mkdirSync(path.dirname(notice), { recursive: true });
  fs.writeFileSync(notice, [
    `This directory contains GStreamer ${GST_VERSION} and libraries from the official macOS package,`,
    'dynamically linked and unmodified, except that binaries were thinned to arm64 and re-signed.',
    'GStreamer is licensed under the LGPL-2.1-or-later.',
    `Package: ${PKG_URL}`,
    'Source code: https://gstreamer.freedesktop.org/src/',
    'Build recipes and third-party library versions: https://gitlab.freedesktop.org/gstreamer/cerbero',
    '',
  ].join('\n'));
}

function validate() {
  const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'catrealm-gst-registry-'));
  const pluginDir = path.join(targetRoot, 'lib', 'gstreamer-1.0');
  const env = {
    ...process.env,
    GST_PLUGIN_PATH_1_0: pluginDir,
    GST_PLUGIN_SYSTEM_PATH_1_0: pluginDir,
    GST_PLUGIN_SCANNER_1_0: path.join(targetRoot, 'libexec', 'gstreamer-1.0', 'gst-plugin-scanner'),
    GST_REGISTRY_1_0: path.join(registryDir, 'registry.bin'),
  };
  try {
    const launcher = path.join(targetRoot, 'bin', BUNDLED_LAUNCHER);
    const smoke = spawnSync(launcher, ['-q', 'fakesrc', 'num-buffers=1', '!', 'fakesink'], { encoding: 'utf8', env, timeout: 60000 });
    if (smoke.status !== 0) fail(`smoke test failed:\n${smoke.stdout || ''}${smoke.stderr || ''}`);
    const inspect = path.join(targetRoot, 'bin', 'gst-inspect-1.0');
    const broken = validationElements.filter((element) => (
      spawnSync(inspect, ['--exists', element], { env, timeout: 15000 }).status !== 0
    ));
    if (broken.length) fail(`trimmed runtime is missing elements: ${broken.join(', ')}`);
    const screens = spawnSync(path.join(targetRoot, 'bin', HELPER_NAME), ['--list-screens'], { encoding: 'utf8', timeout: 15000 });
    if (screens.status !== 0) fail(`${HELPER_NAME} failed: ${screens.stderr || ''}`);
  } finally {
    fs.rmSync(registryDir, { recursive: true, force: true });
  }
}

function directorySize(root) {
  let files = 0;
  let bytes = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else { files += 1; bytes += fs.statSync(fullPath).size; }
    }
  };
  walk(root);
  return { files, mb: Math.round((bytes / 1024 / 1024) * 10) / 10 };
}

async function main() {
  if (/^(1|true|yes|on)$/i.test(String(process.env.CATREALM_SKIP_GSTREAMER_BUNDLE || '').trim())) {
    console.log('[prepare-gstreamer-runtime] skipped by CATREALM_SKIP_GSTREAMER_BUNDLE');
    return;
  }
  if (process.arch !== 'arm64') {
    const message = `macOS bundle preparation needs an arm64 host, not ${process.arch}.`;
    if (required()) fail(message);
    console.warn(`[prepare-gstreamer-runtime] ${message} Skipping.`);
    return;
  }

  const pkg = await obtainPackage();
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'catrealm-gst-'));
  try {
    const sourceRoot = unpackPackage(pkg, workDir);
    const tools = { 'bin/gst-launch-1.0': `bin/${BUNDLED_LAUNCHER}`, 'bin/gst-inspect-1.0': 'bin/gst-inspect-1.0', 'libexec/gstreamer-1.0/gst-plugin-scanner': 'libexec/gstreamer-1.0/gst-plugin-scanner' };
    const pluginFiles = plugins.map((plugin) => `lib/gstreamer-1.0/libgst${plugin}.dylib`);
    for (const relative of [...Object.keys(tools), ...pluginFiles]) {
      if (!fs.existsSync(path.join(sourceRoot, relative))) fail(`missing from ${PKG_NAME}: ${relative}`);
    }
    const libraries = collectLibraries(sourceRoot, [...Object.keys(tools), ...pluginFiles].map((relative) => path.join(sourceRoot, relative)));

    fs.rmSync(targetRoot, { recursive: true, force: true });
    for (const [source, target] of Object.entries(tools)) copyThin(path.join(sourceRoot, source), target);
    for (const relative of pluginFiles) copyThin(path.join(sourceRoot, relative), relative);
    for (const library of libraries) {
      // A plugin's own install name resolves to lib/<name>, where it doesn't exist.
      copyThin(path.join(sourceRoot, 'lib', library), path.join('lib', library));
    }
    buildHelper();
    writeNotice();
    validate();

    const size = directorySize(targetRoot);
    console.log(`[prepare-gstreamer-runtime] bundled ${size.files} files (${size.mb} MB), ${plugins.length} plugins and ${libraries.length} libraries from GStreamer ${GST_VERSION}`);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((error) => fail(error instanceof Error ? error.stack || error.message : String(error)));
