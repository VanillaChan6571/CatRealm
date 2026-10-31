import { Platform } from 'react-native';
import { getRandomBytes, randomUUID } from 'expo-crypto';
import { x25519 } from '@noble/curves/ed25519.js';
import { createAuthenticatedApi } from '@/lib/api';
import {
  accountDeviceDmPrivateKeyKey,
  accountDeviceIdKey,
  accountDeviceNotificationPrivateKeyKey,
  secureStorage,
  sharedNotificationPreviewStorage,
  StorageKeys,
} from '@/lib/storage';
import { useAuthStore } from '@/stores/authStore';
import { useSavedAccountsStore } from '@/stores/savedAccountsStore';
import { clearConversationSecretsForAccount } from '@/lib/dmSecretStorage';

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function bytesToBase64(bytes: Uint8Array): string {
  let output = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    output += BASE64_ALPHABET[(chunk >> 18) & 63] + BASE64_ALPHABET[(chunk >> 12) & 63] + BASE64_ALPHABET[(chunk >> 6) & 63] + BASE64_ALPHABET[chunk & 63];
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

const BASE64_LOOKUP: Record<string, number> = Object.fromEntries(BASE64_ALPHABET.split('').map((c, i) => [c, i]));
function base64ToBytes(value: string): Uint8Array {
  const clean = value.replace(/\s+/g, '');
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((clean.length / 4) * 3 - padding);
  let offset = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const chunk = (BASE64_LOOKUP[clean[i]] << 18)
      | (BASE64_LOOKUP[clean[i + 1]] << 12)
      | ((clean[i + 2] === '=' ? 0 : BASE64_LOOKUP[clean[i + 2]]) << 6)
      | (clean[i + 3] === '=' ? 0 : BASE64_LOOKUP[clean[i + 3]]);
    if (offset < out.length) out[offset++] = (chunk >> 16) & 255;
    if (offset < out.length) out[offset++] = (chunk >> 8) & 255;
    if (offset < out.length) out[offset++] = chunk & 255;
  }
  return out;
}

function currentUserId(): string | null {
  return useAuthStore.getState().user?.id ?? null;
}

function scopedDeviceIdKey(): string {
  const userId = currentUserId();
  return userId ? accountDeviceIdKey(userId) : StorageKeys.deviceId;
}

function scopedDmPrivateKeyKey(): string {
  const userId = currentUserId();
  return userId ? accountDeviceDmPrivateKeyKey(userId) : StorageKeys.deviceDmPrivateKey;
}

function scopedNotificationPrivateKeyKey(): string {
  const userId = currentUserId();
  return userId ? accountDeviceNotificationPrivateKeyKey(userId) : StorageKeys.deviceNotificationPrivateKey;
}

async function resolveLegacyDeviceOwnerId(currentId: string): Promise<string | null> {
  const existing = await secureStorage.get(StorageKeys.deviceIdentityOwner);
  if (existing) {
    const legacyId = await secureStorage.get(StorageKeys.deviceIdentityLegacyDeviceId);
    if (!legacyId) {
      const currentLegacyId = await secureStorage.get(StorageKeys.deviceId)
        ?? await sharedNotificationPreviewStorage.get(StorageKeys.deviceId);
      if (currentLegacyId) await secureStorage.set(StorageKeys.deviceIdentityLegacyDeviceId, currentLegacyId);
    }
    return existing;
  }

  const accounts = useSavedAccountsStore.getState().accounts;
  const firstSavedAccountId = accounts[0]?.id;
  const ownerId = firstSavedAccountId ?? currentId;
  const legacyId = await secureStorage.get(StorageKeys.deviceId)
    ?? await sharedNotificationPreviewStorage.get(StorageKeys.deviceId);
  if (legacyId) await secureStorage.set(StorageKeys.deviceIdentityLegacyDeviceId, legacyId);
  await secureStorage.set(StorageKeys.deviceIdentityOwner, ownerId);
  return ownerId;
}

async function currentAccountCanUseLegacyDeviceIdentity(): Promise<boolean> {
  const userId = currentUserId();
  if (!userId) return true;
  return (await resolveLegacyDeviceOwnerId(userId)) === userId;
}

