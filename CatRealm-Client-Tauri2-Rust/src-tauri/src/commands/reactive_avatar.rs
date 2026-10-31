use crate::AppState;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fmt::Write as _;
use std::fs::OpenOptions;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use tauri::ipc::{InvokeBody, InvokeResponseBody, Request};
use tauri::{AppHandle, Manager, State, WebviewWindow};

const MAX_IMAGE_BYTES: usize = 128 * 1024 * 1024;
const MAX_IMAGE_DIMENSION: u64 = 2048;
const RECEIVED_MAX_IMAGE_BYTES: usize = 12 * 1024 * 1024;
const RECEIVED_MAX_IMAGE_DIMENSION: u64 = 1024;
const MAX_REFS_BYTES: u64 = 1024 * 1024;
const REFS_FILE: &str = "refs.json";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct MediaInfo {
    extension: &'static str,
    width: u64,
    height: u64,
}

#[derive(Clone, Copy)]
struct EbmlElement {
    id: u32,
    data_start: usize,
    data_end: usize,
}

fn read_ebml_element(bytes: &[u8], offset: usize, limit: usize) -> Option<EbmlElement> {
    let first = *bytes.get(offset)?;
    let id_length = first.leading_zeros() as usize + 1;
    if !(1..=4).contains(&id_length) || offset.checked_add(id_length)? > limit {
        return None;
    }
    let mut id = 0u32;
    for byte in bytes.get(offset..offset + id_length)? {
        id = id.checked_mul(256)?.checked_add(u32::from(*byte))?;
    }

    let size_start = offset + id_length;
    let size_first = *bytes.get(size_start)?;
    let size_length = size_first.leading_zeros() as usize + 1;
    if !(1..=8).contains(&size_length) || size_start.checked_add(size_length)? > limit {
        return None;
    }
    let value_mask = 0xffu8 >> size_length;
    let mut size = u64::from(size_first & value_mask);
    let mut unknown = (size_first & value_mask) == value_mask;
    for byte in bytes.get(size_start + 1..size_start + size_length)? {
        size = size.checked_mul(256)?.checked_add(u64::from(*byte))?;
        unknown &= *byte == 0xff;
    }
    let data_start = size_start + size_length;
    let data_end = if unknown {
        limit
    } else {
        data_start
            .checked_add(usize::try_from(size).ok()?)?
            .min(limit)
    };
    (data_end >= data_start).then_some(EbmlElement {
        id,
        data_start,
        data_end,
    })
}

fn find_ebml_child(bytes: &[u8], start: usize, end: usize, wanted: u32) -> Option<EbmlElement> {
    let mut offset = start;
    while offset < end {
        let element = read_ebml_element(bytes, offset, end)?;
        if element.id == wanted {
            return Some(element);
        }
        if element.data_end <= offset {
            return None;
        }
        offset = element.data_end;
    }
    None
}

fn read_ebml_uint(bytes: &[u8], element: EbmlElement) -> Option<u64> {
    let mut value = 0u64;
    for byte in bytes.get(element.data_start..element.data_end)? {
        value = value.checked_mul(256)?.checked_add(u64::from(*byte))?;
    }
    Some(value)
}

fn sniff_webm(bytes: &[u8]) -> Option<MediaInfo> {
    const EBML_HEADER: u32 = 0x1a45dfa3;
    const EBML_DOCTYPE: u32 = 0x4282;
    const MKV_SEGMENT: u32 = 0x18538067;
    const MKV_TRACKS: u32 = 0x1654ae6b;
    const MKV_TRACK_ENTRY: u32 = 0xae;
    const MKV_VIDEO: u32 = 0xe0;
    const MKV_PIXEL_WIDTH: u32 = 0xb0;
    const MKV_PIXEL_HEIGHT: u32 = 0xba;

    let header = read_ebml_element(bytes, 0, bytes.len())?;
    if header.id != EBML_HEADER {
        return None;
    }
    let doc_type = find_ebml_child(bytes, header.data_start, header.data_end, EBML_DOCTYPE)?;
    if bytes.get(doc_type.data_start..doc_type.data_end)? != b"webm" {
        return None;
    }
    let segment = find_ebml_child(bytes, header.data_end, bytes.len(), MKV_SEGMENT)?;
    let tracks = find_ebml_child(bytes, segment.data_start, segment.data_end, MKV_TRACKS)?;
    let entry = find_ebml_child(bytes, tracks.data_start, tracks.data_end, MKV_TRACK_ENTRY)?;
    let video = find_ebml_child(bytes, entry.data_start, entry.data_end, MKV_VIDEO)?;
    let width = find_ebml_child(bytes, video.data_start, video.data_end, MKV_PIXEL_WIDTH)?;
    let height = find_ebml_child(bytes, video.data_start, video.data_end, MKV_PIXEL_HEIGHT)?;
    Some(MediaInfo {
        extension: "webm",
        width: read_ebml_uint(bytes, width)?,
        height: read_ebml_uint(bytes, height)?,
    })
}

