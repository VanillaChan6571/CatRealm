import AsyncStorage from '@react-native-async-storage/async-storage';
import { CryptoDigestAlgorithm, digestStringAsync, getRandomBytes, randomUUID } from 'expo-crypto';
import {
  accountCentralDeviceSecretKey,
  accountDeviceDmPrivateKeyKey,
  accountDeviceIdKey,
  accountDeviceNotificationPrivateKeyKey,
  secureStorage,
  StorageKeys,
} from '@/lib/storage';
import { clearConversationSecretsForAccount } from '@/lib/dmSecretStorage';

type DeviceCredentials = { deviceId: string; deviceSecret: string };

const DEVICE_ID_RE = /^[A-Za-z0-9_-]{16,128}$/;
const DEVICE_SECRET_RE = /^[A-Za-z0-9_-]{43,128}$/;
const pendingLogins = new Map<string, Promise<DeviceCredentials>>();

async function previousAccountDeviceId(username: string): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(StorageKeys.savedAccountsList);
    if (!raw) return null;
    const accounts = JSON.parse(raw) as Array<{ id?: string; username?: string; accountType?: string }>;
    if (!Array.isArray(accounts)) return null;
    const account = accounts.find(entry => entry.accountType === 'central'
      && entry.username?.trim().toLowerCase() === username.trim().toLowerCase());
    if (!account?.id) return null;
    const id = await secureStorage.get(accountDeviceIdKey(account.id));
    return id && DEVICE_ID_RE.test(id) ? id : null;
  } catch { return null; }
}

function base64Url(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const chunk = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    result += alphabet[(chunk >>> 18) & 63] + alphabet[(chunk >>> 12) & 63];
    if (i + 1 < bytes.length) result += alphabet[(chunk >>> 6) & 63];
    if (i + 2 < bytes.length) result += alphabet[chunk & 63];
  }
  return result;
}

async function loginKeys(username: string) {
  const normalized = username.trim().toLowerCase();
  if (!normalized) throw new Error('Enter your Central username.');
  const digest = await digestStringAsync(CryptoDigestAlgorithm.SHA256, normalized);
  return {
    id: `catrealm.central-login-device-id.${digest}`,
    secret: `catrealm.central-login-device-secret.${digest}`,
  };
}

/** A stable, private credential for each Central login identity. */
export async function getCentralLoginDeviceCredentials(username: string): Promise<DeviceCredentials> {
  const keys = await loginKeys(username);
  const existing = pendingLogins.get(keys.id);
  if (existing) return existing;
  const task = (async () => {
    const [storedId, storedSecret] = await Promise.all([
      secureStorage.get(keys.id), secureStorage.get(keys.secret),
    ]);
    const deviceId = storedId && DEVICE_ID_RE.test(storedId)
      ? storedId : (await previousAccountDeviceId(username)) ?? randomUUID();
    const deviceSecret = storedSecret && DEVICE_SECRET_RE.test(storedSecret)
      ? storedSecret : base64Url(getRandomBytes(32));
    await Promise.all([
      secureStorage.set(keys.id, deviceId), secureStorage.set(keys.secret, deviceSecret),
    ]);
    return { deviceId, deviceSecret };
  })();
  pendingLogins.set(keys.id, task);
  try { return await task; }
  finally { pendingLogins.delete(keys.id); }
}

export async function forgetCentralLoginDeviceCredentials(username: string): Promise<void> {
  const keys = await loginKeys(username);
  try { await pendingLogins.get(keys.id); } catch { /* Continue clearing after a failed write. */ }
  await Promise.all([secureStorage.remove(keys.id), secureStorage.remove(keys.secret)]);
}

export function centralDeviceHeaders(credentials: DeviceCredentials) {
  return {
    'X-CatRealm-Device-Id': credentials.deviceId,
    'X-CatRealm-Device-Secret': credentials.deviceSecret,
  };
}

/** Existing sessions must use their original secret; generating a new one cannot repair them. */
export async function getCentralDeviceHeadersForUser(userId: string) {
  const [deviceId, deviceSecret] = await Promise.all([
    secureStorage.get(accountDeviceIdKey(userId)),
    secureStorage.get(accountCentralDeviceSecretKey(userId)),
  ]);
  if (!deviceId || !DEVICE_ID_RE.test(deviceId) || !deviceSecret || !DEVICE_SECRET_RE.test(deviceSecret)) return {};
  return centralDeviceHeaders({ deviceId, deviceSecret });
}

function sessionDeviceId(token: string): string {
  try {
    const encoded = token.split('.')[1];
    if (!encoded) throw new Error();
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let bits = 0;
    let value = 0;
    let decoded = '';
    for (const char of encoded) {
      const digit = alphabet.indexOf(char);
      if (digit < 0) throw new Error();
      value = (value << 6) | digit;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        decoded += String.fromCharCode((value >>> bits) & 255);
      }
    }
    const payload = JSON.parse(decoded);
    if (typeof payload.did === 'string' && DEVICE_ID_RE.test(payload.did)) return payload.did;
  } catch { /* The session did not contain a usable device identity. */ }
  throw new Error('Central did not return a device-bound session. Please try again.');
}

/** Central may replace a device ID owned by another account or one that was revoked. */
export async function adoptCentralSessionDevice(userId: string, username: string, token: string, credentials: DeviceCredentials) {
  const deviceId = sessionDeviceId(token);
  const keys = await loginKeys(username);
  const oldId = await secureStorage.get(accountDeviceIdKey(userId));
  if (oldId && oldId !== deviceId) {
    await Promise.all([
      secureStorage.remove(accountDeviceDmPrivateKeyKey(userId)),
      secureStorage.remove(accountDeviceNotificationPrivateKeyKey(userId)),
    ]);
    await clearConversationSecretsForAccount(userId);
  }
  await Promise.all([
    secureStorage.set(keys.id, deviceId),
    secureStorage.set(keys.secret, credentials.deviceSecret),
    secureStorage.set(accountDeviceIdKey(userId), deviceId),
    secureStorage.set(accountCentralDeviceSecretKey(userId), credentials.deviceSecret),
  ]);
}