async function mirrorActiveDeviceIdentity(deviceId?: string, notificationPrivateKey?: Uint8Array): Promise<void> {
  if (deviceId) {
    await Promise.all([
      secureStorage.set(StorageKeys.deviceId, deviceId),
      sharedNotificationPreviewStorage.set(StorageKeys.deviceId, deviceId),
    ]);
  }
  if (notificationPrivateKey) {
    const encoded = bytesToBase64(notificationPrivateKey);
    await Promise.all([
      secureStorage.set(StorageKeys.deviceNotificationPrivateKey, encoded),
      sharedNotificationPreviewStorage.set(StorageKeys.deviceNotificationPrivateKey, encoded),
    ]);
  }
}

async function getOrCreatePrivateKey(storageKey: string, legacyStorageKey?: string, sharedStorageKey?: string): Promise<Uint8Array> {
  const existing = await secureStorage.get(storageKey);
  if (existing) return base64ToBytes(existing);
  const canUseLegacy = await currentAccountCanUseLegacyDeviceIdentity();
  const legacy = canUseLegacy && legacyStorageKey ? await secureStorage.get(legacyStorageKey) : null;
  const shared = canUseLegacy && sharedStorageKey ? await sharedNotificationPreviewStorage.get(sharedStorageKey) : null;
  const next = legacy ?? shared ?? bytesToBase64(getRandomBytes(32));
  await secureStorage.set(storageKey, next);
  return base64ToBytes(next);
}

async function rotateCurrentAccountDeviceIdentity(): Promise<string> {
  const userId = currentUserId();
  if (!userId) return randomUUID();
  await clearConversationSecretsForAccount(userId);
  const deviceId = randomUUID();
  const dmPrivateKey = getRandomBytes(32);
  const notificationPrivateKey = getRandomBytes(32);
  await Promise.all([
    secureStorage.set(accountDeviceIdKey(userId), deviceId),
    secureStorage.set(accountDeviceDmPrivateKeyKey(userId), bytesToBase64(dmPrivateKey)),
    secureStorage.set(accountDeviceNotificationPrivateKeyKey(userId), bytesToBase64(notificationPrivateKey)),
    secureStorage.set(StorageKeys.deviceDmPrivateKey, bytesToBase64(dmPrivateKey)),
  ]);
  await mirrorActiveDeviceIdentity(deviceId, notificationPrivateKey);
  return deviceId;
}

async function getOrCreateDevicePrivateKey(storageKey: string, legacyStorageKey: string): Promise<Uint8Array> {
  const key = await getOrCreatePrivateKey(storageKey, legacyStorageKey);
  if (storageKey !== legacyStorageKey) await secureStorage.set(legacyStorageKey, bytesToBase64(key));
  return key;
}

async function getOrCreateNotificationPrivateKey(): Promise<Uint8Array> {
  const storageKey = scopedNotificationPrivateKeyKey();
  const next = await getOrCreatePrivateKey(
    storageKey,
    storageKey === StorageKeys.deviceNotificationPrivateKey ? undefined : StorageKeys.deviceNotificationPrivateKey,
    StorageKeys.deviceNotificationPrivateKey,
  );
  await mirrorActiveDeviceIdentity(undefined, next);
  return next;
}

async function getOrCreateDmPrivateKey(): Promise<Uint8Array> {
  return getOrCreateDevicePrivateKey(scopedDmPrivateKeyKey(), StorageKeys.deviceDmPrivateKey);
}

async function postDeviceRegistration(expectedUserId: string): Promise<string> {
  const deviceId = await getLocalDeviceId();
  const [dmPrivateKey, notificationPrivateKey] = await Promise.all([
    getOrCreateDmPrivateKey(),
    getOrCreateNotificationPrivateKey(),
  ]);
  if (currentUserId() !== expectedUserId) throw new Error('Account changed during device registration');
  await createAuthenticatedApi().post('/api/devices/register', {
    deviceId,
    deviceName: Platform.OS === 'ios' ? 'iPhone / iPad' : 'Android device',
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    dmPublicKey: bytesToBase64(x25519.getPublicKey(dmPrivateKey)),
    notificationPublicKey: bytesToBase64(x25519.getPublicKey(notificationPrivateKey)),
  });
  if (currentUserId() !== expectedUserId) throw new Error('Account changed during device registration');
  return deviceId;
}

