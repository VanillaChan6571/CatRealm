#!/usr/bin/env node
// Copies the trimmed GStreamer runtime from the shared Electron-client location
// into src-tauri, so Tauri bundles it via a SHORT resource path
// ("gstreamer/win-msvc-x64" in tauri.conf.json). The original
// "../../CatRealm-Client/electron/native/gstreamer/win-msvc-x64" reference blew
// past Windows MAX_PATH (260) for the deep GStreamer license tree when makensis
// packed the NSIS installer on the self-hosted runner's deep _work directory.
//
// Runs everywhere the Tauri app is built so the resource always exists before
// build.rs (tauri-build) validates it:
//   - locally  via `prepare:native` (dev / build / manual-start-dev.bat)
//   - in CI    as an explicit step before `cargo check` / `tauri build`
// The destination is gitignored (src-tauri/gstreamer/).
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..'); // CatRealm-Client-Tauri2-Rust
const src = path.resolve(
  projectRoot,
  '..',
  'CatRealm-Client',
  'electron',
  'native',
  'gstreamer',
  'win-msvc-x64',
);
const dest = path.resolve(projectRoot, 'src-tauri', 'gstreamer', 'win-msvc-x64');

const marker = path.join(src, 'bin', 'gst-inspect-1.0.exe');
if (!fs.existsSync(marker)) {
  console.error(
    `[stage-gstreamer] Source runtime not found at:\n  ${src}\n` +
      'Run the GStreamer prep first (npm run prepare:gstreamer).',
  );
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.cpSync(src, dest, { recursive: true });

if (!fs.existsSync(path.join(dest, 'bin', 'gst-inspect-1.0.exe'))) {
  console.error(`[stage-gstreamer] Copy to ${dest} did not complete.`);
  process.exit(1);
}
console.log(`[stage-gstreamer] Staged GStreamer runtime -> ${dest}`);
