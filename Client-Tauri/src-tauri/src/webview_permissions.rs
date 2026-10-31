//! Auto-grant WebView2 media permissions for the app's own origin, matching the
//! Electron client's `setPermissionRequestHandler` (CatRealm-Client/electron/
//! main.cjs). Without it, WebView2 pops a native prompt the first time voice
//! opens the microphone, and `enumerateDevices()` returns blank device labels
//! until the grant lands.
//!
//! Scoped to `http(s)://tauri.localhost` (the app origin) so any external
//! content ever loaded in the webview does NOT get silent media access — the
//! same trusted-origin gate Electron applies.

use tauri::WebviewWindow;

#[cfg(windows)]
pub(crate) fn install_media_autogrant(window: &WebviewWindow) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_PERMISSION_KIND_CAMERA, COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
        COREWEBVIEW2_PERMISSION_STATE_ALLOW, COREWEBVIEW2_PERMISSION_STATE_DENY,
    };
    use webview2_com::PermissionRequestedEventHandler;
    use windows::core::PWSTR;
    use windows::Win32::System::Com::CoTaskMemFree;

    let result = window.with_webview(|webview| unsafe {
        let core = match webview.controller().CoreWebView2() {
            Ok(core) => core,
            Err(err) => {
                eprintln!("[webview-perms] CoreWebView2() unavailable: {err}");
                return;
            }
        };

        let handler = PermissionRequestedEventHandler::create(Box::new(|_sender, args| {
            let Some(args) = args else {
                return Ok(());
            };

            let mut kind = COREWEBVIEW2_PERMISSION_KIND_MICROPHONE;
            args.PermissionKind(&mut kind)?;
            let is_media = kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE
                || kind == COREWEBVIEW2_PERMISSION_KIND_CAMERA;
            if !is_media {
                return Ok(());
            }

            let mut uri_ptr = PWSTR::null();
            args.Uri(&mut uri_ptr)?;
            let uri = if uri_ptr.is_null() {
                String::new()
            } else {
                let value = uri_ptr.to_string().unwrap_or_default();
                CoTaskMemFree(Some(uri_ptr.0 as *const core::ffi::c_void));
                value
            };

            let trusted = tauri::Url::parse(&uri)
                .map(|url| crate::app_security::is_app_url(&url))
                .unwrap_or(false);
            args.SetState(if trusted {
                COREWEBVIEW2_PERMISSION_STATE_ALLOW
            } else {
                COREWEBVIEW2_PERMISSION_STATE_DENY
            })?;
            Ok(())
        }));

        let mut token: i64 = 0;
        if let Err(err) = core.add_PermissionRequested(&handler, &mut token) {
            eprintln!("[webview-perms] add_PermissionRequested failed: {err}");
        }
    });

    if let Err(err) = result {
        eprintln!("[webview-perms] with_webview failed: {err}");
    }
}

/// Keep WebKit's WebRTC path disabled on Linux. Sushi ships a native LiveKit
/// voice backend for this platform, and the renderer selects it when
/// `RTCPeerConnection` is unavailable. Enabling WebRTC here defeats that
/// fallback and crashes WebKit's web process in libpipewire on current Ubuntu
/// releases.
///
/// WebKit media capture stays disabled as well: merely opening a microphone
/// crashes the bundled web process in libpipewire. Linux voice capture belongs
/// to the native backend, while ordinary media playback remains available.
#[cfg(target_os = "linux")]
pub(crate) fn install_media_autogrant(window: &WebviewWindow) {
    use webkit2gtk::glib::prelude::*;
    use webkit2gtk::{
        DeviceInfoPermissionRequest, HardwareAccelerationPolicy, PermissionRequestExt, SettingsExt,
        UserMediaPermissionRequest, WebViewExt,
    };

    let result = window.with_webview(|webview| {
        if let Some(settings) = WebViewExt::settings(&webview.inner()) {
            // WebKitGTK defaults to on-demand acceleration, which can leave
            // CSS transitions and large settings panes on its software path.
            // Sushi is a desktop app with a dedicated webview, so keep its
            // compositor acceleration enabled consistently.
            settings.set_hardware_acceleration_policy(HardwareAccelerationPolicy::Always);
            settings.set_enable_media_stream(false);
            settings.set_enable_webrtc(false);
        } else {
            eprintln!("[webview-perms] WebKit settings unavailable");
        }

        webview
            .inner()
            .connect_permission_request(|_webview, request| {
                let is_media = request.is::<UserMediaPermissionRequest>()
                    || request.is::<DeviceInfoPermissionRequest>();
                if !is_media {
                    // Let WebKit's default handling decide non-media requests.
                    return false;
                }

                // Native voice owns capture on Linux. Do not infer a requesting
                // subframe's authority from the top-level WebKit document URL.
                request.deny();
                true
            });
    });

    if let Err(err) = result {
        eprintln!("[webview-perms] with_webview failed: {err}");
    }
}

#[cfg(not(any(windows, target_os = "linux")))]
pub(crate) fn install_media_autogrant(_window: &WebviewWindow) {}
