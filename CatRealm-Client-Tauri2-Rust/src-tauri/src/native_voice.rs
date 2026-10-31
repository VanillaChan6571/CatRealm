//! Native LiveKit voice backend for webviews without WebRTC.
//!
//! Stock Debian/Ubuntu WebKitGTK is compiled with `ENABLE_WEB_RTC=OFF`
//! (upstream defaults it to the experimental-features flag), so
//! `RTCPeerConnection` never exists in Linux Sushi no matter which runtime
//! settings or GStreamer plugins are present. Rather than shipping a custom
//! WebKit, voice runs through the LiveKit Rust SDK in this process: the
//! renderer still fetches the room token and drives all UI, then hands the
//! LiveKit URL/token to `native_voice_connect`. libwebrtc's platform audio
//! device module captures the default microphone and plays subscribed
//! participants out the default output device; room state is mirrored to the
//! renderer through `native-voice-event` emissions.
//!
//! Camera and screen capture also stay native: GStreamer feeds I420 frames to
//! LiveKit, while subscribed video is decoded by libwebrtc and mirrored to the
//! renderer as throttled JPEG previews. This avoids WebKit media APIs entirely.

use serde_json::{json, Value};
use tauri::AppHandle;

#[cfg(all(target_os = "linux", feature = "native-voice"))]
mod imp {
    use super::*;
    use livekit::options::{TrackPublishOptions, VideoCodec, VideoEncoderBackend};
    use livekit::prelude::*;
    use livekit::webrtc::prelude::RtcAudioTrack;
    use livekit::webrtc::video_frame::{
        EncodedFrameType, EncodedVideoCodec, EncodedVideoFrame, I420Buffer, VideoFrame,
        VideoRotation,
    };
    use livekit::webrtc::video_source::{native::NativeVideoSource, RtcVideoSource, VideoResolution};
    use livekit::webrtc::video_stream::native::NativeVideoStream;
    use base64::Engine;
    use futures_util::StreamExt;
    use livekit::webrtc::prelude::VideoBuffer;
    use std::collections::HashMap;
    use std::io::Read;
    use std::process::Command;
    use std::process::{Child, Stdio};
    use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
    use std::sync::{Arc, Mutex, OnceLock};
    use tauri::Emitter;

    type MonitorBounds = (i32, i32, u32, u32);

    static GST_NVH264ENC_AVAILABLE: OnceLock<bool> = OnceLock::new();
    static GST_GL_PIPELINE_AVAILABLE: OnceLock<bool> = OnceLock::new();

    /// Tracks currently subscribed remote audio so deafen can gate decode.
    struct Shared {
        deafened: AtomicBool,
        remote_audio: Mutex<Vec<RtcAudioTrack>>,
        remote_video: Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>,
    }

    struct Session {
        room: Arc<Room>,
        audio: PlatformAudio,
        mic_publication: Option<LocalTrackPublication>,
        event_task: tauri::async_runtime::JoinHandle<()>,
        shared: Arc<Shared>,
    }

    struct VideoPublisher {
        children: Vec<Arc<Mutex<Child>>>,
        tasks: Vec<tauri::async_runtime::JoinHandle<()>>,
        sid: TrackSid,
    }

    struct MicrophoneMeter {
        child: Arc<Mutex<Child>>,
        latest_db_bits: Arc<AtomicU32>,
        last_requested_ms: Arc<AtomicU64>,
    }

    #[derive(Default)]
    struct DevicePreferences {
        input_id: Option<String>,
        output_id: Option<String>,
    }

    #[derive(Default)]
    pub struct NativeVoiceService {
        session: Mutex<Option<Session>>,
        devices: Mutex<DevicePreferences>,
        videos: Arc<Mutex<HashMap<String, VideoPublisher>>>,
        meter: Mutex<Option<MicrophoneMeter>>,
    }

    fn stop_video_processes(videos: &Mutex<HashMap<String, VideoPublisher>>) {
        for (_, publisher) in videos.lock().unwrap().drain() {
            for child in &publisher.children { stop_child(child); }
            for task in publisher.tasks { task.abort(); }
        }
    }

    fn stop_child(child: &Arc<Mutex<Child>>) {
        let mut child = child.lock().unwrap();
        match child.try_wait() {
            Ok(Some(_)) => {}
            _ => {
                let _ = child.kill();
            }
        }
        let _ = child.wait();
    }

    fn preferred_video_encoder() -> VideoEncoderBackend {
        let available = VideoEncoderBackend::list_available().into_iter().collect::<Vec<_>>();
        let selected = if available.contains(&VideoEncoderBackend::Nvenc) {
            VideoEncoderBackend::Nvenc
        } else if available.contains(&VideoEncoderBackend::Vaapi) {
            VideoEncoderBackend::Vaapi
        } else if available.contains(&VideoEncoderBackend::Hardware) {
            VideoEncoderBackend::Hardware
        } else {
            VideoEncoderBackend::Auto
        };
        eprintln!("[native-video] available encoders: {available:?}; selected: {selected:?}");
        selected
    }

    fn emit_event(app: &AppHandle, payload: Value) {
        let _ = app.emit("native-voice-event", payload);
    }

    fn participant_json(identity: &ParticipantIdentity, name: &str) -> Value {
        json!({ "identity": identity.to_string(), "name": name })
    }

    fn apply_deafen(shared: &Shared) {
        let enabled = !shared.deafened.load(Ordering::SeqCst);
        for track in shared.remote_audio.lock().unwrap().iter() {
            track.set_enabled(enabled);
        }
    }

    fn device_key(kind: &str, guid: &str, index: usize) -> String {
        if guid.is_empty() { format!("native-{kind}-{index}") } else { guid.to_string() }
    }

    fn recording_device(audio: &PlatformAudio, key: &str) -> Option<RecordingDeviceId> {
        audio.recording_devices()
            .find(|device| device_key("input", device.id.as_str(), device.index) == key)
            .map(|device| device.id)
    }

    fn playout_device(audio: &PlatformAudio, key: &str) -> Option<PlayoutDeviceId> {
        audio.playout_devices()
            .find(|device| device_key("output", device.id.as_str(), device.index) == key)
            .map(|device| device.id)
    }

