//! Startup timing marks, so launch time can be measured phase by phase.
//!
//! Every mark is logged to `client-debug.log` as
//! `{"startupMark": <name>, "ms": <ms since process creation>, ...}`.
//! Rust marks taken before the log file is ready are buffered and flushed once
//! `attach_log` runs. The renderer reports its own marks through the
//! `startup_mark` command with an epoch timestamp, so both sides share a clock.

use serde_json::{json, Value};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

/// Epoch milliseconds at which the OS created this process (falls back to the
/// first call to `begin` where process creation time isn't available).
static PROCESS_START_MS: OnceLock<f64> = OnceLock::new();
static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();
static PENDING: Mutex<Vec<Value>> = Mutex::new(Vec::new());

fn epoch_ms_now() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

#[cfg(target_os = "windows")]
fn process_creation_epoch_ms() -> Option<f64> {
    use windows::Win32::Foundation::FILETIME;
    use windows::Win32::System::Threading::{GetCurrentProcess, GetProcessTimes};

    let mut created = FILETIME::default();
    let mut exited = FILETIME::default();
    let mut kernel = FILETIME::default();
    let mut user = FILETIME::default();
    unsafe {
        GetProcessTimes(
            GetCurrentProcess(),
            &mut created,
            &mut exited,
            &mut kernel,
            &mut user,
        )
        .ok()?;
    }
    // FILETIME: 100ns ticks since 1601-01-01.
    let ticks = ((created.dwHighDateTime as u64) << 32) | created.dwLowDateTime as u64;
    const EPOCH_DIFF_MS: f64 = 11_644_473_600_000.0;
    Some(ticks as f64 / 10_000.0 - EPOCH_DIFF_MS)
}

#[cfg(not(target_os = "windows"))]
fn process_creation_epoch_ms() -> Option<f64> {
    None
}

fn round1(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

fn process_start_ms() -> f64 {
    *PROCESS_START_MS.get_or_init(|| process_creation_epoch_ms().unwrap_or_else(epoch_ms_now))
}

fn record(entry: Value) {
    if let Some(path) = LOG_PATH.get() {
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
        {
            let _ = writeln!(file, "{entry}");
        }
    } else if let Ok(mut pending) = PENDING.lock() {
        pending.push(entry);
    }
}

fn mark_at(name: &str, source: &str, at_epoch_ms: f64, extra: Option<Value>) {
    let mut entry = json!({
        "startupMark": name,
        "source": source,
        "ms": round1(at_epoch_ms - process_start_ms()),
    });
    if let (Some(extra), Some(obj)) = (extra, entry.as_object_mut()) {
        obj.insert("detail".into(), extra);
    }
    record(entry);
}

/// Call first thing in `run()`: pins the process start time and records how
/// long the OS took to load the exe and its DLLs before Rust code ran.
pub(crate) fn begin() {
    process_start_ms();
    mark("main", None);
}

/// Record a Rust-side mark at the current time.
pub(crate) fn mark(name: &str, extra: Option<Value>) {
    mark_at(name, "rust", epoch_ms_now(), extra);
}

/// Start writing marks into `client-debug.log` (call after it is rotated) and
/// flush the marks taken before it existed.
pub(crate) fn attach_log(path: PathBuf) {
    let pending = PENDING
        .lock()
        .map(|mut p| std::mem::take(&mut *p))
        .unwrap_or_default();
    let _ = LOG_PATH.set(path);
    for entry in pending {
        record(entry);
    }
}

/// Renderer marks. `at` is the renderer's epoch timestamp
/// (`performance.timeOrigin + performance.now()`).
#[tauri::command]
pub fn startup_mark(name: String, at: f64, detail: Option<Value>) {
    let name = name.chars().take(64).collect::<String>();
    mark_at(&name, "renderer", at, detail);
}
