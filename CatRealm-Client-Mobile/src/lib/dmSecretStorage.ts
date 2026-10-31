import AsyncStorage from '@react-native-async-storage/async-storage';
import { secureStorage } from '@/lib/storage';

const SECRET_PREFIX = 'catrealm.dm-conversation-secret.';
const INDEX_PREFIX = 'catrealm.dm-conversation-secret-index.';
const UNSCOPED_SECRET_KEY = /^catrealm\.dm-conversation-secret\.[^.]+\.\d+$/;
const pending = new Map<string, Promise<unknown>>();

function scopedKey(userId: string, deviceId: string, conversationId: string, keyVersion: number): string {
  return `${SECRET_PREFIX}${userId}.${deviceId}.${conversationId}.${keyVersion}`;
}

function indexKey(userId: string): string {
  return `${INDEX_PREFIX}${userId}`;
}

function queueForAccount<T>(userId: string, operation: () => Promise<T>): Promise<T> {
  const previous = pending.get(userId) ?? Promise.resolve();
  const task = previous.catch(() => {}).then(operation);
  const settled = task.then(() => {}, () => {});
  pending.set(userId, settled);
  void settled.then(() => {
    if (pending.get(userId) === settled) pending.delete(userId);
  });
  return task;
}

async function indexedKeys(userId: string): Promise<string[]> {
  try {
    const parsed: unknown = JSON.parse(await AsyncStorage.getItem(indexKey(userId)) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((key): key is string => typeof key === 'string' && key.startsWith(`${SECRET_PREFIX}${userId}.`))
      : [];
  } catch {
    return [];
  }
}

async function indexSecret(userId: string, key: string): Promise<void> {
  const keys = await indexedKeys(userId);
  if (!keys.includes(key)) await AsyncStorage.setItem(indexKey(userId), JSON.stringify([...keys, key]));
}

export async function saveConversationSecret(userId: string, deviceId: string, conversationId: string, keyVersion: number, secret: string): Promise<void> {
  await queueForAccount(userId, async () => {
    const key = scopedKey(userId, deviceId, conversationId, keyVersion);
    // Record the key name first: SecureStore cannot enumerate entries during
    // sign-out or device replacement. The index contains no secret material.
    await indexSecret(userId, key);
    await secureStorage.set(key, secret);
    await AsyncStorage.removeItem(`${SECRET_PREFIX}${userId}.${conversationId}.${keyVersion}`);
    await AsyncStorage.removeItem(`${SECRET_PREFIX}${conversationId}.${keyVersion}`);
  });
}

export async function getConversationSecret(userId: string, deviceId: string, conversationId: string, keyVersion: number): Promise<string | null> {
  const key = scopedKey(userId, deviceId, conversationId, keyVersion);
  const stored = await secureStorage.get(key);
  if (stored) return stored;

  return queueForAccount(userId, async () => {
    const current = await secureStorage.get(key);
    if (current) return current;
    const scopedPlaintextKey = `${SECRET_PREFIX}${userId}.${conversationId}.${keyVersion}`;
    const unscopedKey = `${SECRET_PREFIX}${conversationId}.${keyVersion}`;
    const legacy = await AsyncStorage.getItem(scopedPlaintextKey) ?? await AsyncStorage.getItem(unscopedKey);
    if (!legacy) return null;
    await indexSecret(userId, key);
    await secureStorage.set(key, legacy);
    await AsyncStorage.removeItem(scopedPlaintextKey);
    await AsyncStorage.removeItem(unscopedKey);
    return legacy;
  });
}

export async function clearConversationSecretsForAccount(userId: string): Promise<void> {
  await queueForAccount(userId, async () => {
    const keys = await indexedKeys(userId);
    await Promise.all(keys.map(key => secureStorage.remove(key)));
    const allPlaintextKeys = await AsyncStorage.getAllKeys();
    const plaintextKeys = allPlaintextKeys.filter(key =>
      key.startsWith(`${SECRET_PREFIX}${userId}.`) || UNSCOPED_SECRET_KEY.test(key));
    await AsyncStorage.multiRemove([...plaintextKeys, indexKey(userId)]);
  });
}
