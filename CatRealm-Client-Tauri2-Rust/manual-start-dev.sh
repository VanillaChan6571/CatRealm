#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname -- "$SCRIPT_DIR")"
RENDERER_DIR="$REPO_DIR/CatRealm-Client"
DEBUG_LOG_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/app.catrealm.desktop/logs"
LAUNCHER_LOG="$DEBUG_LOG_DIR/manual-start-tauri-dev-debug.log"

pause_on_failure() {
  local status=$?
  if (( status != 0 )) && [[ -t 0 ]] && [[ "${CATREALM_TAURI_LAUNCHER_SELF_TEST:-0}" != '1' ]]; then
    printf '\nLauncher failed with exit code %d. Press Enter to close...\n' "$status" >&2
    read -r _ || true
  fi
}
trap pause_on_failure EXIT

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$2"
}

ensure_deps() {
  local app_dir="$1"
  local app_label="$2"
  local source_file hash_file lock_hash saved_hash=''

  if [[ -f "$app_dir/package-lock.json" ]]; then
    source_file="$app_dir/package-lock.json"
  else
    source_file="$app_dir/package.json"
  fi
  hash_file="$app_dir/.deps-lock.hash"
  lock_hash="$(sha256sum "$source_file" | awk '{print $1}')"
  [[ -f "$hash_file" ]] && saved_hash="$(<"$hash_file")"

  if [[ ! -d "$app_dir/node_modules" || "$saved_hash" != "$lock_hash" ]]; then
    printf 'Installing/updating %s dependencies...\n' "$app_label"
    (cd "$app_dir" && npm install)
    printf '%s\n' "$lock_hash" > "$hash_file"
    printf '\n'
  fi
}

[[ -f "$RENDERER_DIR/package.json" ]] || fail "Could not find CatRealm-Client at: $RENDERER_DIR"

require_command node 'Node.js is not installed or is not on PATH.'
require_command npm 'npm is not installed or is not on PATH.'
require_command sha256sum 'sha256sum is required but was not found.'
require_command pkg-config 'pkg-config is required. Install the Linux prerequisites listed in CatRealm-Client-Tauri2-Rust/README.md.'
if ! pkg-config --exists glib-2.0 gobject-2.0 gdk-3.0 webkit2gtk-4.1; then
  fail 'Tauri Linux development libraries are missing. Run: sudo apt install pkg-config libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev'
fi
require_command gst-launch-1.0 'GStreamer tools are required for Linux camera and screen sharing. Run: sudo apt install gstreamer1.0-tools gstreamer1.0-plugins-good gstreamer1.0-libav v4l-utils'
require_command v4l2-ctl 'V4L2 utilities are required for Linux camera discovery. Run: sudo apt install v4l-utils'
if ! gst-inspect-1.0 v4l2src >/dev/null 2>&1 || ! gst-inspect-1.0 ximagesrc >/dev/null 2>&1; then
  fail 'GStreamer camera/screen plugins are missing. Run: sudo apt install gstreamer1.0-plugins-good gstreamer1.0-libav'
fi

mkdir -p "$DEBUG_LOG_DIR"
{
  printf 'manual-start-dev launched at %s\n' "$(date --iso-8601=seconds)"
  printf 'tauri_dir=%s\n' "$SCRIPT_DIR"
  printf 'renderer_dir=%s\n' "$RENDERER_DIR"
} > "$LAUNCHER_LOG"

ensure_deps "$RENDERER_DIR" 'React renderer'
ensure_deps "$SCRIPT_DIR" 'Tauri Rust shell'

export PATH="$HOME/.cargo/bin:$PATH"
require_command cargo 'Rust/Cargo is not installed or is not on PATH. Install Rust from https://rustup.rs/ and reopen this launcher.'
if ! cargo --version >/dev/null 2>&1; then
  fail 'Cargo is installed but has no usable Rust toolchain. Run: rustup default stable'
fi

(cd "$SCRIPT_DIR" && npm run prepare:native)

if [[ "${CATREALM_TAURI_LAUNCHER_SELF_TEST:-0}" == '1' ]]; then
  printf 'Launcher self-test passed.\n'
  exit 0
fi

export CATREALM_CHROMIUM_LOG=1
export CATREALM_CAPTURE_TEST_DEBUG=1
export CATREALM_NATIVE_WHIP_DEBUG=1
export RUST_BACKTRACE=1
export CATREALM_TAURI_DIR="$SCRIPT_DIR"
export CATREALM_RENDERER_DIR="$RENDERER_DIR"

{
  printf 'CATREALM_CHROMIUM_LOG=%s\n' "$CATREALM_CHROMIUM_LOG"
  printf 'CATREALM_CAPTURE_TEST_DEBUG=%s\n' "$CATREALM_CAPTURE_TEST_DEBUG"
  printf 'CATREALM_NATIVE_WHIP_DEBUG=%s\n' "$CATREALM_NATIVE_WHIP_DEBUG"
  printf 'RUST_BACKTRACE=%s\n' "$RUST_BACKTRACE"
} >> "$LAUNCHER_LOG"

printf '{"at":"%s","level":"info","scope":"manual-start-tauri-dev","message":"launcher started","details":{"cwd":"%s"}}\n' \
  "$(date --iso-8601=seconds)" "$PWD" >> "$DEBUG_LOG_DIR/client-debug.log"

printf 'Debug logging enabled:\n'
printf '  Client capture breadcrumbs: %s\n' "$DEBUG_LOG_DIR/client-debug.log"
printf '  Tauri launcher marker: %s\n\n' "$LAUNCHER_LOG"
printf 'Starting CatRealm Vite + Tauri dev shell...\n'

"$RENDERER_DIR/node_modules/.bin/concurrently" -k --success command-tauri -n vite,tauri -c cyan,green \
  'npm --prefix "$CATREALM_RENDERER_DIR" run dev' \
  '"$CATREALM_RENDERER_DIR/node_modules/.bin/wait-on" http://localhost:5173 --timeout 60000 && cd "$CATREALM_TAURI_DIR/src-tauri" && cargo run'
