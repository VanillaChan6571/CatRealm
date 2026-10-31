import type { ServerEntry, ServerFolder, ServerLayoutItem } from '../stores/serverStore';

export interface ServerSyncPayload {
  servers: ServerEntry[];
  layout?: ServerLayoutItem[];
  folders?: ServerFolder[];
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function deriveKey(token: string): Promise<CryptoKey> {
  const data = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptServerList(payload: ServerSyncPayload, token: string): Promise<{ payload: string; iv: string }> {
  const key = await deriveKey(token);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return {
    payload: bytesToBase64(new Uint8Array(encrypted)),
    iv: bytesToBase64(iv),
  };
}

export async function decryptServerList(payload: string, iv: string, token: string): Promise<ServerSyncPayload | null> {
  try {
    const key = await deriveKey(token);
    const ivBytes = base64ToBytes(iv);
    const ivForCrypto = new Uint8Array(toArrayBuffer(ivBytes));
    const dataBytes = base64ToBytes(payload);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivForCrypto },
      key,
      toArrayBuffer(dataBytes)
    );
    const json = new TextDecoder().decode(new Uint8Array(decrypted));
    const parsed = JSON.parse(json);
    // Handle legacy format (plain array of servers from before folder support)
    if (Array.isArray(parsed)) {
      return { servers: parsed as ServerEntry[] };
    }
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.servers)) {
      return parsed as ServerSyncPayload;
    }
    return null;
  } catch {
    return null;
  }
}
