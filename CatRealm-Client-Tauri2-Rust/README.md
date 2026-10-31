# CatRealm Desktop — Tauri 2 / Rust Spike

A Rust-shell (Tauri 2 + WebView2) version of the CatRealm desktop client. It
loads the **existing** React renderer from `../CatRealm-Client` — nothing in
that codebase is forked or modified. The Electron app remains the shipping
desktop client until this spike proves out.

## How it works

- `src-tauri/tauri.conf.json` points `frontendDist` at `../CatRealm-Client/dist`
  (production) and `devUrl` at `http://localhost:5173` (the same Vite dev
  server the Electron app uses).
- `src-tauri/injected/electron-shim.js` is injected before page load and
  recreates the full `window.electron` API from
  `CatRealm-Client/electron/preload.cjs`, backed by Tauri commands/events with
  the **same event channel names** the Electron IPC used. The renderer cannot
  tell the difference (until it hits a stubbed native feature).
- `src-tauri/src/lib.rs` implements the low-risk surfaces for real:
  - tray icon + close-to-tray, single instance, autostart (open on startup)
  - persisted desktop settings (`desktop-settings.json` in the app config dir)
  - external URL opening, fullscreen toggle, passkey popup window
  - debug log files, OBS overlay HTTP server (`src/obs_overlay.rs`, Rust
    replacement for the Node `http.createServer` in `electron/main.cjs`)
- `src-tauri/src/capture.rs` holds honest stubs for the two high-risk ports:
  the FFmpeg/GStreamer WHIP screen-share publisher
  (`electron/whipPublisherBridge.cjs`) and the WASAPI app-audio capture
  (`electron/windowsAppAudioBridge.cjs`). They report
  `{ supported: false, reason: "tauri-spike-stub" }` so the renderer degrades
  exactly as it does in a plain browser.

## Running

```sh
# dev (needs the Vite dev server from CatRealm-Client running)
cd ../CatRealm-Client && npm run dev        # terminal 1
npm install && npm run dev                  # terminal 2, in this folder

# production-style (loads ../CatRealm-Client/dist)
cd ../CatRealm-Client && npm run build
npm run build                               # NSIS bundle on Windows
```

On Linux, install the build and native-media prerequisites first:

```sh
sudo apt install pkg-config libwebkit2gtk-4.1-dev libgtk-3-dev \
  libayatana-appindicator3-dev gstreamer1.0-tools \
  gstreamer1.0-plugins-good gstreamer1.0-libav v4l-utils
```

Linux WebKitGTK media capture stays disabled because its PipeWire WebRTC path
is unstable on affected Ubuntu builds. Voice, camera, and X11 monitor sharing
instead run natively: LiveKit Rust owns the room, `v4l2src`/`ximagesrc` produce
I420 frames, and the native LiveKit video source publishes those frames.

### Linux webview rendering backend (GPU)

There is no D3D11 on Linux; the webview is **WebKitGTK**, which GPU-composites
via OpenGL. WebKitGTK 2.40+ defaults to a DMABUF/GBM renderer that frequently
fails on the **NVIDIA proprietary driver under X11** and falls back to software
(CPU) rendering — the whole React UI is then painted on one CPU thread, which
reads as "the GPU isn't being used" and shows up as lag (most visibly in
Settings).

To avoid this, `configure_linux_webview_gpu` in `src-tauri/src/lib.rs` sets
`WEBKIT_DISABLE_DMABUF_RENDERER=1` at launch **when the NVIDIA proprietary
driver is loaded**, dropping WebKit onto the legacy GLX accelerated-compositing
path that uses the GPU reliably on X11. Intel/AMD/Nouveau keep WebKit's default
DMABUF renderer.

The backend is selectable via the persisted `webviewRenderBackend` desktop
setting (commands `get_webview_render_backend` / `set_webview_render_backend`;
changing it needs a relaunch):

| value        | effect                                                        |
| ------------ | ------------------------------------------------------------- |
| `auto`       | default — apply the NVIDIA-safe legacy path only on NVIDIA    |
| `gpu-legacy` | always force the legacy GLX path (`DMABUF_RENDERER=0` → off)  |
| `gpu-dmabuf` | always keep WebKit's modern DMABUF renderer                   |
| `software`   | disable compositing (`WEBKIT_DISABLE_COMPOSITING_MODE=1`)     |

An explicit `WEBKIT_DISABLE_DMABUF_RENDERER` / `WEBKIT_DISABLE_COMPOSITING_MODE`
env var always overrides the setting, e.g. to A/B test:

```sh
WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run dev    # force legacy GL path
WEBKIT_DISABLE_DMABUF_RENDERER=0 npm run dev    # force DMABUF renderer
```

Verify the GPU is actually engaged with `nvidia-smi dmon -s u` (or the process
list in `nvidia-smi`) while scrolling Settings — utilization should rise and the
main-thread CPU should drop. Note the GPU only composites; WebKit still runs
React/layout/paint and GIF decode on the CPU main thread, so also prefer the
production renderer (`../CatRealm-Client/dist`) over the Vite dev server for the
smoothest result.

## Spike success criteria (test on a real Windows machine)

1. App boots and loads the CatRealm client in WebView2; login + chat work.
2. Joining a LiveKit voice channel works (mic, RNNoise AudioWorklet, playback).
3. Screen share via the FFmpeg/GStreamer sidecar publishes a WHIP stream
   (requires replacing the `capture.rs` stubs with a port of
   `whipPublisherBridge.cjs`, with the binaries declared as Tauri sidecars).
4. `CatRealmAppAudioCapture.exe` PCM streams into the renderer at acceptable
   latency over Tauri events (or a local WebSocket if event throughput is
   insufficient).

If all four pass, the remaining Electron surface (updater, embedded logins,
YouTube cookie window, game activity, firewall rule) is mechanical porting —
see the feasibility assessment for the full mapping table.

## Not yet ported (stubbed)

Screen share + app audio capture (the point of the spike), auto-update
(needs the Tauri updater plugin + new signing keys + channel/downgrade logic),
voice debug console window, screenshare wizard window, embedded platform
logins, theater YouTube cookie window, game activity detection, firewall rule.
