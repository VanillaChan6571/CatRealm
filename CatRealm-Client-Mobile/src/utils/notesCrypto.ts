/**
 * Encryption utilities for Personal Notes — mobile port.
 * Uses @stablelib (pure-JS, no WebCrypto required) to match the web client's
 * AES-256-GCM output format exactly: { content: base64, iv: base64 }.
 */

import { AES } from '@stablelib/aes';
import { GCM } from '@stablelib/gcm';
import { hash as sha256 } from '@stablelib/sha256';
import { deriveKey as pbkdf2DeriveKey } from '@stablelib/pbkdf2';
import { SHA256 } from '@stablelib/sha256';
import { getRandomBytes } from 'expo-crypto';

// ── Base64 helpers ─────────────────────────────────────────────────────────────

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bytesToBase64(bytes: Uint8Array): string {
  let result = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;
    result += B64[b0 >> 2];
    result += B64[((b0 & 3) << 4) | (b1 >> 4)];
    result += i + 1 < len ? B64[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    result += i + 2 < len ? B64[b2 & 63] : '=';
  }
  return result;
}

const B64_LOOKUP: Record<string, number> = Object.fromEntries(
  B64.split('').map((c, i) => [c, i]),
);

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, '');
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((clean.length / 4) * 3 - padding);
  let idx = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = B64_LOOKUP[clean[i]] ?? 0;
    const c1 = B64_LOOKUP[clean[i + 1]] ?? 0;
    const c2 = clean[i + 2] === '=' ? 0 : (B64_LOOKUP[clean[i + 2]] ?? 0);
    const c3 = clean[i + 3] === '=' ? 0 : (B64_LOOKUP[clean[i + 3]] ?? 0);
    out[idx++] = (c0 << 2) | (c1 >> 4);
    if (clean[i + 2] !== '=') out[idx++] = ((c1 & 15) << 4) | (c2 >> 2);
    if (clean[i + 3] !== '=') out[idx++] = ((c2 & 3) << 6) | c3;
  }
  return out;
}

// ── Text encoding ──────────────────────────────────────────────────────────────

function encodeUtf8(str: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F));
    } else if (code >= 0xD800 && code <= 0xDBFF) {
      const next = str.charCodeAt(++i);
      const cp = 0x10000 + ((code - 0xD800) << 10) + (next - 0xDC00);
      bytes.push(
        0xF0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3F),
        0x80 | ((cp >> 6) & 0x3F),
        0x80 | (cp & 0x3F),
      );
    } else {
      bytes.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F));
    }
  }
  return new Uint8Array(bytes);
}

function decodeUtf8(bytes: Uint8Array): string {
  let result = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i++];
    if (b < 0x80) {
      result += String.fromCharCode(b);
    } else if (b < 0xE0) {
      result += String.fromCharCode(((b & 0x1F) << 6) | (bytes[i++] & 0x3F));
    } else if (b < 0xF0) {
      const b2 = bytes[i++];
      const b3 = bytes[i++];
      result += String.fromCharCode(((b & 0x0F) << 12) | ((b2 & 0x3F) << 6) | (b3 & 0x3F));
    } else {
      const b2 = bytes[i++];
      const b3 = bytes[i++];
      const b4 = bytes[i++];
      const cp = (((b & 0x07) << 18) | ((b2 & 0x3F) << 12) | ((b3 & 0x3F) << 6) | (b4 & 0x3F)) - 0x10000;
      result += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
    }
  }
  return result;
}

// ── AES-256-GCM encrypt/decrypt ────────────────────────────────────────────────

function gcmEncrypt(key: Uint8Array, plaintext: Uint8Array): { content: string; iv: string } {
  const iv = getRandomBytes(12);
  const cipher = new GCM(new AES(key));
  const ciphertext = cipher.seal(iv, plaintext);
  return { content: bytesToBase64(ciphertext), iv: bytesToBase64(iv) };
}

function gcmDecrypt(key: Uint8Array, content: string, iv: string): Uint8Array {
  const cipher = new GCM(new AES(key));
  const result = cipher.open(base64ToBytes(iv), base64ToBytes(content));
  if (!result) throw new Error('Decryption failed — wrong key or corrupted data');
  return result;
}

// ── Key derivation ─────────────────────────────────────────────────────────────

export function deriveNotesKey(syncKey: string): Uint8Array {
  const data = encodeUtf8(syncKey + ':notes');
  return sha256(data);
}

export function deriveLocalNotesKey(userId: string, token: string): Uint8Array {
  const data = encodeUtf8(userId + ':' + token + ':notes');
  return sha256(data);
}

function derivePinKey(pin: string, salt: Uint8Array): Uint8Array {
  const pinBytes = encodeUtf8(pin);
  return pbkdf2DeriveKey(SHA256, pinBytes, salt, 100_000, 32);
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function encryptNoteContent(plaintext: string, key: Uint8Array): string {
  const encoded = encodeUtf8(plaintext);
  const { content, iv } = gcmEncrypt(key, encoded);
  return JSON.stringify({ content, iv });
}

export function decryptNoteContent(encryptedJson: string, key: Uint8Array): string {
  const { content, iv } = JSON.parse(encryptedJson) as { content: string; iv: string };
  return decodeUtf8(gcmDecrypt(key, content, iv));
}

export function encryptWithPin(
  plaintext: string,
  pin: string,
): { encrypted: string; salt: string } {
  const saltBytes = getRandomBytes(16);
  const key = derivePinKey(pin, saltBytes);
  const encoded = encodeUtf8(plaintext);
  const { content, iv } = gcmEncrypt(key, encoded);
  return {
    encrypted: JSON.stringify({ content, iv }),
    salt: bytesToBase64(saltBytes),
  };
}

export function decryptWithPin(
  encryptedJson: string,
  pin: string,
  salt: string,
): string {
  const saltBytes = base64ToBytes(salt);
  const key = derivePinKey(pin, saltBytes);
  const { content, iv } = JSON.parse(encryptedJson) as { content: string; iv: string };
  try {
    return decodeUtf8(gcmDecrypt(key, content, iv));
  } catch {
    throw new Error('Incorrect PIN');
  }
}
