use tauri::Url;

/// Tauri serves packaged assets from these exact local origins. Development
/// access is limited to Vite's configured port and never enabled in releases.
pub(crate) fn is_app_url(url: &Url) -> bool {
    if !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    let packaged = if cfg!(windows) {
        matches!(url.scheme(), "http" | "https")
            && url.host_str() == Some("tauri.localhost")
            && url.port().is_none()
    } else {
        url.scheme() == "tauri" && url.host_str() == Some("localhost") && url.port().is_none()
    };
    packaged
        || (cfg!(debug_assertions)
            && url.scheme() == "http"
            && url.host_str() == Some("localhost")
            && url.port() == Some(5173))
}

pub(crate) fn is_navigation_url(url: &Url) -> bool {
    if is_app_url(url) {
        return true;
    }
    // WebKitGTK's navigation callback also sees iframe loads. Keep HTTP(S)
    // embeds available; the response policy below separately protects the
    // main document before any response can execute in the application page.
    cfg!(target_os = "linux")
        && matches!(url.scheme(), "http" | "https")
        && url.username().is_empty()
        && url.password().is_none()
}

#[cfg(target_os = "linux")]
pub(crate) fn install_main_document_guard(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    use webkit2gtk::glib::prelude::*;
    use webkit2gtk::{
        PolicyDecisionExt, PolicyDecisionType, ResponsePolicyDecision, ResponsePolicyDecisionExt,
        URIResponseExt, WebViewExt,
    };
    window.with_webview(|webview| {
        webview.inner().connect_decide_policy(|_, decision, kind| {
            if kind != PolicyDecisionType::Response {
                return false;
            }
            let Some(response) = decision.dynamic_cast_ref::<ResponsePolicyDecision>() else {
                return false;
            };
            if !response.is_main_frame_main_resource() {
                return false;
            }
            let trusted = response
                .response()
                .and_then(|response| response.uri())
                .and_then(|uri| Url::parse(&uri).ok())
                .map(|url| is_app_url(&url))
                .unwrap_or(false);
            if trusted {
                return false;
            }
            decision.ignore();
            true
        });
    })
}

#[cfg(not(target_os = "linux"))]
pub(crate) fn install_main_document_guard(_window: &tauri::WebviewWindow) -> tauri::Result<()> {
    Ok(())
}

pub(crate) fn is_passkey_url(url: &Url) -> bool {
    if !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    let hosted = url.scheme() == "https"
        && url.port().is_none()
        && matches!(
            url.host_str(),
            Some("auth.catrealm.app" | "catrealm.app" | "www.catrealm.app")
        );
    let development = cfg!(debug_assertions)
        && url.scheme() == "http"
        && url.host_str() == Some("localhost")
        && url.port() == Some(5173);
    (hosted || development) && url.path().starts_with("/webauthn/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packaged_origins_are_exact() {
        let packaged_urls: &[&str] = if cfg!(windows) {
            &[
                "http://tauri.localhost/",
                "https://tauri.localhost/?standalone=screenshare-wizard",
            ]
        } else {
            &[
                "tauri://localhost/",
                "tauri://localhost/?standalone=screenshare-wizard",
            ]
        };
        for value in packaged_urls {
            assert!(is_app_url(&Url::parse(value).unwrap()), "{value}");
        }
        for value in [
            "https://tauri.localhost.example.test/",
            "https://tauri.localhost@example.test/",
            "http://tauri.localhost:9000/",
            "http://localhost:9000/",
            "https://catrealm.app/",
            "file:///tmp/index.html",
        ] {
            assert!(!is_app_url(&Url::parse(value).unwrap()), "{value}");
        }
    }

    #[test]
    fn passkey_windows_only_load_hosted_authentication() {
        assert!(is_passkey_url(
            &Url::parse("https://catrealm.app/webauthn/register/flow?token=synthetic").unwrap()
        ));
        for value in [
            "https://catrealm.app/",
            "https://catrealm.app.example.test/webauthn/login/flow",
            "https://catrealm.app@example.test/webauthn/login/flow",
            "https://auth.catrealm.app:9000/webauthn/login/flow",
            "http://auth.catrealm.app/webauthn/login/flow",
        ] {
            assert!(!is_passkey_url(&Url::parse(value).unwrap()), "{value}");
        }
    }
}
