//! Sushi (Tauri) desktop updater.
//!
//! Reuses the update infrastructure the Electron client (Sparky) already relies
//! on: CI publishes `CatRealm-Sushi_<version>_x64-setup.exe` plus a per-channel
//! manifest `<channel>-sushi.yml` (version / path / sha512) to
//! `https://catrealm.app/downloads/win/`. This module reads that manifest,
//! compares versions, downloads the installer with progress, verifies its
//! sha512, and runs it silently — emitting `app-update-status` events in the
//! exact shape the shared renderer's DesktopUpdateBanner + Updates tab consume.
//!
//! Windows-only (the only installer target). Non-Windows reports `unsupported`,
//! matching Sparky's `canAutoUpdate = isWindows`.

use crate::AppState;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
#[cfg(windows)]
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

#[cfg(windows)]
const DEFAULT_UPDATE_BASE: &str = "https://catrealm.app/downloads/win/";
#[cfg(windows)]
const MAX_AUTO_RETRIES: u32 = 3;

#[cfg(windows)]
const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
#[cfg(windows)]
const READ_TIMEOUT: Duration = Duration::from_secs(60);
#[cfg(windows)]
const INITIAL_CHECK_DELAY: Duration = Duration::from_secs(3);

#[cfg(windows)]
const UPDATES_SUPPORTED: bool = true;
#[cfg(not(windows))]
const UPDATES_SUPPORTED: bool = false;

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested, platform-agnostic)
// ---------------------------------------------------------------------------

/// The download server base URL, overridable for local testing.
#[cfg(windows)]
fn update_base() -> String {
    match std::env::var("CATREALM_SUSHI_UPDATE_BASE") {
        Ok(value) if !value.trim().is_empty() => {
            let value = value.trim().to_string();
            if value.ends_with('/') {
                value
            } else {
                format!("{value}/")
            }
        }
        _ => DEFAULT_UPDATE_BASE.to_string(),
    }
}

/// Sushi publishes only Stable and Dev. Archived or otherwise unknown channel
/// ids fall back to Stable so legacy settings never request missing manifests.
#[cfg(windows)]
fn normalize_channel(channel: &str) -> String {
    let c = channel.trim().to_ascii_lowercase();
    match c.as_str() {
        "" | "stable" | "latest" => "latest".to_string(),
        "dev" => "dev".to_string(),
        _ => "latest".to_string(),
    }
}

/// e.g. "dev" -> "dev-sushi.yml", "stable" -> "latest-sushi.yml".
#[cfg(windows)]
fn channel_to_manifest_file(channel: &str) -> String {
    format!("{}-sushi.yml", normalize_channel(channel))
}

#[cfg(windows)]
#[derive(Debug, Clone, PartialEq)]
struct Manifest {
    version: String,
    path: String,
    sha512: Option<String>,
}

/// Strip a single pair of matching surrounding quotes and trim.
#[cfg(windows)]
fn unquote(value: &str) -> String {
    let t = value.trim();
    let bytes = t.as_bytes();
    if bytes.len() >= 2 {
        let first = bytes[0];
        let last = bytes[bytes.len() - 1];
        if (first == b'\'' && last == b'\'') || (first == b'"' && last == b'"') {
            return t[1..t.len() - 1].trim().to_string();
        }
    }
    t.to_string()
}

/// Parse the line-based `<channel>-sushi.yml`. version + path are required.
#[cfg(windows)]
fn parse_manifest(text: &str) -> Option<Manifest> {
    let mut version = None;
    let mut path = None;
    let mut sha512 = None;
    for line in text.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("version:") {
            version = Some(unquote(rest));
        } else if let Some(rest) = line.strip_prefix("path:") {
            path = Some(unquote(rest));
        } else if let Some(rest) = line.strip_prefix("sha512:") {
            sha512 = Some(unquote(rest));
        }
    }
    Some(Manifest {
        version: version.filter(|v| !v.is_empty())?,
        path: path.filter(|p| !p.is_empty())?,
        sha512: sha512.filter(|s| !s.is_empty()),
    })
}

/// The installer path from the manifest must be a bare filename we control —
/// never a path that could escape the downloads directory.
#[cfg(windows)]
fn is_safe_installer_name(name: &str) -> bool {
    !name.is_empty()
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains("..")
        && name.to_ascii_lowercase().ends_with(".exe")
}

