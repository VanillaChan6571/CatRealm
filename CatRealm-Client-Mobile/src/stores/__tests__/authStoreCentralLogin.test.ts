jest.mock('@/lib/storage', () => {
  const values = new Map<string, string>();
  return {
    StorageKeys: {
      authToken: 'auth-token', authUser: 'auth-user', syncKey: 'sync-key',
      activeServerUrl: 'active-server',
      savedAccountsList: 'saved-accounts',
      pushToken: 'push-token', voipPushToken: 'voip-push-token',
    },
    accountTokenKey: (id: string) => `token.${id}`,
    accountUserKey: (id: string) => `user.${id}`,
    accountSyncKeyKey: (id: string) => `sync.${id}`,
    accountServerUrlKey: (id: string) => `server.${id}`,
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
jest.mock('expo-crypto', () => {
  let sequence = 0;
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA256' },
    digestStringAsync: async (_algorithm: string, value: string) => `hash-${value}`,
    getRandomBytes: (count: number) => new Uint8Array(count).fill(++sequence),
    randomUUID: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
  };
});
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true, default: { getItem: async () => null, getAllKeys: async () => [], multiRemove: async () => {} },
}));
jest.mock('axios', () => ({
  __esModule: true,
  default: { post: (...args: unknown[]) => mockPost(...args), get: (...args: unknown[]) => mockGet(...args), isAxiosError: () => false },
}));
jest.mock('@/lib/socket', () => ({ disconnectSocket: jest.fn() }));
jest.mock('@/lib/pushNotifications', () => ({ unregisterPushToken: jest.fn(), unregisterVoipPushToken: jest.fn() }));
jest.mock('@/lib/resetAllStores', () => ({ resetAllStores: jest.fn() }));
jest.mock('@/stores/savedAccountsStore', () => ({
  useSavedAccountsStore: { getState: () => ({
    accounts: [], addOrUpdate: async () => {}, remove: async () => {}, load: async () => {},
  }) },
}));

import { useAuthStore, fetchRegisterCaptchaConfig } from '../authStore';
import { getCentralDeviceHeadersForUser } from '@/lib/centralDeviceCredentials';
import { secureStorage } from '@/lib/storage';
import { unregisterPushToken, unregisterVoipPushToken } from '@/lib/pushNotifications';

const mockPost = jest.fn();
const mockGet = jest.fn();
const tokenFor = (deviceId: string) => `header.${btoa(JSON.stringify({ did: deviceId })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.signature`;

test('authenticator login and the paste shortcut use the same device-bound Central transport', async () => {
  mockPost.mockImplementation(async (_url: string, body: { username: string }, config: { headers: Record<string, string> }) => ({
    data: {
      token: tokenFor(config.headers['X-CatRealm-Device-Id']),
      user: { id: `id-${body.username}`, username: body.username },
      syncKey: 'synthetic-sync-key',
    },
  }));
  mockGet.mockResolvedValue({ data: { status: 'online' } });

  await useAuthStore.getState().centralLogin('alice', '123456');
  const login = mockPost.mock.calls[0];
  expect(login[0]).toBe('https://auth.catrealm.app/api/login');
  expect(login[2].headers).toMatchObject({
    'X-CatRealm-Client': 'mobile',
    'X-CatRealm-Device-Id': expect.stringMatching(/^[A-Za-z0-9_-]{16,128}$/),
    'X-CatRealm-Device-Secret': expect.stringMatching(/^[A-Za-z0-9_-]{43,128}$/),
  });
  expect(mockGet.mock.calls[0][1].headers).toMatchObject({
    'X-CatRealm-Device-Id': login[2].headers['X-CatRealm-Device-Id'],
    'X-CatRealm-Device-Secret': login[2].headers['X-CatRealm-Device-Secret'],
  });
  expect(await getCentralDeviceHeadersForUser('id-alice')).toEqual({
    'X-CatRealm-Device-Id': login[2].headers['X-CatRealm-Device-Id'],
    'X-CatRealm-Device-Secret': login[2].headers['X-CatRealm-Device-Secret'],
  });
  expect(useAuthStore.getState().error).toBeNull();
});

test('pre-upgrade saved Central sessions return to login instead of looping on 401', async () => {
  await secureStorage.set('auth-token', 'legacy-token');
  await secureStorage.set('auth-user', JSON.stringify({ id: 'legacy-user', username: 'legacy', accountType: 'central' }));
  await secureStorage.set('token.legacy-user', 'legacy-token');
  mockGet.mockClear();
  await useAuthStore.getState().hydrate();
  expect(useAuthStore.getState()).toMatchObject({ user: null, token: null, centralSessionExpired: true });
  expect(await secureStorage.get('auth-token')).toBeNull();
  expect(await secureStorage.get('token.legacy-user')).toBeNull();
  expect(mockGet).not.toHaveBeenCalled();
});

