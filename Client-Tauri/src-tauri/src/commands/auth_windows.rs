use serde_json::{json, Value};
use tauri::webview::cookie::Cookie;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const THEATER_SESSION_LABEL: &str = "theater-youtube-cookie";
const THEATER_COOKIE_DOMAINS: &[&str] = &[
    "youtube.com",
    "google.com",
    "googlevideo.com",
    "googleapis.com",
    "gstatic.com",
    "ytimg.com",
];

#[derive(Clone, Copy)]
struct CookieCheck {
    name: &'static str,
    domain: &'static str,
}

#[tauri::command]
pub async fn embed_login_open(app: AppHandle, platform: String) -> Value {
    let Some(config) = embed_login_config(&platform) else {
        return json!({
            "ok": false,
            "reason": "unknown_platform",
            "message": format!("Unknown platform: {platform}"),
        });
    };
    open_login_window(
        app,
        &format!("embed-login-{platform}"),
        config.title,
        config.login_url,
        config.allowed_nav_domains,
        1000.0,
        700.0,
    )
}

#[tauri::command]
pub async fn embed_login_status(app: AppHandle, platform: String) -> Value {
    let Some(config) = embed_login_config(&platform) else {
        return json!({ "loggedIn": false });
    };
    match session_cookies(&app, &format!("embed-login-{platform}")).await {
        Ok(cookies) => json!({
            "loggedIn": config.cookie_checks.iter().all(|check| cookies.iter().any(|cookie| {
                cookie.name() == check.name && domain_matches(cookie.domain(), &[check.domain])
            })),
        }),
        Err(_) => json!({ "loggedIn": false }),
    }
}

#[tauri::command]
pub async fn embed_login_logout(app: AppHandle, platform: String) -> Value {
    let Some(config) = embed_login_config(&platform) else {
        return json!({
            "ok": false,
            "reason": "unknown_platform",
            "message": format!("Unknown platform: {platform}"),
        });
    };
    delete_session_cookies(&app, &format!("embed-login-{platform}"), config.logout_domains).await
}

#[tauri::command]
pub async fn theater_youtube_cookie_open(app: AppHandle) -> Value {
    open_login_window(
        app,
        THEATER_SESSION_LABEL,
        "Authorize YouTube Cookies for Theater",
        "https://accounts.google.com/signin/v2/identifier?service=youtube",
        &[
            "google.com",
            "accounts.google.com",
            "youtube.com",
            "gstatic.com",
            "googleusercontent.com",
            "googleapis.com",
            "googlevideo.com",
            "ytimg.com",
        ],
        1000.0,
        760.0,
    )
}

#[tauri::command]
pub async fn theater_youtube_cookie_status(app: AppHandle) -> Value {
    match theater_cookie_snapshot(&app).await {
        Ok(cookies) => {
            let logged_in = cookies.iter().any(|cookie| {
                matches!(cookie.name(), "SID" | "SAPISID")
                    && domain_matches(cookie.domain(), &["youtube.com"])
            });
            json!({ "loggedIn": logged_in, "cookieCount": cookies.len() })
        }
        Err(_) => json!({ "loggedIn": false, "cookieCount": 0 }),
    }
}

#[tauri::command]
pub async fn theater_youtube_cookie_export(app: AppHandle) -> Value {
    match theater_cookie_snapshot(&app).await {
        Ok(cookies) if cookies.is_empty() => json!({
            "ok": false,
            "reason": "not_authorized",
            "message": "No YouTube cookies were found in the CatRealm desktop session.",
        }),
        Ok(cookies) => {
            let lines = cookies.iter().map(cookie_to_netscape_line).collect::<Vec<_>>();
            json!({
                "ok": true,
                "cookieCount": lines.len(),
                "cookieText": format!("# Netscape HTTP Cookie File\n{}\n", lines.join("\n")),
            })
        }
        Err(error) => json!({
            "ok": false,
            "reason": "export_failed",
            "message": error,
        }),
    }
}

#[tauri::command]
pub async fn theater_youtube_cookie_clear(app: AppHandle) -> Value {
    delete_session_cookies(&app, THEATER_SESSION_LABEL, THEATER_COOKIE_DOMAINS).await
}

struct EmbedLoginConfig {
    login_url: &'static str,
    title: &'static str,
    allowed_nav_domains: &'static [&'static str],
    cookie_checks: &'static [CookieCheck],
    logout_domains: &'static [&'static str],
}

fn embed_login_config(platform: &str) -> Option<EmbedLoginConfig> {
    match platform {
        "youtube" => Some(EmbedLoginConfig {
            login_url: "https://accounts.google.com/signin/v2/identifier?service=youtube",
            title: "Log in to YouTube",
            allowed_nav_domains: &[
                "google.com",
                "accounts.google.com",
                "youtube.com",
                "gstatic.com",
                "googleusercontent.com",
                "googleapis.com",
            ],
            cookie_checks: &[CookieCheck { name: "SID", domain: "youtube.com" }],
            logout_domains: &["youtube.com", "google.com", "googleapis.com", "googlevideo.com", "gstatic.com"],
        }),
        "x" => Some(EmbedLoginConfig {
            login_url: "https://x.com/i/flow/login",
            title: "Log in to X",
            allowed_nav_domains: &["x.com", "twitter.com", "abs.twimg.com", "t.co"],
            cookie_checks: &[CookieCheck { name: "auth_token", domain: "x.com" }],
            logout_domains: &["x.com", "twitter.com", "twimg.com"],
        }),
        _ => None,
    }
}

