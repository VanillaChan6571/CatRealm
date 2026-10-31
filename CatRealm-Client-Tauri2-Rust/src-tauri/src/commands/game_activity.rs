use crate::AppState;
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

const POLL_INTERVAL: Duration = Duration::from_secs(15);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GameActivity {
    activity_type: &'static str,
    activity_text: String,
    activity_started_at: Option<i64>,
    process_name: String,
    process_id: u32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GameActivityStateValue {
    supported: bool,
    enabled: bool,
    status: &'static str,
    activity: Option<GameActivity>,
    last_error: Option<String>,
    updated_at: u128,
}

pub(crate) struct GameActivityService {
    enabled: AtomicBool,
    poller_running: AtomicBool,
    state: Mutex<GameActivityStateValue>,
}

impl GameActivityService {
    pub(crate) fn new() -> Self {
        let supported = cfg!(target_os = "windows");
        Self {
            enabled: AtomicBool::new(false),
            poller_running: AtomicBool::new(false),
            state: Mutex::new(GameActivityStateValue {
                supported,
                enabled: false,
                status: if supported { "disabled" } else { "unsupported" },
                activity: None,
                last_error: None,
                updated_at: crate::now_ms(),
            }),
        }
    }

    fn state_value(&self) -> Value {
        serde_json::to_value(self.state.lock().unwrap().clone()).unwrap_or_else(|_| {
            json!({
                "supported": false,
                "enabled": false,
                "status": "unsupported",
                "activity": null,
                "lastError": "serialization_failed",
                "updatedAt": crate::now_ms(),
            })
        })
    }

    fn set_state(&self, patch: GameActivityStatePatch) -> Value {
        let mut state = self.state.lock().unwrap();
        if let Some(enabled) = patch.enabled {
            state.enabled = enabled;
        }
        if let Some(status) = patch.status {
            state.status = status;
        }
        if patch.activity_set {
            state.activity = patch.activity;
        }
        if patch.last_error_set {
            state.last_error = patch.last_error;
        }
        state.updated_at = crate::now_ms();
        serde_json::to_value(state.clone()).unwrap_or(Value::Null)
    }

    fn refresh_once(&self) -> Value {
        if !cfg!(target_os = "windows") {
            return self.set_state(GameActivityStatePatch {
                enabled: Some(false),
                status: Some("unsupported"),
                activity_set: true,
                activity: None,
                last_error_set: true,
                last_error: None,
            });
        }

        if !self.enabled.load(Ordering::SeqCst) {
            return self.set_state(GameActivityStatePatch {
                enabled: Some(false),
                status: Some("disabled"),
                activity_set: true,
                activity: None,
                last_error_set: true,
                last_error: None,
            });
        }

        match detect_windows_game_activity() {
            Ok(activity) => self.set_state(GameActivityStatePatch {
                enabled: Some(true),
                status: Some(if activity.is_some() { "active" } else { "idle" }),
                activity_set: true,
                activity,
                last_error_set: true,
                last_error: None,
            }),
            Err(error) => self.set_state(GameActivityStatePatch {
                enabled: Some(true),
                status: Some("error"),
                activity_set: true,
                activity: None,
                last_error_set: true,
                last_error: Some(error),
            }),
        }
    }

    fn ensure_poller(&self, app: AppHandle) {
        if self
            .poller_running
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return;
        }

        thread::spawn(move || loop {
            thread::sleep(POLL_INTERVAL);
            let app_state = app.state::<AppState>();
            let service = &app_state.game_activity;
            if !service.enabled.load(Ordering::SeqCst) {
                service.poller_running.store(false, Ordering::SeqCst);
                break;
            }
            let state = service.refresh_once();
            let _ = app.emit("game-activity-state", state);
        });
    }
}

#[derive(Default)]
struct GameActivityStatePatch {
    enabled: Option<bool>,
    status: Option<&'static str>,
    activity_set: bool,
    activity: Option<GameActivity>,
    last_error_set: bool,
    last_error: Option<String>,
}

#[tauri::command]
pub fn get_game_activity_state(state: State<AppState>) -> Value {
    state.game_activity.state_value()
}