    fn wav_pcm_bytes(mut pcm: Vec<u8>, sample_rate: u32, channels: u16) -> Vec<u8> {
        const HEADER_BYTES: usize = 44;
        let data_len = u32::try_from(pcm.len()).unwrap_or(u32::MAX);
        let original_len = pcm.len();
        pcm.reserve(HEADER_BYTES);
        pcm.resize(original_len + HEADER_BYTES, 0);
        pcm.copy_within(0..original_len, HEADER_BYTES);

        pcm[0..4].copy_from_slice(b"RIFF");
        pcm[4..8].copy_from_slice(&(36 + data_len).to_le_bytes());
        pcm[8..16].copy_from_slice(b"WAVEfmt ");
        pcm[16..20].copy_from_slice(&16u32.to_le_bytes());
        pcm[20..22].copy_from_slice(&1u16.to_le_bytes());
        pcm[22..24].copy_from_slice(&channels.to_le_bytes());
        pcm[24..28].copy_from_slice(&sample_rate.to_le_bytes());
        pcm[28..32].copy_from_slice(&(sample_rate * channels as u32 * 2).to_le_bytes());
        pcm[32..34].copy_from_slice(&(channels * 2).to_le_bytes());
        pcm[34..36].copy_from_slice(&16u16.to_le_bytes());
        pcm[36..40].copy_from_slice(b"data");
        pcm[40..44].copy_from_slice(&data_len.to_le_bytes());
        pcm
    }

    fn pcm_level_db(raw: &[u8]) -> f32 {
        let mut sum = 0.0f64;
        let mut count = 0usize;
        for bytes in raw.chunks_exact(2) {
            let sample = i16::from_le_bytes([bytes[0], bytes[1]]) as f64 / 32768.0;
            sum += sample * sample;
            count += 1;
        }
        let rms = (sum / count.max(1) as f64).sqrt();
        if rms > 1e-9 { (20.0 * rms.log10()).max(-60.0) as f32 } else { -60.0 }
    }

    fn start_microphone_meter() -> Result<MicrophoneMeter, String> {
        const METER_SAMPLE_BYTES: usize = 4_800 * 2;
        const IDLE_TIMEOUT_MS: u64 = 1_500;

        let mut child = Command::new("pw-record")
            .args(["--raw", "--rate", "48000", "--channels", "1", "--format", "s16", "-"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| error.to_string())?;
        let Some(mut stdout) = child.stdout.take() else {
            let _ = child.kill();
            return Err("pw-record stdout was unavailable".into());
        };
        let child = Arc::new(Mutex::new(child));
        let latest_db_bits = Arc::new(AtomicU32::new((-60.0f32).to_bits()));
        let last_requested_ms = Arc::new(AtomicU64::new(crate::now_ms() as u64));
        let task_child = child.clone();
        let task_latest = latest_db_bits.clone();
        let task_last_requested = last_requested_ms.clone();
        std::thread::spawn(move || {
            let mut raw = [0u8; METER_SAMPLE_BYTES];
            while stdout.read_exact(&mut raw).is_ok() {
                task_latest.store(pcm_level_db(&raw).to_bits(), Ordering::Relaxed);
                let idle_ms = (crate::now_ms() as u64)
                    .saturating_sub(task_last_requested.load(Ordering::Relaxed));
                if idle_ms >= IDLE_TIMEOUT_MS {
                    stop_child(&task_child);
                    break;
                }
            }
        });
        Ok(MicrophoneMeter { child, latest_db_bits, last_requested_ms })
    }

    fn process_test_audio_in_place(
        pcm: &mut [u8],
        rnnoise: bool,
        gate: bool,
        gate_threshold_db: f32,
    ) {
        let mut denoiser = rnnoise.then(nnnoiseless::DenoiseState::new);
        let mut gate_gain = 1.0f32;
        for chunk in pcm.chunks_mut(nnnoiseless::DenoiseState::FRAME_SIZE * 2) {
            let mut input = [0.0f32; nnnoiseless::DenoiseState::FRAME_SIZE];
            let sample_count = chunk.len() / 2;
            for (target, sample) in input.iter_mut().zip(chunk.chunks_exact(2)) {
                *target = i16::from_le_bytes([sample[0], sample[1]]) as f32;
            }
            let mut output = [0.0f32; nnnoiseless::DenoiseState::FRAME_SIZE];
            if let Some(state) = denoiser.as_mut() {
                state.process_frame(&mut output, &input);
            } else {
                output.copy_from_slice(&input);
            }
            let rms = (output.iter().map(|sample| sample * sample).sum::<f32>() / output.len() as f32).sqrt();
            let db = 20.0 * (rms / 32768.0).max(1e-6).log10();
            let target_gain = if !gate || db >= gate_threshold_db { 1.0 } else { 0.0 };
            for (sample, target) in output
                .iter()
                .take(sample_count)
                .zip(chunk.chunks_exact_mut(2))
            {
                let speed = if target_gain > gate_gain { 0.08 } else { 0.008 };
                gate_gain += (target_gain - gate_gain) * speed;
                target.copy_from_slice(
                    &((*sample * gate_gain).clamp(i16::MIN as f32, i16::MAX as f32) as i16)
                        .to_le_bytes(),
                );
            }
        }
    }

    fn apply_monitor_bounds(command: &mut Command, bounds: Option<MonitorBounds>) {
        if let Some((x, y, monitor_width, monitor_height)) = bounds {
            let end_x = i64::from(x) + i64::from(monitor_width) - 1;
            let end_y = i64::from(y) + i64::from(monitor_height) - 1;
            command.args([
                &format!("startx={x}"), &format!("starty={y}"),
                &format!("endx={end_x}"), &format!("endy={end_y}"),
            ]);
        }
    }

    fn monitor_bounds(app: &AppHandle, source_id: &str) -> Option<MonitorBounds> {
        let index = source_id.strip_prefix("screen:")?.parse::<usize>().ok()?;
        let monitor = app.available_monitors().ok()?.into_iter().nth(index)?;
        let position = monitor.position();
        let size = monitor.size();
        Some((position.x, position.y, size.width, size.height))
    }

    fn gstreamer_video_child(kind: &str, source_id: &str, width: u32, height: u32, fps: u32, bounds: Option<MonitorBounds>) -> std::io::Result<Child> {
        let mut command = Command::new("gst-launch-1.0");
        command.arg("-q");
        if kind == "camera" {
            let derived_path;
            let path = if source_id.starts_with("/dev/video") {
                source_id
            } else if let Some(node) = source_id.strip_prefix("native-video:") {
                derived_path = format!("/dev/{node}");
                &derived_path
            } else {
                "/dev/video0"
            };
            command.args(["v4l2src", &format!("device={path}"), "!", "decodebin", "!", "videoconvert"]);
        } else {
            command.args(["ximagesrc", "use-damage=false", "show-pointer=true"]);
            apply_monitor_bounds(&mut command, bounds);
            command.args(["!", "videoconvert"]);
        }
        command.args([
            "!", "videoscale", "!", "videorate", "!",
            &format!("video/x-raw,format=I420,width={width},height={height},framerate={fps}/1"),
            "!", "fdsink", "fd=1", "sync=true",
        ]);
        command.stdout(Stdio::piped()).stderr(Stdio::inherit()).spawn()
    }

    fn gstreamer_nvenc_child(width: u32, height: u32, fps: u32, bounds: Option<MonitorBounds>) -> std::io::Result<Child> {
        let mut command = Command::new("gst-launch-1.0");
        command.args(["-q", "ximagesrc", "use-damage=false", "show-pointer=true"]);
        apply_monitor_bounds(&mut command, bounds);
        let bitrate_kbps = ((width as u64 * height as u64 * fps as u64 * 7) / 100_000)
            .clamp(2_500, 16_000);
        command.args([
            "!", "queue", "leaky=downstream", "max-size-buffers=2", "max-size-bytes=0", "max-size-time=0",
        ]);
        if gstreamer_gl_pipeline_available() {
            // nvh264enc accepts GLMemory directly, so the expensive BGRx to
            // NV12 conversion and any requested scaling can remain on the GPU.
            command.args([
                "!", "glupload", "!", "glcolorconvert", "!",
                "video/x-raw(memory:GLMemory),format=RGBA", "!", "glcolorscale", "!",
                &format!("video/x-raw(memory:GLMemory),format=RGBA,width={width},height={height}"),
                "!", "glcolorconvert", "!",
                &format!("video/x-raw(memory:GLMemory),format=NV12,width={width},height={height},framerate={fps}/1"),
            ]);
        } else {
            command.args([
                "!", "videoconvert", "!", "videoscale", "!", "videorate", "!",
                &format!("video/x-raw,format=NV12,width={width},height={height},framerate={fps}/1"),
            ]);
        }
        command.args([
            "!", "nvh264enc", "preset=p4", "tune=low-latency", "rc-mode=cbr",
            &format!("bitrate={bitrate_kbps}"), &format!("gop-size={}", fps * 2),
            "bframes=0", "zerolatency=true", "aud=true", "repeat-sequence-header=true",
            "!", "video/x-h264,stream-format=byte-stream,alignment=au", "!",
            "h264parse", "config-interval=-1", "!",
            "video/x-h264,stream-format=byte-stream,alignment=au", "!",
            "fdsink", "fd=1", "sync=true",
        ]);
        command.stdout(Stdio::piped()).stderr(Stdio::inherit()).spawn()
    }

    fn gstreamer_screen_preview_child(width: u32, height: u32, fps: u32, bounds: Option<MonitorBounds>) -> std::io::Result<Child> {
        let mut command = Command::new("gst-launch-1.0");
        command.args(["-q", "ximagesrc", "use-damage=false", "show-pointer=true"]);
        apply_monitor_bounds(&mut command, bounds);
        command.args([
            "!", "queue", "leaky=downstream", "max-size-buffers=1", "max-size-bytes=0", "max-size-time=0",
            "!", "videoconvert", "!", "videoscale", "!", "videorate", "!",
            &format!("video/x-raw,format=I420,width={width},height={height},framerate={fps}/1"),
            "!", "jpegenc", "quality=70", "!", "fdsink", "fd=1", "sync=true",
        ]);
        command.stdout(Stdio::piped()).stderr(Stdio::inherit()).spawn()
    }

    fn inspect_gstreamer_element(name: &str) -> bool {
        Command::new("gst-inspect-1.0")
            .arg(name)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|status| status.success())
    }