fn read_u24_le(bytes: &[u8], offset: usize) -> Option<u32> {
    let bytes = bytes.get(offset..offset + 3)?;
    Some(u32::from(bytes[0]) | (u32::from(bytes[1]) << 8) | (u32::from(bytes[2]) << 16))
}

fn sniff_media(bytes: &[u8]) -> Option<MediaInfo> {
    if bytes.len() < 30 {
        return None;
    }
    if bytes.get(..8)? == [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]
        && bytes.get(12..16)? == b"IHDR"
    {
        return Some(MediaInfo {
            extension: "png",
            width: u64::from(u32::from_be_bytes(bytes.get(16..20)?.try_into().ok()?)),
            height: u64::from(u32::from_be_bytes(bytes.get(20..24)?.try_into().ok()?)),
        });
    }

    if matches!(bytes.get(..6)?, b"GIF87a" | b"GIF89a") {
        return Some(MediaInfo {
            extension: "gif",
            width: u64::from(u16::from_le_bytes(bytes.get(6..8)?.try_into().ok()?)),
            height: u64::from(u16::from_le_bytes(bytes.get(8..10)?.try_into().ok()?)),
        });
    }

    if bytes.get(..4)? == b"RIFF" && bytes.get(8..12)? == b"WEBP" {
        let chunk = bytes.get(12..16)?;
        if chunk == b"VP8X" {
            return Some(MediaInfo {
                extension: "webp",
                width: u64::from(read_u24_le(bytes, 24)? + 1),
                height: u64::from(read_u24_le(bytes, 27)? + 1),
            });
        }
        if chunk == b"VP8L" && bytes.get(20) == Some(&0x2f) {
            let bits = u32::from_le_bytes(bytes.get(21..25)?.try_into().ok()?);
            return Some(MediaInfo {
                extension: "webp",
                width: u64::from((bits & 0x3fff) + 1),
                height: u64::from(((bits >> 14) & 0x3fff) + 1),
            });
        }
        if chunk == b"VP8 " && bytes.get(23..26)? == [0x9d, 0x01, 0x2a] {
            return Some(MediaInfo {
                extension: "webp",
                width: u64::from(u16::from_le_bytes(bytes.get(26..28)?.try_into().ok()?) & 0x3fff),
                height: u64::from(u16::from_le_bytes(bytes.get(28..30)?.try_into().ok()?) & 0x3fff),
            });
        }
    }
    sniff_webm(bytes)
}

fn validate_media(bytes: &[u8], received: bool) -> Result<&'static str, &'static str> {
    let (max_bytes, max_dimension) = if received {
        (RECEIVED_MAX_IMAGE_BYTES, RECEIVED_MAX_IMAGE_DIMENSION)
    } else {
        (MAX_IMAGE_BYTES, MAX_IMAGE_DIMENSION)
    };
    if bytes.is_empty() {
        return Err("empty");
    }
    if bytes.len() > max_bytes {
        return Err("too-large");
    }
    let info = sniff_media(bytes).ok_or("unsupported-type")?;
    if info.width == 0
        || info.height == 0
        || info.width > max_dimension
        || info.height > max_dimension
    {
        return Err("bad-dimensions");
    }
    Ok(info.extension)
}

