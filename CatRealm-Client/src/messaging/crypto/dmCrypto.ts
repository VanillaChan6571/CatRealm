import { base64ToBytes as base64ToArray, bytesToBase64 as arrayToBase64 } from './base64';

export type DMV2Payload = {
  v: 2;
  alg: 'aes-256-gcm';
  kid: number;
  iv: string;
  ciphertext: string;
  createdAt: number;
};

/**
 * Derive a conversation-specific key from the conversation ID
 * Uses the conversation ID as the shared secret between both users
 * Note: This means the server could theoretically decrypt (not true E2EE)
 * A proper E2EE solution would require key exchange or public-key crypto
 */
export async function deriveConversationKey(
  _syncKey: string,
  conversationId: string
): Promise<CryptoKey> {
  // Use conversation ID as the key material (shared between both users)
  const conversationIdBytes = new TextEncoder().encode(conversationId);

  // Hash it to get 256 bits
  const keyHash = await crypto.subtle.digest('SHA-256', conversationIdBytes);

  // Import as AES-GCM key
  const conversationKey = await crypto.subtle.importKey(
    'raw',
    keyHash,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  return conversationKey;
}

/**
 * Encrypt a DM message
 * Returns encrypted payload with IV and nonce
 */
export async function encryptDM(
  plaintext: string,
  syncKey: string,
  conversationId: string
): Promise<string> {
  const conversationKey = await deriveConversationKey(syncKey, conversationId);

  // Generate random IV (12 bytes for GCM)
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Encrypt plaintext
  const plaintextBytes = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    conversationKey,
    plaintextBytes
  );

  // Create encrypted payload
  const payload = {
    content: arrayToBase64(new Uint8Array(ciphertext)),
    iv: arrayToBase64(iv),
    nonce: Date.now(),
    timestamp: Math.floor(Date.now() / 1000)
  };

  return JSON.stringify(payload);
}

/**
 * Decrypt a DM message
 * Verifies nonce and timestamp, returns plaintext
 */
export async function decryptDM(
  encryptedPayload: string,
  syncKey: string,
  conversationId: string
): Promise<string> {
  const payload = JSON.parse(encryptedPayload);

  // Verify payload structure
  if (!verifyDMPayload(encryptedPayload)) {
    throw new Error('Invalid encrypted payload');
  }

  const conversationKey = await deriveConversationKey(syncKey, conversationId);

  // Decode base64 components
  const ciphertext = base64ToArray(payload.content);
  const iv = base64ToArray(payload.iv);

  // Decrypt
  try {
    const plaintextBytes = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      conversationKey,
      ciphertext as BufferSource
    );

    return new TextDecoder().decode(plaintextBytes);
  } catch (error) {
    console.error('[DM Crypto] Decryption failed:', error);
    throw new Error('Failed to decrypt message');
  }
}

/**
 * Verify encrypted payload has required fields
 */
export function verifyDMPayload(encryptedPayload: string): boolean {
  try {
    const payload = JSON.parse(encryptedPayload);
    return !!(
      payload.content &&
      payload.iv &&
      typeof payload.nonce === 'number' &&
      typeof payload.timestamp === 'number'
    );
  } catch {
    return false;
  }
}

async function deriveV2ConversationKey(conversationSecretBase64: string, conversationId: string): Promise<CryptoKey> {
  const secret = base64ToArray(conversationSecretBase64);
  const keyMaterial = await crypto.subtle.importKey('raw', secret as BufferSource, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode(conversationId),
      info: new TextEncoder().encode('catrealm:dm:v2'),
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
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

export async function encryptDMV2(
  plaintext: string,
  conversationSecretBase64: string,
  conversationId: string,
  keyVersion: number,
): Promise<string> {
  const key = await deriveV2ConversationKey(conversationSecretBase64, conversationId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext),
  );
  return JSON.stringify({
    v: 2,
    alg: 'aes-256-gcm',
    kid: keyVersion,
    iv: arrayToBase64(iv),
    ciphertext: arrayToBase64(new Uint8Array(ciphertext)),
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
  const key = await deriveV2ConversationKey(conversationSecretBase64, conversationId);
  const plaintextBytes = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToArray(payload.iv) as BufferSource },
    key,
    base64ToArray(payload.ciphertext) as BufferSource,
  );
  return new TextDecoder().decode(plaintextBytes);
}
