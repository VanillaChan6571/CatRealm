use crate::AppState;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};

#[tauri::command]
pub fn obs_overlay_set_enabled(
    app: AppHandle,
    state: State<AppState>,
    enabled: bool,
    port: Option<u16>,
) -> Result<Value, String> {
    let reactive_root = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("reactive-avatars");
    state
        .overlay
        .set_enabled(enabled, port.unwrap_or(42069), reactive_root)?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub fn obs_overlay_update_state(state: State<AppState>, overlay_state: Value) -> Value {
    state.overlay.update_state(overlay_state);
    json!({ "ok": true })
}
