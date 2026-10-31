use tauri::WebviewWindow;

#[cfg(windows)]
pub(crate) fn resume(window: &WebviewWindow) {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_3;
    use windows::core::Interface;

    let result = window.with_webview(|webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else {
            return;
        };
        let Ok(core3) = core.cast::<ICoreWebView2_3>() else {
            return;
        };
        // Resume is harmless when the WebView was not suspended.
        if let Err(error) = core3.Resume() {
            eprintln!("[webview-lifecycle] Resume failed: {error}");
        }
    });
    if let Err(error) = result {
        eprintln!("[webview-lifecycle] with_webview failed: {error}");
    }
}

#[cfg(not(windows))]
pub(crate) fn resume(_window: &WebviewWindow) {}
