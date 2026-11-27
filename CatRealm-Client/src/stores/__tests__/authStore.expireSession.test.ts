import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const clearAllDMStorage = vi.hoisted(() => vi.fn());
vi.mock('../../messaging/persistence/dmStorage', () => ({ clearAllDMStorage }));
vi.mock('../../lib/socket', () => ({ disconnectSocket: vi.fn(), connectSocket: vi.fn(), getSocket: vi.fn() }));

import { useAuthStore } from '../authStore';
import { confirmOrExpireCentralSession } from '../../lib/authApi';
import { adoptCentralSessionDevice } from '../../lib/centralDeviceCredentials';

const SECRET = 'catrealm.dm-conversation-secret.conversation.1';
const PRIVATE_KEY = 'catrealm.device-dm-private-key.device-aaaaaaaaaaaaaaaa';

function sessionToken(sub: string, did = 'device-aaaaaaaaaaaaaaaa') {
  const payload = btoa(JSON.stringify({ sub, type: 'central', did, exp: Math.floor(Date.now() / 1000) + 86400 }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `header.${payload}.signature`;
}

function reject(status: number | null, data: Record<string, unknown> = {}) {
  const error = new axios.AxiosError('request failed');
  if (status !== null) error.response = { status, data, statusText: '', headers: {}, config: {} as never };
  vi.spyOn(axios, 'get').mockRejectedValue(error);
}

describe('central session expiry and DM keys', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearAllDMStorage.mockClear();
    localStorage.clear();
    // Each test needs its own verification instead of the shared cooldown result.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 60_000 * (Number(expect.getState().currentTestName?.length) + 1));
    localStorage.setItem('catrealm.device-id', 'device-aaaaaaaaaaaaaaaa');
    localStorage.setItem(SECRET, 'cached-secret');
    localStorage.setItem(PRIVATE_KEY, 'private');
    useAuthStore.setState({
      user: { id: 'alice', username: 'alice', accountType: 'central', permissions: 0 },
      token: sessionToken('alice'),
      isAuthenticated: true,
    });
  });

  it('keeps DM keys but drops plaintext messages when the session is only unknown', async () => {
    reject(401, { error: 'Invalid token' });
    await confirmOrExpireCentralSession();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(localStorage.getItem(SECRET)).toBe('cached-secret');
    expect(clearAllDMStorage).toHaveBeenCalled();
  });

  it('keeps DM keys when many requests are rejected at once', async () => {
    reject(401, { error: 'Invalid token' });
    await Promise.all([1, 2, 3, 4].map(() => confirmOrExpireCentralSession()));
    useAuthStore.getState().expireCentralSession();
    expect(localStorage.getItem(SECRET)).toBe('cached-secret');
    adoptCentralSessionDevice(sessionToken('alice'));
    expect(localStorage.getItem(SECRET)).toBe('cached-secret');
  });

  it('keeps ambiguous old plaintext keys when the session was revoked', async () => {
    localStorage.setItem('catrealm.dm-conversation-secret-owner', 'alice');
    localStorage.setItem('catrealm.dm-conversation-secret-device', 'device-aaaaaaaaaaaaaaaa');
    reject(401, { error: 'Invalid token', code: 'SESSION_REVOKED' });
    await confirmOrExpireCentralSession();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(localStorage.getItem(SECRET)).toBe('cached-secret');
  });

  it('does not erase another device’s legacy key when this device was revoked', async () => {
    localStorage.setItem('catrealm.dm-conversation-secret-owner', 'alice');
    localStorage.setItem('catrealm.dm-conversation-secret-device', 'device-bbbbbbbbbbbbbbbb');
    reject(401, { error: 'Invalid token', code: 'SESSION_REVOKED' });
    await confirmOrExpireCentralSession();
    expect(localStorage.getItem(SECRET)).toBe('cached-secret');
  });

  it('stays signed in when Central is unreachable or failing', async () => {
    reject(null);
    await confirmOrExpireCentralSession();
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    vi.setSystemTime(Date.now() + 60_000);
    reject(503, { error: 'Unavailable' });
    await confirmOrExpireCentralSession();
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(localStorage.getItem(SECRET)).toBe('cached-secret');
  });

  it('gives the keys back to the same account on the same device', () => {
    useAuthStore.getState().expireCentralSession();
    adoptCentralSessionDevice(sessionToken('alice'));
    expect(localStorage.getItem(SECRET)).toBe('cached-secret');
  });

  it('preserves un-migrated keys for their owner across an account switch', () => {
    useAuthStore.getState().expireCentralSession();
    adoptCentralSessionDevice(sessionToken('bob'));
    expect(localStorage.getItem(SECRET)).toBe('cached-secret');
    expect(localStorage.getItem('catrealm.dm-conversation-secret-owner')).toBeNull();
  });

  it('does not erase the only legacy key copy when the device id changes', () => {
    useAuthStore.getState().expireCentralSession();
    adoptCentralSessionDevice(sessionToken('alice', 'device-bbbbbbbbbbbbbbbb'));
    expect(localStorage.getItem(SECRET)).toBe('cached-secret');
  });

  it('keeps un-migrated keys on a normal sign-out', () => {
    vi.spyOn(axios, 'post').mockResolvedValue({ data: {} });
    useAuthStore.getState().logout();
    expect(localStorage.getItem(SECRET)).toBe('cached-secret');
    expect(localStorage.getItem('catrealm.dm-conversation-secret-owner')).toBeNull();
    expect(localStorage.getItem('catrealm.dm-conversation-secret-device')).toBeNull();
  });
});