/// True when `candidate` should be installed over `current`. Normal checks are
/// strictly-newer (semver, prerelease-aware); channel downgrades relax this to
/// "different version". Unparseable versions never trigger an update.
#[cfg(windows)]
fn is_update_available(current: &str, candidate: &str, allow_downgrade: bool) -> bool {
    let cur = semver::Version::parse(current.trim().trim_start_matches('v'));
    let cand = semver::Version::parse(candidate.trim().trim_start_matches('v'));
    match (cur, cand) {
        (Ok(cur), Ok(cand)) => {
            if allow_downgrade {
                cand != cur
            } else {
                cand > cur
            }
        }
        _ => false,
    }
}

// ---------------------------------------------------------------------------
// Shared updater state
// ---------------------------------------------------------------------------

#[derive(Default)]
struct UpdaterInner {
    /// Latest emitted `app-update-status` payload (served by get_update_status).
    status: Option<Value>,
    downloaded_path: Option<PathBuf>,
    downloaded_version: Option<String>,
    /// Install as soon as a download finishes (the renderer's "Force" action).
    queued_install: bool,
    /// Relax the strictly-newer check (set by downgrade_client).
    allow_downgrade: bool,
    /// A check/download worker is currently running.
    in_progress: bool,
    /// Epoch-ms of the next scheduled periodic check (for the settings countdown).
    next_check_at: Option<u64>,
}

#[derive(Clone)]
pub struct UpdaterService {
    inner: Arc<Mutex<UpdaterInner>>,
}

impl UpdaterService {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(UpdaterInner::default())),
        }
    }
}

impl Default for UpdaterService {
    fn default() -> Self {
        Self::new()
    }
}

/// Store the status and broadcast it to every window's `app-update-status`
/// listener (the shim registers a global listener for this event).
fn emit_status(app: &AppHandle, inner: &Arc<Mutex<UpdaterInner>>, status: Value) {
    if let Ok(mut guard) = inner.lock() {
        guard.status = Some(status.clone());
    }
    let _ = app.emit("app-update-status", status);
}

fn updates_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_cache_dir()
        .ok()
        .map(|dir| dir.join("updates"))
}

fn unsupported() -> Value {
    json!({
        "ok": false,
        "reason": "unsupported",
        "message": "Desktop updates are only available on Windows.",
    })
}

// ---------------------------------------------------------------------------
// Commands (registered in lib.rs)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_update_channel(state: State<AppState>) -> Value {
    json!({ "channel": state.settings.lock().unwrap().update_channel })
}

#[tauri::command]
pub fn set_update_channel(app: AppHandle, state: State<AppState>, channel: String) -> Value {
    {
        let mut settings = state.settings.lock().unwrap();
        settings.update_channel = channel.clone();
    }
    state.save();
    {
        let mut guard = state.updater.inner.lock().unwrap();
        guard.downloaded_path = None;
        guard.downloaded_version = None;
        guard.queued_install = false;
        guard.allow_downgrade = false;
    }
    emit_status(&app, &state.updater.inner, json!({ "state": "idle" }));
    spawn_check(app, state.updater.clone(), channel.clone());
    json!({ "ok": true, "channel": channel })
}

#[tauri::command]
pub fn check_for_updates(app: AppHandle, state: State<AppState>) -> Value {
    if !UPDATES_SUPPORTED {
        return unsupported();
    }
    let channel = state.settings.lock().unwrap().update_channel.clone();
    if spawn_check(app, state.updater.clone(), channel) {
        json!({ "ok": true })
    } else {
        json!({ "ok": false, "reason": "busy", "message": "An update check is already in progress." })
    }
}

#[tauri::command]
pub fn get_update_status(state: State<AppState>) -> Value {
    if !UPDATES_SUPPORTED {
        return json!({ "state": "unsupported" });
    }
    state
        .updater
        .inner
        .lock()
        .ok()
        .and_then(|guard| guard.status.clone())
        .unwrap_or_else(|| json!({ "state": "idle" }))
}

#[tauri::command]
pub fn get_next_update_check_at(state: State<AppState>) -> Value {
    let next = if UPDATES_SUPPORTED {
        state.updater.inner.lock().ok().and_then(|g| g.next_check_at)
    } else {
        None
    };
    json!({ "nextCheckAt": next })
}

