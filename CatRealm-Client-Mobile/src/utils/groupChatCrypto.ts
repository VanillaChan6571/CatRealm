import { AES } from '@stablelib/aes';
import { GCM } from '@stablelib/gcm';
import { getRandomBytes } from 'expo-crypto';

// ─── Base64 helpers (same as dmCrypto) ─────────────────────────────────────

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP: Record<string, number> = Object.fromEntries(B64.split('').map((c, i) => [c, i]));

function toBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  if (i < bytes.length) {
    const rem = bytes.length - i;
    const n = (bytes[i] << 16) | (rem === 2 ? bytes[i + 1] << 8 : 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += rem === 2 ? B64[(n >> 6) & 63] : '=';
    out += '=';
  }
  return out;
}

function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/\s+/g, '');
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((clean.length / 4) * 3 - padding);
  let idx = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c1 = B64_LOOKUP[clean[i]] ?? 0;
    const c2 = B64_LOOKUP[clean[i + 1]] ?? 0;
    const c3 = clean[i + 2] === '=' ? 0 : B64_LOOKUP[clean[i + 2]] ?? 0;
    const c4 = clean[i + 3] === '=' ? 0 : B64_LOOKUP[clean[i + 3]] ?? 0;
    const n = (c1 << 18) | (c2 << 12) | (c3 << 6) | c4;
    if (idx < out.length) out[idx++] = (n >> 16) & 255;
    if (idx < out.length) out[idx++] = (n >> 8) & 255;
    if (idx < out.length) out[idx++] = n & 255;
  }
  return out;
}

// ─── Group chat AES-GCM crypto ──────────────────────────────────────────────

export async function encryptGroupChatMessage(plaintext: string, keyMaterialBase64: string): Promise<string> {
  const keyBytes = fromBase64(keyMaterialBase64);
  const cipher = new AES(keyBytes);
  const gcm = new GCM(cipher);
  const iv = getRandomBytes(12);
  const sealed = gcm.seal(iv, new TextEncoder().encode(plaintext));
  gcm.clean();
  cipher.clean();
  return JSON.stringify({
    content: toBase64(sealed),
    iv: toBase64(iv),
    nonce: Date.now(),
    timestamp: Math.floor(Date.now() / 1000),
  });
}

export async function decryptGroupChatMessage(encryptedPayload: string, keyMaterialBase64: string): Promise<string> {
  const payload = JSON.parse(encryptedPayload) as { content?: string; iv?: string };
  if (!payload?.content || !payload?.iv) throw new Error('Invalid encrypted payload');
  const keyBytes = fromBase64(keyMaterialBase64);
  const cipher = new AES(keyBytes);
  const gcm = new GCM(cipher);
  const opened = gcm.open(fromBase64(payload.iv), fromBase64(payload.content));
  gcm.clean();
  cipher.clean();
  if (!opened) throw new Error('Failed to decrypt group message');
  return new TextDecoder().decode(opened);
}
