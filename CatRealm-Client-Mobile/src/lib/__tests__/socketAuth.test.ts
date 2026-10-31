const mockIo = jest.fn();
const mockGetState = jest.fn();
const mockGetCentralProof = jest.fn();

jest.mock('socket.io-client', () => ({ io: (...args: unknown[]) => mockIo(...args) }));
jest.mock('@/lib/api', () => ({ AUTH_BASE: 'https://auth.catrealm.app' }));
jest.mock('@/lib/centralDeviceCredentials', () => ({
  getCentralDeviceHeadersForUser: (...args: unknown[]) => mockGetCentralProof(...args),
}));
jest.mock('@/stores/authStore', () => ({ useAuthStore: { getState: () => mockGetState() } }));

import { connectSocket, disconnectSocket, resolveServerSocketToken } from '../socket';

beforeEach(() => {
  disconnectSocket();
  jest.clearAllMocks();
  mockGetState.mockReturnValue({ user: { id: 'account-a', accountType: 'central' }, token: 'central-token' });
  mockGetCentralProof.mockResolvedValue({
    'X-CatRealm-Device-Id': 'device-id',
    'X-CatRealm-Device-Secret': 'device-secret',
  });
  mockIo.mockReturnValue({ auth: {}, connected: false, connect: jest.fn(), disconnect: jest.fn() });
});

async function socketHandshake(): Promise<Record<string, string>> {
  const options = mockIo.mock.calls[0][1];
  return new Promise(resolve => options.auth(resolve));
}

test('Central socket sends device-bound proof on every handshake', async () => {
  const socket = connectSocket('https://auth.catrealm.app', 'old-token');
  await expect(socketHandshake()).resolves.toEqual({
    token: 'central-token', clientType: 'mobile', deviceId: 'device-id', deviceSecret: 'device-secret',
  });
  expect(mockGetCentralProof).toHaveBeenCalledWith('account-a');
  mockGetState.mockReturnValue({ user: { id: 'account-a', accountType: 'central' }, token: 'refreshed-token' });
  await expect(socketHandshake()).resolves.toMatchObject({ token: 'refreshed-token', deviceSecret: 'device-secret' });
  expect(connectSocket('https://auth.catrealm.app', 'old-token')).toBe(socket);
  expect(typeof socket.auth).toBe('function');
});

test('realm sockets receive only their realm token', () => {
  connectSocket('https://realm.example', 'realm-token');
  expect(mockIo.mock.calls[0][1].auth).toEqual({ token: 'realm-token', clientType: 'mobile' });
  expect(mockGetCentralProof).not.toHaveBeenCalled();
});

test('a missing realm token never falls back to a Central session', () => {
  expect(resolveServerSocketToken('central', '', 'central-token')).toBeNull();
  expect(resolveServerSocketToken('central', undefined, 'central-token')).toBeNull();
  expect(resolveServerSocketToken('central', 'realm-token', 'central-token')).toBe('realm-token');
  expect(resolveServerSocketToken('local', undefined, 'local-token')).toBe('local-token');
});

test('a Central handshake abandoned during an account switch sends no credential', async () => {
  let resolveProof!: (value: Record<string, string>) => void;
  mockGetCentralProof.mockReturnValue(new Promise(resolve => { resolveProof = resolve; }));
  connectSocket('https://auth.catrealm.app', 'old-token');
  const handshake = socketHandshake();
  mockGetState.mockReturnValue({ user: { id: 'account-b', accountType: 'central' }, token: 'new-token' });
  resolveProof({ 'X-CatRealm-Device-Id': 'old-device', 'X-CatRealm-Device-Secret': 'old-secret' });
  await expect(handshake).resolves.toEqual({ token: '', clientType: 'mobile' });
});