#[tauri::command]
pub fn queue_next_update_install(app: AppHandle, state: State<AppState>) -> Value {
    if !UPDATES_SUPPORTED {
        return unsupported();
    }
    let ready = state
        .updater
        .inner
        .lock()
        .map(|g| g.downloaded_path.is_some())
        .unwrap_or(false);
    if ready {
        return match do_install(&app, &state.updater.inner) {
            Ok(()) => json!({ "ok": true }),
            Err(reason) => install_error(reason),
        };
    }
    {
        let mut guard = state.updater.inner.lock().unwrap();
        guard.queued_install = true;
    }
    let channel = state.settings.lock().unwrap().update_channel.clone();
    spawn_check(app, state.updater.clone(), channel);
    json!({ "ok": true })
}

#[tauri::command]
pub fn install_update(app: AppHandle, state: State<AppState>) -> Value {
    if !UPDATES_SUPPORTED {
        return unsupported();
    }
    match do_install(&app, &state.updater.inner) {
        Ok(()) => json!({ "ok": true }),
        Err(reason) => install_error(reason),
    }
}

#[tauri::command]
pub fn downgrade_client(app: AppHandle, state: State<AppState>) -> Value {
    if !UPDATES_SUPPORTED {
        return unsupported();
    }
    {
        let mut settings = state.settings.lock().unwrap();
        settings.update_channel = "latest".into();
    }
    state.save();
    {
        let mut guard = state.updater.inner.lock().unwrap();
        guard.allow_downgrade = true;
        guard.downloaded_path = None;
        guard.downloaded_version = None;
    }
    spawn_check(app, state.updater.clone(), "latest".to_string());
    json!({ "ok": true })
}

#[tauri::command]
pub fn clear_and_retry_update(app: AppHandle, state: State<AppState>) -> Value {
    if !UPDATES_SUPPORTED {
        return unsupported();
    }
    {
        let mut guard = state.updater.inner.lock().unwrap();
        guard.downloaded_path = None;
        guard.downloaded_version = None;
    }
    // Wipe any partial download so the retry starts clean.
    if let Some(dir) = updates_dir(&app) {
        let _ = std::fs::remove_dir_all(&dir);
    }
    let channel = state.settings.lock().unwrap().update_channel.clone();
    if spawn_check(app, state.updater.clone(), channel) {
        json!({ "ok": true })
    } else {
        json!({ "ok": false, "reason": "busy", "message": "A retry is already in progress." })
    }
}

fn install_error(reason: String) -> Value {
    if reason == "not_ready" {
        json!({ "ok": false, "reason": "not_ready", "message": "Update is still downloading or unavailable." })
    } else {
        json!({ "ok": false, "reason": "install_failed", "message": reason })
    }
}

// ---------------------------------------------------------------------------
// Worker orchestration
// ---------------------------------------------------------------------------

/// Ensures `in_progress` is cleared even if the worker panics.
#[cfg(windows)]
struct InProgressGuard(Arc<Mutex<UpdaterInner>>);
#[cfg(windows)]
impl Drop for InProgressGuard {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.0.lock() {
            guard.in_progress = false;
        }
    }
}

/// Spawn a background check/download. Returns false if one is already running
/// or updates are unsupported on this platform.
fn spawn_check(app: AppHandle, updater: UpdaterService, channel: String) -> bool {
    if !UPDATES_SUPPORTED {
        let _ = (&app, &updater, &channel);
        return false;
    }
    {
        let mut guard = updater.inner.lock().unwrap();
        if guard.in_progress {
            return false;
        }
        guard.in_progress = true;
    }
    #[cfg(windows)]
    {
        let inner = updater.inner.clone();
        std::thread::spawn(move || {
            let _guard = InProgressGuard(inner.clone());
            run_update_flow(&app, &inner, &channel);
        });
        true
    }
    #[cfg(not(windows))]
    {
        // Unreachable (UPDATES_SUPPORTED is false), but keeps types consistent.
        if let Ok(mut guard) = updater.inner.lock() {
            guard.in_progress = false;
        }
        false
    }
}

