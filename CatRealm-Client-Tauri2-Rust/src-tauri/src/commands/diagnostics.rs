use serde_json::{json, Value};
use std::io::Write;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

fn append_log(app: &AppHandle, file: &str, entry: &Value) {
    let Ok(dir) = app.path().app_log_dir() else {
        return;
    };
    let _ = std::fs::create_dir_all(&dir);
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join(file))
    {
        let _ = writeln!(f, "{entry}");
    }
}

pub(crate) fn init_client_debug_log(app: &AppHandle) {
    let Ok(dir) = app.path().app_log_dir() else {
        return;
    };
    let _ = std::fs::create_dir_all(&dir);
    let current = dir.join("client-debug.log");
    let previous = dir.join("client-debug-prev.log");
    if current.exists() {
        let _ = std::fs::remove_file(&previous);
        let _ = std::fs::rename(&current, &previous);
    }
    let session = json!({
        "session": true,
        "at": crate::now_ms(),
        "version": app.package_info().version.to_string(),
        "platform": std::env::consts::OS,
        "pid": std::process::id(),
        "logsDir": dir,
    });
    if let Ok(mut file) = std::fs::File::create(current) {
        let _ = writeln!(file, "{session}");
    }
}

#[tauri::command]
pub fn get_app_metrics() -> Value {
    #[cfg(target_os = "windows")]
    if let Some(metrics) = windows_process_tree_metrics() {
        return metrics;
    }

    json!({
        "at": crate::now_ms(),
        "count": 0,
        "totalMB": 0,
        "rows": [],
    })
}

#[tauri::command]
pub fn get_debug_log_paths(app: AppHandle) -> Value {
    match app.path().app_log_dir() {
        Ok(dir) => json!({
            "voiceDebug": dir.join("voice-debug.log"),
            "clientDebug": dir.join("client-debug.log"),
            "logsDir": dir,
            "crashDumps": null,
        }),
        Err(_) => json!({
            "voiceDebug": null,
            "clientDebug": null,
            "logsDir": null,
            "crashDumps": null,
        }),
    }
}

#[tauri::command]
pub fn client_debug_log(app: AppHandle, entry: Value) {
    append_log(&app, "client-debug.log", &entry);
}

#[tauri::command]
pub fn voice_debug_log(app: AppHandle, entry: Value) {
    append_log(&app, "voice-debug.log", &entry);
    let _ = app.emit_to("voice-debug", "voice-debug-entry", entry);
}

#[tauri::command]
pub async fn set_voice_debug_console_enabled(app: AppHandle, enabled: bool) -> Value {
    const LABEL: &str = "voice-debug";

    if !enabled {
        if let Some(window) = app.get_webview_window(LABEL) {
            let _ = window.close();
        }
        return json!({ "ok": true, "enabled": false });
    }

    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        return json!({ "ok": true, "enabled": true });
    }

    let html = voice_debug_console_html();
    let data_url = format!("data:text/html;charset=utf-8,{}", percent_encode(&html));
    let Ok(url) = data_url.parse::<tauri::Url>() else {
        return json!({
            "ok": false,
            "enabled": false,
            "reason": "invalid_url",
        });
    };

    match WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::External(url))
        .title("CatRealm Voice Debug Console")
        .inner_size(900.0, 540.0)
        .min_inner_size(520.0, 320.0)
        .build()
    {
        Ok(_) => json!({ "ok": true, "enabled": true }),
        Err(error) => json!({
            "ok": false,
            "enabled": false,
            "reason": "open_failed",
            "message": error.to_string(),
        }),
    }
}