test('sign-out revokes the bound Central session before removing its device proof', async () => {
  mockPost.mockImplementation(async (url: string, body: { username: string } | null, config: { headers: Record<string, string> }) => {
    if (url.endsWith('/api/login/logout')) return { data: { success: true } };
    return { data: {
      token: tokenFor(config.headers['X-CatRealm-Device-Id']),
      user: { id: 'id-logout', username: body!.username },
    } };
  });
  mockGet.mockResolvedValue({ data: { status: 'online' } });

  await useAuthStore.getState().centralLogin('logout', '123456');
  const proof = await getCentralDeviceHeadersForUser('id-logout');
  await useAuthStore.getState().signOut();
  const logout = mockPost.mock.calls.find(([url]) => url === 'https://auth.catrealm.app/api/login/logout');
  expect(logout?.[2].headers).toMatchObject({
    Authorization: expect.stringMatching(/^Bearer /),
    ...proof,
  });
  expect(await getCentralDeviceHeadersForUser('id-logout')).toEqual({});
  expect(useAuthStore.getState().token).toBeNull();
});

test('saved-account switch holds the old session until the new one is ready and releases both push tokens', async () => {
  const oldUser = { id: 'id-old', username: 'old', accountType: 'central' as const };
  const newUser = { id: 'id-new', username: 'new', accountType: 'local' as const };
  useAuthStore.setState({ user: oldUser, token: 'old-token', accountSwitching: false });
  await Promise.all([
    secureStorage.set('token.id-new', 'new-token'),
    secureStorage.set('user.id-new', JSON.stringify(newUser)),
    secureStorage.set('push-token', 'expo-token'),
    secureStorage.set('voip-push-token', 'voip-token'),
  ]);
  let releaseUnregister!: () => void;
  let startedUnregister!: () => void;
  const unregisterStarted = new Promise<void>((resolve) => { startedUnregister = resolve; });
  jest.mocked(unregisterPushToken).mockImplementationOnce(() => {
    startedUnregister();
    return new Promise<void>((resolve) => { releaseUnregister = resolve; });
  });
  const seenUsers: Array<string | null> = [];
  const unsubscribe = useAuthStore.subscribe((state) => seenUsers.push(state.user?.id ?? null));

  const switching = useAuthStore.getState().switchToAccount(newUser.id);
  await unregisterStarted;
  expect(useAuthStore.getState().accountSwitching).toBe(true);
  useAuthStore.getState().expireCentralSession();
  expect(useAuthStore.getState().user?.id).toBe(oldUser.id);
  releaseUnregister();
  expect(await switching).toBeNull();
  unsubscribe();

  expect(unregisterPushToken).toHaveBeenCalledWith('expo-token');
  expect(unregisterVoipPushToken).toHaveBeenCalledWith('voip-token');
  expect(seenUsers).not.toContain(null);
  expect(useAuthStore.getState()).toMatchObject({ user: newUser, token: 'new-token', accountSwitching: false });
});

test('registration fetches the captcha config as mobile and sends the token to Central', async () => {
  mockGet.mockResolvedValueOnce({ data: { enabled: true, siteKey: 'site-key' } });
  await expect(fetchRegisterCaptchaConfig()).resolves.toEqual({ enabled: true, siteKey: 'site-key' });
  expect(mockGet).toHaveBeenLastCalledWith(expect.stringMatching(/\/api\/register\/hcaptcha-config$/),
    expect.objectContaining({ headers: { 'X-CatRealm-Client': 'mobile' } }));

  mockGet.mockResolvedValueOnce({ data: { enabled: true, siteKey: null } });
  await expect(fetchRegisterCaptchaConfig()).resolves.toEqual({ enabled: false, siteKey: null });
  mockGet.mockRejectedValueOnce(new Error('offline'));
  await expect(fetchRegisterCaptchaConfig()).resolves.toBeNull();

  mockPost.mockResolvedValueOnce({ data: { pendingId: 'p1', qrCode: 'qr', manualCode: 'm' } });
  await useAuthStore.getState().centralRegisterStart('Nya4', 'captcha-token');
  expect(mockPost).toHaveBeenLastCalledWith(expect.stringMatching(/\/api\/register\/start$/),
    expect.objectContaining({ username: 'Nya4', captchaToken: 'captcha-token', confirmAge18: true }), expect.anything());
  expect(useAuthStore.getState().centralRegPending).toEqual({ pendingId: 'p1', qrCode: 'qr', manualCode: 'm' });
});