#[tauri::command]
pub fn set_game_activity_enabled(app: AppHandle, state: State<AppState>, enabled: bool) -> Value {
    state.settings.lock().unwrap().game_activity_enabled = enabled;
    state.save();

    if !cfg!(target_os = "windows") {
        state.game_activity.enabled.store(false, Ordering::SeqCst);
        return state.game_activity.set_state(GameActivityStatePatch {
            enabled: Some(false),
            status: Some("unsupported"),
            activity_set: true,
            activity: None,
            last_error_set: true,
            last_error: None,
        });
    }

    state.game_activity.enabled.store(enabled, Ordering::SeqCst);
    if !enabled {
        return state.game_activity.set_state(GameActivityStatePatch {
            enabled: Some(false),
            status: Some("disabled"),
            activity_set: true,
            activity: None,
            last_error_set: true,
            last_error: None,
        });
    }

    state.game_activity.set_state(GameActivityStatePatch {
        enabled: Some(true),
        status: Some("detecting"),
        activity_set: false,
        activity: None,
        last_error_set: true,
        last_error: None,
    });
    let next_state = state.game_activity.refresh_once();
    state.game_activity.ensure_poller(app.clone());
    let _ = app.emit("game-activity-state", next_state.clone());
    next_state
}

#[tauri::command]
pub fn invalidate_game_activity_catalog(state: State<AppState>) -> Value {
    let detector_state = state.game_activity.refresh_once();
    json!({ "ok": true, "state": detector_state })
}

fn detect_windows_game_activity() -> Result<Option<GameActivity>, String> {
    #[cfg(not(target_os = "windows"))]
    {
        Ok(None)
    }

    #[cfg(target_os = "windows")]
    {
        let mut matches = crate::windows_process::snapshot()?
            .into_iter()
            .filter_map(|process| {
                let catalog_entry = catalog_lookup(&process.name)?;
                Some(GameActivity {
                    activity_type: "Playing",
                    activity_text: catalog_entry.to_string(),
                    activity_started_at: crate::windows_process::started_at(process.pid),
                    process_name: process.name,
                    process_id: process.pid,
                })
            })
            .collect::<Vec<_>>();

        matches.sort_by(|a, b| {
            b.activity_started_at
                .unwrap_or(0)
                .cmp(&a.activity_started_at.unwrap_or(0))
                .then_with(|| b.process_id.cmp(&a.process_id))
        });
        Ok(matches.into_iter().next())
    }
}

#[cfg(any(target_os = "windows", test))]
fn catalog_lookup(process_name: &str) -> Option<&'static str> {
    let normalized = process_name.trim().to_ascii_lowercase();
    GAME_CATALOG
        .iter()
        .find(|(name, _title)| *name == normalized)
        .map(|(_name, title)| *title)
}

#[cfg(any(target_os = "windows", test))]
const GAME_CATALOG: &[(&str, &str)] = &[
    ("minecraft.exe", "Minecraft"),
    ("javaw.exe", "Minecraft: Java Edition"),
    ("robloxplayerbeta.exe", "Roblox"),
    ("fortniteclient-win64-shipping.exe", "Fortnite"),
    ("valorant-win64-shipping.exe", "VALORANT"),
    ("league of legends.exe", "League of Legends"),
    ("rocketleague.exe", "Rocket League"),
    ("eldenring.exe", "Elden Ring"),
    ("r5apex.exe", "Apex Legends"),
    ("overwatch.exe", "Overwatch 2"),
    ("cs2.exe", "Counter-Strike 2"),
    ("gta5.exe", "Grand Theft Auto V"),
    ("starrail.exe", "Honkai: Star Rail"),
    ("genshinimpact.exe", "Genshin Impact"),
    ("bh3.exe", "Honkai Impact 3rd"),
    ("osu!.exe", "osu!"),
    ("terraria.exe", "Terraria"),
    ("stardew valley.exe", "Stardew Valley"),
    ("palworld-win64-shipping.exe", "Palworld"),
    ("helldivers2.exe", "HELLDIVERS 2"),
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn game_catalog_lookup_is_case_insensitive() {
        assert_eq!(catalog_lookup("CS2.EXE"), Some("Counter-Strike 2"));
        assert_eq!(catalog_lookup("not-a-game.exe"), None);
    }
}
