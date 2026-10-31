import { base64ToBytes as base64ToArray, bytesToBase64 as arrayToBase64 } from './base64';

async function importGroupKey(keyMaterialBase64: string): Promise<CryptoKey> {
  const keyBytes = base64ToArray(keyMaterialBase64);
  if (keyBytes.length !== 32) {
    throw new Error('Invalid group key length');
  }
  return crypto.subtle.importKey(
    'raw',
    keyBytes as BufferSource,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptGroupChatMessage(plaintext: string, keyMaterialBase64: string): Promise<string> {
  const key = await importGroupKey(keyMaterialBase64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext)
  );

  return JSON.stringify({
    content: arrayToBase64(new Uint8Array(ciphertext)),
    iv: arrayToBase64(iv),
    nonce: Date.now(),
    timestamp: Math.floor(Date.now() / 1000),
  });
}

export async function decryptGroupChatMessage(encryptedPayload: string, keyMaterialBase64: string): Promise<string> {
  const payload = JSON.parse(encryptedPayload);
  if (!payload?.content || !payload?.iv) throw new Error('Invalid encrypted payload');

  const key = await importGroupKey(keyMaterialBase64);
  const ciphertext = base64ToArray(payload.content);
  const iv = base64ToArray(payload.iv);
  const plaintextBytes = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    ciphertext as BufferSource
  );
  return new TextDecoder().decode(plaintextBytes);
}
