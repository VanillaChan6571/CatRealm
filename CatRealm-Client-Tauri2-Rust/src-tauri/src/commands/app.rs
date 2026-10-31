use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::window::Color;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt as _;

/// Injected into the standalone screenshare-wizard window only. Runs at
/// document-start on every load, before the React bundle executes. It:
///   1. Sets a durable `window.__CATREALM_STANDALONE__` marker so the renderer
///      renders the wizard surface even when the `?standalone=` query is lost
///      (window reuse, a client-side redirect, or a cache-bust reload). Relying
///      on the query alone made a logged-in session fall back to the full app.
///   2. Captures load-time errors and, if the React root never mounts, replaces
///      the blank page with a readable diagnostic instead of a silent screen.
const WIZARD_LOAD_GUARD: &str = r#"
(function () {
  // This window is always the standalone screenshare wizard.
  window.__CATREALM_STANDALONE__ = 'screenshare-wizard';
  var errors = [];
  window.addEventListener('error', function (e) {
    errors.push('error: ' + (e.message || '') + ' @ ' + (e.filename || '') + ':' + (e.lineno || '') + ':' + (e.colno || ''));
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    errors.push('unhandledrejection: ' + ((r && (r.stack || r.message)) || String(r)));
  });
  function report() {
    var root = document.getElementById('root');
    if (root && root.childElementCount > 0) return; // rendered fine — do nothing
    var el = document.createElement('pre');
    el.style.cssText = 'white-space:pre-wrap;font:12px/1.6 monospace;color:#f2f3f5;background:#1e1f22;padding:20px;margin:0;position:fixed;inset:0;overflow:auto;z-index:2147483647';
    el.textContent = 'CatRealm Screen Share Wizard failed to render.\n\n'
      + 'href: ' + location.href + '\n'
      + 'standalone: ' + new URLSearchParams(location.search).get('standalone') + '\n'
      + 'readyState: ' + document.readyState + '\n'
      + 'window.electron present: ' + (!!window.electron) + '\n'
      + 'window.__TAURI__ present: ' + (!!(window.__TAURI__ && window.__TAURI__.core)) + '\n'
      + '#root childCount: ' + (root ? root.childElementCount : '(no #root element)') + '\n'
      + 'userAgent: ' + navigator.userAgent + '\n\n'
      + 'captured errors (' + errors.length + '):\n'
      + (errors.length ? errors.join('\n') : '(none captured — the bundle likely never executed)');
    (document.body || document.documentElement).appendChild(el);
  }
  window.addEventListener('DOMContentLoaded', function () { setTimeout(report, 4000); });
})();
"#;

#[tauri::command]
pub fn get_app_version(app: AppHandle) -> Value {
    json!({ "version": app.package_info().version.to_string() })
}

#[tauri::command]
pub fn quit_app(app: AppHandle) -> Value {
    crate::capture::stop_all_native_whip_publishers(&app);
    app.exit(0);
    json!({ "ok": true })
}

#[tauri::command]
pub fn app_relaunch(app: AppHandle) -> Value {
    crate::capture::stop_all_native_whip_publishers(&app);
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(50));
        app.restart();
    });
    json!({ "ok": true })
}

#[tauri::command]
pub fn open_external_url(app: AppHandle, url: String) -> Value {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return json!({ "ok": false, "reason": "invalid_url" });
    }
    match app.opener().open_url(url, None::<&str>) {
        Ok(_) => json!({ "ok": true }),
        Err(error) => {
            json!({ "ok": false, "reason": "open_failed", "message": error.to_string() })
        }
    }
}

fn is_external_http_url(url: &tauri::Url) -> bool {
    matches!(url.scheme(), "http" | "https")
        && !url.host_str().unwrap_or_default().is_empty()
        && url.username().is_empty()
        && url.password().is_none()
}

pub(crate) fn handle_new_window_request(app: &AppHandle, url: &tauri::Url) {
    if !is_external_http_url(url)
        || app
            .state::<crate::AppState>()
            .ad_frame_count
            .load(Ordering::Relaxed)
            > 0
    {
        return;
    }
    let _ = app.emit_to("main", "protected-link-request", url.as_str());
}

pub(crate) fn reset_ad_frame_guard(app: &AppHandle) {
    app.state::<crate::AppState>()
        .ad_frame_count
        .store(0, Ordering::Relaxed);
}

#[tauri::command]
pub fn set_ad_frame_mounted(state: State<crate::AppState>, mounted: bool) -> Value {
    if mounted {
        let _ = state.ad_frame_count.fetch_update(
            Ordering::Relaxed,
            Ordering::Relaxed,
            |count| count.checked_add(1),
        );
    } else {
        let _ = state.ad_frame_count.fetch_update(
            Ordering::Relaxed,
            Ordering::Relaxed,
            |count| Some(count.saturating_sub(1)),
        );
    }
    json!({ "ok": true })
}

#[tauri::command]
pub fn open_protected_link(app: AppHandle, url: String) -> Value {
    open_external_url(app, url)
}

#[tauri::command]
pub fn set_window_fullscreen(app: AppHandle, fullscreen: bool) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("no main window")?;
    window
        .set_fullscreen(fullscreen)
        .map_err(|e| e.to_string())?;
    let _ = app.emit("window-fullscreen-changed", fullscreen);
    Ok(())
}

