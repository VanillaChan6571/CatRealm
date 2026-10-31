import { AES } from '@stablelib/aes';
import { GCM } from '@stablelib/gcm';
import { hash as sha256, SHA256 } from '@stablelib/sha256';
import { hmac } from '@stablelib/hmac';
import { getRandomBytes } from 'expo-crypto';

export interface SyncedServerEntry {
  url: string;
  /** Direct HTTP origin represented by a bridge.catrealm.app entry. */
  originalHttpOrigin?: string;
  name: string;
  icon?: string | null;
  token: string;
  info?: {
    name?: string | null;
    serverIcon?: string | null;
    serverBanner?: string | null;
    userCount?: number | null;
  } | null;
  realmTrust?: {
    state: 'trusted' | 'changed' | 'unverified' | 'error';
    approvedIdentity?: { realmInstanceId: string; realmKeyFingerprint: string };
    seenIdentity?: { realmInstanceId: string; realmKeyFingerprint: string };
    approvedAt?: number;
    lastSeenAt?: number;
    lastError?: string;
  };
}

/** Folder grouping, mirrors CatRealm-Client ServerFolder. */
export interface SyncedServerFolder {
  id: string;
  name: string;
  color: string;
  serverUrls: string[];
  isOpen: boolean;
}

/** Ordered top-level layout item, mirrors CatRealm-Client ServerLayoutItem. */
export type ServerLayoutItem =
  | { type: 'server'; url: string }
  | { type: 'folder'; folderId: string };

export interface ServerSyncPayload {
  servers: SyncedServerEntry[];
  layout?: ServerLayoutItem[];
  folders?: SyncedServerFolder[];
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export async function serverMembershipIds(urls: string[], syncKey: string): Promise<string[]> {
  return urls.map(url => Array.from(hmac(SHA256, utf8ToBytes(syncKey),
    utf8ToBytes(`catrealm-server-list-member-v1\0${url}`)), byte => byte.toString(16).padStart(2, '0')).join(''));
}
const BASE64_LOOKUP: Record<string, number> = Object.fromEntries(
  BASE64_ALPHABET.split('').map((char, index) => [char, index]),
);

function base64ToBytes(value: string): Uint8Array {
  const clean = value.replace(/\s+/g, '');
  if (clean.length % 4 !== 0) throw new Error('Invalid base64');

  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const output = new Uint8Array((clean.length / 4) * 3 - padding);
  let outIndex = 0;

  for (let i = 0; i < clean.length; i += 4) {
    const c1 = BASE64_LOOKUP[clean[i]];
    const c2 = BASE64_LOOKUP[clean[i + 1]];
    const c3 = clean[i + 2] === '=' ? 0 : BASE64_LOOKUP[clean[i + 2]];
    const c4 = clean[i + 3] === '=' ? 0 : BASE64_LOOKUP[clean[i + 3]];
    if (c1 == null || c2 == null || c3 == null || c4 == null) {
      throw new Error('Invalid base64');
    }

    const chunk = (c1 << 18) | (c2 << 12) | (c3 << 6) | c4;
    if (outIndex < output.length) output[outIndex++] = (chunk >> 16) & 255;
    if (outIndex < output.length) output[outIndex++] = (chunk >> 8) & 255;
    if (outIndex < output.length) output[outIndex++] = chunk & 255;
  }

  return output;
}

function bytesToBase64(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i];
    const b2 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b3 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const chunk = (b1 << 16) | (b2 << 8) | b3;
    result += BASE64_ALPHABET[(chunk >> 18) & 63];
    result += BASE64_ALPHABET[(chunk >> 12) & 63];
    result += i + 1 < bytes.length ? BASE64_ALPHABET[(chunk >> 6) & 63] : '=';
    result += i + 2 < bytes.length ? BASE64_ALPHABET[chunk & 63] : '=';
  }
  return result;
}

function bytesToUtf8(bytes: Uint8Array): string {
  const Decoder = globalThis.TextDecoder;
  if (Decoder) return new Decoder().decode(bytes);

  const chars: string[] = [];
  for (let i = 0; i < bytes.length; ) {
    const b1 = bytes[i++];
    if (b1 < 0x80) {
      chars.push(String.fromCodePoint(b1));
    } else if (b1 < 0xe0) {
      const b2 = bytes[i++];
      chars.push(String.fromCodePoint(((b1 & 0x1f) << 6) | (b2 & 0x3f)));
    } else if (b1 < 0xf0) {
      const b2 = bytes[i++];
      const b3 = bytes[i++];
      chars.push(String.fromCodePoint(((b1 & 0x0f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f)));
    } else {
      const b2 = bytes[i++];
      const b3 = bytes[i++];
      const b4 = bytes[i++];
      chars.push(
        String.fromCodePoint(
          ((b1 & 0x07) << 18) |
            ((b2 & 0x3f) << 12) |
            ((b3 & 0x3f) << 6) |
            (b4 & 0x3f),
        ),
      );
    }
  }
  return chars.join('');
}

function utf8ToBytes(value: string): Uint8Array {
  const Encoder = globalThis.TextEncoder;
  if (Encoder) return new Encoder().encode(value);

  const bytes: number[] = [];
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return new Uint8Array(bytes);
}

export async function decryptServerList(
  payload: string,
  iv: string,
  syncKey: string,
): Promise<ServerSyncPayload | null> {
  try {
    const cipher = new AES(sha256(utf8ToBytes(syncKey)));
    const gcm = new GCM(cipher);
    const opened = gcm.open(base64ToBytes(iv), base64ToBytes(payload));
    gcm.clean();
    cipher.clean();

    if (!opened) return null;
    const parsed = JSON.parse(bytesToUtf8(opened));
    // Legacy format: plain array of servers from before folder support.
    if (Array.isArray(parsed)) return { servers: parsed as SyncedServerEntry[] };
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.servers)) {
      return {
        servers: parsed.servers as SyncedServerEntry[],
        layout: Array.isArray(parsed.layout) ? (parsed.layout as ServerLayoutItem[]) : undefined,
        folders: Array.isArray(parsed.folders) ? (parsed.folders as SyncedServerFolder[]) : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Encrypts the server sync payload back to Central. Cross-compatible with the
 * desktop client (AES-256-GCM, SHA-256(syncKey) as key, 12-byte IV, base64).
 */
export async function encryptServerList(
  payload: ServerSyncPayload,
  syncKey: string,
): Promise<{ payload: string; iv: string }> {
  const cipher = new AES(sha256(utf8ToBytes(syncKey)));
  const gcm = new GCM(cipher);
  const iv = getRandomBytes(12);
  const sealed = gcm.seal(iv, utf8ToBytes(JSON.stringify(payload)));
  gcm.clean();
  cipher.clean();
  return {
    payload: bytesToBase64(sealed),
    iv: bytesToBase64(iv),
  };
}