fn is_image_id(id: &str) -> bool {
    let Some((hash, extension)) = id.split_once('.') else {
        return false;
    };
    hash.len() == 64
        && hash
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        && matches!(extension, "png" | "gif" | "webp" | "webm")
}

fn read_refs(root: &Path) -> HashMap<String, Vec<String>> {
    let path = root.join(REFS_FILE);
    if std::fs::metadata(&path)
        .ok()
        .is_none_or(|metadata| metadata.len() > MAX_REFS_BYTES)
    {
        return HashMap::new();
    }
    std::fs::read_to_string(path)
        .ok()
        .and_then(|contents| serde_json::from_str(&contents).ok())
        .unwrap_or_default()
}

fn write_refs(root: &Path, refs: &HashMap<String, Vec<String>>) -> Result<(), String> {
    std::fs::create_dir_all(root).map_err(|error| error.to_string())?;
    let encoded = serde_json::to_vec(refs).map_err(|error| error.to_string())?;
    std::fs::write(root.join(REFS_FILE), encoded).map_err(|error| error.to_string())
}

fn content_id(bytes: &[u8], extension: &str) -> String {
    let digest = Sha256::digest(bytes);
    let mut id = String::with_capacity(64 + 1 + extension.len());
    for byte in digest {
        let _ = write!(id, "{byte:02x}");
    }
    id.push('.');
    id.push_str(extension);
    id
}

fn save(root: &Path, owner: &str, bytes: &[u8], received: bool) -> Value {
    let extension = match validate_media(bytes, received) {
        Ok(extension) => extension,
        Err(error) => return json!({ "ok": false, "error": error }),
    };
    let id = content_id(bytes, extension);
    if let Err(error) = std::fs::create_dir_all(root) {
        return json!({ "ok": false, "error": error.to_string() });
    }
    let path = root.join(&id);
    match OpenOptions::new().write(true).create_new(true).open(&path) {
        Ok(mut file) => {
            if let Err(error) = file.write_all(bytes) {
                let _ = std::fs::remove_file(&path);
                return json!({ "ok": false, "error": error.to_string() });
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => return json!({ "ok": false, "error": error.to_string() }),
    }

    let mut refs = read_refs(root);
    let owned = refs.entry(owner.to_string()).or_default();
    if !owned.iter().any(|existing| existing == &id) {
        owned.push(id.clone());
        if let Err(error) = write_refs(root, &refs) {
            return json!({ "ok": false, "error": error });
        }
    }
    json!({ "ok": true, "id": id })
}

fn read(root: &Path, id: &str) -> Result<Vec<u8>, String> {
    if !is_image_id(id) {
        return Err("invalid-id".into());
    }
    let path = root.join(id);
    let metadata = std::fs::metadata(&path).map_err(|_| "not-found".to_string())?;
    if metadata.len() > MAX_IMAGE_BYTES as u64 {
        return Err("too-large".into());
    }
    std::fs::read(path).map_err(|_| "not-found".into())
}

pub(crate) fn read_from_root(root: &Path, id: &str) -> Result<Vec<u8>, String> {
    read(root, id)
}

pub(crate) fn mime_for_id(id: &str) -> Option<&'static str> {
    if !is_image_id(id) {
        return None;
    }
    match id.rsplit_once('.')?.1 {
        "png" => Some("image/png"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "webm" => Some("video/webm"),
        _ => None,
    }
}

fn prune(root: &Path, owner: &str, keep_ids: Vec<String>) -> Value {
    let mut refs = read_refs(root);
    refs.insert(
        owner.to_string(),
        keep_ids.into_iter().filter(|id| is_image_id(id)).collect(),
    );
    if let Err(error) = write_refs(root, &refs) {
        return json!({ "ok": false, "error": error });
    }
    let keep = refs
        .values()
        .flatten()
        .filter(|id| is_image_id(id))
        .cloned()
        .collect::<HashSet<_>>();
    let mut removed = 0usize;
    let Ok(entries) = std::fs::read_dir(root) else {
        return json!({ "ok": true, "removed": removed });
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if is_image_id(&name) && !keep.contains(&name) && std::fs::remove_file(entry.path()).is_ok()
        {
            removed += 1;
        }
    }
    json!({ "ok": true, "removed": removed })
}

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join("reactive-avatars"))
        .map_err(|error| error.to_string())
}