function isDeviceIdReuseError(error: unknown): boolean {
  const response = (error as { response?: { status?: number; data?: { error?: unknown; message?: unknown } } })?.response;
  if (response?.status !== 409) return false;
  const message = String(response.data?.error ?? response.data?.message ?? '').toLowerCase();
  return message.includes('device id') && message.includes('registered');
}

async function getOrCreateSharedNotificationPrivateKey(): Promise<Uint8Array> {
  return getOrCreateNotificationPrivateKey();
}

async function getOrCreateDeviceId(): Promise<string> {
  const storageKey = scopedDeviceIdKey();
  const existing = await secureStorage.get(storageKey);
  const canUseLegacy = await currentAccountCanUseLegacyDeviceIdentity();
  const legacyDeviceId = await secureStorage.get(StorageKeys.deviceIdentityLegacyDeviceId);
  if (existing && !canUseLegacy && existing === legacyDeviceId) {
    return rotateCurrentAccountDeviceIdentity();
  }
  if (existing) {
    await mirrorActiveDeviceIdentity(existing);
    return existing;
  }
  const currentGlobalDeviceId = await secureStorage.get(StorageKeys.deviceId);
  const legacy = canUseLegacy && storageKey !== StorageKeys.deviceId ? legacyDeviceId : null;
  const shared = canUseLegacy ? currentGlobalDeviceId ?? await sharedNotificationPreviewStorage.get(StorageKeys.deviceId) : null;
  const id = legacy ?? shared ?? randomUUID();
  await secureStorage.set(storageKey, id);
  await mirrorActiveDeviceIdentity(id);
  return id;
}

async function resetUnscopedDeviceId(id: string): Promise<void> {
  await Promise.all([
    secureStorage.set(StorageKeys.deviceId, id),
    sharedNotificationPreviewStorage.set(StorageKeys.deviceId, id),
  ]);
}

async function getOrCreateUnscopedPrivateKey(storageKey: string): Promise<Uint8Array> {
  const existing = await secureStorage.get(storageKey);
  if (existing) return base64ToBytes(existing);
  const next = getRandomBytes(32);
  await secureStorage.set(storageKey, bytesToBase64(next));
  return next;
}

export async function getLocalDeviceId(): Promise<string> {
  return getOrCreateDeviceId();
}

// Registration is idempotent server-side but each call is a real POST that
// counts against the (small) profile/devices rate bucket — and key-recovery
// paths call this once per conversation. Deduplicate concurrent calls and
// skip entirely while a recent registration is still fresh.
const registrationPromises = new Map<string, Promise<string>>();
let registeredAt = 0;
let registeredForUser: string | null = null;
const REGISTRATION_TTL_MS = 5 * 60 * 1000;

export async function registerCurrentDevice(): Promise<string> {
  const userId = currentUserId();
  if (!userId) throw new Error('No active account for device registration');
  const pending = registrationPromises.get(userId);
  if (pending) return pending;
  if (registeredForUser === userId && Date.now() - registeredAt < REGISTRATION_TTL_MS) {
    return getLocalDeviceId();
  }
  const task = (async () => {
    try {
      let id: string;
      try {
        id = await postDeviceRegistration(userId);
      } catch (error) {
        if (!isDeviceIdReuseError(error)) throw error;
        if (currentUserId() !== userId) throw new Error('Account changed during device registration');
        const nextDeviceId = await rotateCurrentAccountDeviceIdentity();
        await resetUnscopedDeviceId(nextDeviceId);
        id = await postDeviceRegistration(userId);
      }
      registeredAt = Date.now();
      registeredForUser = userId;
      return id;
    } finally {
      registrationPromises.delete(userId);
    }
  })();
  registrationPromises.set(userId, task);
  return task;
}

export async function getLocalDmPrivateKey(): Promise<Uint8Array> {
  return currentUserId()
    ? getOrCreateDmPrivateKey()
    : getOrCreateUnscopedPrivateKey(StorageKeys.deviceDmPrivateKey);
}

export async function getLocalNotificationPrivateKey(): Promise<Uint8Array> {
  return getOrCreateSharedNotificationPrivateKey();
}
