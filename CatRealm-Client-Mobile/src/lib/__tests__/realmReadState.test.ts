const mockGet = jest.fn();
const mockPatch = jest.fn();
const mockFetchMessages = jest.fn();

jest.mock('@/lib/api', () => ({ createApi: () => ({ get: mockGet, patch: mockPatch }) }));
jest.mock('@/stores/messageStore', () => ({ useMessageStore: { getState: () => ({ fetchMessages: mockFetchMessages }) } }));
jest.mock('@react-native-async-storage/async-storage', () => ({ setItem: jest.fn(), getItem: jest.fn() }));
jest.mock('@/stores/authStore', () => ({ useAuthStore: { getState: () => ({ user: null }) } }));

import { useChannelStore } from '@/stores/channelStore';
import {
  markRealmChannelRead,
  recountRealmUnread,
  syncActiveRealmReadState,
  syncRealmUnreadCounts,
  useRealmUnreadStore,
} from '@/lib/realmReadState';

const realm = { serverUrl: 'https://realm.example', token: 't' };
const state = (unread: boolean, muted = false) => ({ lastMessageAt: 10, lastReadAt: 0, muted, unread });

beforeEach(() => {
  jest.clearAllMocks();
  mockPatch.mockResolvedValue({});
  useChannelStore.setState({ activeChannelId: 'open', unreadByChannel: { read: 4 } });
});

test('active realm: highlights unread channels, clears read ones, preloads them', async () => {
  mockGet.mockResolvedValue({ data: { channels: { a: state(true), b: state(true, true), open: state(true), read: state(false) } } });
  await syncActiveRealmReadState(realm);

  // Muted and currently-open channels stay unhighlighted; a channel read elsewhere clears.
  expect(useChannelStore.getState().unreadByChannel).toEqual({ a: 1, b: 0, open: 0, read: 0 });
  expect(useRealmUnreadStore.getState().byServer[realm.serverUrl]).toBe(1);
  expect(mockFetchMessages).toHaveBeenCalledWith('a', undefined, realm);
  expect(mockFetchMessages).toHaveBeenCalledTimes(1);

  // Leaving after reading it locally recounts without a request.
  useChannelStore.getState().resetCounts('a');
  recountRealmUnread(realm.serverUrl);
  expect(useRealmUnreadStore.getState().byServer[realm.serverUrl]).toBe(0);
});

test("active realm: shows each channel's unread message count from the realm", async () => {
  const counted = (unreadCount: number) => ({ ...state(true), unreadCount });
  useChannelStore.setState({ activeChannelId: 'open', unreadByChannel: { live: 12 } });
  mockGet.mockResolvedValue({ data: { channels: { many: counted(100), few: counted(3), live: counted(5), flagOnly: state(true) } } });
  await syncActiveRealmReadState(realm);

  // A higher live count wins; a realm without counts still shows the channel as unread.
  expect(useChannelStore.getState().unreadByChannel).toEqual({ many: 100, few: 3, live: 12, flagOnly: 1 });
});

test('other realms: counted, throttled, and skipped once a realm 404s', async () => {
  const other = { serverUrl: 'https://other.example', token: 't' };
  const old = { serverUrl: 'https://old.example', token: 't' };
  mockGet.mockResolvedValue({ data: { channels: { x: state(true), y: state(true), z: state(false) } } });
  await syncRealmUnreadCounts([other]);
  await syncRealmUnreadCounts([other]);
  expect(mockGet).toHaveBeenCalledTimes(1);
  expect(useRealmUnreadStore.getState().byServer[other.serverUrl]).toBe(2);

  mockGet.mockRejectedValue({ response: { status: 404 } });
  await syncActiveRealmReadState(old);
  await syncActiveRealmReadState(old);
  expect(mockGet).toHaveBeenCalledTimes(2);
});

test('marking read writes the read position to the realm', () => {
  markRealmChannelRead(realm, 'a');
  expect(mockPatch).toHaveBeenCalledWith('/api/channels/a/prefs', { lastReadAt: expect.any(Number) });
});
