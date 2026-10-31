import { AES } from '@stablelib/aes';
import { GCM } from '@stablelib/gcm';
import { hash as sha256 } from '@stablelib/sha256';
import { SHA256 } from '@stablelib/sha256';
import { hmac } from '@stablelib/hmac';
import { getRandomBytes } from 'expo-crypto';

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_LOOKUP: Record<string, number> = Object.fromEntries(
  BASE64_ALPHABET.split('').map((char, index) => [char, index]),
);

export function bytesToBase64(bytes: Uint8Array): string {
  let output = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    output +=
      BASE64_ALPHABET[(chunk >> 18) & 63] +
      BASE64_ALPHABET[(chunk >> 12) & 63] +
      BASE64_ALPHABET[(chunk >> 6) & 63] +
      BASE64_ALPHABET[chunk & 63];
  }

  if (i < bytes.length) {
    const remaining = bytes.length - i;
    const chunk = (bytes[i] << 16) | (remaining === 2 ? bytes[i + 1] << 8 : 0);
    output += BASE64_ALPHABET[(chunk >> 18) & 63] + BASE64_ALPHABET[(chunk >> 12) & 63];
    output += remaining === 2 ? BASE64_ALPHABET[(chunk >> 6) & 63] : '=';
    output += '=';
  }

  return output;
}

export function base64ToBytes(value: string): Uint8Array {
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

export function utf8ToBytes(value: string): Uint8Array {
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

function bytesToUtf8(bytes: Uint8Array): string {
  const Decoder = globalThis.TextDecoder;
  if (Decoder) return new Decoder().decode(bytes);

  const chars: string[] = [];
  for (let i = 0; i < bytes.length;) {
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
          ((b1 & 0x07) << 18) | ((b2 & 0x3f) << 12) | ((b3 & 0x3f) << 6) | (b4 & 0x3f),
        ),
      );
    }
  }
  return chars.join('');
}

function deriveConversationKey(conversationId: string): Uint8Array {
  return sha256(utf8ToBytes(conversationId));
}

export type DMV2Payload = {
  v: 2;
  alg: 'aes-256-gcm';
  kid: number;
  iv: string;
  ciphertext: string;
  createdAt: number;
};

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const next = new Uint8Array(left.length + right.length);
  next.set(left, 0);
  next.set(right, left.length);
  return next;
}

function deriveV2ConversationKey(conversationSecretBase64: string, conversationId: string): Uint8Array {
  const secret = base64ToBytes(conversationSecretBase64);
  const salt = utf8ToBytes(conversationId);
  const prk = hmac(SHA256, salt, secret);
  return hmac(SHA256, prk, concatBytes(utf8ToBytes('catrealm:dm:v2'), new Uint8Array([1])));
}

export function verifyDMPayload(encryptedPayload: string): boolean {
  try {
    const payload = JSON.parse(encryptedPayload);
    return !!(
      payload &&
      typeof payload.content === 'string' &&
      typeof payload.iv === 'string' &&
      typeof payload.nonce === 'number' &&
      typeof payload.timestamp === 'number'
    );
  } catch {
    return false;
  }
}

export function verifyDMV2Payload(encryptedPayload: string): boolean {
  try {
    const payload = JSON.parse(encryptedPayload) as Partial<DMV2Payload>;
    return payload.v === 2
      && payload.alg === 'aes-256-gcm'
      && Number.isInteger(payload.kid)
      && typeof payload.iv === 'string'
      && typeof payload.ciphertext === 'string'
      && typeof payload.createdAt === 'number';
  } catch {
    return false;
  }
}

export function getDMPayloadVersion(encryptedPayload: string): 1 | 2 | null {
  if (verifyDMV2Payload(encryptedPayload)) return 2;
  if (verifyDMPayload(encryptedPayload)) return 1;
  return null;
}

export async function encryptDM(
  plaintext: string,
  _syncKey: string,
  conversationId: string,
): Promise<string> {
  const cipher = new AES(deriveConversationKey(conversationId));
  const gcm = new GCM(cipher);
  const iv = getRandomBytes(12);
  const sealed = gcm.seal(iv, utf8ToBytes(plaintext));
  gcm.clean();
  cipher.clean();

  return JSON.stringify({
    content: bytesToBase64(sealed),
    iv: bytesToBase64(iv),
    nonce: Date.now(),
    timestamp: Math.floor(Date.now() / 1000),
  });
}

export async function decryptDM(
  encryptedPayload: string,
  _syncKey: string,
  conversationId: string,
): Promise<string> {
  if (!verifyDMPayload(encryptedPayload)) throw new Error('Invalid encrypted payload');

  const payload = JSON.parse(encryptedPayload) as { content: string; iv: string };
  const cipher = new AES(deriveConversationKey(conversationId));
  const gcm = new GCM(cipher);
  const opened = gcm.open(base64ToBytes(payload.iv), base64ToBytes(payload.content));
  gcm.clean();
  cipher.clean();

  if (!opened) throw new Error('Failed to decrypt message');
  return bytesToUtf8(opened);
}

export async function encryptDMV2(
  plaintext: string,
  conversationSecretBase64: string,
  conversationId: string,
  keyVersion: number,
): Promise<string> {
  const cipher = new AES(deriveV2ConversationKey(conversationSecretBase64, conversationId));
  const gcm = new GCM(cipher);
  const iv = getRandomBytes(12);
  const sealed = gcm.seal(iv, utf8ToBytes(plaintext));
  gcm.clean();
  cipher.clean();
  return JSON.stringify({
    v: 2,
    alg: 'aes-256-gcm',
    kid: keyVersion,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(sealed),
    createdAt: Math.floor(Date.now() / 1000),
  } satisfies DMV2Payload);
}

export async function decryptDMV2(
  encryptedPayload: string,
  conversationSecretBase64: string,
  conversationId: string,
): Promise<string> {
  if (!verifyDMV2Payload(encryptedPayload)) throw new Error('Invalid v2 encrypted payload');
  const payload = JSON.parse(encryptedPayload) as DMV2Payload;
  const cipher = new AES(deriveV2ConversationKey(conversationSecretBase64, conversationId));
  const gcm = new GCM(cipher);
  const opened = gcm.open(base64ToBytes(payload.iv), base64ToBytes(payload.ciphertext));
  gcm.clean();
  cipher.clean();
  if (!opened) throw new Error('Failed to decrypt message');
  return bytesToUtf8(opened);
}