/// Started once from lib.rs setup: an initial check shortly after launch, then
/// periodic checks whose cadence depends on the channel.
pub fn start_periodic_updater(app: AppHandle) {
    if !UPDATES_SUPPORTED {
        let _ = app;
        return;
    }
    #[cfg(windows)]
    std::thread::spawn(move || {
        std::thread::sleep(INITIAL_CHECK_DELAY);
        loop {
            let (updater, channel) = {
                let state = app.state::<AppState>();
                let updater = state.updater.clone();
                let channel = state.settings.lock().unwrap().update_channel.clone();
                (updater, channel)
            };
            let interval = check_interval(&channel);
            if let Ok(mut guard) = updater.inner.lock() {
                guard.next_check_at = Some(crate::now_ms() as u64 + interval.as_millis() as u64);
            }
            spawn_check(app.clone(), updater, channel);
            std::thread::sleep(interval);
        }
    });
}

#[cfg(windows)]
fn check_interval(channel: &str) -> Duration {
    if normalize_channel(channel) == "latest" {
        Duration::from_secs(30 * 60)
    } else {
        Duration::from_secs(15 * 60)
    }
}

#[cfg(windows)]
fn run_update_flow(app: &AppHandle, inner: &Arc<Mutex<UpdaterInner>>, channel: &str) {
    emit_status(app, inner, json!({ "state": "checking" }));

    let agent = match build_agent() {
        Ok(agent) => agent,
        Err(message) => {
            emit_status(app, inner, json!({ "state": "error", "message": message }));
            return;
        }
    };

    let base = update_base();
    let manifest_url = format!("{}{}", base, channel_to_manifest_file(channel));
    let manifest = match fetch_manifest(&agent, &manifest_url) {
        Ok(manifest) => manifest,
        Err(message) => {
            emit_status(app, inner, json!({ "state": "error", "message": message }));
            return;
        }
    };

    let current = app.package_info().version.to_string();
    let allow_downgrade = inner.lock().map(|g| g.allow_downgrade).unwrap_or(false);
    if !is_update_available(&current, &manifest.version, allow_downgrade) {
        emit_status(app, inner, json!({ "state": "not-available" }));
        return;
    }

    // We execute the downloaded installer, so an integrity hash is mandatory.
    let Some(expected_sha) = manifest.sha512.clone() else {
        emit_status(
            app,
            inner,
            json!({ "state": "error", "message": "Update manifest is missing an integrity hash; refusing to install." }),
        );
        return;
    };
    if !is_safe_installer_name(&manifest.path) {
        emit_status(
            app,
            inner,
            json!({ "state": "error", "message": "Update manifest references an unsafe installer path." }),
        );
        return;
    }

    let Some(dir) = updates_dir(app) else {
        emit_status(app, inner, json!({ "state": "error", "message": "Could not resolve the update cache directory." }));
        return;
    };
    if let Err(err) = std::fs::create_dir_all(&dir) {
        emit_status(app, inner, json!({ "state": "error", "message": format!("Could not create update cache: {err}") }));
        return;
    }
    let dest = dir.join(&manifest.path);
    let part = dest.with_extension("part");
    let url = format!("{}{}", base, manifest.path);

    emit_status(
        app,
        inner,
        json!({ "state": "downloading", "version": manifest.version, "percent": 0 }),
    );

    // Bounded stall-retry: the agent's read timeout surfaces a hung transfer as
    // an error; clear the partial file and retry, mirroring Sparky's watchdog.
    let mut attempt: u32 = 0;
    loop {
        let _ = std::fs::remove_file(&part);
        let progress_inner = inner.clone();
        let progress_app = app.clone();
        let version = manifest.version.clone();
        let result = download_file(&agent, &url, &part, |percent| {
            emit_status(
                &progress_app,
                &progress_inner,
                json!({ "state": "downloading", "version": version, "percent": percent }),
            );
        });
        match result {
            Ok(()) => break,
            Err(message) => {
                attempt += 1;
                if attempt <= MAX_AUTO_RETRIES {
                    emit_status(
                        app,
                        inner,
                        json!({
                            "state": "error",
                            "stalled": true,
                            "message": format!("Download stalled — clearing and retrying ({attempt}/{MAX_AUTO_RETRIES})…"),
                        }),
                    );
                    std::thread::sleep(Duration::from_secs(2));
                    continue;
                }
                let _ = std::fs::remove_file(&part);
                emit_status(
                    app,
                    inner,
                    json!({
                        "state": "error",
                        "stalled": true,
                        "canRetry": true,
                        "message": format!("Update download keeps stalling ({message}). Check your connection, then Clear & Retry."),
                    }),
                );
                return;
            }
        }
    }

    match sha512_hex(&part) {
        Ok(actual) if actual.eq_ignore_ascii_case(expected_sha.trim()) => {}
        Ok(_) => {
            let _ = std::fs::remove_file(&part);
            emit_status(
                app,
                inner,
                json!({ "state": "error", "message": "Downloaded update failed integrity verification and was discarded." }),
            );
            return;
        }
        Err(err) => {
            let _ = std::fs::remove_file(&part);
            emit_status(app, inner, json!({ "state": "error", "message": format!("Could not verify the update: {err}") }));
            return;
        }
    }

    if let Err(err) = std::fs::rename(&part, &dest) {
        emit_status(app, inner, json!({ "state": "error", "message": format!("Could not finalize the update: {err}") }));
        return;
    }

    let queued = {
        let mut guard = inner.lock().unwrap();
        guard.downloaded_path = Some(dest.clone());
        guard.downloaded_version = Some(manifest.version.clone());
        guard.queued_install
    };
    emit_status(
        app,
        inner,
        json!({ "state": "downloaded", "version": manifest.version }),
    );

    if queued {
        let _ = do_install(app, inner);
    }
}

