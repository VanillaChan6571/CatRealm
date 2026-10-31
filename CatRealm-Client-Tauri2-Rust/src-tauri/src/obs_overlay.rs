//! Local OBS browser-source server. Rust owns the listener, SSE fan-out, and
//! content-addressed reactive-avatar files so no Node sidecar is needed.

use std::io::Write;
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, SyncSender, TrySendError};
use std::sync::{Arc, Mutex};
use std::thread;
use tiny_http::{Header, Response};

const OVERLAY_HTML: &str = include_str!("overlay.html");
const MAX_EVENT_CLIENTS: usize = 16;

const EVENT_STREAM_HEAD: &[u8] = b"HTTP/1.1 200 OK\r\n\
Content-Type: text/event-stream\r\n\
Cache-Control: no-cache\r\n\
Connection: close\r\n\
X-Content-Type-Options: nosniff\r\n\
\r\n";

/// Writes the SSE response straight to the socket, flushing after every
/// event. tiny_http's `respond` sends an unsized body chunked and only flushes
/// once ~8 KB build up, so small overlay events never reached OBS. Returns when
/// the overlay is turned off (sender dropped) or the client disconnects.
fn stream_events(mut writer: impl Write, receiver: Receiver<Vec<u8>>) {
    if writer.write_all(EVENT_STREAM_HEAD).and_then(|()| writer.flush()).is_err() {
        return;
    }
    while let Ok(event) = receiver.recv() {
        if writer.write_all(&event).and_then(|()| writer.flush()).is_err() {
            return;
        }
    }
}

pub struct OverlayServer {
    state: Arc<Mutex<serde_json::Value>>,
    clients: Arc<Mutex<Vec<SyncSender<Vec<u8>>>>>,
    server: Mutex<Option<(u16, Arc<tiny_http::Server>)>>,
}

impl Default for OverlayServer {
    fn default() -> Self {
        Self {
            state: Arc::new(Mutex::new(serde_json::Value::Null)),
            clients: Arc::new(Mutex::new(Vec::new())),
            server: Mutex::new(None),
        }
    }
}

fn header(name: &[u8], value: &[u8]) -> Header {
    Header::from_bytes(name, value).expect("static HTTP header must be valid")
}

fn host_is_local(request: &tiny_http::Request, port: u16) -> bool {
    let expected = [format!("127.0.0.1:{port}"), format!("localhost:{port}")];
    request.headers().iter().any(|candidate| {
        candidate.field.equiv("Host")
            && expected
                .iter()
                .any(|host| candidate.value.as_str().eq_ignore_ascii_case(host))
    })
}

fn respond_events(
    request: tiny_http::Request,
    state: &Arc<Mutex<serde_json::Value>>,
    clients: &Arc<Mutex<Vec<SyncSender<Vec<u8>>>>>,
) {
    let current = state.lock().unwrap().to_string();
    let mut client_guard = clients.lock().unwrap();
    if client_guard.len() >= MAX_EVENT_CLIENTS {
        drop(client_guard);
        let response = Response::from_string("too many overlay clients")
            .with_status_code(503)
            .with_header(header(b"Retry-After", b"3"))
            .with_header(header(b"X-Content-Type-Options", b"nosniff"));
        let _ = request.respond(response);
        return;
    }
    let (sender, receiver) = mpsc::sync_channel(4);
    let initial = if current == "null" {
        b":ok\n\n".to_vec()
    } else {
        format!(":ok\n\ndata: {current}\n\n").into_bytes()
    };
    let _ = sender.try_send(initial);
    client_guard.push(sender);
    drop(client_guard);
    thread::spawn(move || stream_events(request.into_writer(), receiver));
}

fn respond_reactive(request: tiny_http::Request, root: &std::path::Path, id: &str) {
    let Some(mime) = crate::commands::reactive_avatar::mime_for_id(id) else {
        let _ = request.respond(Response::empty(404));
        return;
    };
    let Ok(bytes) = crate::commands::reactive_avatar::read_from_root(root, id) else {
        let _ = request.respond(Response::empty(404));
        return;
    };
    let response = Response::from_data(bytes)
        .with_header(header(b"Content-Type", mime.as_bytes()))
        .with_header(header(
            b"Cache-Control",
            b"public, max-age=31536000, immutable",
        ))
        .with_header(header(b"X-Content-Type-Options", b"nosniff"));
    let _ = request.respond(response);
}

