#!/usr/bin/env bash
#
# Linux equivalent of manual-start-dev.bat — launches the Electron ("Sparky")
# client for representative performance/framerate comparisons against the Tauri
# ("Sushi") build.
#
# Modes (same as the .bat):
#   lean     (default) debug logging off; local DevTools inspector on 127.0.0.1:9222
#   profile  same as lean, labelled for DevTools-protocol profiling
#   debug    full Chromium/capture logging to ~/.config/CatRealm/logs
#
# Usage: ./manual-start-dev.sh [lean|profile|debug]
#
# Notes vs. the Windows launcher:
#   * The .bat's HKCU\...\UserGpuPreferences reg juggling is dropped: it is a
#     Windows-only mechanism, and electron/main.cjs already appends
#     `force-high-performance-gpu` + GPU-rasterization switches itself, so
#     Chromium selects the GPU on every platform without it.
#   * DevTools/CDP works here (Chromium), unlike the WebKitGTK Tauri build:
#     open chrome://inspect or http://127.0.0.1:9222 in Chrome once running.

set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

pause_on_failure() {
  local status=$?
  if (( status != 0 )) && [[ -t 0 ]]; then
    printf '\nLauncher failed with exit code %d. Press Enter to close...\n' "$status" >&2
    read -r _ || true
  fi
}
trap pause_on_failure EXIT

fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }
require_command() { command -v "$1" >/dev/null 2>&1 || fail "$2"; }

require_command node 'Node.js is not installed or is not on PATH.'
require_command npm 'npm is not installed or is not on PATH.'
require_command sha256sum 'sha256sum is required but was not found.'

# --- dependency install (hash package-lock.json, reinstall on change) ---------
if [[ -f package-lock.json ]]; then
  source_file='package-lock.json'
else
  source_file='package.json'
fi
lock_hash="$(sha256sum "$source_file" | awk '{print $1}')"
saved_hash=''
[[ -f .deps-lock.hash ]] && saved_hash="$(<.deps-lock.hash)"
if [[ ! -d node_modules || "$saved_hash" != "$lock_hash" ]]; then
  printf 'Installing/updating dependencies...\n'
  npm install || fail 'Dependency install failed.'
  printf '%s\n' "$lock_hash" > .deps-lock.hash
  printf '\n'
fi

# --- launch mode --------------------------------------------------------------
mode="${1:-lean}"
case "$mode" in
  --debug)   mode='debug' ;;
  --profile) mode='profile' ;;
esac

# Start clean even when these exist in the parent shell (lean mode is meant for
# representative memory/performance comparisons).
unset CATREALM_CHROMIUM_LOG CATREALM_CAPTURE_TEST_DEBUG CATREALM_NATIVE_WHIP_DEBUG \
      ELECTRON_ENABLE_LOGGING ELECTRON_ENABLE_STACK_DUMPING ELECTRON_REMOTE_DEBUG \
      CATREALM_DEBUG_LOG_DIR 2>/dev/null || true

case "$mode" in
  lean)
    export ELECTRON_REMOTE_DEBUG=9222
    printf 'Launch mode: lean (debug logging disabled; local inspector on 127.0.0.1:9222)\n'
    ;;
  profile)
    export ELECTRON_REMOTE_DEBUG=9222
    printf 'Launch mode: profile (DevTools protocol on 127.0.0.1:9222)\n'
    ;;
  debug)
    export CATREALM_CHROMIUM_LOG=1
    export CATREALM_CAPTURE_TEST_DEBUG=1
    export CATREALM_NATIVE_WHIP_DEBUG=1
    export ELECTRON_ENABLE_LOGGING=1
    export ELECTRON_ENABLE_STACK_DUMPING=1
    export ELECTRON_REMOTE_DEBUG=9222
    export CATREALM_DEBUG_LOG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/CatRealm/logs"
    mkdir -p "$CATREALM_DEBUG_LOG_DIR"
    {
      printf 'manual-start-dev launched at %s\n' "$(date --iso-8601=seconds)"
      printf 'cwd=%s\n' "$PWD"
      printf 'launchMode=%s\n' "$mode"
    } > "$CATREALM_DEBUG_LOG_DIR/manual-start-dev-debug.log"
    printf '{"at":"%s","level":"info","scope":"manual-start-dev","message":"launcher started","details":{"cwd":"%s"}}\n' \
      "$(date --iso-8601=seconds)" "$PWD" >> "$CATREALM_DEBUG_LOG_DIR/client-debug.log"
    printf 'Launch mode: debug\n'
    printf '  Chromium GPU/capture log: %s/chromium.log\n' "$CATREALM_DEBUG_LOG_DIR"
    printf '  Client capture breadcrumbs: %s/client-debug.log\n' "$CATREALM_DEBUG_LOG_DIR"
    printf '  Launcher marker: %s/manual-start-dev-debug.log\n' "$CATREALM_DEBUG_LOG_DIR"
    ;;
  *)
    printf 'Unknown mode "%s".\n' "$mode" >&2
    printf 'Usage: manual-start-dev.sh [lean|profile|debug]\n' >&2
    exit 2
    ;;
esac

# --- Electron sandbox guard ---------------------------------------------------
# Chromium's sandbox needs EITHER a setuid-root chrome-sandbox helper OR
# unprivileged user namespaces. On Ubuntu 23.10+/24.04 the AppArmor policy
# (kernel.apparmor_restrict_unprivileged_userns=1) blocks the namespace path for
# unconfined binaries, and npm installs chrome-sandbox without the setuid bit —
# so Electron aborts within ~2s of launch and the concurrently -k pair tears
# down, which is why the window closes immediately.
#
# For this dev/perf launcher the sandbox is irrelevant to framerate, so disable
# it when a working SUID helper isn't present. Set CATREALM_FORCE_SANDBOX=1 to
# opt back into the real sandbox (then run the printed chmod once to enable it).
SANDBOX_BIN="$SCRIPT_DIR/node_modules/electron/dist/chrome-sandbox"
if [[ "${CATREALM_FORCE_SANDBOX:-0}" != '1' ]]; then
  suid_ok=0
  if [[ -u "$SANDBOX_BIN" ]] && [[ "$(stat -c '%U' "$SANDBOX_BIN" 2>/dev/null)" == 'root' ]]; then
    suid_ok=1
  fi
  if (( suid_ok == 0 )); then
    export ELECTRON_DISABLE_SANDBOX=1
    printf 'Note: Electron sandbox disabled (no setuid chrome-sandbox helper).\n'
    printf '      To use the real sandbox instead, run once:\n'
    printf '        sudo chown root:root "%s" && sudo chmod 4755 "%s"\n' "$SANDBOX_BIN" "$SANDBOX_BIN"
    printf '      then relaunch with CATREALM_FORCE_SANDBOX=1.\n'
  fi
fi

printf '\nOther modes: manual-start-dev.sh profile | debug\n\n'
printf 'Starting CatRealm (Electron)...\n'

npm run dev:electron