#[cfg(target_os = "windows")]
fn windows_process_tree_metrics() -> Option<Value> {
    use std::collections::{HashMap, HashSet};

    let root_pid = std::process::id();
    let processes = crate::windows_process::snapshot().ok()?;
    let by_pid = processes
        .iter()
        .map(|process| (process.pid, process))
        .collect::<HashMap<_, _>>();
    let mut children = HashMap::<u32, Vec<u32>>::new();
    for process in &processes {
        children
            .entry(process.parent_pid)
            .or_default()
            .push(process.pid);
    }

    let mut pending = vec![root_pid];
    let mut process_ids = Vec::new();
    let mut seen = HashSet::new();
    while let Some(pid) = pending.pop() {
        if !seen.insert(pid) {
            continue;
        }
        process_ids.push(pid);
        if let Some(child_ids) = children.get(&pid) {
            pending.extend(child_ids.iter().copied());
        }
    }

    let mut total_bytes = 0usize;
    let mut private_total_bytes = 0usize;
    let mut rows = process_ids
        .into_iter()
        .filter_map(|pid| {
            let process = by_pid.get(&pid)?;
            let memory = crate::windows_process::memory(pid)?;
            total_bytes = total_bytes.saturating_add(memory.working_set_bytes);
            private_total_bytes = private_total_bytes.saturating_add(memory.private_bytes);
            let name = process.name.strip_suffix(".exe").unwrap_or(&process.name);
            let mut role = if pid == root_pid {
                "Rust host".to_string()
            } else {
                let command_line = crate::windows_process::command_line(pid).unwrap_or_default();
                let base = command_line_switch(&command_line, "--type=")
                    .unwrap_or_else(|| name.to_string());
                match command_line_switch(&command_line, "--utility-sub-type=") {
                    Some(subtype) => format!("{base}/{subtype}"),
                    None => base,
                }
            };
            if name.eq_ignore_ascii_case("msedgewebview2") && role.eq_ignore_ascii_case(name) {
                role = "browser".into();
            }
            Some(json!({
                "pid": pid,
                "type": role,
                "name": name,
                "memMB": bytes_to_mb(memory.working_set_bytes),
                "privateMB": bytes_to_mb(memory.private_bytes),
                "cpu": 0,
            }))
        })
        .collect::<Vec<_>>();
    rows.sort_by(|left, right| {
        right["memMB"]
            .as_f64()
            .unwrap_or(0.0)
            .partial_cmp(&left["memMB"].as_f64().unwrap_or(0.0))
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    Some(json!({
        "at": crate::now_ms(),
        "count": rows.len(),
        "totalMB": bytes_to_mb(total_bytes),
        "privateTotalMB": bytes_to_mb(private_total_bytes),
        "rows": rows,
    }))
}

#[cfg(any(target_os = "windows", test))]
fn command_line_switch(command_line: &str, prefix: &str) -> Option<String> {
    command_line
        .split_whitespace()
        .find_map(|part| part.trim_matches('"').strip_prefix(prefix))
        .map(|value| value.trim_matches('"').to_string())
}

#[cfg(any(target_os = "windows", test))]
fn bytes_to_mb(bytes: usize) -> f64 {
    ((bytes as f64 / (1024.0 * 1024.0)) * 10.0).round() / 10.0
}

fn voice_debug_console_html() -> String {
    r#"<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>CatRealm Voice Debug Console</title>
  <style>
    :root { color-scheme: dark; font-family: Consolas, "Cascadia Mono", monospace; }
    body { margin: 0; background: #111214; color: #d7dadf; }
    header { position: sticky; top: 0; display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 12px; background: #1c1f24; border-bottom: 1px solid #2a2f37; }
    h1 { margin: 0; font: 600 14px system-ui, sans-serif; }
    button { border: 1px solid #3a414d; background: #242933; color: #f4f6f8; border-radius: 4px; padding: 5px 9px; cursor: pointer; }
    main { padding: 10px 12px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; line-height: 1.45; }
    .entry { border-bottom: 1px solid #20242b; padding: 6px 0; }
    .meta { color: #8ea4bd; }
    .warn .meta { color: #e5b95f; }
    .error .meta { color: #ff8585; }
  </style>
</head>
<body>
  <header>
    <h1>CatRealm Voice Debug Console</h1>
    <button id="clear">Clear</button>
  </header>
  <main id="log"></main>
  <script>
    const log = document.getElementById('log');
    const clear = document.getElementById('clear');
    const maxEntries = 1000;
    clear.addEventListener('click', () => { log.textContent = ''; });
    function add(entry) {
      const row = document.createElement('div');
      row.className = 'entry ' + (entry && entry.level || 'info');
      const time = entry && entry.at ? new Date(entry.at).toLocaleTimeString() : new Date().toLocaleTimeString();
      const scope = entry && entry.scope ? entry.scope : 'voice';
      const level = entry && entry.level ? entry.level : 'info';
      const message = entry && entry.message ? entry.message : JSON.stringify(entry);
      const details = entry && entry.details != null ? '\n' + JSON.stringify(entry.details, null, 2) : '';
      row.textContent = `[${time}] ${level.toUpperCase()} ${scope}: ${message}${details}`;
      log.appendChild(row);
      while (log.childElementCount > maxEntries) log.firstElementChild.remove();
      row.scrollIntoView({ block: 'end' });
    }
    window.addEventListener('DOMContentLoaded', async () => {
      try {
        await window.__TAURI__.event.listen('voice-debug-entry', (event) => add(event.payload));
      } catch (error) {
        add({ level: 'warn', scope: 'tauri', message: 'Unable to attach Tauri voice debug listener', details: String(error) });
      }
      add({ level: 'info', scope: 'tauri', message: 'Voice debug console ready' });
    });
  </script>
</body>
</html>"#
        .to_string()
}

fn percent_encode(input: &str) -> String {
    let mut encoded = String::with_capacity(input.len());
    for byte in input.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char);
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_webview_process_roles() {
        let command =
            r#"msedgewebview2.exe --type=utility --utility-sub-type=audio.mojom.AudioService"#;
        assert_eq!(
            command_line_switch(command, "--type=").as_deref(),
            Some("utility")
        );
        assert_eq!(
            command_line_switch(command, "--utility-sub-type=").as_deref(),
            Some("audio.mojom.AudioService")
        );
    }

    #[test]
    fn memory_values_are_rounded_to_tenths_of_a_megabyte() {
        assert_eq!(bytes_to_mb(1024 * 1024), 1.0);
        assert_eq!(bytes_to_mb(1536 * 1024), 1.5);
    }
}
