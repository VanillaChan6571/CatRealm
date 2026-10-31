use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// Persisted desktop settings, mirroring what the Electron main process kept
/// in its own settings store (electron/main.cjs).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub minimize_to_tray: bool,
    pub open_links_in_app: bool,
    pub update_channel: String,
    pub screen_share_video_encoding: serde_json::Value,
    pub game_activity_enabled: bool,
    /// Linux webview rendering backend selector, applied at launch by
    /// `configure_linux_webview_gpu` in lib.rs. One of:
    /// `auto` (NVIDIA-safe default), `gpu-legacy`, `gpu-dmabuf`, `software`.
    /// Ignored on non-Linux platforms.
    pub webview_render_backend: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            minimize_to_tray: true,
            open_links_in_app: false,
            update_channel: "stable".into(),
            screen_share_video_encoding: serde_json::Value::Null,
            game_activity_enabled: false,
            webview_render_backend: "auto".into(),
        }
    }
}

impl Settings {
    pub fn load(path: &Path) -> Self {
        fs::read(path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &PathBuf) {
        if let Some(dir) = path.parent() {
            let _ = fs::create_dir_all(dir);
        }
        if let Ok(json) = serde_json::to_vec_pretty(self) {
            let _ = fs::write(path, json);
        }
    }
}
