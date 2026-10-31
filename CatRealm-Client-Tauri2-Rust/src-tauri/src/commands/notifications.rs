//! Native desktop notifications, matching the Electron client.
//!
//! On Windows the renderer's `showDesktopNotification` lands here instead of
//! the WebView `Notification` API, which the notification plugin shows under
//! PowerShell's identity (unregistered AUMID), without the sender's avatar and
//! with no way back to the message. Here toasts carry Sushi's registered app
//! id, a circular avatar, and clicking one focuses the window and emits
//! `desktop-notification-click` so the renderer opens the conversation.
//! Other platforms answer `{ fallback: true }` and keep the WebView path.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationTarget {
    #[serde(default)]
    pub id: Option<String>,
    pub source_kind: String,
    pub source_id: String,
    #[serde(default)]
    pub subsource_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationRequest {
    pub id: String,
    pub source_kind: String,
    pub source_id: String,
    #[serde(default)]
    pub subsource_id: Option<String>,
    pub title: String,
    pub body: String,
    #[serde(default)]
    pub icon_url: Option<String>,
}

fn valid_request(request: &NotificationRequest) -> bool {
    matches!(request.source_kind.as_str(), "dm" | "server")
        && !request.id.is_empty()
        && request.id.len() <= 128
        && !request.source_id.is_empty()
        && request.source_id.len() <= 2048
        && request.subsource_id.as_ref().is_none_or(|value| value.len() <= 128)
}

/// Same matching as Electron's `dismissDesktopNotifications`.
fn target_matches(entry: &NotificationTarget, target: &NotificationTarget) -> bool {
    entry.source_kind == target.source_kind
        && entry.source_id == target.source_id
        && target
            .subsource_id
            .as_ref()
            .is_none_or(|subsource| entry.subsource_id.as_ref() == Some(subsource))
}

fn truncate_chars(value: &str, max: usize) -> String {
    value.chars().take(max).collect()
}

#[tauri::command]
pub async fn desktop_notification_show(app: AppHandle, payload: NotificationRequest) -> Value {
    if !valid_request(&payload) {
        return json!({ "ok": false });
    }
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(move || windows_toast::show(&app, payload))
            .await
            .unwrap_or_else(|_| json!({ "ok": false }))
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        json!({ "ok": false, "fallback": true })
    }
}

#[tauri::command]
pub async fn desktop_notification_dismiss(target: NotificationTarget) -> Value {
    if !matches!(target.source_kind.as_str(), "dm" | "server") {
        return json!({ "ok": false });
    }
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(move || windows_toast::dismiss(&target))
            .await
            .unwrap_or_else(|_| json!({ "ok": false }))
    }
    #[cfg(not(windows))]
    {
        let _ = target;
        json!({ "ok": true })
    }
}

/// Registers Sushi's AppUserModelID so toasts show "CatRealm" and its icon in
/// dev and installed builds alike. Cheap and idempotent; call once at startup.
pub fn register_app_identity(app: &AppHandle) {
    #[cfg(windows)]
    windows_toast::register_app_identity(app);
    #[cfg(not(windows))]
    let _ = app;
}

