import { decodeToken } from '../utils/token';
// Independent of the account token and never sent to community servers.
// Central stores only a hash; knowing a listed device ID is not device proof.
const DEVICE_ID_KEY = 'catrealm.device-id';
const DEVICE_SECRET_KEY = 'catrealm.device-session-secret';
const CONVERSATION_SECRET_PREFIX = 'catrealm.dm-conversation-secret.';
const CONVERSATION_SECRET_OWNER_KEY = 'catrealm.dm-conversation-secret-owner';

export function clearLocalConversationSecrets() {
  for (let index = localStorage.length - 1; index >= 0; index--) {
    const key = localStorage.key(index);
    if (key?.startsWith(CONVERSATION_SECRET_PREFIX)) localStorage.removeItem(key);
  }
  localStorage.removeItem(CONVERSATION_SECRET_OWNER_KEY);
}

// An unconfirmed session keeps its cached DM keys, since the server may no longer
// hold this device's copy. Record whose they are so no other account inherits them.
export function keepConversationSecretsFor(userId: string) {
  localStorage.setItem(CONVERSATION_SECRET_OWNER_KEY, userId);
}

function claimConversationSecrets(userId: unknown) {
  const owner = localStorage.getItem(CONVERSATION_SECRET_OWNER_KEY);
  if (owner === null) return;
  if (owner !== userId) clearLocalConversationSecrets();
  localStorage.removeItem(CONVERSATION_SECRET_OWNER_KEY);
}

export function getCentralDeviceCredentials() {
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  let deviceSecret = localStorage.getItem(DEVICE_SECRET_KEY);
  if (!deviceSecret) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    deviceSecret = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    localStorage.setItem(DEVICE_SECRET_KEY, deviceSecret);
  }
  return { deviceId, deviceSecret };
}
export function getCentralDeviceHeaders() {
  const { deviceId, deviceSecret } = getCentralDeviceCredentials();
  return { 'X-CatRealm-Device-Id': deviceId, 'X-CatRealm-Device-Secret': deviceSecret };
}

// A login can name a different device id: another account's id is replaced by
// this account's own device (or a new one), and a revoked id by a new one.
// Adopt it before sending authenticated requests. Encryption keys are stored
// per device id (deviceIdentity.ts), so a new id gets fresh keys while another
// account's device keeps its own; a revoked id's keys are never reused.
export function adoptCentralSessionDevice(token: string) {
  const payload = decodeToken(token);
  claimConversationSecrets(payload?.sub);
  const deviceId = payload?.did;
  if (typeof deviceId !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(deviceId)) return;
  const previousDeviceId = localStorage.getItem(DEVICE_ID_KEY);
  if (deviceId !== previousDeviceId) {
    // Pin pre-migration single-slot keys to the device id they belong to
    // before switching away, so they aren't picked up by the new id.
    if (previousDeviceId) {
      for (const baseKey of ['catrealm.device-dm-private-key', 'catrealm.device-notification-private-key']) {
        const legacy = localStorage.getItem(baseKey);
        if (legacy) {
          if (!localStorage.getItem(`${baseKey}.${previousDeviceId}`)) localStorage.setItem(`${baseKey}.${previousDeviceId}`, legacy);
          localStorage.removeItem(baseKey);
        }
      }
    }
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
    clearLocalConversationSecrets();
  }
}