impl OverlayServer {
    pub fn set_enabled(
        &self,
        enabled: bool,
        port: u16,
        reactive_root: PathBuf,
    ) -> Result<(), String> {
        let mut guard = self.server.lock().unwrap();
        if !enabled {
            self.clients.lock().unwrap().clear();
            *self.state.lock().unwrap() = serde_json::Value::Null;
            if let Some((_, server)) = guard.take() {
                server.unblock();
            }
            return Ok(());
        }
        if let Some((active_port, _)) = guard.as_ref() {
            if *active_port == port {
                return Ok(());
            }
        }
        if let Some((_, server)) = guard.take() {
            self.clients.lock().unwrap().clear();
            server.unblock();
        }
        let server = Arc::new(
            tiny_http::Server::http(("127.0.0.1", port)).map_err(|error| error.to_string())?,
        );
        let state = Arc::clone(&self.state);
        let clients = Arc::clone(&self.clients);
        let listener = Arc::clone(&server);
        thread::spawn(move || {
            for request in listener.incoming_requests() {
                if !host_is_local(&request, port) {
                    let _ = request.respond(Response::empty(403));
                    continue;
                }
                let route = request.url().split('?').next().unwrap_or("/").to_string();
                match route.as_str() {
                    "/events" => respond_events(request, &state, &clients),
                    "/state" => {
                        let current = state.lock().unwrap();
                        let body = if current.is_null() {
                            "{}".to_string()
                        } else {
                            current.to_string()
                        };
                        let response = Response::from_string(body)
                            .with_header(header(b"Content-Type", b"application/json"))
                            .with_header(header(b"Cache-Control", b"no-store"))
                            .with_header(header(b"X-Content-Type-Options", b"nosniff"));
                        let _ = request.respond(response);
                    }
                    route if route.starts_with("/reactive/") => {
                        respond_reactive(request, &reactive_root, &route["/reactive/".len()..]);
                    }
                    _ => {
                        let response = Response::from_string(OVERLAY_HTML)
                            .with_header(header(b"Content-Type", b"text/html; charset=utf-8"))
                            .with_header(header(b"Cache-Control", b"no-store"))
                            .with_header(header(b"X-Content-Type-Options", b"nosniff"));
                        let _ = request.respond(response);
                    }
                }
            }
        });
        *guard = Some((port, server));
        Ok(())
    }

    pub fn update_state(&self, state: serde_json::Value) {
        let payload = format!("data: {state}\n\n").into_bytes();
        *self.state.lock().unwrap() = state;
        self.clients
            .lock()
            .unwrap()
            .retain(|client| match client.try_send(payload.clone()) {
                Ok(()) => true,
                Err(TrySendError::Full(_)) | Err(TrySendError::Disconnected(_)) => false,
            });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Records what reached the "socket" at each flush.
    #[derive(Default)]
    struct FlushLog {
        pending: Vec<u8>,
        flushed: Vec<String>,
    }

    impl Write for &mut FlushLog {
        fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
            self.pending.extend_from_slice(buffer);
            Ok(buffer.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            self.flushed
                .push(String::from_utf8(std::mem::take(&mut self.pending)).unwrap());
            Ok(())
        }
    }

    #[test]
    fn event_stream_flushes_headers_and_each_event_unchunked() {
        let (sender, receiver) = mpsc::sync_channel(2);
        sender.send(b":ok\n\n".to_vec()).unwrap();
        sender.send(b"data: one\n\n".to_vec()).unwrap();
        drop(sender);

        let mut log = FlushLog::default();
        stream_events(&mut log, receiver);
        assert!(log.flushed[0].starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(log.flushed[0].contains("Content-Type: text/event-stream\r\n"));
        assert!(!log.flushed[0].contains("Transfer-Encoding"));
        assert!(log.flushed[0].ends_with("\r\n\r\n"));
        assert_eq!(&log.flushed[1..], [":ok\n\n", "data: one\n\n"]);
        assert!(log.pending.is_empty());
    }

    #[test]
    fn update_state_fans_out_and_removes_slow_clients() {
        let overlay = OverlayServer::default();
        let (sender, receiver) = mpsc::sync_channel(1);
        overlay.clients.lock().unwrap().push(sender);

        overlay.update_state(serde_json::json!({ "users": [1] }));
        assert_eq!(
            String::from_utf8(receiver.recv().unwrap()).unwrap(),
            "data: {\"users\":[1]}\n\n"
        );
        assert_eq!(*overlay.state.lock().unwrap(), serde_json::json!({ "users": [1] }));

        overlay.update_state(serde_json::json!({ "sequence": 1 }));
        overlay.update_state(serde_json::json!({ "sequence": 2 }));
        assert!(overlay.clients.lock().unwrap().is_empty());
    }

    #[test]
    fn bundled_overlay_connects_to_events_and_renders_reactive_media() {
        assert!(OVERLAY_HTML.contains("new EventSource('/events')"));
        assert!(OVERLAY_HTML.contains("reactive-stack"));
        assert!(OVERLAY_HTML.contains("VIDEO"));
    }
}