#[cfg(windows)]
mod windows_toast {
    use super::{target_matches, truncate_chars, NotificationRequest, NotificationTarget};
    use serde_json::{json, Value};
    use std::collections::HashMap;
    use std::hash::{Hash, Hasher};
    use std::io::Read;
    use std::path::{Path, PathBuf};
    use std::sync::{Mutex, OnceLock};
    use std::time::Duration;
    use tauri::{AppHandle, Emitter, Manager};
    use windows::core::{HSTRING, IInspectable, PCWSTR};
    use windows::Data::Xml::Dom::XmlDocument;
    use windows::Foundation::TypedEventHandler;
    use windows::Graphics::Imaging::{BitmapAlphaMode, BitmapDecoder, BitmapEncoder, BitmapPixelFormat};
    use windows::Storage::Streams::{DataReader, DataWriter, InMemoryRandomAccessStream};
    use windows::UI::Notifications::{ToastDismissedEventArgs, ToastNotification, ToastNotificationManager};
    use windows::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_SET_VALUE,
        REG_OPTION_NON_VOLATILE, REG_SZ,
    };
    use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

    const APP_ID: &str = "app.catrealm.desktop";
    const DISPLAY_NAME: &str = "CatRealm";
    const APP_ICON: &[u8] = include_bytes!("../../icons/icon.ico");
    const AVATAR_PX: u32 = 96;
    const AVATAR_MAX_BYTES: u64 = 4 * 1024 * 1024;

    struct ActiveToast {
        toast: ToastNotification,
        target: NotificationTarget,
    }

    fn active() -> &'static Mutex<HashMap<String, ActiveToast>> {
        static ACTIVE: OnceLock<Mutex<HashMap<String, ActiveToast>>> = OnceLock::new();
        ACTIVE.get_or_init(|| Mutex::new(HashMap::new()))
    }

    fn init_winrt() {
        // S_FALSE / RPC_E_CHANGED_MODE just mean this thread is already set up.
        let _ = unsafe { RoInitialize(RO_INIT_MULTITHREADED) };
    }

    fn set_registry_string(key: HKEY, name: &str, value: &str) {
        let wide: Vec<u16> = value.encode_utf16().chain(std::iter::once(0)).collect();
        let bytes = unsafe { std::slice::from_raw_parts(wide.as_ptr().cast::<u8>(), wide.len() * 2) };
        let _ = unsafe { RegSetValueExW(key, &HSTRING::from(name), None, REG_SZ, Some(bytes)) };
    }

    pub fn register_app_identity(app: &AppHandle) {
        let icon_path = app
            .path()
            .app_data_dir()
            .ok()
            .map(|dir| dir.join("notification-app-icon.ico"))
            .filter(|path| {
                let fresh = std::fs::metadata(path).is_ok_and(|meta| meta.len() == APP_ICON.len() as u64);
                fresh
                    || path
                        .parent()
                        .is_some_and(|parent| std::fs::create_dir_all(parent).is_ok())
                        && std::fs::write(path, APP_ICON).is_ok()
            });
        let subkey = HSTRING::from(format!("Software\\Classes\\AppUserModelId\\{APP_ID}"));
        let mut key = HKEY::default();
        let created = unsafe {
            RegCreateKeyExW(
                HKEY_CURRENT_USER,
                PCWSTR(subkey.as_ptr()),
                None,
                PCWSTR::null(),
                REG_OPTION_NON_VOLATILE,
                KEY_SET_VALUE,
                None,
                &mut key,
                None,
            )
        };
        if created.is_err() {
            return;
        }
        set_registry_string(key, "DisplayName", DISPLAY_NAME);
        if let Some(path) = icon_path {
            set_registry_string(key, "IconUri", &path.to_string_lossy());
        }
        let _ = unsafe { RegCloseKey(key) };
    }

    fn xml_escape(value: &str) -> String {
        let mut out = String::with_capacity(value.len());
        for ch in value.chars() {
            match ch {
                '&' => out.push_str("&amp;"),
                '<' => out.push_str("&lt;"),
                '>' => out.push_str("&gt;"),
                '"' => out.push_str("&quot;"),
                '\'' => out.push_str("&apos;"),
                // XML 1.0 forbids most control characters.
                c if (c as u32) < 0x20 && !matches!(c, '\t' | '\n' | '\r') => {}
                c => out.push(c),
            }
        }
        out
    }

    pub(super) fn toast_xml(title: &str, body: &str, avatar: Option<&Path>) -> String {
        let image = avatar
            .map(|path| {
                format!(
                    r#"<image placement="appLogoOverride" hint-crop="circle" src="{}"/>"#,
                    xml_escape(&path.to_string_lossy())
                )
            })
            .unwrap_or_default();
        format!(
            r#"<toast><visual><binding template="ToastGeneric"><text>{}</text><text>{}</text>{image}</binding></visual><audio silent="true"/></toast>"#,
            xml_escape(&truncate_chars(title, 120)),
            xml_escape(&truncate_chars(body, 300)),
        )
    }

    /// Downloads the avatar and re-encodes it as a small PNG: toasts only
    /// render PNG/JPEG/GIF files, and CatRealm avatars are often WebP.
    fn cached_avatar(app: &AppHandle, url: &str) -> Option<PathBuf> {
        if !(url.starts_with("https://") || url.starts_with("http://")) {
            return None;
        }
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        url.hash(&mut hasher);
        let dir = app.path().app_cache_dir().ok()?.join("notification-avatars");
        let path = dir.join(format!("{:016x}.png", hasher.finish()));
        if path.is_file() {
            return Some(path);
        }
        let response = ureq::get(url).timeout(Duration::from_secs(5)).call().ok()?;
        let mut bytes = Vec::new();
        response
            .into_reader()
            .take(AVATAR_MAX_BYTES)
            .read_to_end(&mut bytes)
            .ok()?;
        let png = transcode_to_png(&bytes).ok()?;
        std::fs::create_dir_all(&dir).ok()?;
        std::fs::write(&path, png).ok()?;
        Some(path)
    }

    fn transcode_to_png(bytes: &[u8]) -> windows::core::Result<Vec<u8>> {
        let input = InMemoryRandomAccessStream::new()?;
        let writer = DataWriter::CreateDataWriter(&input)?;
        writer.WriteBytes(bytes)?;
        writer.StoreAsync()?.get()?;
        writer.DetachStream()?;
        input.Seek(0)?;

        let decoder = BitmapDecoder::CreateAsync(&input)?.get()?;
        let bitmap = decoder
            .GetSoftwareBitmapConvertedAsync(BitmapPixelFormat::Bgra8, BitmapAlphaMode::Premultiplied)?
            .get()?;
        let (width, height) = (decoder.PixelWidth()?.max(1), decoder.PixelHeight()?.max(1));
        let scale = (AVATAR_PX as f64 / width.max(height) as f64).min(1.0);

        let output = InMemoryRandomAccessStream::new()?;
        let encoder = BitmapEncoder::CreateAsync(BitmapEncoder::PngEncoderId()?, &output)?.get()?;
        encoder.SetSoftwareBitmap(&bitmap)?;
        let transform = encoder.BitmapTransform()?;
        transform.SetScaledWidth(((width as f64 * scale).round() as u32).max(1))?;
        transform.SetScaledHeight(((height as f64 * scale).round() as u32).max(1))?;
        encoder.FlushAsync()?.get()?;

        let size = output.Size()? as u32;
        let reader = DataReader::CreateDataReader(&output.GetInputStreamAt(0)?)?;
        reader.LoadAsync(size)?.get()?;
        let mut png = vec![0u8; size as usize];
        reader.ReadBytes(&mut png)?;
        Ok(png)
    }

    fn focus_main_window(app: &AppHandle) {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.set_skip_taskbar(false);
            let _ = window.show();
            let _ = window.set_focus();
        }
    }

    fn main_window_focused(app: &AppHandle) -> bool {
        app.get_webview_window("main").is_some_and(|window| {
            window.is_visible().unwrap_or(false)
                && !window.is_minimized().unwrap_or(false)
                && window.is_focused().unwrap_or(false)
        })
    }

    fn hide_matching(target: &NotificationTarget) {
        let Ok(notifier) = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(APP_ID)) else {
            return;
        };
        let mut toasts = active().lock().unwrap();
        toasts.retain(|_, entry| {
            if !target_matches(&entry.target, target) {
                return true;
            }
            let _ = notifier.Hide(&entry.toast);
            false
        });
    }

    pub fn dismiss(target: &NotificationTarget) -> Value {
        init_winrt();
        hide_matching(target);
        json!({ "ok": true })
    }

    pub fn show(app: &AppHandle, request: NotificationRequest) -> Value {
        // Electron skips the toast while the user is looking at the app.
        if main_window_focused(app) {
            return json!({ "ok": false });
        }
        if active().lock().unwrap().contains_key(&request.id) {
            return json!({ "ok": true });
        }
        init_winrt();
        let avatar = request.icon_url.as_deref().and_then(|url| cached_avatar(app, url));
        let target = NotificationTarget {
            id: Some(request.id.clone()),
            source_kind: request.source_kind.clone(),
            source_id: request.source_id.clone(),
            subsource_id: request.subsource_id.clone(),
        };
        match present(app, &request, target, avatar.as_deref()) {
            Ok(()) => json!({ "ok": true }),
            Err(error) => json!({ "ok": false, "message": error.message() }),
        }
    }

    fn present(
        app: &AppHandle,
        request: &NotificationRequest,
        target: NotificationTarget,
        avatar: Option<&Path>,
    ) -> windows::core::Result<()> {
        // One toast per conversation, like Electron: a newer message replaces it.
        hide_matching(&target);

        let document = XmlDocument::new()?;
        document.LoadXml(&HSTRING::from(toast_xml(&request.title, &request.body, avatar)))?;
        let toast = ToastNotification::CreateToastNotification(&document)?;

        let click_app = app.clone();
        let click_target = target.clone();
        toast.Activated(&TypedEventHandler::<ToastNotification, IInspectable>::new(move |_, _| {
            hide_matching(&click_target);
            focus_main_window(&click_app);
            let _ = click_app.emit("desktop-notification-click", &click_target);
            Ok(())
        }))?;
        let dismissed_id = request.id.clone();
        toast.Dismissed(&TypedEventHandler::<ToastNotification, ToastDismissedEventArgs>::new(move |_, _| {
            active().lock().unwrap().remove(&dismissed_id);
            Ok(())
        }))?;

        ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(APP_ID))?.Show(&toast)?;
        active()
            .lock()
            .unwrap()
            .insert(request.id.clone(), ActiveToast { toast, target });
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target(kind: &str, source: &str, subsource: Option<&str>) -> NotificationTarget {
        NotificationTarget {
            id: None,
            source_kind: kind.into(),
            source_id: source.into(),
            subsource_id: subsource.map(Into::into),
        }
    }

    #[test]
    fn dismissal_matches_like_electron() {
        let entry = target("server", "https://realm", Some("chan-1"));
        assert!(target_matches(&entry, &target("server", "https://realm", None)));
        assert!(target_matches(&entry, &target("server", "https://realm", Some("chan-1"))));
        assert!(!target_matches(&entry, &target("server", "https://realm", Some("chan-2"))));
        assert!(!target_matches(&entry, &target("dm", "https://realm", None)));
    }

    #[test]
    fn rejects_malformed_requests() {
        let mut request = NotificationRequest {
            id: "n1".into(),
            source_kind: "dm".into(),
            source_id: "conv".into(),
            subsource_id: None,
            title: "t".into(),
            body: "b".into(),
            icon_url: None,
        };
        assert!(valid_request(&request));
        request.source_kind = "other".into();
        assert!(!valid_request(&request));
    }

    #[cfg(windows)]
    #[test]
    fn toast_xml_escapes_text_and_crops_avatar() {
        let xml = windows_toast::toast_xml(
            "<Aydan & co>",
            "hi \u{1} \"there\"",
            Some(std::path::Path::new("C:\\cache\\a.png")),
        );
        assert!(xml.contains("<text>&lt;Aydan &amp; co&gt;</text>"));
        assert!(xml.contains("<text>hi  &quot;there&quot;</text>"));
        assert!(xml.contains(r#"placement="appLogoOverride" hint-crop="circle" src="C:\cache\a.png""#));
        assert!(xml.contains(r#"<audio silent="true"/>"#));
    }
}
