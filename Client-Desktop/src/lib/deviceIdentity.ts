import { createAuthenticatedApi } from './authApi';
import { x25519 } from '@noble/curves/ed25519.js';

const DEVICE_ID_KEY = 'catrealm.device-id';
const DEVICE_NAME_KEY = 'catrealm.device-name';
const DEVICE_DM_PRIVATE_KEY = 'catrealm.device-dm-private-key';
const DEVICE_NOTIFICATION_PRIVATE_KEY = 'catrealm.device-notification-private-key';

export type UserDevice = {
  id: string;
  deviceName: string;
  platform: 'desktop' | 'web' | 'ios' | 'android';
  browserName: string | null;
  dmTrustState: 'untrusted' | 'trusted' | 'revoked';
  deviceSecurity: 'software_protected' | 'passkey_protected' | 'security_key_protected' | 'platform_protected';
  boundWebAuthnCredentialId: string | null;
  lastProofAt: number | null;
  proofRequiredOnLaunch: boolean;
  trustedAt: number | null;
  trustedByDeviceId: string | null;
  pushCapable: boolean;
  firstSeenAt: number;
  lastSeenAt: number;
  revokedAt: number | null;
};

function browserName() {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Browser';
}

function bytesToBase64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(value: string) {
  const raw = atob(value);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

// Private keys are stored per device id. Several accounts can share this
// device, and each account's session may name a different device id; one
// shared slot meant switching accounts replaced (and lost) the previous
// account's key, so its trusted device could no longer decrypt.
function deviceKeyStorageKey(baseKey: string, deviceId: string) {
  return `${baseKey}.${deviceId}`;
}

function getOrCreatePrivateKey(baseKey: string) {
  const deviceId = getLocalDeviceId();
  const storageKey = deviceKeyStorageKey(baseKey, deviceId);
  let existing = localStorage.getItem(storageKey);
  if (!existing) {
    // Migrate the old single-slot key: it belonged to whichever device id was
    // stored when it was made, which is the current one.
    const legacy = localStorage.getItem(baseKey);
    if (legacy) {
      localStorage.setItem(storageKey, legacy);
      localStorage.removeItem(baseKey);
      existing = legacy;
    }
  }
  if (existing) return base64ToBytes(existing);
  const next = x25519.utils.randomSecretKey();
  localStorage.setItem(storageKey, bytesToBase64(next));
  return next;
}

export function getLocalDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

export function clearLocalConversationSecrets() {
  for (let index = localStorage.length - 1; index >= 0; index--) {
    const key = localStorage.key(index);
    if (key?.startsWith('catrealm.dm-conversation-secret.')) localStorage.removeItem(key);
  }
}

export function clearLocalDeviceIdentity() {
  clearLocalConversationSecrets();
  const deviceId = localStorage.getItem(DEVICE_ID_KEY);
  if (deviceId) {
    // Only this device id's keys: other accounts' devices on this machine keep theirs.
    localStorage.removeItem(deviceKeyStorageKey(DEVICE_DM_PRIVATE_KEY, deviceId));
    localStorage.removeItem(deviceKeyStorageKey(DEVICE_NOTIFICATION_PRIVATE_KEY, deviceId));
  }
  localStorage.removeItem('catrealm.device-session-secret');
  localStorage.removeItem(DEVICE_ID_KEY);
  localStorage.removeItem(DEVICE_NAME_KEY);
  localStorage.removeItem(DEVICE_DM_PRIVATE_KEY);
  localStorage.removeItem(DEVICE_NOTIFICATION_PRIVATE_KEY);
}

export function getLocalDeviceDescriptor() {
  const platform = window.electron ? 'desktop' : 'web';
  const fallbackName = window.electron ? 'Desktop App' : `${browserName()} on web`;
  const dmPrivateKey = getOrCreatePrivateKey(DEVICE_DM_PRIVATE_KEY);
  const notificationPrivateKey = getOrCreatePrivateKey(DEVICE_NOTIFICATION_PRIVATE_KEY);
  return {
    deviceId: getLocalDeviceId(),
    deviceName: localStorage.getItem(DEVICE_NAME_KEY) || fallbackName,
    platform,
    browserName: platform === 'web' ? browserName() : null,
    dmPublicKey: bytesToBase64(x25519.getPublicKey(dmPrivateKey)),
    notificationPublicKey: bytesToBase64(x25519.getPublicKey(notificationPrivateKey)),
  } as const;
}

export async function registerCurrentDevice() {
  const descriptor = getLocalDeviceDescriptor();
  const res = await createAuthenticatedApi().post<{ device: UserDevice }>('/api/devices/register', descriptor);
  return res.data.device;
}

export function getLocalDmPrivateKey() {
  return getOrCreatePrivateKey(DEVICE_DM_PRIVATE_KEY);
}

export function getLocalNotificationPrivateKey() {
  return getOrCreatePrivateKey(DEVICE_NOTIFICATION_PRIVATE_KEY);
}