fn domain_matches(cookie_domain: Option<&str>, allowed_domains: &[&str]) -> bool {
    let domain = cookie_domain
        .unwrap_or_default()
        .trim()
        .trim_start_matches('.')
        .trim_start_matches("www.")
        .to_ascii_lowercase();
    allowed_domains.iter().any(|allowed| {
        let allowed = allowed.trim_start_matches('.').to_ascii_lowercase();
        domain == allowed || domain.ends_with(&format!(".{allowed}"))
    })
}

fn session_window(app: &AppHandle, label: &str) -> Option<WebviewWindow> {
    app.get_webview_window(label)
        .or_else(|| app.get_webview_window("main"))
}

async fn session_cookies(app: &AppHandle, label: &str) -> Result<Vec<Cookie<'static>>, String> {
    let window = session_window(app, label).ok_or_else(|| "No CatRealm webview is available.".to_string())?;
    tauri::async_runtime::spawn_blocking(move || window.cookies().map_err(|error| error.to_string()))
        .await
        .map_err(|error| format!("Cookie task failed: {error}"))?
}

async fn theater_cookie_snapshot(app: &AppHandle) -> Result<Vec<Cookie<'static>>, String> {
    Ok(session_cookies(app, THEATER_SESSION_LABEL).await?
        .into_iter()
        .filter(|cookie| domain_matches(cookie.domain(), THEATER_COOKIE_DOMAINS))
        .collect())
}

async fn delete_session_cookies(app: &AppHandle, label: &str, domains: &[&str]) -> Value {
    let Some(window) = session_window(app, label) else {
        return json!({ "ok": false, "reason": "no_webview", "message": "No CatRealm webview is available." });
    };
    let domains = domains.iter().map(|domain| (*domain).to_string()).collect::<Vec<_>>();
    let task_window = window.clone();
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let cookies = task_window.cookies().map_err(|error| error.to_string())?;
        let domains = domains.iter().map(String::as_str).collect::<Vec<_>>();
        for cookie in cookies.into_iter().filter(|cookie| domain_matches(cookie.domain(), &domains)) {
            task_window.delete_cookie(cookie).map_err(|error| error.to_string())?;
        }
        Ok(())
    }).await;
    match result {
        Ok(Ok(())) => json!({ "ok": true }),
        Ok(Err(error)) => json!({ "ok": false, "reason": "clear_failed", "message": error }),
        Err(error) => json!({ "ok": false, "reason": "task_failed", "message": error.to_string() }),
    }
}

fn sanitize_cookie_field(value: &str) -> String {
    value.replace(['\r', '\n', '\t'], " ").trim().to_string()
}

fn cookie_to_netscape_line(cookie: &Cookie<'_>) -> String {
    let domain = sanitize_cookie_field(cookie.domain().unwrap_or_default());
    // The cookie crate normalizes away a domain's leading dot. These cookies
    // are already restricted to the YouTube/Google allowlist, so restore the
    // Netscape subdomain form needed by yt-dlp and related HTTP clients.
    let domain = if domain.starts_with('.') || domain.is_empty() {
        domain
    } else {
        format!(".{domain}")
    };
    let include_subdomains = if domain.is_empty() { "FALSE" } else { "TRUE" };
    let path = sanitize_cookie_field(cookie.path().unwrap_or("/"));
    let secure = if cookie.secure().unwrap_or(false) { "TRUE" } else { "FALSE" };
    let expires = cookie.expires_datetime()
        .map(|date| date.unix_timestamp().max(0))
        .unwrap_or(0);
    [
        domain,
        include_subdomains.to_string(),
        if path.is_empty() { "/".to_string() } else { path },
        secure.to_string(),
        expires.to_string(),
        sanitize_cookie_field(cookie.name()),
        sanitize_cookie_field(cookie.value()),
    ].join("\t")
}

fn open_login_window(
    app: AppHandle,
    label: &str,
    title: &str,
    login_url: &str,
    allowed_nav_domains: &'static [&'static str],
    width: f64,
    height: f64,
) -> Value {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        return json!({ "ok": true });
    }

    let Ok(url) = login_url.parse::<tauri::Url>() else {
        return json!({ "ok": false, "reason": "invalid_url" });
    };

    match WebviewWindowBuilder::new(&app, label, WebviewUrl::External(url))
        .title(title)
        .inner_size(width, height)
        .on_navigation(move |url| {
            url.host_str()
                .map(|host| host.trim_start_matches("www.").to_ascii_lowercase())
                .map(|host| {
                    allowed_nav_domains
                        .iter()
                        .any(|domain| host == *domain || host.ends_with(&format!(".{domain}")))
                })
                .unwrap_or(false)
        })
        .build()
    {
        Ok(_) => json!({ "ok": true }),
        Err(error) => json!({
            "ok": false,
            "reason": "open_failed",
            "message": error.to_string(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cookie_domains_match_exact_hosts_and_subdomains() {
        assert!(domain_matches(Some(".youtube.com"), &["youtube.com"]));
        assert!(domain_matches(Some("accounts.google.com"), &["google.com"]));
        assert!(!domain_matches(Some("notyoutube.com"), &["youtube.com"]));
    }

    #[test]
    fn netscape_cookie_export_sanitizes_fields() {
        let cookie = Cookie::build(("SID", "token\tvalue"))
            .domain(".youtube.com")
            .path("/")
            .secure(true)
            .build();
        assert_eq!(
            cookie_to_netscape_line(&cookie),
            ".youtube.com\tTRUE\t/\tTRUE\t0\tSID\ttoken value"
        );
    }
}
