jest.mock('@/stores/authStore', () => ({ useAuthStore: { getState: () => mockAuth } }));
jest.mock('@/lib/api', () => ({
  AUTH_BASE: 'https://central.invalid',
  createAuthenticatedApi: () => ({
    get: (...args: unknown[]) => mockCentralGet(...args),
    post: (...args: unknown[]) => mockCentralPost(...args),
  }),
  setActiveServerGetter: jest.fn(),
  confirmOrExpireCentralSession: jest.fn(),
}));
jest.mock('@/lib/debugLog', () => ({ debugLog: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => ({ multiSet: jest.fn(async () => {}), getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}) }));
jest.mock('@/lib/guardedServerSync', () => ({ syncGuardedServerList: (...args: unknown[]) => mockSync(...args), readServerList: (...args: unknown[]) => mockReadServerList(...args) }));
jest.mock('axios', () => {
  const api = {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    isAxiosError: (error: { isAxiosError?: boolean }) => !!error?.isAxiosError,
  };
  return { __esModule: true, default: api, ...api };
});

import { cancelPendingServerSync, normalizeServerUrl, useServerStore } from '../serverStore';
import { invalidateAccountSession } from '@/lib/accountSession';

let mockAuth: { user: { id: string; accountType: string; avatar?: string | null; banner?: string | null } | null; token: string | null; syncKey: string | null };
const mockSync = jest.fn(async (..._args: unknown[]) => true);
const mockGet = jest.fn();
const mockPost = jest.fn();
const mockCentralPost = jest.fn();
const mockCentralGet = jest.fn();
const mockReadServerList = jest.fn();
const httpError = (status: number | null, data?: unknown) => Object.assign(new Error('http'), { isAxiosError: true, response: status ? { status, data } : undefined });
const REALM = 'https://realm.invalid';

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  cancelPendingServerSync();
  invalidateAccountSession();
  mockAuth = { user: { id: 'A', accountType: 'central', avatar: null, banner: null }, token: 'central-token', syncKey: 'key-A' };
  useServerStore.setState({
    servers: [], rawSyncedServers: [{ name: 'Old', url: 'https://old.invalid', token: 't' }],
    serverLayout: [{ type: 'server', url: 'https://old.invalid' }], serverFolders: [], activeServerId: null,
  });
  mockGet.mockImplementation(async (url: string) => {
    if (url === `${REALM}/api/server`) return { data: { name: 'Cozy Realm', serverIcon: '/uploads/icon.png', userCount: 12 } };
    if (url === `${REALM}/api/server/identity`) return { data: { realmInstanceId: 'r1', realmKeyFingerprint: 'fp' } };
    if (url === `${REALM}/api/profile/me`) return { data: {} };
    throw httpError(404);
  });
  mockPost.mockImplementation(async (url: string) => {
    if (url === `${REALM}/api/auth/central`) return { data: { token: 'realm-token' } };
    return { data: {} };
  });
  mockCentralPost.mockResolvedValue({ data: { token: 'realm-assertion', audience: REALM } });
  mockCentralGet.mockResolvedValue({ data: {} });
  mockReadServerList.mockResolvedValue({ servers: [{ url: REALM, name: 'Cozy Realm', token: 'old-realm-token' }] });
});
afterEach(() => { cancelPendingServerSync(); jest.useRealTimers(); });

test('addresses are normalised the way desktop stores them', () => {
  expect(normalizeServerUrl(' realm.invalid/ ')).toBe('https://realm.invalid');
  expect(normalizeServerUrl('http://lan.invalid:3000//')).toBe('http://lan.invalid:3000');
  expect(normalizeServerUrl('   ')).toBe('');
});