#[cfg(windows)]
fn build_agent() -> Result<ureq::Agent, String> {
    let connector = native_tls::TlsConnector::new().map_err(|e| format!("TLS init failed: {e}"))?;
    Ok(ureq::AgentBuilder::new()
        .timeout_connect(CONNECT_TIMEOUT)
        .timeout_read(READ_TIMEOUT)
        .tls_connector(Arc::new(connector))
        .build())
}

#[cfg(windows)]
fn fetch_manifest(agent: &ureq::Agent, url: &str) -> Result<Manifest, String> {
    let text = agent
        .get(url)
        .call()
        .map_err(|e| format!("Could not reach the update server: {e}"))?
        .into_string()
        .map_err(|e| format!("Could not read the update manifest: {e}"))?;
    parse_manifest(&text).ok_or_else(|| "Update manifest was malformed.".to_string())
}

#[cfg(windows)]
fn download_file(
    agent: &ureq::Agent,
    url: &str,
    dest: &std::path::Path,
    mut on_progress: impl FnMut(i64),
) -> Result<(), String> {
    use std::io::{Read, Write};

    let response = agent
        .get(url)
        .call()
        .map_err(|e| format!("download request failed: {e}"))?;
    let total: Option<u64> = response
        .header("Content-Length")
        .and_then(|value| value.parse().ok());

    let mut reader = response.into_reader();
    let mut file = std::fs::File::create(dest).map_err(|e| format!("could not open temp file: {e}"))?;
    let mut buffer = [0u8; 64 * 1024];
    let mut downloaded: u64 = 0;
    let mut last_percent: i64 = -1;

    loop {
        // A read timeout (stalled socket) surfaces here as an io::Error.
        let read = reader
            .read(&mut buffer)
            .map_err(|e| format!("transfer interrupted: {e}"))?;
        if read == 0 {
            break;
        }
        file.write_all(&buffer[..read])
            .map_err(|e| format!("write failed: {e}"))?;
        downloaded += read as u64;
        if let Some(total) = total {
            if total > 0 {
                let percent = (((downloaded as f64) / (total as f64)) * 100.0).round() as i64;
                let percent = percent.clamp(0, 100);
                if percent != last_percent {
                    last_percent = percent;
                    on_progress(percent);
                }
            }
        }
    }
    file.sync_all().map_err(|e| format!("flush failed: {e}"))?;
    Ok(())
}

#[cfg(windows)]
fn sha512_hex(path: &std::path::Path) -> Result<String, String> {
    use sha2::{Digest, Sha512};
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha512::new();
    std::io::copy(&mut file, &mut hasher).map_err(|e| e.to_string())?;
    let digest = hasher.finalize();
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        use std::fmt::Write as _;
        let _ = write!(hex, "{byte:02x}");
    }
    Ok(hex)
}

// ---------------------------------------------------------------------------
// Silent install + relaunch
// ---------------------------------------------------------------------------

