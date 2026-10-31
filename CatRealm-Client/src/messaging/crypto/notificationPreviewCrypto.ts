import { x25519 } from '@noble/curves/ed25519.js';
import { getLocalDeviceId, getLocalNotificationPrivateKey } from '../../lib/deviceIdentity';

import { bytesToBase64, base64ToBytes } from './base64';
async function deriveKey(shared: Uint8Array, deviceId: string) {
  const material = await crypto.subtle.importKey('raw', shared as BufferSource, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({
    name: 'HKDF', hash: 'SHA-256',
    salt: new TextEncoder().encode(deviceId),
    info: new TextEncoder().encode('catrealm:notification-preview:v1'),
  }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
}
export type NotificationPreviewTarget = { id: string; notificationPublicKey: string | null };
export type NotificationPreviewEnvelope = { deviceId: string; encryptedPayload: string };
export async function encryptNotificationPreviewForDevice(device: NotificationPreviewTarget, payload: unknown): Promise<NotificationPreviewEnvelope | null> {
  if (!device.notificationPublicKey) return null;
  const eph = x25519.utils.randomSecretKey();
  const epk = x25519.getPublicKey(eph);
  const shared = x25519.getSharedSecret(eph, base64ToBytes(device.notificationPublicKey));
  const key = await deriveKey(shared, device.id);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, plaintext as BufferSource);
  return { deviceId: device.id, encryptedPayload: JSON.stringify({ v: 1, epk: bytesToBase64(epk), iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) }) };
}

export type DecryptedNotificationPreview = {
  type: 'dm_message';
  conversationId: string;
  senderId?: string;
  senderDisplayName?: string;
  preview?: string;
  createdAt?: number;
};

async function deriveDecryptKey(shared: Uint8Array, deviceId: string) {
  const material = await crypto.subtle.importKey('raw', shared as BufferSource, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({
    name: 'HKDF', hash: 'SHA-256',
    salt: new TextEncoder().encode(deviceId),
    info: new TextEncoder().encode('catrealm:notification-preview:v1'),
  }, material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
}

export async function decryptNotificationPreviewEnvelope(envelope: string): Promise<DecryptedNotificationPreview | null> {
  try {
    const parsed = JSON.parse(envelope) as { v?: number; epk?: string; iv?: string; ciphertext?: string };
    if (parsed.v !== 1 || !parsed.epk || !parsed.iv || !parsed.ciphertext) return null;
    const deviceId = getLocalDeviceId();
    const shared = x25519.getSharedSecret(getLocalNotificationPrivateKey(), base64ToBytes(parsed.epk));
    const key = await deriveDecryptKey(shared, deviceId);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(parsed.iv) as BufferSource },
      key,
      base64ToBytes(parsed.ciphertext) as BufferSource,
    );
    const payload = JSON.parse(new TextDecoder().decode(plaintext)) as DecryptedNotificationPreview;
    return payload?.type === 'dm_message' && typeof payload.conversationId === 'string' ? payload : null;
  } catch {
    return null;
  }
}
