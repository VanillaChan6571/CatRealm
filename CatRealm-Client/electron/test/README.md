# Electron hardware discovery regression tests

Run `npm run test:electron` from `CatRealm-Client` (Node's built-in test runner).
These tests load the real CommonJS discovery code with simulated Windows process
responses. They never launch PowerShell, GStreamer, FFmpeg, or Electron.

Coverage includes non-blocking cold discovery, startup/request deduplication,
cache reuse and failure retries, GPU/encoder mapping, missing binaries, timeout
cleanup, bounded output, and the actual native-support IPC registration.
Renderer loading/interaction tests run with the existing `npm test` Vitest suite.

Windows smoke check: in a fresh Electron session, open Settings → Voice before
startup discovery finishes, switch tabs while discovery is pending, then reopen
Voice. Controls and window actions should stay responsive and the GPU list
should populate normally. Verify this with the packaged GStreamer runtime as
well as with it unavailable; these unit tests do not exercise real GPU drivers.
