/**
 * Encryption utilities for Personal Notes
 * Uses WebCrypto API (AES-256-GCM) with optional PBKDF2 PIN key derivation.
 * Follows same patterns as serverSyncCrypto.ts.
 */

// ── Base64 helpers ─────────────────────────────────────────────────────────────

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

// ── Key derivation ─────────────────────────────────────────────────────────────

/**
 * Central accounts: derive AES-GCM key from syncKey.
 * Uses SHA-256(syncKey + ":notes") to produce a notes-specific key
 * distinct from the server-list sync key (SHA-256(syncKey)).
 */
export async function deriveNotesKey(syncKey: string): Promise<CryptoKey> {
  const data = new TextEncoder().encode(syncKey + ':notes');
  const hash = await crypto.subtle.digest('SHA-256', data);
  return crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/**
 * Local/decentral accounts: derive AES-GCM key from userId + token.
 * Note: if the JWT rotates, existing notes will require the old token to decrypt.
 */
export async function deriveLocalNotesKey(userId: string, token: string): Promise<CryptoKey> {
  const data = new TextEncoder().encode(userId + ':' + token + ':notes');
  const hash = await crypto.subtle.digest('SHA-256', data);
  return crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

// ── Base encryption ────────────────────────────────────────────────────────────

/** Encrypts plaintext and returns a JSON string: { content: base64, iv: base64 } */
export async function encryptNoteContent(plaintext: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return JSON.stringify({
    content: bytesToBase64(new Uint8Array(encrypted)),
    iv: bytesToBase64(iv),
  });
}

/** Decrypts a JSON string from encryptNoteContent back to plaintext. */
export async function decryptNoteContent(encryptedJson: string, key: CryptoKey): Promise<string> {
  const { content, iv } = JSON.parse(encryptedJson) as { content: string; iv: string };
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(base64ToBytes(iv)) },
    key,
    toArrayBuffer(base64ToBytes(content)),
  );
  return new TextDecoder().decode(new Uint8Array(decrypted));
}

// ── PIN-based encryption ───────────────────────────────────────────────────────

/**
 * Encrypts plaintext with a PBKDF2-derived PIN key.
 * Returns { encrypted: JSON string, salt: base64 string }.
 * The PIN-encrypted blob replaces the base-key blob entirely — no double-encryption.
 */
export async function encryptWithPin(
  plaintext: string,
  pin: string,
): Promise<{ encrypted: string; salt: string }> {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = bytesToBase64(saltBytes);
  const pinKey = await derivePinKey(pin, saltBytes);

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, pinKey, encoded);

  return {
    encrypted: JSON.stringify({
      content: bytesToBase64(new Uint8Array(encrypted)),
      iv: bytesToBase64(iv),
    }),
    salt,
  };
}

/**
 * Decrypts a PIN-locked note.
 * Throws an error with message 'Incorrect PIN' if the PIN is wrong (AES-GCM auth tag mismatch).
 */
export async function decryptWithPin(
  encryptedJson: string,
  pin: string,
  salt: string,
): Promise<string> {
  const saltBytes = base64ToBytes(salt);
  const pinKey = await derivePinKey(pin, saltBytes);
  const { content, iv } = JSON.parse(encryptedJson) as { content: string; iv: string };
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(base64ToBytes(iv)) },
      pinKey,
      toArrayBuffer(base64ToBytes(content)),
    );
    return new TextDecoder().decode(new Uint8Array(decrypted));
  } catch (err) {
    if (err instanceof DOMException && err.name === 'OperationError') {
      throw new Error('Incorrect PIN');
    }
    throw err;
  }
}

// ── PBKDF2 ────────────────────────────────────────────────────────────────────

async function derivePinKey(pin: string, saltBytes: Uint8Array): Promise<CryptoKey> {
  const pinBytes = new TextEncoder().encode(pin);
  const baseKey = await crypto.subtle.importKey(
    'raw',
    pinBytes,
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: toArrayBuffer(saltBytes), iterations: 100_000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
