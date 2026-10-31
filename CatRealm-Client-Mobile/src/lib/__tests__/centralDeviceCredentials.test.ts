jest.mock('@/lib/storage', () => {
  const values = new Map<string, string>();
  return {
    StorageKeys: { savedAccountsList: 'saved-accounts' },
    accountCentralDeviceSecretKey: (id: string) => `secret.${id}`,
    accountDeviceIdKey: (id: string) => `device.${id}`,
    accountDeviceDmPrivateKeyKey: (id: string) => `dm.${id}`,
    accountDeviceNotificationPrivateKeyKey: (id: string) => `notification.${id}`,
    secureStorage: {
      get: async (key: string) => values.get(key) ?? null,
      set: async (key: string, value: string) => { values.set(key, value); },
      remove: async (key: string) => { values.delete(key); },
    },
  };
});
jest.mock('@react-native-async-storage/async-storage', () => {
  const keys = new Set<string>();
  return { __esModule: true, default: {
    getItem: jest.fn(async () => null),
    getAllKeys: async () => [...keys],
    multiRemove: async (removed: string[]) => { removed.forEach(key => keys.delete(key)); },
  } };
});
jest.mock('expo-crypto', () => {
  let sequence = 0;
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA256' },
    digestStringAsync: async (_algorithm: string, value: string) => `hash-${value}`,
    getRandomBytes: (count: number) => new Uint8Array(count).fill(++sequence),
    randomUUID: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
  };
});

import { secureStorage } from '@/lib/storage';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  adoptCentralSessionDevice,
  centralDeviceHeaders,
  forgetCentralLoginDeviceCredentials,
  getCentralDeviceHeadersForUser,
  getCentralLoginDeviceCredentials,
} from '../centralDeviceCredentials';

const tokenFor = (deviceId: string) => `header.${btoa(JSON.stringify({ did: deviceId })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.signature`;

test('Central login keeps a stable device ID and independent secret per username', async () => {
  const [first, concurrent] = await Promise.all([
    getCentralLoginDeviceCredentials('Alice'), getCentralLoginDeviceCredentials('alice'),
  ]);
  const second = await getCentralLoginDeviceCredentials('ALICE');
  const other = await getCentralLoginDeviceCredentials('Bob');
  expect(first).toEqual(concurrent);
  expect(second).toEqual(first);
  expect(other.deviceId).not.toBe(first.deviceId);
  expect(other.deviceSecret).not.toBe(first.deviceSecret);
  expect(first.deviceSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(centralDeviceHeaders(first)).toEqual({
    'X-CatRealm-Device-Id': first.deviceId,
    'X-CatRealm-Device-Secret': first.deviceSecret,
  });
});

test('an existing Mobile account keeps its registered device identity and encryption keys', async () => {
  const oldId = '22222222-2222-4222-8222-222222222222';
  jest.mocked(AsyncStorage.getItem).mockResolvedValueOnce(JSON.stringify([
    { id: 'user-old', username: 'Old', accountType: 'central' },
  ]));
  await secureStorage.set('device.user-old', oldId);
  await secureStorage.set('dm.user-old', 'existing-key');
  const credentials = await getCentralLoginDeviceCredentials('Old');
  expect(credentials.deviceId).toBe(oldId);
  await adoptCentralSessionDevice('user-old', 'Old', tokenFor(oldId), credentials);
  expect(await secureStorage.get('dm.user-old')).toBe('existing-key');
  await forgetCentralLoginDeviceCredentials('Old');
  expect((await getCentralLoginDeviceCredentials('Old')).deviceId).not.toBe(oldId);
});

test('adopts Central assigned device ID and reuses its secret for authenticated requests', async () => {
  const credentials = await getCentralLoginDeviceCredentials('Cat');
  const assignedId = '11111111-1111-4111-8111-111111111111';
  await adoptCentralSessionDevice('user-cat', 'Cat', tokenFor(assignedId), credentials);
  expect(await getCentralDeviceHeadersForUser('user-cat')).toEqual({
    'X-CatRealm-Device-Id': assignedId,
    'X-CatRealm-Device-Secret': credentials.deviceSecret,
  });
  expect((await getCentralLoginDeviceCredentials('Cat')).deviceId).toBe(assignedId);
  expect(await getCentralDeviceHeadersForUser('other-user')).toEqual({});
});

test('a replacement device drops old encryption keys and rejects a session without device identity', async () => {
  const credentials = await getCentralLoginDeviceCredentials('Changed');
  await secureStorage.set('device.user-changed', '22222222-2222-4222-8222-222222222222');
  await secureStorage.set('dm.user-changed', 'old-key');
  await secureStorage.set('notification.user-changed', 'old-key');
  await expect(adoptCentralSessionDevice('user-changed', 'Changed', tokenFor(''), credentials))
    .rejects.toThrow('device-bound session');
  expect(await secureStorage.get('dm.user-changed')).toBe('old-key');
  await adoptCentralSessionDevice('user-changed', 'Changed', tokenFor(credentials.deviceId), credentials);
  expect(await secureStorage.get('dm.user-changed')).toBeNull();
  expect(await secureStorage.get('notification.user-changed')).toBeNull();
});
