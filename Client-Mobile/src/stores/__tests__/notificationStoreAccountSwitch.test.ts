jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn(async () => {}), removeItem: jest.fn(async () => {}) },
}));
jest.mock('@/stores/authStore', () => ({ useAuthStore: { getState: () => mockAuthState } }));
jest.mock('@/lib/api', () => ({ createAuthenticatedApi: () => ({ get: mockApiGet }) }));
jest.mock('@/lib/deviceIdentity', () => ({ getLocalDeviceId: async () => 'device-id' }));
jest.mock('@/lib/notificationPreviewCrypto', () => ({ decryptNotificationPreviewEnvelope: jest.fn() }));
jest.mock('@/stores/dmStore', () => ({ useDMStore: { getState: () => ({ messages: {}, applyUnreadSummary: jest.fn() }) } }));
jest.mock('@/stores/serverStore', () => ({ useServerStore: { getState: () => ({ activeServerId: null, applyCentralMentionSummary: jest.fn() }) } }));
jest.mock('@/stores/channelStore', () => ({ useChannelStore: { getState: () => ({ applyMentionSummary: jest.fn() }) } }));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { invalidateAccountSession } from '@/lib/accountSession';
import { resetNotificationCache, useNotificationStore } from '../notificationStore';

let mockAuthState = { user: { id: 'account-a' }, token: 'token-a', syncKey: null };
const mockApiGet = jest.fn(async () => { throw new Error('offline'); });
const cachedNotification = (id: string) => ({
  id,
  type: 'friend_request',
  requestId: id,
  fromUserId: id,
  fromUsername: id,
  fromAvatar: null,
  timestamp: Date.now(),
  read: false,
});

beforeEach(() => {
  invalidateAccountSession();
  resetNotificationCache();
  mockAuthState = { user: { id: 'account-a' }, token: 'token-a', syncKey: null };
  useNotificationStore.setState({ items: [], summary: null, loaded: false });
  jest.mocked(AsyncStorage.getItem).mockReset();
  mockApiGet.mockClear();
});

test('offline inbox cache never shows another account’s notifications', async () => {
  jest.mocked(AsyncStorage.getItem).mockImplementation(async (key) =>
    key === 'catrealm:notifications:v2:account-a'
      ? JSON.stringify([cachedNotification('from-a')])
      : null,
  );
  await useNotificationStore.getState().load();
  expect(useNotificationStore.getState().items.map((item) => item.id)).toEqual(['from-a']);

  invalidateAccountSession();
  resetNotificationCache();
  mockAuthState = { user: { id: 'account-b' }, token: 'token-b', syncKey: null };
  useNotificationStore.setState({ items: [], summary: null, loaded: false });
  await useNotificationStore.getState().load();

  expect(useNotificationStore.getState().items).toEqual([]);
  expect(AsyncStorage.getItem).toHaveBeenCalledWith('catrealm:notifications:v2:account-b');
});

test('an old cache read cannot restore notifications after the account changes', async () => {
  let releaseOldRead!: (value: string) => void;
  let oldReadStarted!: () => void;
  const started = new Promise<void>((resolve) => { oldReadStarted = resolve; });
  jest.mocked(AsyncStorage.getItem).mockImplementation((key) => {
    if (key === 'catrealm:notifications:v2:account-a') {
      oldReadStarted();
      return new Promise<string>((resolve) => { releaseOldRead = resolve; });
    }
    return Promise.resolve(null);
  });
  const oldLoad = useNotificationStore.getState().load();
  await started;

  invalidateAccountSession();
  resetNotificationCache();
  mockAuthState = { user: { id: 'account-b' }, token: 'token-b', syncKey: null };
  useNotificationStore.setState({ items: [], summary: null, loaded: false });
  await useNotificationStore.getState().load();
  releaseOldRead(JSON.stringify([cachedNotification('late-a')]));
  await oldLoad;

  expect(useNotificationStore.getState().items).toEqual([]);
});
