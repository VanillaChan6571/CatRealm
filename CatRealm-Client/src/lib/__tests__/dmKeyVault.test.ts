import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { AxiosError } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  get: vi.fn(), post: vi.fn(),
  state: { user: { id: 'alice', accountType: 'central' }, token: '' } as { user: { id: string; accountType: string }; token: string },
  deviceId: 'device-aaaaaaaaaaaaaaaa',
}));
vi.mock('../authApi', () => ({ createAuthenticatedApi: () => ({ get: mock.get, post: mock.post }) }));
vi.mock('../deviceIdentity', () => ({ getLocalDeviceId: () => mock.deviceId }));
vi.mock('../../stores/authStore', () => ({ useAuthStore: { getState: () => mock.state } }));

import { auditCurrentDMVault, ensureDMVaultReady, getLegacyDMKeyDiagnostics, getVaultConversationSecret, lockDMVault, refreshLegacyDMKeyNotice, saveVaultConversationSecret, useDMVaultStatus } from '../dmKeyVault';

const secret = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const conversationSecret = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
function signIn(userId: string, sessionId = 'session-1') {
  const payload = btoa(JSON.stringify({ sub: userId, sid: sessionId, did: mock.deviceId, type: 'central' }));
  mock.state = { user: { id: userId, accountType: 'central' }, token: `a.${payload}.c` };
  localStorage.setItem('catrealm_session', JSON.stringify({ token: mock.state.token, user: mock.state.user }));
}

beforeEach(() => {
  lockDMVault();
  localStorage.clear();
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: new IDBFactory() });
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
  mock.get.mockReset().mockResolvedValue({ data: { secret, secretId: 'secret-1' } });
  mock.post.mockReset().mockResolvedValue({ data: { secret, secretId: 'secret-1' } });
  signIn('alice');
});