    fn gstreamer_nvenc_available() -> bool {
        *GST_NVH264ENC_AVAILABLE.get_or_init(|| inspect_gstreamer_element("nvh264enc"))
    }

    fn gstreamer_gl_pipeline_available() -> bool {
        *GST_GL_PIPELINE_AVAILABLE.get_or_init(|| {
            inspect_gstreamer_element("glupload")
                && inspect_gstreamer_element("glcolorconvert")
                && inspect_gstreamer_element("glcolorscale")
        })
    }

    #[derive(Default)]
    struct PreviewScratch {
        rgb: Vec<u8>,
        jpeg: Vec<u8>,
    }

    #[allow(clippy::too_many_arguments)]
    fn i420_planes_preview_jpeg(
        y_plane: &[u8], stride_y: usize,
        u_plane: &[u8], stride_u: usize,
        v_plane: &[u8], stride_v: usize,
        width: u32, height: u32,
        scratch: &mut PreviewScratch,
    ) -> Option<String> {
        if width == 0 || height == 0 || width > u16::MAX as u32 || height > u16::MAX as u32 {
            return None;
        }
        let width = usize::try_from(width).ok()?;
        let height = usize::try_from(height).ok()?;
        let chroma_width = width.div_ceil(2);
        let chroma_height = height.div_ceil(2);
        let plane_fits = |plane: &[u8], stride: usize, row_width: usize, rows: usize| {
            stride >= row_width
                && rows > 0
                && (rows - 1).checked_mul(stride)
                    .and_then(|offset| offset.checked_add(row_width))
                    .is_some_and(|required| required <= plane.len())
        };
        if !plane_fits(y_plane, stride_y, width, height)
            || !plane_fits(u_plane, stride_u, chroma_width, chroma_height)
            || !plane_fits(v_plane, stride_v, chroma_width, chroma_height)
        {
            return None;
        }

        let pixel_count = width.checked_mul(height)?;
        scratch.rgb.resize(pixel_count.checked_mul(3)?, 0);
        for py in 0..height {
            for px in 0..width {
                let y = y_plane[py * stride_y + px] as f32;
                let u = u_plane[(py / 2) * stride_u + px / 2] as f32 - 128.0;
                let v = v_plane[(py / 2) * stride_v + px / 2] as f32 - 128.0;
                let offset = (py * width + px) * 3;
                scratch.rgb[offset] = (y + 1.402 * v).clamp(0.0, 255.0) as u8;
                scratch.rgb[offset + 1] = (y - 0.344136 * u - 0.714136 * v).clamp(0.0, 255.0) as u8;
                scratch.rgb[offset + 2] = (y + 1.772 * u).clamp(0.0, 255.0) as u8;
            }
        }
        scratch.jpeg.clear();
        jpeg_encoder::Encoder::new(&mut scratch.jpeg, 70)
            .encode(&scratch.rgb, width as u16, height as u16, jpeg_encoder::ColorType::Rgb).ok()?;
        Some(format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(&scratch.jpeg)))
    }

    fn i420_buffer_preview_jpeg(buffer: &I420Buffer, scratch: &mut PreviewScratch) -> Option<String> {
        let width = buffer.width();
        let height = buffer.height();
        let (stride_y, stride_u, stride_v) = buffer.strides();
        let (y, u, v) = buffer.data();
        i420_planes_preview_jpeg(
            y, stride_y as usize,
            u, stride_u as usize,
            v, stride_v as usize,
            width, height, scratch,
        )
    }

    fn scaled_i420_preview_jpeg(buffer: &mut I420Buffer, scratch: &mut PreviewScratch) -> Option<String> {
        const MAX_PREVIEW_WIDTH: u32 = 960;
        if buffer.width() <= MAX_PREVIEW_WIDTH {
            return i420_buffer_preview_jpeg(buffer, scratch);
        }
        let width = MAX_PREVIEW_WIDTH & !1;
        let height = ((buffer.height() as u64 * width as u64 / buffer.width() as u64) as u32).max(2) & !1;
        let scaled = buffer.scale(width as i32, height as i32);
        i420_buffer_preview_jpeg(&scaled, scratch)
    }

    fn start_remote_video(
        app: AppHandle,
        shared: Arc<Shared>,
        track: RemoteVideoTrack,
        participant_identity: String,
    ) {
        let track_sid = track.sid().to_string();
        let source = match track.source() {
            TrackSource::Screenshare => "screen",
            _ => "camera",
        };
        let task_key = track_sid.clone();
        let cleanup_key = task_key.clone();
        let task_shared = shared.clone();
        let task = tauri::async_runtime::spawn(async move {
            let mut stream = NativeVideoStream::new(track.rtc_track());
            let mut preview_scratch = PreviewScratch::default();
            let mut last_preview = std::time::Instant::now()
                .checked_sub(std::time::Duration::from_millis(100))
                .unwrap_or_else(std::time::Instant::now);
            while let Some(frame) = stream.next().await {
                if last_preview.elapsed() < std::time::Duration::from_millis(100) {
                    continue;
                }
                let mut i420 = frame.buffer.to_i420();
                if let Some(data_url) = scaled_i420_preview_jpeg(&mut i420, &mut preview_scratch) {
                    emit_event(&app, json!({
                        "type": "remote-video-frame",
                        "identity": participant_identity,
                        "trackSid": track_sid,
                        "kind": source,
                        "dataUrl": data_url,
                        "width": i420.width(),
                        "height": i420.height(),
                    }));
                    last_preview = std::time::Instant::now();
                }
            }
            emit_event(&app, json!({
                "type": "remote-video-ended", "trackSid": track_sid,
                "identity": participant_identity, "kind": source,
            }));
            task_shared.remote_video.lock().unwrap().remove(&cleanup_key);
        });
        shared.remote_video.lock().unwrap().insert(task_key, task);
    }

    fn annex_b_nal(data: &[u8], index: usize) -> Option<(usize, u8)> {
        if data.get(index..index + 4) == Some(&[0, 0, 0, 1]) {
            data.get(index + 4).map(|value| (4, value & 0x1f))
        } else if data.get(index..index + 3) == Some(&[0, 0, 1]) {
            data.get(index + 3).map(|value| (3, value & 0x1f))
        } else {
            None
        }
    }

    fn find_annex_b_nal(data: &[u8], wanted_type: u8, from: usize) -> Option<(usize, usize)> {
        let mut index = from;
        while index + 3 < data.len() {
            if let Some((prefix_len, nal_type)) = annex_b_nal(data, index) {
                if nal_type == wanted_type {
                    return Some((index, prefix_len));
                }
                // Do not treat the tail of a four-byte prefix as a second,
                // overlapping three-byte prefix.
                index += prefix_len;
            } else {
                index += 1;
            }
        }
        None
    }

    fn contains_annex_b_nal(data: &[u8], wanted_type: u8) -> bool {
        find_annex_b_nal(data, wanted_type, 0).is_some()
    }

    fn feed_h264_frames(
        child: Arc<Mutex<Child>>,
        source: NativeVideoSource,
        width: u32,
        height: u32,
        started_tx: std::sync::mpsc::Sender<Result<(), String>>,
    ) {
        let mut stdout = match child.lock().unwrap().stdout.take() {
            Some(stdout) => stdout,
            None => {
                let _ = started_tx.send(Err("GStreamer NVENC stdout was unavailable".into()));
                return;
            }
        };
        let started = std::time::Instant::now();
        let resolution = VideoResolution { width, height };
        let mut pending = Vec::<u8>::with_capacity(256 * 1024);
        let mut chunk = [0u8; 64 * 1024];
        let mut start_signal = Some(started_tx);
        loop {
            let read = match stdout.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(read) => read,
            };
            pending.extend_from_slice(&chunk[..read]);
            let first_prefix_len = if let Some((first, prefix_len)) = find_annex_b_nal(&pending, 9, 0) {
                if first > 0 {
                    pending.drain(..first);
                }
                prefix_len
            } else {
                if pending.len() > 8 * 1024 * 1024 {
                    pending.clear();
                }
                continue;
            };
            let mut next_search = first_prefix_len + 1;
            while let Some((end, _)) = find_annex_b_nal(&pending, 9, next_search) {
                let access_unit = &pending[..end];
                let key = contains_annex_b_nal(access_unit, 5);
                let frame = EncodedVideoFrame {
                    codec: EncodedVideoCodec::H264,
                    payload: &access_unit,
                    timestamp_us: started.elapsed().as_micros().min(i64::MAX as u128) as i64,
                    frame_type: if key { EncodedFrameType::Key } else { EncodedFrameType::Delta },
                    resolution: resolution.clone(),
                    frame_metadata: None,
                };
                if source.capture_encoded_frame(&frame) {
                    if let Some(signal) = start_signal.take() { let _ = signal.send(Ok(())); }
                }
                pending.drain(..end);
                next_search = annex_b_nal(&pending, 0)
                    .map(|(prefix_len, _)| prefix_len + 1)
                    .unwrap_or(4);
            }
            if pending.len() > 8 * 1024 * 1024 {
                pending.clear();
            }
        }
        if let Some(signal) = start_signal.take() {
            let _ = signal.send(Err("GStreamer NVENC produced no accepted H.264 access units".into()));
        }
    }

    fn find_marker(data: &[u8], marker: [u8; 2], from: usize) -> Option<usize> {
        data.get(from..)?
            .windows(2)
            .position(|window| window == marker)
            .map(|offset| from + offset)
    }

    fn feed_jpeg_preview_frames(child: Arc<Mutex<Child>>, app: AppHandle, kind: String) {
        let mut stdout = match child.lock().unwrap().stdout.take() { Some(stdout) => stdout, None => return };
        let mut pending = Vec::<u8>::with_capacity(256 * 1024);
        let mut chunk = [0u8; 64 * 1024];
        loop {
            let read = match stdout.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(read) => read,
            };
            pending.extend_from_slice(&chunk[..read]);
            let Some(start) = find_marker(&pending, [0xff, 0xd8], 0) else {
                if pending.len() > 4 * 1024 * 1024 { pending.clear(); }
                continue;
            };
            if start > 0 { pending.drain(..start); }
            while let Some(end) = find_marker(&pending, [0xff, 0xd9], 2) {
                let jpeg_end = end + 2;
                let data_url = format!(
                    "data:image/jpeg;base64,{}",
                    base64::engine::general_purpose::STANDARD.encode(&pending[..jpeg_end]),
                );
                emit_event(&app, json!({ "type": "video-preview", "kind": kind, "dataUrl": data_url }));
                pending.drain(..jpeg_end);
                let Some(next_start) = find_marker(&pending, [0xff, 0xd8], 0) else { break };
                if next_start > 0 { pending.drain(..next_start); }
            }
        }
        emit_event(&app, json!({ "type": "video-preview-ended", "kind": kind }));
    }

    fn feed_i420_frames(
        child: Arc<Mutex<Child>>,
        source: NativeVideoSource,
        app: AppHandle,
        kind: String,
        fps: u32,
        width: u32,
        height: u32,
        started_tx: std::sync::mpsc::Sender<Result<(), String>>,
    ) {
        let mut stdout = match child.lock().unwrap().stdout.take() {
            Some(stdout) => stdout,
            None => {
                let _ = started_tx.send(Err("GStreamer stdout was unavailable".into()));
                return;
            }
        };
        let y_len = (width * height) as usize;
        let uv_len = (((width + 1) / 2) * ((height + 1) / 2)) as usize;
        let mut raw = vec![0u8; y_len + uv_len * 2];
        let started = std::time::Instant::now();
        let preview_fps = 10u32.min(fps);
        let preview_interval = fps.div_ceil(preview_fps).max(1) as usize;
        let mut frame_number = 0usize;
        let mut start_signal = Some(started_tx);
        let mut preview_scratch = PreviewScratch::default();
        while stdout.read_exact(&mut raw).is_ok() {
            if let Some(signal) = start_signal.take() {
                let _ = signal.send(Ok(()));
            }
            let mut buffer = I420Buffer::new(width, height);
            let (y, u, v) = buffer.data_mut();
            y.copy_from_slice(&raw[..y_len]);
            u.copy_from_slice(&raw[y_len..y_len + uv_len]);
            v.copy_from_slice(&raw[y_len + uv_len..]);
            let mut frame = VideoFrame::new(VideoRotation::VideoRotation0, buffer);
            frame.timestamp_us = started.elapsed().as_micros().min(i64::MAX as u128) as i64;
            source.capture_frame(&frame);
            if frame_number % preview_interval == 0 {
                if let Some(data_url) = scaled_i420_preview_jpeg(&mut frame.buffer, &mut preview_scratch) {
                    emit_event(&app, json!({ "type": "video-preview", "kind": kind, "dataUrl": data_url }));
                }
            }
            frame_number = frame_number.wrapping_add(1);
        }
        if let Some(signal) = start_signal.take() {
            let status = child.lock().unwrap().try_wait().ok().flatten();
            let detail = status
                .map(|status| format!("GStreamer exited with {status}"))
                .unwrap_or_else(|| "GStreamer produced no complete video frame".into());
            let _ = signal.send(Err(detail));
        }
        emit_event(&app, json!({ "type": "video-preview-ended", "kind": kind }));
    }

    impl NativeVoiceService {
        pub fn supported(&self) -> Value {
            json!({ "ok": true, "backend": "livekit-native", "platform": "linux" })
        }

        pub fn list_devices(&self) -> Value {
            let audio = match PlatformAudio::new() {
                Ok(audio) => audio,
                Err(err) => return json!({ "ok": false, "reason": "audio-init-failed", "message": err.to_string() }),
            };
            let inputs = audio.recording_devices().map(|device| json!({
                "deviceId": device_key("input", device.id.as_str(), device.index), "label": device.name, "index": device.index, "kind": "audioinput",
            })).collect::<Vec<_>>();
            let outputs = audio.playout_devices().map(|device| json!({
                "deviceId": device_key("output", device.id.as_str(), device.index), "label": device.name, "index": device.index, "kind": "audiooutput",
            })).collect::<Vec<_>>();
            let preferences = self.devices.lock().unwrap();
            json!({
                "ok": true, "inputs": inputs, "outputs": outputs,
                "inputDeviceId": preferences.input_id, "outputDeviceId": preferences.output_id,
            })
        }

        pub fn set_input_device(&self, device_id: Option<String>) -> Value {
            if let Some(id) = device_id.as_deref() {
                let session = self.session.lock().unwrap();
                if let Some(session) = session.as_ref() {
                    let Some(device) = recording_device(&session.audio, id) else {
                        return json!({ "ok": false, "reason": "device-not-found" });
                    };
                    if let Err(err) = session.audio.switch_recording_device(&device) {
                        return json!({ "ok": false, "reason": "device-switch-failed", "message": err.to_string() });
                    }
                } else {
                    let found = PlatformAudio::new().ok().and_then(|audio| recording_device(&audio, id)).is_some();
                    if !found { return json!({ "ok": false, "reason": "device-not-found" }); }
                }
            }
            self.devices.lock().unwrap().input_id = device_id.clone();
            json!({ "ok": true, "deviceId": device_id })
        }

        pub fn set_output_device(&self, device_id: Option<String>) -> Value {
            if let Some(id) = device_id.as_deref() {
                let session = self.session.lock().unwrap();
                if let Some(session) = session.as_ref() {
                    let Some(device) = playout_device(&session.audio, id) else {
                        return json!({ "ok": false, "reason": "device-not-found" });
                    };
                    if let Err(err) = session.audio.switch_playout_device(&device) {
                        return json!({ "ok": false, "reason": "device-switch-failed", "message": err.to_string() });
                    }
                } else {
                    let found = PlatformAudio::new().ok().and_then(|audio| playout_device(&audio, id)).is_some();
                    if !found { return json!({ "ok": false, "reason": "device-not-found" }); }
                }
            }
            self.devices.lock().unwrap().output_id = device_id.clone();
            json!({ "ok": true, "deviceId": device_id })
        }

        pub async fn microphone_test(&self, duration_ms: u64, rnnoise: bool, gate: bool, gate_threshold_db: f32) -> Value {
            if self.session.lock().unwrap().is_some() {
                return json!({ "ok": false, "reason": "voice-session-active", "message": "Leave voice before recording a microphone test." });
            }
            let sample_count = 48_000 * duration_ms.clamp(1_000, 30_000) / 1_000;
            let capture = tauri::async_runtime::spawn_blocking(move || {
                Command::new("pw-record")
                    .args([
                        "--raw", "--rate", "48000", "--channels", "1", "--format", "s16",
                        "--sample-count", &sample_count.to_string(), "-",
                    ])
                    .output()
            }).await;
            let output = match capture {
                // pw-record returns status 1 after reaching --sample-count on
                // some Ubuntu/PipeWire builds even though stdout contains the
                // complete capture. The PCM payload is the reliable result.
                Ok(Ok(output)) if !output.stdout.is_empty() => output,
                Ok(Ok(output)) => return json!({
                    "ok": false, "reason": "recording-failed",
                    "message": String::from_utf8_lossy(&output.stderr).trim(),
                }),
                Ok(Err(err)) => return json!({ "ok": false, "reason": "pw-record-unavailable", "message": err.to_string() }),
                Err(err) => return json!({ "ok": false, "reason": "recording-task-failed", "message": err.to_string() }),
            };
            let mut pcm = output.stdout;
            process_test_audio_in_place(
                &mut pcm,
                rnnoise,
                gate,
                gate_threshold_db.clamp(-80.0, 0.0),
            );
            let encoded = base64::engine::general_purpose::STANDARD
                .encode(wav_pcm_bytes(pcm, 48_000, 1));
            json!({ "ok": true, "mimeType": "audio/wav", "audioBase64": encoded })
        }

        pub async fn microphone_level(&self) -> Value {
            let mut meter = self.meter.lock().unwrap();
            let stopped = meter.as_ref().is_some_and(|meter| {
                meter.child.lock().unwrap().try_wait().ok().flatten().is_some()
            });
            if stopped {
                *meter = None;
            }
            if meter.is_none() {
                *meter = match start_microphone_meter() {
                    Ok(meter) => Some(meter),
                    Err(message) => return json!({ "ok": false, "reason": "pw-record-unavailable", "message": message }),
                };
            }
            let meter = meter.as_ref().unwrap();
            meter.last_requested_ms.store(crate::now_ms() as u64, Ordering::Relaxed);
            let db = f32::from_bits(meter.latest_db_bits.load(Ordering::Relaxed));
            json!({ "ok": true, "db": db })
        }

        pub async fn start_video(&self, app: AppHandle, kind: String, source_id: String, width: u32, height: u32, fps: u32) -> Value {
            let kind = if kind == "screen" { "screen" } else { "camera" };
            self.stop_video(kind.to_string()).await;
            let room = {
                let session = self.session.lock().unwrap();
                let Some(session) = session.as_ref() else {
                    return json!({ "ok": false, "reason": "no-session", "message": "Join voice before starting video." });
                };
                session.room.clone()
            };
            let width = width.clamp(320, 3840) & !1;
            let height = height.clamp(180, 2160) & !1;
            let fps = fps.clamp(5, 60);
            let resolution = VideoResolution { width, height };
            let use_preencoded = kind == "screen" && gstreamer_nvenc_available();
            let source = if use_preencoded {
                NativeVideoSource::new_encoded(resolution.clone())
            } else {
                NativeVideoSource::new(resolution, kind == "screen")
            };
            let rtc_source = RtcVideoSource::Native(source.clone());
            let track_name = if kind == "screen" { "screen_share" } else { "camera" };
            let track = LocalVideoTrack::create_video_track(track_name, rtc_source);
            let video_encoder = if use_preencoded { VideoEncoderBackend::PreEncoded } else { preferred_video_encoder() };
            let video_encoder_name = format!("{video_encoder:?}").to_lowercase();
            let bounds = (kind == "screen").then(|| monitor_bounds(&app, &source_id)).flatten();
            let publication = match room.local_participant().publish_track(
                LocalTrack::Video(track),
                TrackPublishOptions {
                    source: if kind == "screen" { TrackSource::Screenshare } else { TrackSource::Camera },
                    simulcast: kind == "screen" && !use_preencoded,
                    video_codec: VideoCodec::H264,
                    video_encoder,
                    ..Default::default()
                },
            ).await {
                Ok(publication) => publication,
                Err(err) => return json!({ "ok": false, "reason": "publish-failed", "message": err.to_string() }),
            };
            let child_result = if use_preencoded {
                gstreamer_nvenc_child(width, height, fps, bounds)
            } else {
                gstreamer_video_child(kind, &source_id, width, height, fps, bounds)
            };
            let child = match child_result {
                Ok(child) => Arc::new(Mutex::new(child)),
                Err(err) => {
                    let _ = room.local_participant().unpublish_track(&publication.sid()).await;
                    return json!({ "ok": false, "reason": "gstreamer-start-failed", "message": err.to_string() });
                }
            };
            let task_child = child.clone();
            let task_kind = kind.to_string();
            let (started_tx, started_rx) = std::sync::mpsc::channel();
            let task = if use_preencoded {
                tauri::async_runtime::spawn_blocking(move || {
                    feed_h264_frames(task_child, source, width, height, started_tx)
                })
            } else {
                let task_app = app.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    feed_i420_frames(task_child, source, task_app, task_kind, fps, width, height, started_tx)
                })
            };
            let startup = tauri::async_runtime::spawn_blocking(move || {
                started_rx.recv_timeout(std::time::Duration::from_secs(5))
            }).await;
            let startup_error = match startup {
                Ok(Ok(Ok(()))) => None,
                Ok(Ok(Err(message))) => Some(message),
                Ok(Err(_)) => Some("GStreamer timed out waiting for its first video frame".into()),
                Err(err) => Some(format!("Video startup task failed: {err}")),
            };
            if let Some(message) = startup_error {
                stop_child(&child);
                task.abort();
                let _ = room.local_participant().unpublish_track(&publication.sid()).await;
                return json!({ "ok": false, "reason": "no-video-frames", "message": message });
            }
            let mut children = vec![child];
            let mut tasks = vec![task];
            if use_preencoded {
                let preview_width = 640;
                let preview_height = ((height as u64 * preview_width as u64 / width as u64) as u32).max(2) & !1;
                if let Ok(preview_child) = gstreamer_screen_preview_child(preview_width, preview_height, 10, bounds) {
                    let preview_child = Arc::new(Mutex::new(preview_child));
                    let task_child = preview_child.clone();
                    let task_app = app.clone();
                    let task_kind = kind.to_string();
                    let preview_task = tauri::async_runtime::spawn_blocking(move || {
                        feed_jpeg_preview_frames(task_child, task_app, task_kind)
                    });
                    children.push(preview_child);
                    tasks.push(preview_task);
                }
            }
            let sid = publication.sid();
            self.videos.lock().unwrap().insert(kind.to_string(), VideoPublisher { children, tasks, sid: sid.clone() });
            json!({
                "ok": true, "kind": kind, "trackSid": sid.to_string(),
                "width": width, "height": height, "fps": fps,
                "codec": "h264", "encoder": video_encoder_name,
            })
        }

        pub async fn stop_video(&self, kind: String) -> Value {
            let publisher = self.videos.lock().unwrap().remove(&kind);
            if let Some(publisher) = publisher {
                for child in &publisher.children { stop_child(child); }
                for task in publisher.tasks { task.abort(); }
                let room = self.session.lock().unwrap().as_ref().map(|session| session.room.clone());
                if let Some(room) = room {
                    let _ = room.local_participant().unpublish_track(&publisher.sid).await;
                }
            }
            json!({ "ok": true, "kind": kind })
        }

        async fn stop_all_video(&self) {
            self.stop_video("camera".into()).await;
            self.stop_video("screen".into()).await;
        }

        pub async fn connect(&self, app: AppHandle, url: String, token: String, muted: bool) -> Value {
            // Serialize sessions: tear down any previous room first.
            self.leave().await;

            let (room, mut events) = match Room::connect(&url, &token, RoomOptions::default()).await {
                Ok(pair) => pair,
                Err(err) => {
                    return json!({
                        "ok": false,
                        "reason": "connect-failed",
                        "message": format!("LiveKit connect failed: {err}"),
                    });
                }
            };
            let room = Arc::new(room);

            let shared = Arc::new(Shared {
                deafened: AtomicBool::new(false),
                remote_audio: Mutex::new(Vec::new()),
                remote_video: Mutex::new(HashMap::new()),
            });

            // Microphone publish is best-effort: a headless or device-less box
            // should still be able to join and listen.
            let mut mic_error: Option<String> = None;
            let (audio, mic_publication) = match PlatformAudio::new() {
                Ok(audio) => {
                    let (input_id, output_id) = {
                        let preferences = self.devices.lock().unwrap();
                        (preferences.input_id.clone(), preferences.output_id.clone())
                    };
                    if let Some(id) = input_id.as_deref() {
                        if let Some(device) = recording_device(&audio, id) {
                            if let Err(err) = audio.set_recording_device(&device) {
                                mic_error = Some(format!("selected microphone unavailable: {err}"));
                            }
                        } else {
                            mic_error = Some("selected microphone unavailable".into());
                        }
                    }
                    if let Some(id) = output_id.as_deref() {
                        if let Some(device) = playout_device(&audio, id) {
                            let _ = audio.set_playout_device(&device);
                        }
                    }
                    let _ = audio.set_echo_cancellation(true, false);
                    let _ = audio.set_noise_suppression(true, false);
                    let _ = audio.set_auto_gain_control(true, false);
                    let track = LocalAudioTrack::create_audio_track("microphone", audio.rtc_source());
                    let publication = match room
                        .local_participant()
                        .publish_track(
                            LocalTrack::Audio(track),
                            TrackPublishOptions { source: TrackSource::Microphone, ..Default::default() },
                        )
                        .await
                    {
                        Ok(publication) => {
                            if let Err(err) = audio.start_recording() {
                                mic_error = Some(format!("microphone start failed: {err}"));
                            }
                            if muted {
                                publication.mute();
                            }
                            Some(publication)
                        }
                        Err(err) => {
                            mic_error = Some(format!("microphone publish failed: {err}"));
                            None
                        }
                    };
                    (Some(audio), publication)
                }
                Err(err) => {
                    mic_error = Some(format!("platform audio init failed: {err}"));
                    (None, None)
                }
            };
            let Some(audio) = audio else {
                let _ = room.close().await;
                return json!({
                    "ok": false,
                    "reason": "audio-init-failed",
                    "message": mic_error.unwrap_or_else(|| "platform audio unavailable".into()),
                });
            };

            let participants: Vec<Value> = room
                .remote_participants()
                .values()
                .map(|participant| participant_json(&participant.identity(), &participant.name()))
                .collect();
            let local_identity = room.local_participant().identity().to_string();
            let room_name = room.name();

            let task_app = app.clone();
            let task_shared = shared.clone();
            let task_videos = self.videos.clone();
            let event_task = tauri::async_runtime::spawn(async move {
                while let Some(event) = events.recv().await {
                    match event {
                        RoomEvent::ParticipantConnected(participant) => emit_event(
                            &task_app,
                            json!({
                                "type": "participant-connected",
                                "identity": participant.identity().to_string(),
                                "name": participant.name(),
                            }),
                        ),
                        RoomEvent::ParticipantDisconnected(participant) => emit_event(
                            &task_app,
                            json!({
                                "type": "participant-disconnected",
                                "identity": participant.identity().to_string(),
                            }),
                        ),
                        RoomEvent::ActiveSpeakersChanged { speakers } => emit_event(
                            &task_app,
                            json!({
                                "type": "active-speakers",
                                "identities": speakers
                                    .iter()
                                    .map(|speaker| speaker.identity().to_string())
                                    .collect::<Vec<_>>(),
                            }),
                        ),
                        RoomEvent::TrackSubscribed { track, participant, .. } => {
                            match track {
                                RemoteTrack::Audio(audio_track) => {
                                    let rtc = audio_track.rtc_track();
                                    task_shared.remote_audio.lock().unwrap().push(rtc);
                                    apply_deafen(&task_shared);
                                }
                                RemoteTrack::Video(video_track) => start_remote_video(
                                    task_app.clone(),
                                    task_shared.clone(),
                                    video_track,
                                    participant.identity().to_string(),
                                ),
                            }
                        }
                        RoomEvent::TrackUnsubscribed { track, .. } => {
                            match track {
                                RemoteTrack::Audio(audio_track) => {
                                    let sid = audio_track.rtc_track().id();
                                    task_shared
                                        .remote_audio
                                        .lock()
                                        .unwrap()
                                        .retain(|candidate| candidate.id() != sid);
                                }
                                RemoteTrack::Video(video_track) => {
                                    let sid = video_track.sid().to_string();
                                    if let Some(task) = task_shared.remote_video.lock().unwrap().remove(&sid) {
                                        task.abort();
                                    }
                                    emit_event(&task_app, json!({
                                        "type": "remote-video-ended", "trackSid": sid,
                                    }));
                                }
                            }
                        }
                        RoomEvent::ConnectionStateChanged(state) => {
                            if state == ConnectionState::Disconnected {
                                stop_video_processes(&task_videos);
                            }
                            emit_event(&task_app, json!({
                                "type": "connection",
                                "state": match state {
                                    ConnectionState::Connected => "connected",
                                    ConnectionState::Reconnecting => "reconnecting",
                                    ConnectionState::Disconnected => "disconnected",
                                },
                            }));
                        }
                        RoomEvent::Reconnecting => emit_event(
                            &task_app,
                            json!({ "type": "connection", "state": "reconnecting" }),
                        ),
                        RoomEvent::Reconnected => emit_event(
                            &task_app,
                            json!({ "type": "connection", "state": "connected" }),
                        ),
                        RoomEvent::Disconnected { reason } => {
                            stop_video_processes(&task_videos);
                            emit_event(&task_app, json!({ "type": "video-preview-ended", "kind": "camera" }));
                            emit_event(&task_app, json!({ "type": "video-preview-ended", "kind": "screen" }));
                            emit_event(
                                &task_app,
                                json!({ "type": "disconnected", "reason": format!("{reason:?}") }),
                            );
                        }
                        _ => {}
                    }
                }
            });

            *self.session.lock().unwrap() = Some(Session {
                room,
                audio,
                mic_publication,
                event_task,
                shared,
            });

            json!({
                "ok": true,
                "roomName": room_name,
                "identity": local_identity,
                "participants": participants,
                "micPublished": mic_error.is_none(),
                "micError": mic_error,
            })
        }

        pub async fn leave(&self) -> Value {
            self.stop_all_video().await;
            let session = self.session.lock().unwrap().take();
            if let Some(session) = session {
                for (_, task) in session.shared.remote_video.lock().unwrap().drain() {
                    task.abort();
                }
                let _ = session.room.close().await;
                session.event_task.abort();
                let _ = session.audio.stop_recording();
                session.audio.release();
            }
            json!({ "ok": true })
        }

        pub fn set_muted(&self, muted: bool) -> Value {
            let session = self.session.lock().unwrap();
            let Some(session) = session.as_ref() else {
                return json!({ "ok": false, "reason": "no-session" });
            };
            let Some(publication) = session.mic_publication.as_ref() else {
                return json!({ "ok": false, "reason": "no-microphone" });
            };
            if muted {
                publication.mute();
            } else {
                publication.unmute();
            }
            json!({ "ok": true, "muted": muted })
        }

        pub fn set_deafened(&self, deafened: bool) -> Value {
            let session = self.session.lock().unwrap();
            let Some(session) = session.as_ref() else {
                return json!({ "ok": false, "reason": "no-session" });
            };
            session.shared.deafened.store(deafened, Ordering::SeqCst);
            apply_deafen(&session.shared);
            json!({ "ok": true, "deafened": deafened })
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn annex_b_parser_does_not_duplicate_four_byte_prefixes() {
            let data = [0, 0, 0, 1, 9, 0, 0, 0, 1, 5];
            assert_eq!(find_annex_b_nal(&data, 9, 0), Some((0, 4)));
            assert_eq!(find_annex_b_nal(&data, 5, 5), Some((5, 4)));
        }

        #[test]
        fn annex_b_parser_supports_three_byte_prefixes() {
            let data = [0, 0, 1, 9, 0xf0, 0, 0, 1, 1, 0xaa];
            assert_eq!(find_annex_b_nal(&data, 9, 0), Some((0, 3)));
            assert_eq!(find_annex_b_nal(&data, 1, 4), Some((5, 3)));
            assert!(!contains_annex_b_nal(&data, 5));
        }

        #[test]
        fn i420_preview_accepts_padded_plane_strides() {
            let y = [128, 128, 0, 0, 128, 128, 0, 0];
            let u = [128, 0];
            let v = [128, 0];
            let mut scratch = PreviewScratch::default();
            let jpeg = i420_planes_preview_jpeg(&y, 4, &u, 2, &v, 2, 2, 2, &mut scratch);
            assert!(jpeg.is_some_and(|value| value.starts_with("data:image/jpeg;base64,")));
        }

        #[test]
        fn i420_preview_rejects_short_planes() {
            let mut scratch = PreviewScratch::default();
            assert!(i420_planes_preview_jpeg(
                &[0; 3], 2, &[128], 1, &[128], 1, 2, 2, &mut scratch,
            ).is_none());
        }

        #[test]
        fn i420_preview_reuses_allocated_buffers() {
            let mut scratch = PreviewScratch::default();
            let y = [128; 4];
            let first = i420_planes_preview_jpeg(
                &y, 2, &[128], 1, &[128], 1, 2, 2, &mut scratch,
            );
            let capacities = (scratch.rgb.capacity(), scratch.jpeg.capacity());
            let second = i420_planes_preview_jpeg(
                &y, 2, &[128], 1, &[128], 1, 2, 2, &mut scratch,
            );
            assert!(first.is_some() && second.is_some());
            assert_eq!(capacities, (scratch.rgb.capacity(), scratch.jpeg.capacity()));
        }

        #[test]
        fn microphone_level_reports_silence_and_full_scale() {
            assert_eq!(pcm_level_db(&[0; 16]), -60.0);
            let full_scale = i16::MAX.to_le_bytes().repeat(8);
            assert!(pcm_level_db(&full_scale) > -0.01);
        }

        #[test]
        fn microphone_test_processing_reuses_the_pcm_allocation() {
            let samples = [i16::MIN, -1, 0, 1, i16::MAX];
            let mut pcm = samples
                .iter()
                .flat_map(|sample| sample.to_le_bytes())
                .collect::<Vec<_>>();
            process_test_audio_in_place(&mut pcm, false, false, -40.0);
            let processed = pcm
                .chunks_exact(2)
                .map(|sample| i16::from_le_bytes([sample[0], sample[1]]))
                .collect::<Vec<_>>();
            assert_eq!(processed, samples);

            let wav = wav_pcm_bytes(pcm, 48_000, 1);
            assert_eq!(&wav[0..4], b"RIFF");
            assert_eq!(&wav[8..12], b"WAVE");
            assert_eq!(u32::from_le_bytes(wav[40..44].try_into().unwrap()), 10);
            assert_eq!(wav.len(), 54);
        }
    }
}

