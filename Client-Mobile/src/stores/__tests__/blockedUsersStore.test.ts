jest.mock('@/stores/authStore', () => ({ useAuthStore: { getState: () => mockAuth } }));
jest.mock('@/lib/api', () => ({ createAuthenticatedApi: () => mockApi }));
jest.mock('@react-native-async-storage/async-storage', () => ({ setItem: jest.fn(async () => {}), getItem: jest.fn(async () => null) }));

import { useBlockedUsersStore } from '../blockedUsersStore';
import AsyncStorage from '@react-native-async-storage/async-storage';

let mockAuth = { user: { id: 'A', accountType: 'central' }, token: 'token-A', syncKey: 'key-A' };
const mockApi = { get: jest.fn(), post: jest.fn(), delete: jest.fn() };
beforeEach(() => {
  jest.clearAllMocks();
  mockAuth = { user: { id: 'A', accountType: 'central' }, token: 'token-A', syncKey: 'key-A' };
  useBlockedUsersStore.setState({ blockedUsers: new Set() });
});
test('reads the actual blockedUsers response envelope', async () => {
  mockApi.get.mockResolvedValueOnce({ data: { blockedUsers: [{ id: 'blocked' }] } });
  await useBlockedUsersStore.getState().fetchFromApi();
  expect(useBlockedUsersStore.getState().isBlocked('blocked')).toBe(true);
  expect(AsyncStorage.setItem).toHaveBeenCalledWith('catrealm-blocked-users:A', '["blocked"]');
});
test('a failed block does not pretend to succeed locally', async () => {
  mockApi.post.mockRejectedValueOnce(new Error('offline'));
  await expect(useBlockedUsersStore.getState().blockUser('blocked')).rejects.toThrow('offline');
  expect(useBlockedUsersStore.getState().isBlocked('blocked')).toBe(false);
});
test('block/unblock are saved to Central', async () => {
  await useBlockedUsersStore.getState().blockUser('blocked');
  expect(mockApi.post).toHaveBeenCalledWith('/api/profile/block/blocked');
  await useBlockedUsersStore.getState().unblockUser('blocked');
  expect(mockApi.delete).toHaveBeenCalledWith('/api/profile/block/blocked');
  expect(useBlockedUsersStore.getState().isBlocked('blocked')).toBe(false);
});
test('late blocked-list responses cannot populate another account', async () => {
  let finish!: (value: unknown) => void;
  mockApi.get.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const pending = useBlockedUsersStore.getState().fetchFromApi();
  mockAuth = { user: { id: 'B', accountType: 'central' }, token: 'token-B', syncKey: 'key-B' };
  finish({ data: { blockedUsers: [{ id: 'blocked' }] } });
  await pending;
  expect(useBlockedUsersStore.getState().blockedUsers.size).toBe(0);
});