#[tauri::command]
pub fn get_window_fullscreen(app: AppHandle) -> bool {
    app.get_webview_window("main")
        .and_then(|window| window.is_fullscreen().ok())
        .unwrap_or(false)
}

#[tauri::command]
pub fn set_background_media_active(app: AppHandle, active: bool) -> Value {
    app.state::<crate::AppState>()
        .background_media_active
        .store(active, Ordering::Relaxed);
    if active {
        if let Some(window) = app.get_webview_window("main") {
            crate::webview_lifecycle::resume(&window);
        }
    }
    json!({ "ok": true })
}

#[tauri::command]
pub async fn open_passkey_window(app: AppHandle, url: String) -> Value {
    const LABEL: &str = "passkey";
    let Ok(parsed) = url.parse::<tauri::Url>() else {
        return json!({ "ok": false, "reason": "invalid_url" });
    };
    if !crate::app_security::is_passkey_url(&parsed) {
        return json!({
            "ok": false,
            "reason": "unsupported_origin",
            "message": "Passkey windows require a trusted CatRealm authentication page.",
        });
    }

    // Keep the relying-party HTTPS origin in an unprivileged native window.
    // The local tauri:// / tauri.localhost origin cannot authenticate for it.
    // Unsupported system WebViews offer an explicit user-selected fallback;
    // opening an auth flow no longer launches the system browser automatically.
    let browser_app = app.clone();
    let browser_url = parsed.to_string();
    let auth_origin = parsed.origin();
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.close();
        std::thread::sleep(Duration::from_millis(80));
    }

    match WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::External(parsed))
        .title("CatRealm - Sign in")
        .inner_size(480.0, 640.0)
        .min_inner_size(420.0, 560.0)
        .background_color(Color(30, 31, 34, 255))
        .incognito(true)
        .initialization_script(include_str!("../../injected/passkey-window.js"))
        .on_navigation(move |next| {
            if next.origin() == auth_origin && next.path() == "/__catrealm_open_browser" {
                let _ = browser_app.opener().open_url(&browser_url, None::<&str>);
                return false;
            }
            crate::app_security::is_passkey_url(next) && next.origin() == auth_origin
        })
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .build()
    {
        Ok(window) => {
            let _ = window.set_focus();
            json!({ "ok": true })
        }
        Err(error) => {
            json!({ "ok": false, "reason": "open_failed", "message": error.to_string() })
        }
    }
}

#[tauri::command]
pub async fn open_screenshare_wizard(app: AppHandle) -> Value {
    const LABEL: &str = "screenshare-wizard";

    let standalone_enabled = std::env::var("CATREALM_TAURI_STANDALONE_WIZARD")
        .map(|value| {
            matches!(
                value.to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false);
    if !standalone_enabled {
        return json!({
            "ok": false,
            "reason": "standalone_wizard_disabled",
            "message": "Tauri standalone screenshare wizard is disabled; use the in-app wizard modal fallback.",
        });
    }

    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        return json!({ "ok": true });
    }

    let popup_app = app.clone();
    match WebviewWindowBuilder::new(
        &app,
        LABEL,
        WebviewUrl::App("?standalone=screenshare-wizard".into()),
    )
    .title("CatRealm Screen Share Wizard")
    .inner_size(1040.0, 760.0)
    .min_inner_size(760.0, 560.0)
    // Dark background so a slow/failed load is never a stark white window
    // (matches the Electron wizard's backgroundColor: '#1e1f22').
    .background_color(Color(30, 31, 34, 255))
    .initialization_script(crate::ELECTRON_SHIM)
    .initialization_script(WIZARD_LOAD_GUARD)
    .on_navigation(crate::app_security::is_navigation_url)
    .on_new_window(move |url, _| {
        handle_new_window_request(&popup_app, &url);
        tauri::webview::NewWindowResponse::Deny
    })
    .on_page_load(|window, payload| {
        println!(
            "[screenshare-wizard] page loaded: {:?} {}",
            payload.event(),
            payload.url()
        );
        let _ = window.eval(
            r#"
            window.dispatchEvent(new CustomEvent('catrealm:wizard-debug-probe'));
            console.info('[screenshare-wizard]', {
              href: location.href,
              title: document.title,
              standalone: new URLSearchParams(location.search).get('standalone'),
              rootText: document.getElementById('root')?.innerText?.slice(0, 200) ?? null,
              rootHtml: document.getElementById('root')?.innerHTML?.slice(0, 200) ?? null,
            });
            "#,
        );
    })
    .build()
    {
        Ok(window) => match crate::app_security::install_main_document_guard(&window) {
            Ok(()) => json!({ "ok": true }),
            Err(error) => {
                let _ = window.close();
                json!({ "ok": false, "reason": "navigation_guard_failed", "message": error.to_string() })
            }
        },
        Err(error) => {
            json!({ "ok": false, "reason": "open_failed", "message": error.to_string() })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protected_links_accept_only_credential_free_http_urls() {
        for value in ["https://example.com/path", "http://example.com/"] {
            assert!(is_external_http_url(&value.parse().unwrap()), "{value}");
        }
        for value in [
            "https://user@example.com/",
            "ftp://example.com/file",
            "javascript:alert(1)",
            "file:///tmp/example",
        ] {
            assert!(!is_external_http_url(&value.parse().unwrap()), "{value}");
        }
    }
}
