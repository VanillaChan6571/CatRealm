use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use crate::AppState;

#[tauri::command]
pub fn native_voice_supported(state: State<'_, AppState>) -> Value {
    state.native_voice.supported()
}

#[tauri::command]
pub fn native_voice_list_devices(state: State<'_, AppState>) -> Value {
    state.native_voice.list_devices()
}

#[tauri::command]
pub fn native_voice_set_input_device(state: State<'_, AppState>, device_id: Option<String>) -> Value {
    state.native_voice.set_input_device(device_id)
}

#[tauri::command]
pub fn native_voice_set_output_device(state: State<'_, AppState>, device_id: Option<String>) -> Value {
    state.native_voice.set_output_device(device_id)
}

#[tauri::command]
pub async fn native_voice_microphone_test(app: AppHandle, duration_ms: u64, rnnoise: bool, gate: bool, gate_threshold_db: f32) -> Value {
    let state = app.state::<AppState>();
    state.native_voice.microphone_test(duration_ms, rnnoise, gate, gate_threshold_db).await
}

#[tauri::command]
pub async fn native_voice_microphone_level(app: AppHandle) -> Value {
    let state = app.state::<AppState>();
    state.native_voice.microphone_level().await
}

#[tauri::command]
pub async fn native_voice_start_video(app: AppHandle, kind: String, source_id: String, width: u32, height: u32, fps: u32) -> Value {
    let state = app.state::<AppState>();
    state.native_voice.start_video(app.clone(), kind, source_id, width, height, fps).await
}

#[tauri::command]
pub async fn native_voice_stop_video(app: AppHandle, kind: String) -> Value {
    let state = app.state::<AppState>();
    state.native_voice.stop_video(kind).await
}

#[tauri::command]
pub async fn native_voice_connect(app: AppHandle, url: String, token: String, muted: bool) -> Value {
    let state = app.state::<AppState>();
    state.native_voice.connect(app.clone(), url, token, muted).await
}

#[tauri::command]
pub async fn native_voice_leave(app: AppHandle) -> Value {
    let state = app.state::<AppState>();
    state.native_voice.leave().await
}

#[tauri::command]
pub async fn native_voice_set_muted(app: AppHandle, muted: bool) -> Value {
    let state = app.state::<AppState>();
    state.native_voice.set_muted(muted)
}

#[tauri::command]
pub async fn native_voice_set_deafened(app: AppHandle, deafened: bool) -> Value {
    let state = app.state::<AppState>();
    state.native_voice.set_deafened(deafened)
}