fn owner(window: &WebviewWindow) -> String {
    window
        .url()
        .ok()
        .map(|url| url.origin().ascii_serialization())
        .filter(|origin| !origin.is_empty() && origin != "null")
        .unwrap_or_else(|| "default".into())
}

#[tauri::command]
pub fn reactive_avatar_save_image(
    app: AppHandle,
    window: WebviewWindow,
    state: State<AppState>,
    request: Request<'_>,
) -> Value {
    let received = request
        .headers()
        .get("x-catrealm-received")
        .and_then(|value| value.to_str().ok())
        == Some("1");
    let InvokeBody::Raw(bytes) = request.body() else {
        return json!({ "ok": false, "error": "binary-body-required" });
    };
    let Ok(root) = root(&app) else {
        return json!({ "ok": false, "error": "storage-unavailable" });
    };
    let _guard = state.reactive_avatar_gate.lock().unwrap();
    save(&root, &owner(&window), bytes, received)
}

#[tauri::command]
pub fn reactive_avatar_read_image(
    app: AppHandle,
    state: State<AppState>,
    id: String,
) -> Result<InvokeResponseBody, String> {
    let root = root(&app)?;
    let _guard = state.reactive_avatar_gate.lock().unwrap();
    read(&root, &id).map(InvokeResponseBody::Raw)
}

#[tauri::command]
pub fn reactive_avatar_prune(
    app: AppHandle,
    window: WebviewWindow,
    state: State<AppState>,
    keep_ids: Vec<String>,
) -> Value {
    let Ok(root) = root(&app) else {
        return json!({ "ok": false, "error": "storage-unavailable" });
    };
    let _guard = state.reactive_avatar_gate.lock().unwrap();
    prune(&root, &owner(&window), keep_ids)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = vec![0u8; 30];
        bytes[..8].copy_from_slice(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]);
        bytes[12..16].copy_from_slice(b"IHDR");
        bytes[16..20].copy_from_slice(&width.to_be_bytes());
        bytes[20..24].copy_from_slice(&height.to_be_bytes());
        bytes
    }

    #[test]
    fn validates_magic_bytes_and_dimension_caps() {
        assert_eq!(validate_media(&png(512, 512), false), Ok("png"));
        assert_eq!(validate_media(&png(2048, 2048), false), Ok("png"));
        assert_eq!(validate_media(&png(2049, 1), false), Err("bad-dimensions"));
        assert_eq!(validate_media(&png(1025, 1), true), Err("bad-dimensions"));
        assert_eq!(
            validate_media(b"not an image", false),
            Err("unsupported-type")
        );
    }

    #[test]
    fn content_ids_are_stable_and_path_safe() {
        let id = content_id(&png(1, 1), "png");
        assert!(is_image_id(&id));
        assert_eq!(id, content_id(&png(1, 1), "png"));
        assert!(!is_image_id("../avatar.png"));
        assert!(!is_image_id(&format!("{}.svg", "a".repeat(64))));
    }

    #[test]
    fn storage_tracks_owners_before_pruning_content() {
        let root = std::env::temp_dir().join(format!(
            "catrealm-reactive-avatar-test-{}-{}",
            std::process::id(),
            crate::now_ms()
        ));
        let bytes = png(32, 32);
        let first = save(&root, "owner-a", &bytes, false);
        let id = first["id"].as_str().unwrap().to_string();
        assert_eq!(read(&root, &id).unwrap(), bytes);
        assert_eq!(save(&root, "owner-b", &bytes, false)["id"], id);
        assert_eq!(prune(&root, "owner-a", Vec::new())["removed"], 0);
        assert!(root.join(&id).is_file());
        assert_eq!(prune(&root, "owner-b", Vec::new())["removed"], 1);
        assert!(!root.join(&id).exists());
        let _ = std::fs::remove_dir_all(root);
    }
}
