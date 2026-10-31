use crate::AppState;
use serde_json::{json, Value};
use tauri::{AppHandle, State};
use tauri_plugin_autostart::ManagerExt as _;

fn normalized_video_encoding_config(config: &Value) -> Value {
    let hardware_encoding = config
        .get("hardwareEncoding")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let encoder_backend = config
        .get("encoderBackend")
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "auto" | "d3d11" | "vulkan"))
        .unwrap_or("auto");
    json!({
        "hardwareEncoding": hardware_encoding,
        "encoderBackend": encoder_backend,
    })
}

#[tauri::command]
pub fn get_minimize_to_tray(state: State<AppState>) -> Value {
    json!({
        "supported": true,
        "enabled": state.settings.lock().unwrap().minimize_to_tray,
    })
}

#[tauri::command]
pub fn set_minimize_to_tray(state: State<AppState>, enabled: bool) -> Value {
    state.settings.lock().unwrap().minimize_to_tray = enabled;
    state.save();
    json!({ "ok": true, "supported": true, "enabled": enabled })
}

#[tauri::command]
pub fn get_open_links_in_app(state: State<AppState>) -> Value {
    json!({ "enabled": state.settings.lock().unwrap().open_links_in_app })
}

#[tauri::command]
pub fn set_open_links_in_app(state: State<AppState>, enabled: bool) -> Value {
    state.settings.lock().unwrap().open_links_in_app = enabled;
    state.save();
    json!({ "ok": true, "enabled": enabled })
}

#[tauri::command]
pub fn get_screen_share_video_encoding(state: State<AppState>) -> Value {
    let saved = normalized_video_encoding_config(
        &state.settings.lock().unwrap().screen_share_video_encoding,
    );
    json!({
        "hardwareEncoding": saved["hardwareEncoding"],
        "encoderBackend": saved["encoderBackend"],
        "applied": {
            "hardwareEncoding": saved["hardwareEncoding"],
            "encoderBackend": saved["encoderBackend"],
        },
        "diagnostics": null,
        "requiresRestart": false,
    })
}

#[tauri::command]
pub fn set_screen_share_video_encoding(state: State<AppState>, config: Value) -> Value {
    let saved = normalized_video_encoding_config(&config);
    state.settings.lock().unwrap().screen_share_video_encoding = saved.clone();
    state.save();
    json!({
        "ok": true,
        "hardwareEncoding": saved["hardwareEncoding"],
        "encoderBackend": saved["encoderBackend"],
        "applied": {
            "hardwareEncoding": saved["hardwareEncoding"],
            "encoderBackend": saved["encoderBackend"],
        },
        "diagnostics": null,
        "requiresRestart": false,
    })
}

const WEBVIEW_RENDER_BACKENDS: [&str; 4] = ["auto", "gpu-legacy", "gpu-dmabuf", "software"];

fn normalized_webview_render_backend(value: &str) -> &'static str {
    match value.trim() {
        "gpu-legacy" => "gpu-legacy",
        "gpu-dmabuf" => "gpu-dmabuf",
        "software" => "software",
        _ => "auto",
    }
}

/// Linux-only webview rendering backend. Applied at launch by
/// `configure_linux_webview_gpu`; changing it requires an app relaunch.
#[tauri::command]
pub fn get_webview_render_backend(state: State<AppState>) -> Value {
    let backend =
        normalized_webview_render_backend(&state.settings.lock().unwrap().webview_render_backend);
    json!({
        "supported": cfg!(target_os = "linux"),
        "backend": backend,
        "options": WEBVIEW_RENDER_BACKENDS,
    })
}

#[tauri::command]
pub fn set_webview_render_backend(state: State<AppState>, backend: String) -> Value {
    let normalized = normalized_webview_render_backend(&backend);
    state.settings.lock().unwrap().webview_render_backend = normalized.to_string();
    state.save();
    json!({
        "ok": true,
        "supported": cfg!(target_os = "linux"),
        "backend": normalized,
        "options": WEBVIEW_RENDER_BACKENDS,
        "requiresRestart": true,
    })
}

#[tauri::command]
pub fn get_open_on_startup(app: AppHandle) -> Value {
    json!({
        "supported": true,
        "enabled": app.autolaunch().is_enabled().unwrap_or(false),
    })
}

#[tauri::command]
pub fn set_open_on_startup(app: AppHandle, enabled: bool) -> Value {
    let autolaunch = app.autolaunch();
    let result = if enabled {
        autolaunch.enable()
    } else {
        autolaunch.disable()
    };
    match result {
        Ok(_) => json!({
            "ok": true,
            "supported": true,
            "enabled": app.autolaunch().is_enabled().unwrap_or(enabled),
        }),
        Err(error) => json!({
            "ok": false,
            "supported": true,
            "enabled": app.autolaunch().is_enabled().unwrap_or(false),
            "reason": "apply_failed",
            "message": error.to_string(),
        }),
    }
}