describe('DM key vault', () => {
  it('stores ciphertext, reopens after lock, and never exposes another account’s key', async () => {
    await saveVaultConversationSecret('conversation', 1, conversationSecret);
    expect(await getVaultConversationSecret('conversation', 1)).toBe(conversationSecret);
    expect(localStorage.getItem('catrealm.dm-conversation-secret.conversation.1')).toBeNull();
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(`catrealm-dm-key-vault-alice-${mock.deviceId}`);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction('secrets', 'readonly');
    const record = await new Promise<{ ciphertext: ArrayBuffer }>((resolve, reject) => {
      const request = transaction.objectStore('secrets').get('conversation.1');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    expect(record.ciphertext.byteLength).toBeGreaterThan(32);
    expect(new Uint8Array(record.ciphertext)).not.toEqual(new Uint8Array(32).fill(9));
    lockDMVault();
    expect(await getVaultConversationSecret('conversation', 1)).toBe(conversationSecret);
    lockDMVault();
    signIn('bob');
    expect(await getVaultConversationSecret('conversation', 1)).toBeNull();
  });

  it('checks vault record membership without changing or exposing keys', async () => {
    await saveVaultConversationSecret('own', 1, conversationSecret);
    await saveVaultConversationSecret('own', 2, conversationSecret);
    await saveVaultConversationSecret('unavailable', 1, conversationSecret);
    const missing = new AxiosError('not found');
    missing.response = { status: 404, data: {}, statusText: '', headers: {}, config: {} as never };
    mock.get.mockImplementation((path: string) => {
      if (path.endsWith('/key-manifest')) {
        return path.includes('/own/')
          ? Promise.resolve({ data: { participantUserIds: ['alice', 'friend'] } })
          : Promise.reject(missing);
      }
      return Promise.resolve({ data: { secret, secretId: 'secret-1' } });
    });
    expect(await auditCurrentDMVault()).toEqual({ records: 3, accessible: 2, needsReview: 1, couldNotCheck: 0 });
    expect(await getVaultConversationSecret('own', 1)).toBe(conversationSecret);
    expect(await getVaultConversationSecret('unavailable', 1)).toBe(conversationSecret);
  });

  it('discards an audit result if the account changes during a manifest check', async () => {
    await saveVaultConversationSecret('conversation', 1, conversationSecret);
    let release!: (value: { data: { participantUserIds: string[] } }) => void;
    mock.get.mockImplementation((path: string) => path.endsWith('/key-manifest')
      ? new Promise(resolve => { release = resolve; })
      : Promise.resolve({ data: { secret, secretId: 'secret-1' } }));
    const audit = auditCurrentDMVault();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    signIn('bob');
    lockDMVault();
    release({ data: { participantUserIds: ['alice'] } });
    await expect(audit).rejects.toThrow('Account changed');
  });

  it('keeps legacy keys even when sign-out markers match the current account', async () => {
    const legacyKey = 'catrealm.dm-conversation-secret.conversation.1';
    localStorage.setItem(legacyKey, conversationSecret);
    localStorage.setItem('catrealm.dm-conversation-secret-owner', 'alice');
    localStorage.setItem('catrealm.dm-conversation-secret-device', mock.deviceId);
    await ensureDMVaultReady();
    expect(localStorage.getItem(legacyKey)).toBe(conversationSecret);
    expect(await getVaultConversationSecret('conversation', 1)).toBeNull();
    expect(useDMVaultStatus.getState().issue).toBe('legacy');
  });

  it('keeps legacy keys whose owner marker is missing', async () => {
    const legacyKey = 'catrealm.dm-conversation-secret.conversation.1';
    localStorage.setItem(legacyKey, conversationSecret);
    await ensureDMVaultReady();
    expect(localStorage.getItem(legacyKey)).toBe(conversationSecret);
    expect(await getVaultConversationSecret('conversation', 1)).toBeNull();
    expect(useDMVaultStatus.getState().reason).toContain('need review');
    expect(useDMVaultStatus.getState().issue).toBe('legacy');
    expect(useDMVaultStatus.getState().cannotSave).toBe(false);
    expect(getLegacyDMKeyDiagnostics()).toEqual({
      entries: 1,
      plausibleKeys: 1,
      accountMarker: 'missing',
      deviceMarker: 'missing',
      sessionMarker: 'matches',
    });
  });

  it('reports marker mismatch without exposing old DM key contents', () => {
    localStorage.setItem('catrealm.dm-conversation-secret.conversation.1', conversationSecret);
    localStorage.setItem('catrealm.dm-conversation-secret.invalid', 'announcement text');
    localStorage.setItem('catrealm.dm-conversation-secret-owner', 'bob');
    localStorage.setItem('catrealm.dm-conversation-secret-device', 'another-device');
    expect(getLegacyDMKeyDiagnostics()).toEqual({
      entries: 2,
      plausibleKeys: 1,
      accountMarker: 'different',
      deviceMarker: 'different',
      sessionMarker: 'matches',
    });
  });

  it('keeps legacy keys recorded for another device', async () => {
    const legacyKey = 'catrealm.dm-conversation-secret.conversation.1';
    localStorage.setItem(legacyKey, conversationSecret);
    localStorage.setItem('catrealm.dm-conversation-secret-owner', 'alice');
    localStorage.setItem('catrealm.dm-conversation-secret-device', 'device-bbbbbbbbbbbbbbbb');
    await ensureDMVaultReady();
    expect(localStorage.getItem(legacyKey)).toBe(conversationSecret);
    expect(await getVaultConversationSecret('conversation', 1)).toBeNull();
  });

  it('keeps a failed-save warning visible when another legacy copy needs review', async () => {
    const firstKey = 'catrealm.dm-conversation-secret.first.1';
    const secondKey = 'catrealm.dm-conversation-secret.second.1';
    localStorage.setItem(firstKey, conversationSecret);
    localStorage.setItem(secondKey, 'not-base64!');
    localStorage.setItem('catrealm.dm-conversation-secret-owner', 'alice');
    localStorage.setItem('catrealm.dm-conversation-secret-device', mock.deviceId);
    const spy = vi.spyOn(crypto.subtle, 'encrypt').mockRejectedValueOnce(new Error('storage failed'));
    await saveVaultConversationSecret('third', 1, conversationSecret);
    expect(localStorage.getItem(firstKey)).toBe(conversationSecret);
    expect(localStorage.getItem(secondKey)).toBe('not-base64!');
    expect(useDMVaultStatus.getState().cannotSave).toBe(true);
    expect(useDMVaultStatus.getState().issue).toBe('storage');
    spy.mockRestore();
  });

  it('shows the old-key warning before device registration or vault opening', () => {
    localStorage.setItem('catrealm.dm-conversation-secret.conversation.1', conversationSecret);
    refreshLegacyDMKeyNotice();
    expect(useDMVaultStatus.getState().issue).toBe('legacy');
    expect(localStorage.getItem('catrealm.dm-conversation-secret.conversation.1')).toBe(conversationSecret);
  });

  it('keeps a mismatched vault intact and refuses to migrate keys from another owner', async () => {
    const legacyKey = 'catrealm.dm-conversation-secret.other.1';
    localStorage.setItem(legacyKey, conversationSecret);
    localStorage.setItem('catrealm.dm-conversation-secret-owner', 'bob');
    await saveVaultConversationSecret('conversation', 1, conversationSecret);
    expect(localStorage.getItem(legacyKey)).toBe(conversationSecret);
    lockDMVault();
    mock.get.mockResolvedValue({ data: { secret, secretId: 'different-secret' } });
    expect(await getVaultConversationSecret('conversation', 1)).toBeNull();
    expect(useDMVaultStatus.getState().cannotSave).toBe(true);
    lockDMVault();
    mock.get.mockResolvedValue({ data: { secret, secretId: 'secret-1' } });
    expect(await getVaultConversationSecret('conversation', 1)).toBe(conversationSecret);
  });

  it('keeps concurrent records and warns if encryption fails', async () => {
    await ensureDMVaultReady();
    await Promise.all([
      saveVaultConversationSecret('first', 1, conversationSecret),
      saveVaultConversationSecret('second', 2, conversationSecret),
    ]);
    lockDMVault();
    expect(await getVaultConversationSecret('first', 1)).toBe(conversationSecret);
    expect(await getVaultConversationSecret('second', 2)).toBe(conversationSecret);
    const spy = vi.spyOn(crypto.subtle, 'encrypt').mockRejectedValueOnce(new Error('storage failed'));
    await saveVaultConversationSecret('third', 1, conversationSecret);
    expect(await getVaultConversationSecret('third', 1)).toBe(conversationSecret);
    expect(useDMVaultStatus.getState().cannotSave).toBe(true);
    spy.mockRestore();
  });

  it('never replaces a stored key with a different secret for the same version', async () => {
    const differentSecret = btoa(String.fromCharCode(...new Uint8Array(32).fill(8)));
    const results = await Promise.allSettled([
      saveVaultConversationSecret('conversation', 1, conversationSecret),
      saveVaultConversationSecret('conversation', 1, differentSecret),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    const stored = await getVaultConversationSecret('conversation', 1);
    expect([conversationSecret, differentSecret]).toContain(stored);
    lockDMVault();
    expect(await getVaultConversationSecret('conversation', 1)).toBe(stored);
  });

  it('keeps an existing vault usable when an offline memory key conflicts', async () => {
    const differentSecret = btoa(String.fromCharCode(...new Uint8Array(32).fill(8)));
    await saveVaultConversationSecret('conversation', 1, conversationSecret);
    lockDMVault();
    mock.get.mockRejectedValueOnce(new Error('offline'));
    await saveVaultConversationSecret('conversation', 1, differentSecret);
    expect(useDMVaultStatus.getState().cannotSave).toBe(true);
    await ensureDMVaultReady();
    expect(await getVaultConversationSecret('conversation', 1)).toBe(conversationSecret);
    expect(useDMVaultStatus.getState().reason).toContain('different DM key');
  });

  it('discards a delayed vault response after an account switch', async () => {
    let release!: (value: { data: { secret: string; secretId: string } }) => void;
    mock.get.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const oldOpen = ensureDMVaultReady();
    await vi.waitFor(() => expect(mock.get).toHaveBeenCalled());
    signIn('bob');
    lockDMVault();
    release({ data: { secret, secretId: 'secret-1' } });
    expect(await oldOpen).toBeNull();
    expect(await getVaultConversationSecret('conversation', 1)).toBeNull();
  });

  it('discards a delayed vault response after a new login for the same account', async () => {
    let release!: (value: { data: { secret: string; secretId: string } }) => void;
    mock.get.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const oldOpen = ensureDMVaultReady();
    await vi.waitFor(() => expect(mock.get).toHaveBeenCalled());
    signIn('alice', 'session-2');
    release({ data: { secret, secretId: 'secret-1' } });
    expect(await oldOpen).toBeNull();
    expect(await getVaultConversationSecret('conversation', 1)).toBeNull();
  });

  it('does not report a delayed key save as successful after the session locks', async () => {
    await ensureDMVaultReady();
    const originalEncrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const spy = vi.spyOn(crypto.subtle, 'encrypt').mockImplementationOnce(async (...args) => {
      await gate;
      return originalEncrypt(...args);
    });
    const save = saveVaultConversationSecret('conversation', 1, conversationSecret);
    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
    lockDMVault();
    release();
    await expect(save).rejects.toThrow('Session changed');
    spy.mockRestore();
  });

  it('does not report a delayed key save as successful after a new same-account login', async () => {
    await ensureDMVaultReady();
    const originalEncrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const spy = vi.spyOn(crypto.subtle, 'encrypt').mockImplementationOnce(async (...args) => {
      await gate;
      return originalEncrypt(...args);
    });
    const save = saveVaultConversationSecret('conversation', 1, conversationSecret);
    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
    signIn('alice', 'session-2');
    release();
    await expect(save).rejects.toThrow('Session changed');
    spy.mockRestore();
  });

  it('keeps keys in memory and shows the banner when IndexedDB cannot open', async () => {
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: undefined });
    await saveVaultConversationSecret('conversation', 1, conversationSecret);
    expect(await getVaultConversationSecret('conversation', 1)).toBe(conversationSecret);
    expect(useDMVaultStatus.getState().cannotSave).toBe(true);
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: new IDBFactory() });
    await ensureDMVaultReady();
    expect(useDMVaultStatus.getState().cannotSave).toBe(false);
    lockDMVault();
    expect(await getVaultConversationSecret('conversation', 1)).toBe(conversationSecret);
  });

  it('uses the encrypted vault even when browser persistence is unconfirmed', async () => {
    const persisted = vi.fn().mockResolvedValue(false);
    Object.defineProperty(navigator, 'storage', { configurable: true, value: {
      persisted, persist: vi.fn().mockResolvedValue(false),
    } });
    await saveVaultConversationSecret('conversation', 1, conversationSecret);
    expect(persisted).not.toHaveBeenCalled();
    expect(useDMVaultStatus.getState().cannotSave).toBe(false);
    lockDMVault();
    expect(await getVaultConversationSecret('conversation', 1)).toBe(conversationSecret);
  });

  it('creates a missing server secret only for a new local vault', async () => {
    const missing = new AxiosError('missing');
    missing.response = { status: 404, data: { code: 'VAULT_SECRET_MISSING' }, statusText: '', headers: {}, config: {} as never };
    mock.get.mockRejectedValueOnce(missing);
    await saveVaultConversationSecret('conversation', 1, conversationSecret);
    expect(mock.post).toHaveBeenCalledOnce();
    expect(await getVaultConversationSecret('conversation', 1)).toBe(conversationSecret);
  });

  it('does not create a missing secret after a new login takes over', async () => {
    const missing = new AxiosError('missing');
    missing.response = { status: 404, data: { code: 'VAULT_SECRET_MISSING' }, statusText: '', headers: {}, config: {} as never };
    let rejectGet!: (error: unknown) => void;
    mock.get.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectGet = reject; }));
    const oldOpen = ensureDMVaultReady();
    await vi.waitFor(() => expect(mock.get).toHaveBeenCalled());
    signIn('alice', 'session-2');
    rejectGet(missing);
    expect(await oldOpen).toBeNull();
    expect(mock.post).not.toHaveBeenCalled();
  });

  it('uses memory and warns with an older server that has no vault API', async () => {
    const missing = new AxiosError('not found');
    missing.response = { status: 404, data: {}, statusText: '', headers: {}, config: {} as never };
    mock.get.mockRejectedValue(missing);
    await saveVaultConversationSecret('conversation', 1, conversationSecret);
    expect(mock.post).not.toHaveBeenCalled();
    expect(await getVaultConversationSecret('conversation', 1)).toBe(conversationSecret);
    expect(useDMVaultStatus.getState().cannotSave).toBe(true);
  });

  it('keeps a volatile key across same-account token refresh but locks on account switch', async () => {
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: undefined });
    await saveVaultConversationSecret('conversation', 1, conversationSecret);
    const refreshedPayload = btoa(JSON.stringify({ sub: 'alice', sid: 'session-1', did: mock.deviceId, type: 'central', exp: 123 }));
    const refreshed = JSON.stringify({ token: `b.${refreshedPayload}.c`, user: { id: 'alice' } });
    localStorage.setItem('catrealm_session', refreshed);
    window.dispatchEvent(new StorageEvent('storage', { key: 'catrealm_session', newValue: refreshed }));
    expect(await getVaultConversationSecret('conversation', 1)).toBe(conversationSecret);
    const switched = JSON.stringify({ token: 'bob', user: { id: 'bob' } });
    localStorage.setItem('catrealm_session', switched);
    window.dispatchEvent(new StorageEvent('storage', { key: 'catrealm_session', newValue: switched }));
    expect(await getVaultConversationSecret('conversation', 1)).toBeNull();
  });

  it('locks a volatile key when another tab signs in to a new session for the same account', async () => {
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: undefined });
    await saveVaultConversationSecret('conversation', 1, conversationSecret);
    const nextPayload = btoa(JSON.stringify({ sub: 'alice', sid: 'session-2', did: mock.deviceId, type: 'central' }));
    const next = JSON.stringify({ token: `b.${nextPayload}.c`, user: { id: 'alice' } });
    localStorage.setItem('catrealm_session', next);
    window.dispatchEvent(new StorageEvent('storage', { key: 'catrealm_session', newValue: next }));
    expect(await getVaultConversationSecret('conversation', 1)).toBeNull();
  });
});