#[cfg(not(all(target_os = "linux", feature = "native-voice")))]
mod imp {
    use super::*;

    /// Non-Linux (and feature-disabled) stub: the webview provides WebRTC
    /// there, so the renderer never routes voice through this backend.
    #[derive(Default)]
    pub struct NativeVoiceService;

    impl NativeVoiceService {
        pub fn supported(&self) -> Value {
            json!({ "ok": false, "reason": "unsupported-platform" })
        }

        pub fn list_devices(&self) -> Value {
            json!({ "ok": false, "reason": "unsupported-platform", "inputs": [], "outputs": [] })
        }

        pub fn set_input_device(&self, _device_id: Option<String>) -> Value {
            json!({ "ok": false, "reason": "unsupported-platform" })
        }

        pub fn set_output_device(&self, _device_id: Option<String>) -> Value {
            json!({ "ok": false, "reason": "unsupported-platform" })
        }

        pub async fn microphone_test(&self, _duration_ms: u64, _rnnoise: bool, _gate: bool, _gate_threshold_db: f32) -> Value {
            json!({ "ok": false, "reason": "unsupported-platform" })
        }


        pub async fn microphone_level(&self) -> Value {
            json!({ "ok": false, "reason": "unsupported-platform" })
        }


        pub async fn start_video(&self, _app: AppHandle, _kind: String, _source_id: String, _width: u32, _height: u32, _fps: u32) -> Value {
            json!({ "ok": false, "reason": "unsupported-platform" })
        }

        pub async fn stop_video(&self, _kind: String) -> Value {
            json!({ "ok": false, "reason": "unsupported-platform" })
        }

        pub async fn connect(&self, _app: AppHandle, _url: String, _token: String, _muted: bool) -> Value {
            json!({ "ok": false, "reason": "unsupported-platform" })
        }

        pub async fn leave(&self) -> Value {
            json!({ "ok": true })
        }

        pub fn set_muted(&self, _muted: bool) -> Value {
            json!({ "ok": false, "reason": "unsupported-platform" })
        }

        pub fn set_deafened(&self, _deafened: bool) -> Value {
            json!({ "ok": false, "reason": "unsupported-platform" })
        }
    }
}

pub use imp::NativeVoiceService;