#[cfg(windows)]
fn do_install(app: &AppHandle, inner: &Arc<Mutex<UpdaterInner>>) -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    let installer = {
        inner
            .lock()
            .ok()
            .and_then(|guard| guard.downloaded_path.clone())
    };
    let Some(installer) = installer else {
        return Err("not_ready".into());
    };
    if !installer.exists() {
        return Err("not_ready".into());
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;

    // A .bat carries the (possibly space-containing) installer + exe paths as
    // literal quoted strings, sidestepping cmd /C argument-quoting pitfalls.
    // `ping` (not `timeout`) is the delay: `timeout` errors without a console,
    // and this helper runs detached with no console.
    let script = format!(
        "@echo off\r\nping 127.0.0.1 -n 3 >nul\r\n\"{installer}\" /S\r\nping 127.0.0.1 -n 2 >nul\r\nstart \"\" \"{exe}\"\r\n",
        installer = installer.display(),
        exe = exe.display(),
    );
    let script_path = installer
        .parent()
        .map(|dir| dir.join("catrealm-sushi-update.bat"))
        .ok_or_else(|| "could not resolve update script path".to_string())?;
    std::fs::write(&script_path, script).map_err(|e| format!("could not write update script: {e}"))?;

    // CREATE_NO_WINDOW alone: combining it with DETACHED_PROCESS makes
    // Windows ignore CREATE_NO_WINDOW, and the console-less cmd's children
    // (ping.exe) then allocate a visible console window mid-update. Children
    // outlive the exiting app either way, so detachment isn't needed.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    std::process::Command::new("cmd")
        .arg("/C")
        .arg(&script_path)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("could not launch installer: {e}"))?;

    crate::capture::stop_all_native_whip_publishers(app);
    // Give the detached helper a beat, then exit so the per-user NSIS installer
    // can replace the (currently locked) app executable.
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(400));
        app.exit(0);
    });
    Ok(())
}

#[cfg(not(windows))]
fn do_install(_app: &AppHandle, _inner: &Arc<Mutex<UpdaterInner>>) -> Result<(), String> {
    Err("unsupported".into())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn channel_maps_to_manifest_file() {
        assert_eq!(channel_to_manifest_file("stable"), "latest-sushi.yml");
        assert_eq!(channel_to_manifest_file("latest"), "latest-sushi.yml");
        assert_eq!(channel_to_manifest_file(""), "latest-sushi.yml");
        assert_eq!(channel_to_manifest_file("dev"), "dev-sushi.yml");
        assert_eq!(channel_to_manifest_file("LiveKitDev"), "latest-sushi.yml");
        assert_eq!(channel_to_manifest_file("custom"), "latest-sushi.yml");
    }

    #[test]
    fn parses_manifest() {
        let yml = "version: 1.8.2-dev.664\npath: CatRealm-Sushi_1.8.2-dev.664_x64-setup.exe\nsha512: abc123\nreleaseDate: '2026-07-14T00:00:00.000Z'\n";
        let manifest = parse_manifest(yml).expect("should parse");
        assert_eq!(manifest.version, "1.8.2-dev.664");
        assert_eq!(manifest.path, "CatRealm-Sushi_1.8.2-dev.664_x64-setup.exe");
        assert_eq!(manifest.sha512.as_deref(), Some("abc123"));
    }

    #[test]
    fn parse_requires_version_and_path() {
        assert!(parse_manifest("path: x.exe\n").is_none());
        assert!(parse_manifest("version: 1.0.0\n").is_none());
        assert!(parse_manifest("").is_none());
    }

    #[test]
    fn version_comparison() {
        assert!(is_update_available("1.8.2-dev.663", "1.8.2-dev.664", false));
        assert!(!is_update_available("1.8.2-dev.664", "1.8.2-dev.663", false));
        assert!(is_update_available("1.8.2-dev.664", "1.8.2", false)); // release > prerelease
        assert!(!is_update_available("1.8.2", "1.8.2", false));
        // downgrade only when explicitly allowed
        assert!(!is_update_available("1.8.2", "1.8.1", false));
        assert!(is_update_available("1.8.2", "1.8.1", true));
        assert!(!is_update_available("1.8.2", "1.8.2", true));
        // unparseable => never update
        assert!(!is_update_available("garbage", "1.0.0", false));
    }

    #[test]
    fn installer_name_safety() {
        assert!(is_safe_installer_name("CatRealm-Sushi_1.8.2_x64-setup.exe"));
        assert!(!is_safe_installer_name("../evil.exe"));
        assert!(!is_safe_installer_name("sub/dir.exe"));
        assert!(!is_safe_installer_name("a\\b.exe"));
        assert!(!is_safe_installer_name("notanexe.txt"));
        assert!(!is_safe_installer_name(""));
    }
}
