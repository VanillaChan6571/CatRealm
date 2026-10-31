'use strict';

// Cat Lab — reactive avatar images for the OBS voice overlay.
//
// Images (and CatRealm-compressed WebM animations) are stored content-addressed under <userData>/reactive-avatars as
// <sha256>.<ext> and served to OBS by the local overlay server. Every image is
// checked by its magic bytes (never a claimed MIME type or extension) and by the
// dimensions in its header, so a renamed or oversized file is rejected before it
// is written. SVG is never accepted: it can carry script into the OBS browser
// source. The same checks will gate packs received from other users, with a much
// smaller byte cap; your own art only ever travels from disk to OBS on this PC,
// so the local cap fits long lossless animations (e.g. 8 s of 60 fps 512 px WebP).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MAX_IMAGE_BYTES = 128 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 2048;
// Art received from other people in a call: CatRealm-compressed sizes only.
const RECEIVED_MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const RECEIVED_MAX_IMAGE_DIMENSION = 1024;
const REFS_FILE = 'refs.json';
const IMAGE_ID_PATTERN = /^[0-9a-f]{64}\.(png|gif|webp|webm)$/;
const MIME_BY_EXT = { png: 'image/png', gif: 'image/gif', webp: 'image/webp', webm: 'video/webm' };

// WebM (CatRealm's compressed animations, VP9 with optional alpha) is Matroska/EBML.
const EBML_HEADER = 0x1a45dfa3;
const EBML_DOCTYPE = 0x4282;
const MKV_SEGMENT = 0x18538067;
const MKV_TRACKS = 0x1654ae6b;
const MKV_TRACK_ENTRY = 0xae;
const MKV_VIDEO = 0xe0;
const MKV_PIXEL_WIDTH = 0xb0;
const MKV_PIXEL_HEIGHT = 0xba;

/** Reads an EBML element header at offset: { id, dataStart, dataEnd } or null. */
function readEbmlElement(buf, offset, limit) {
  if (offset >= limit) return null;
  const idLength = Math.clz32(buf[offset]) - 23;
  if (idLength < 1 || idLength > 4 || offset + idLength > limit) return null;
  let id = 0;
  for (let i = 0; i < idLength; i++) id = id * 256 + buf[offset + i];
  const sizeStart = offset + idLength;
  if (sizeStart >= limit) return null;
  const sizeLength = Math.clz32(buf[sizeStart]) - 23;
  if (sizeLength < 1 || sizeLength > 8 || sizeStart + sizeLength > limit) return null;
  let size = buf[sizeStart] & (0xff >> sizeLength);
  let unknown = size === (0xff >> sizeLength);
  for (let i = 1; i < sizeLength; i++) {
    size = size * 256 + buf[sizeStart + i];
    if (buf[sizeStart + i] !== 0xff) unknown = false;
  }
  const dataStart = sizeStart + sizeLength;
  // "Unknown size" (streamed) elements run to the end of their parent.
  const dataEnd = unknown ? limit : Math.min(limit, dataStart + size);
  return { id, dataStart, dataEnd };
}

function findEbmlChild(buf, start, end, wantedId) {
  for (let offset = start; offset < end;) {
    const el = readEbmlElement(buf, offset, end);
    if (!el) return null;
    if (el.id === wantedId) return el;
    offset = el.dataEnd;
  }
  return null;
}

function readEbmlUint(buf, el) {
  let value = 0;
  for (let i = el.dataStart; i < el.dataEnd; i++) value = value * 256 + buf[i];
  return value;
}

function sniffWebm(buf) {
  const header = readEbmlElement(buf, 0, buf.length);
  if (!header || header.id !== EBML_HEADER) return null;
  const docType = findEbmlChild(buf, header.dataStart, header.dataEnd, EBML_DOCTYPE);
  if (!docType || buf.toString('ascii', docType.dataStart, docType.dataEnd) !== 'webm') return null;
  const segment = findEbmlChild(buf, header.dataEnd, buf.length, MKV_SEGMENT);
  const tracks = segment && findEbmlChild(buf, segment.dataStart, segment.dataEnd, MKV_TRACKS);
  const entry = tracks && findEbmlChild(buf, tracks.dataStart, tracks.dataEnd, MKV_TRACK_ENTRY);
  const video = entry && findEbmlChild(buf, entry.dataStart, entry.dataEnd, MKV_VIDEO);
  const width = video && findEbmlChild(buf, video.dataStart, video.dataEnd, MKV_PIXEL_WIDTH);
  const height = video && findEbmlChild(buf, video.dataStart, video.dataEnd, MKV_PIXEL_HEIGHT);
  if (!width || !height) return null;
  return { ext: 'webm', width: readEbmlUint(buf, width), height: readEbmlUint(buf, height) };
}

function readUInt24LE(buf, offset) {
  return buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16);
}

