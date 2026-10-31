const mockPlain = new Map<string, string>();
const mockSecure = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => mockPlain.get(key) ?? null,
    setItem: async (key: string, value: string) => { mockPlain.set(key, value); },
    removeItem: async (key: string) => { mockPlain.delete(key); },
    getAllKeys: async () => [...mockPlain.keys()],
    multiRemove: async (keys: string[]) => { keys.forEach(key => mockPlain.delete(key)); },
  },
}));
jest.mock('@/lib/storage', () => ({
  secureStorage: {
    get: async (key: string) => mockSecure.get(key) ?? null,
    set: async (key: string, value: string) => { mockSecure.set(key, value); },
    remove: async (key: string) => { mockSecure.delete(key); },
  },
}));

import { clearConversationSecretsForAccount, getConversationSecret, saveConversationSecret } from '../dmSecretStorage';

const key = (user: string, device: string, conversation: string, version: number) =>
  `catrealm.dm-conversation-secret.${user}.${device}.${conversation}.${version}`;

beforeEach(() => { mockPlain.clear(); mockSecure.clear(); });

test('stores conversation secrets in secure storage and indexes only their names', async () => {
  await saveConversationSecret('alice', 'device-a', 'conversation', 2, 'secret-value');
  expect(mockSecure.get(key('alice', 'device-a', 'conversation', 2))).toBe('secret-value');
  expect(mockPlain.get(key('alice', 'device-a', 'conversation', 2))).toBeUndefined();
  expect([...mockPlain.values()].join(' ')).not.toContain('secret-value');
  await expect(getConversationSecret('alice', 'device-a', 'conversation', 2)).resolves.toBe('secret-value');
  await expect(getConversationSecret('alice', 'device-b', 'conversation', 2)).resolves.toBeNull();
  await expect(getConversationSecret('bob', 'device-a', 'conversation', 2)).resolves.toBeNull();
});

test('migrates a previous plaintext secret then deletes its old copies', async () => {
  const scoped = 'catrealm.dm-conversation-secret.alice.conversation.1';
  const unscoped = 'catrealm.dm-conversation-secret.conversation.1';
  mockPlain.set(scoped, 'old-secret');
  mockPlain.set(unscoped, 'old-secret');
  await expect(getConversationSecret('alice', 'device-a', 'conversation', 1)).resolves.toBe('old-secret');
  expect(mockSecure.get(key('alice', 'device-a', 'conversation', 1))).toBe('old-secret');
  expect(mockPlain.has(scoped)).toBe(false);
  expect(mockPlain.has(unscoped)).toBe(false);
});

test('sign-out and device rotation clear secure and legacy keys for only that account', async () => {
  await saveConversationSecret('alice', 'device-a', 'one', 1, 'alice-secret');
  await saveConversationSecret('bob', 'device-b', 'two', 1, 'bob-secret');
  mockPlain.set('catrealm.dm-conversation-secret.alice.old.1', 'legacy-secret');
  mockPlain.set('catrealm.dm-conversation-secret.older-conversation.1', 'unscoped-secret');
  await clearConversationSecretsForAccount('alice');
  expect(mockSecure.has(key('alice', 'device-a', 'one', 1))).toBe(false);
  expect(mockPlain.has('catrealm.dm-conversation-secret.alice.old.1')).toBe(false);
  expect(mockPlain.has('catrealm.dm-conversation-secret.older-conversation.1')).toBe(false);
  expect(mockSecure.get(key('bob', 'device-b', 'two', 1))).toBe('bob-secret');
});
