jest.mock('@/stores/authStore', () => ({ useAuthStore: { getState: () => mockAuth } }));
jest.mock('@/lib/api', () => ({ createAuthenticatedApi: () => mockApi, setActiveServerGetter: jest.fn(), confirmOrExpireCentralSession: jest.fn() }));
jest.mock('@/lib/debugLog', () => ({ debugLog: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => ({ multiSet: jest.fn(async () => {}), getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}) }));
jest.mock('@/lib/guardedServerSync', () => ({ syncGuardedServerList: (...args: unknown[]) => mockSync(...args), readServerList: jest.fn() }));

import { cancelPendingServerSync, useServerStore } from '../serverStore';
import { invalidateAccountSession } from '@/lib/accountSession';
import type { MobileServer } from '../serverStore';

let mockAuth = { user: { id: 'A', accountType: 'central' }, token: 'token-A', syncKey: 'key-A' };
const mockApi = { post: jest.fn(async () => ({})), get: jest.fn() };
const mockSync = jest.fn(async (..._args: unknown[]) => true);
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  cancelPendingServerSync();
  invalidateAccountSession();
  mockAuth = { user: { id: 'A', accountType: 'central' }, token: 'token-A', syncKey: 'key-A' };
  useServerStore.setState({ servers: [], rawSyncedServers: [{ name: 'Realm A', url: 'https://realm-A.invalid', token: 'secret-A' }], serverLayout: [], serverFolders: [] });
});
afterEach(() => { cancelPendingServerSync(); jest.useRealTimers(); });

test('a queued list from A is never encrypted or submitted as B', async () => {
  useServerStore.getState().reorderLayout([]);
  mockAuth = { user: { id: 'B', accountType: 'central' }, token: 'token-B', syncKey: 'key-B' };
  jest.advanceTimersByTime(2000);
  await flush();
  expect(mockSync).not.toHaveBeenCalled();
  expect(mockApi.post).not.toHaveBeenCalled();
});
test('normal account-scoped sync still works', async () => {
  useServerStore.getState().reorderLayout([]);
  jest.advanceTimersByTime(2000);
  await flush();
  expect(mockSync).toHaveBeenCalledWith(mockApi, expect.objectContaining({ servers: [{ name: 'Realm A', url: 'https://realm-A.invalid', token: 'secret-A' }] }), 'key-A', [], expect.any(Function));
  expect(mockSync).toHaveBeenCalledTimes(1);
});
test('reset invalidates pending work even for the same credentials', async () => {
  useServerStore.getState().reorderLayout([]);
  invalidateAccountSession();
  jest.advanceTimersByTime(2000);
  await flush();
  expect(mockApi.post).not.toHaveBeenCalled();
});
test('late fetch after switching accounts does not clear the new list', async () => {
  let resolve!: (data: unknown) => void;
  mockApi.get.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
  const pending = useServerStore.getState().fetchServersForCentral();
  mockAuth = { user: { id: 'B', accountType: 'central' }, token: 'token-B', syncKey: 'key-B' };
  useServerStore.setState({ serverSyncStatus: 'ready' });
  resolve({ data: { payload: null, iv: null } });
  await pending;
  expect(useServerStore.getState().serverSyncStatus).toBe('ready');
});

function seedFolders() {
  const servers = ['a', 'b', 'c'].map((id): MobileServer => ({
    id, url: id, name: id, token: '', membersOnline: 0, unread: 0, mention: 0,
  }));
  useServerStore.setState({
    servers,
    serverLayout: [{ type: 'folder', folderId: 'old' }, { type: 'server', url: 'c' }],
    serverFolders: [{ id: 'old', name: 'Old', color: '#5865F2', isOpen: true, serverUrls: ['a', 'b'] }],
  });
}

test('creating a folder moves grouped servers once and retains unselected members', () => {
  seedFolders();
  const id = useServerStore.getState().createFolder(['a', 'a', 'c'], 'New');
  const state = useServerStore.getState();
  expect(state.serverFolders.find((f) => f.id === 'old')?.serverUrls).toEqual(['b']);
  expect(state.serverFolders.find((f) => f.id === id)?.serverUrls).toEqual(['a', 'c']);
  expect(state.serverLayout).toEqual([{ type: 'folder', folderId: 'old' }, { type: 'folder', folderId: id }]);
});

test('moving every member into a new folder replaces the emptied folder in place', () => {
  seedFolders();
  const id = useServerStore.getState().createFolder(['a', 'b'], 'New');
  expect(useServerStore.getState().serverFolders.map((f) => f.id)).toEqual([id]);
  expect(useServerStore.getState().serverLayout).toEqual([{ type: 'folder', folderId: id }, { type: 'server', url: 'c' }]);
});

test('moves between folders and removal preserve every server', () => {
  seedFolders();
  const id = useServerStore.getState().createFolder(['c'], 'New');
  useServerStore.getState().addServerToFolder('a', id);
  useServerStore.getState().addServerToFolder('b', id);
  expect(useServerStore.getState().serverFolders).toHaveLength(1);
  expect(useServerStore.getState().serverFolders[0].serverUrls).toEqual(['c', 'a', 'b']);
  useServerStore.getState().removeServerFromFolder('a', id);
  expect(useServerStore.getState().serverLayout).toContainEqual({ type: 'server', url: 'a' });
  useServerStore.getState().deleteFolder(id);
  expect(useServerStore.getState().serverFolders).toEqual([]);
  expect(useServerStore.getState().serverLayout).toEqual([
    { type: 'server', url: 'c' }, { type: 'server', url: 'b' }, { type: 'server', url: 'a' },
  ]);
});

test('stale folder actions and empty selections cannot lose or duplicate servers', () => {
  seedFolders();
  const before = useServerStore.getState();
  useServerStore.getState().addServerToFolder('a', 'deleted-folder');
  useServerStore.getState().addServerToFolder('deleted-server', 'old');
  useServerStore.getState().removeServerFromFolder('c', 'old');
  expect(useServerStore.getState().createFolder(['deleted-server'], 'New')).toBe('');
  expect(useServerStore.getState().serverLayout).toEqual(before.serverLayout);
  expect(useServerStore.getState().serverFolders).toEqual(before.serverFolders);
});

test('folder edits are included in the encrypted account-scoped sync', async () => {
  seedFolders();
  const id = useServerStore.getState().createFolder(['a', 'c'], 'Friends');
  jest.advanceTimersByTime(2000);
  await flush();
  expect(mockSync).toHaveBeenCalledWith(mockApi, expect.objectContaining({
    folders: expect.arrayContaining([expect.objectContaining({ id, name: 'Friends', serverUrls: ['a', 'c'] })]),
  }), 'key-A', [], expect.any(Function));
});
