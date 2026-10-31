import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
import axios, { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Keep the real login store, API interceptors, credential storage and Axios
// serialization. Isolate UI cleanup side effects and replace transport only.
vi.mock('../socket', () => ({ disconnectSocket: vi.fn() }));
vi.mock('../api', () => ({ createApi: vi.fn() }));
vi.mock('../centralProfileActivity', () => ({
  reconcileIncomingCentralProfileActivity: () => ({ shouldClearUpstream: false }),
  scheduleStaleCentralProfileActivityClear: vi.fn(),
}));
vi.mock('../../messaging/persistence/dmStorage', () => ({ clearAllDMStorage: vi.fn() }));
vi.mock('../../stores/pinnedStore', () => ({ usePinnedStore: { getState: () => ({ clearPins: vi.fn() }) } }));
import { authApi } from '../authApi';
import { useAuthStore } from '../../stores/authStore';

type DeviceValidator = (req: { get: (name: string) => unknown }, res: {
  status: (value: number) => unknown; json: (value: unknown) => unknown;
}) => boolean;
const root = path.resolve(process.cwd(), '..');
const filename = path.join(root, 'security/centralSessions.js');
const realRequire = createRequire(filename);
const sessionModule = { exports: {} as { validateLoginDevice: DeviceValidator } };
vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
  module: sessionModule, Buffer, URL, Date,
  process: { env: { JWT_SECRET: 'synthetic-transport-regression-key' } },
  require: (name: string) => {
    if (name === '../db') return { prepare: () => { throw new Error('This transport fixture must never access a database'); } };
    // Login-device validation does not sign or verify JWTs. Client-only CI does
    // not install central's dependencies, so keep that unrelated import inert.
    if (name === 'jsonwebtoken') return {};
    if (name === 'node:crypto' || name === 'node:events') return realRequire(name);
    throw new Error(`Unexpected server-validator dependency: ${name}`);
  },
}, { filename });

const initialAdapter = axios.defaults.adapter;
const initialAuthAdapter = authApi.defaults.adapter;
let requests: InternalAxiosRequestConfig[] = [];
function fixtureToken(deviceId: string) {
  const payload = { sub: 'fixture-user', username: 'FixtureUser', type: 'central', did: deviceId,
    sid: 'fixture-session', exp: Math.floor(Date.now() / 1000) + 604800 };
  return `${btoa('{}')}.${btoa(JSON.stringify(payload))}.fixture-signature`;
}
const transport: AxiosAdapter = async (config) => {
  requests.push(config);
  let status = 200;
  let data: unknown;
  const res = { status: (value: number) => { status = value; return res; }, json: (value: unknown) => { data = value; return res; } };
  const valid = sessionModule.exports.validateLoginDevice({ get: name => config.headers.get(name) }, res);
  if (valid) {
    if (config.url === '/api/login') {
      const body = JSON.parse(config.data);
      expect(body).toEqual({ username: 'FixtureUser', totpCode: '123456' });
      data = { token: fixtureToken(String(config.headers.get('X-CatRealm-Device-Id'))), user: { id: 'fixture-user', username: 'FixtureUser' }, syncKey: null };
    } else if (config.url === '/api/profile/me') {
      data = { id: 'fixture-user', username: 'FixtureUser', status: 'online' };
    } else {
      throw new Error(`Unexpected isolated request: ${config.url}`);
    }
  }
  const response = { data, status, statusText: status === 200 ? 'OK' : 'Bad Request', headers: {}, config };
  if (status !== 200) throw new AxiosError('Synthetic endpoint rejected device credentials', 'ERR_BAD_REQUEST', config, undefined, response);
  return response;
};

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  localStorage.clear();
  Reflect.deleteProperty(window, 'electron');
  requests = [];
  axios.defaults.adapter = transport;
  authApi.defaults.adapter = transport;
  useAuthStore.setState({ user: null, token: null, syncKey: null, serverUrl: null, isAuthenticated: false, error: null, loading: false });
});
afterEach(async () => {
  await Promise.resolve();
  axios.defaults.adapter = initialAdapter;
  authApi.defaults.adapter = initialAuthAdapter;
  Reflect.deleteProperty(window, 'electron');
  vi.unstubAllGlobals();
});

describe('actual central login store and Axios transport', () => {
  it.each(['web', 'Electron', 'Tauri'])('sends valid device credentials before signing in on %s', async (client) => {
    if (client !== 'web') Object.defineProperty(window, 'electron', { configurable: true, value: { platform: client === 'Tauri' ? 'linux' : 'win32' } });
    await useAuthStore.getState().centralLogin('FixtureUser', '123456');
    await vi.waitFor(() => expect(requests.some(request => request.url === '/api/profile/me')).toBe(true));
    const login = requests.find(request => request.url === '/api/login')!;
    expect(login.headers.get('X-CatRealm-Device-Id')).toMatch(/^[a-zA-Z0-9_-]{16,128}$/);
    expect(login.headers.get('X-CatRealm-Device-Secret')).toMatch(/^[a-zA-Z0-9_-]{43,128}$/);
    expect(login.headers.get('Authorization')).toBeUndefined();
    expect(useAuthStore.getState()).toMatchObject({ isAuthenticated: true, loading: false, error: null });
    for (const request of requests) {
      expect(request.headers.get('X-CatRealm-Device-Id')).toBe(login.headers.get('X-CatRealm-Device-Id'));
      expect(request.headers.get('X-CatRealm-Device-Secret')).toBe(login.headers.get('X-CatRealm-Device-Secret'));
    }
  });

  it('adds the independent secret to an existing pre-upgrade device identity', async () => {
    const existingId = '29298c4c-8074-4c27-bf58-a0ba0fdb58ca';
    localStorage.setItem('catrealm.device-id', existingId);
    await useAuthStore.getState().centralLogin('FixtureUser', '123456');
    expect(requests[0].headers.get('X-CatRealm-Device-Id')).toBe(existingId);
    expect(requests[0].headers.get('X-CatRealm-Device-Secret')).toMatch(/^[a-zA-Z0-9_-]{43,128}$/);
    expect(useAuthStore.getState().error).toBeNull();
  });
});