/** Returns { ext, width, height } from the file header, or null if unsupported. */
function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 30) return null;

  // PNG: signature, then IHDR width/height as big-endian uint32.
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
    return { ext: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }

  // GIF87a / GIF89a: logical screen size as little-endian uint16.
  const gifSig = buf.toString('ascii', 0, 6);
  if (gifSig === 'GIF87a' || gifSig === 'GIF89a') {
    return { ext: 'gif', width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }

  // WebP: RIFF container with a VP8 / VP8L / VP8X first chunk.
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8X') {
      return { ext: 'webp', width: readUInt24LE(buf, 24) + 1, height: readUInt24LE(buf, 27) + 1 };
    }
    if (chunk === 'VP8L') {
      if (buf[20] !== 0x2f) return null;
      const bits = buf.readUInt32LE(21);
      return { ext: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8 ') {
      if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null;
      return { ext: 'webp', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
  }

  return sniffWebm(buf);
}

/** Validates raw bytes; returns { ok: true, ext } or { ok: false, error }. */
function validateImage(buf, maxBytes = MAX_IMAGE_BYTES, maxDimension = MAX_IMAGE_DIMENSION) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) return { ok: false, error: 'empty' };
  if (buf.length > maxBytes) return { ok: false, error: 'too-large' };
  const info = sniffImage(buf);
  if (!info) return { ok: false, error: 'unsupported-type' };
  if (!info.width || !info.height || info.width > maxDimension || info.height > maxDimension) {
    return { ok: false, error: 'bad-dimensions' };
  }
  return { ok: true, ext: info.ext };
}

function isImageId(id) {
  return typeof id === 'string' && IMAGE_ID_PATTERN.test(id);
}

/**
 * Several app instances can share one userData folder (the installed app and a
 * dev build each keep their own localStorage), so references are tracked per
 * owner (the requesting page's origin) and a file is only deleted once no owner
 * references it.
 */
function createReactiveAvatarFiles(rootDir) {
  const ensureDir = () => fs.mkdirSync(rootDir, { recursive: true });
  const refsPath = path.join(rootDir, REFS_FILE);

  const readRefs = () => {
    try {
      const parsed = JSON.parse(fs.readFileSync(refsPath, 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  };
  const writeRefs = (refs) => {
    ensureDir();
    fs.writeFileSync(refsPath, JSON.stringify(refs));
  };

  return {
    /**
     * Validates and stores an image for owner; returns { ok, id } or { ok: false, error }.
     * received: true applies the much smaller caps for art that came from someone else.
     */
    save(bytes, { owner = 'default', received = false } = {}) {
      const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes instanceof Uint8Array ? bytes : []);
      const check = received
        ? validateImage(buf, RECEIVED_MAX_IMAGE_BYTES, RECEIVED_MAX_IMAGE_DIMENSION)
        : validateImage(buf);
      if (!check.ok) return check;
      const id = `${crypto.createHash('sha256').update(buf).digest('hex')}.${check.ext}`;
      ensureDir();
      const file = path.join(rootDir, id);
      if (!fs.existsSync(file)) fs.writeFileSync(file, buf);
      // Reference it straight away so another owner's prune can't race the caller.
      const refs = readRefs();
      const owned = new Set(Array.isArray(refs[owner]) ? refs[owner] : []);
      if (!owned.has(id)) {
        owned.add(id);
        refs[owner] = [...owned];
        writeRefs(refs);
      }
      return { ok: true, id };
    },

    /** Returns { bytes, mime } for a stored image, or null. */
    read(id) {
      if (!isImageId(id)) return null;
      try {
        const bytes = fs.readFileSync(path.join(rootDir, id));
        return { bytes, mime: MIME_BY_EXT[id.split('.').pop()] };
      } catch {
        return null;
      }
    },

    /** Sets owner's references to keepIds and deletes files no owner references; returns the number removed. */
    prune(owner, keepIds) {
      const refs = readRefs();
      refs[owner || 'default'] = (Array.isArray(keepIds) ? keepIds : []).filter(isImageId);
      writeRefs(refs);
      const keep = new Set(Object.values(refs).flat().filter(isImageId));
      let removed = 0;
      let entries = [];
      try {
        entries = fs.readdirSync(rootDir);
      } catch {
        return 0;
      }
      for (const name of entries) {
        if (!isImageId(name) || keep.has(name)) continue;
        try {
          fs.unlinkSync(path.join(rootDir, name));
          removed += 1;
        } catch {
          // A file OBS is still reading can fail to unlink on Windows; retried on next prune.
        }
      }
      return removed;
    },
  };
}

module.exports = {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  RECEIVED_MAX_IMAGE_BYTES,
  createReactiveAvatarFiles,
  isImageId,
  sniffImage,
  validateImage,
};