test('joining exchanges a realm assertion and never sends the Central session to the realm', async () => {
  const id = await useServerStore.getState().addServer('realm.invalid', { inviteCode: 'CODE1' });
  expect(id).toBe(REALM);
  expect(mockCentralPost).toHaveBeenCalledWith('/api/login/realm-assertion', { serverUrl: REALM });
  expect(mockPost).toHaveBeenCalledWith(`${REALM}/api/auth/central`, { token: 'realm-assertion', inviteCode: 'CODE1' }, expect.anything());
  const state = useServerStore.getState();
  // Same shape as realms loaded from Central: ServerIcon resolves the relative
  // icon against the realm URL; the synced entry carries the absolute one (desktop parity).
  expect(state.servers.find((s) => s.id === REALM)).toMatchObject({ name: 'Cozy Realm', token: 'realm-token', iconUrl: '/uploads/icon.png' });
  expect(state.rawSyncedServers.find((e) => e.url === REALM)?.icon).toBe(`${REALM}/uploads/icon.png`);
  expect(state.serverLayout).toEqual([{ type: 'server', url: 'https://old.invalid' }, { type: 'server', url: REALM }]);
  expect(state.activeServerId).toBe(REALM);
  // The new realm reaches Central with the existing ones, through the guarded sync.
  jest.advanceTimersByTime(2000);
  for (let i = 0; i < 5; i++) await Promise.resolve();
  expect(mockSync).toHaveBeenCalledTimes(1);
  const payload = mockSync.mock.calls[0][1] as { servers: { url: string; token: string }[] };
  expect(payload.servers.map((s) => s.url)).toEqual(['https://old.invalid', REALM]);
  expect(payload.servers[1].token).toBe('realm-token');
  // Realm identity is checked like any other synced realm.
  expect(mockGet).toHaveBeenCalledWith(`${REALM}/api/server/identity`, expect.anything());
});

test('Central accounts reject insecure realm addresses before exchanging credentials', async () => {
  mockGet.mockResolvedValueOnce({ data: { name: 'Insecure Realm' } });
  await expect(useServerStore.getState().addServer('http://realm.invalid')).rejects.toThrow('public HTTPS address');
  expect(mockCentralPost).not.toHaveBeenCalled();
  expect(mockPost).not.toHaveBeenCalled();
});

test('a mismatched Central assertion never reaches a realm', async () => {
  mockCentralPost.mockResolvedValueOnce({ data: { token: 'wrong-audience', audience: 'https://other.invalid' } });
  await expect(useServerStore.getState().addServer(REALM)).rejects.toThrow('Invalid realm authorization response');
  expect(mockPost).not.toHaveBeenCalled();
});

test('synced realms refresh with audience-bound assertions instead of the Central session', async () => {
  await useServerStore.getState().fetchServersForCentral();
  expect(mockCentralPost).toHaveBeenCalledWith('/api/login/realm-assertion', { serverUrl: REALM });
  expect(mockPost).toHaveBeenCalledWith(`${REALM}/api/auth/central`, { token: 'realm-assertion' }, expect.anything());
  expect(useServerStore.getState().servers[0].token).toBe('realm-token');
});

test('a realm already in the list is just opened', async () => {
  useServerStore.setState({ servers: [{ id: REALM, name: 'Cozy', url: REALM, token: 't', membersOnline: 0, unread: 0, mention: 0 }] });
  await useServerStore.getState().addServer(`${REALM}/`);
  expect(mockGet).not.toHaveBeenCalled();
  expect(mockPost).not.toHaveBeenCalled();
  expect(useServerStore.getState().activeServerId).toBe(REALM);
});

test.each([
  ['a removal', { error: 'You were removed from this server' }, 'You were removed from this server.'],
  ['a decentralized-only realm', {}, 'This server is decentralized only. Sign in to it directly with a local account.'],
  ['a custom refusal', { error: 'Invite required' }, 'Invite required'],
])('a 403 from %s is explained and nothing is added', async (_label, data, message) => {
  mockPost.mockRejectedValueOnce(httpError(403, data));
  await expect(useServerStore.getState().addServer(REALM)).rejects.toThrow(message);
  expect(useServerStore.getState().servers).toEqual([]);
  expect(useServerStore.getState().rawSyncedServers).toHaveLength(1);
});

test('an unreachable address says so, and plain http is called out on iOS', async () => {
  mockGet.mockRejectedValue(httpError(null));
  await expect(useServerStore.getState().addServer('https://down.invalid')).rejects.toThrow('Could not reach this server');
  await expect(useServerStore.getState().addServer('http://lan.invalid')).rejects.toThrow('secure (https)');
});

test('local accounts cannot add servers', async () => {
  mockAuth = { user: { id: 'L', accountType: 'local' }, token: 'x', syncKey: null };
  await expect(useServerStore.getState().addServer(REALM)).rejects.toThrow('Central account');
  expect(mockGet).not.toHaveBeenCalled();
});

test('switching accounts mid-join adds nothing', async () => {
  mockPost.mockImplementationOnce(async () => {
    mockAuth = { user: { id: 'B', accountType: 'central' }, token: 'token-B', syncKey: 'key-B' };
    return { data: { token: 'realm-token' } };
  });
  await expect(useServerStore.getState().addServer(REALM)).rejects.toThrow('account changed');
  expect(useServerStore.getState().servers).toEqual([]);
});
