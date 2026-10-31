import { webcrypto } from 'node:crypto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerEntry } from '../../stores/serverStore';
import type { ServerSyncPayload } from '../../utils/serverSyncCrypto';
import { encryptServerList } from '../../utils/serverSyncCrypto';
import { readServerList, encryptServerEntries, type RemoteList, serverMembershipIds, syncGuardedServerList } from '../guardedServerSync';

const KEY = 'synthetic-account-sync-key';
const entry = (url: string) => ({ url, name: url, token: 'synthetic-token', info: {} }) as ServerEntry;
const list = (...urls: string[]): ServerSyncPayload => ({ servers: urls.map(entry) });

async function fixture(initial: ServerSyncPayload, legacy = false) {
  let stored: RemoteList = legacy
    ? { protocol: 2, ...await encryptServerList(initial, KEY), revision: 1, memberIds: null }
    : { protocol: 2, payload: null, iv: null, ...await encryptServerEntries(initial, KEY), revision: 1 };
  type Write = typeof stored & { expectedRevision: number; removedMemberIds: string[] };
  const api = {
    get: vi.fn(async () => ({ data: { ...stored } })),
    post: vi.fn(async (_path: string, body: unknown) => {
      const write = body as Write;
      stored = { protocol: 2, payload: null, iv: null, entries: write.entries, metadata: write.metadata,
        memberIds: write.memberIds, revision: stored.revision + 1 };
      return { data: { revision: stored.revision } };
    }),
  };
  const saved = () => readServerList(stored, KEY);
  return { api, saved, original: { ...stored } };
}

describe('guarded encrypted realm-list syncing', () => {
  beforeEach(() => { vi.stubGlobal('crypto', webcrypto); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('uses stable account-keyed opaque membership identifiers', async () => {
    const ids = await serverMembershipIds(['https://realm-a', 'https://realm-b'], KEY);
    expect(ids).toEqual(await serverMembershipIds(['https://realm-a', 'https://realm-b'], KEY));
    expect(ids[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids).not.toEqual(await serverMembershipIds(['https://realm-a', 'https://realm-b'], 'another-account'));
  });

  it('does not turn an incomplete local list into a central removal', async () => {
    const { api, saved } = await fixture(list('owner-realm', 'other-realm'));
    expect(await syncGuardedServerList(api, list('other-realm'), KEY, [], () => true)).toBe(true);
    expect((await saved())?.servers.map(s => s.url)).toEqual(['other-realm', 'owner-realm']);
    expect(api.post.mock.calls[0][1]).toMatchObject({ removedMemberIds: [] });
    expect((await saved())?.layout).toContainEqual({ type: 'server', url: 'owner-realm' });
  });

  it('only sends removal identifiers for explicitly removed realms', async () => {
    const { api, saved } = await fixture(list('owner-realm', 'leave-realm', 'remote-only'));
    await syncGuardedServerList(api, list('owner-realm'), KEY, ['leave-realm'], () => true);
    expect((await saved())?.servers.map(s => s.url)).toEqual(['owner-realm', 'remote-only']);
    expect(api.post.mock.calls[0][1]).toMatchObject({
      removedMemberIds: await serverMembershipIds(['leave-realm'], KEY),
    });
  });

  it('bootstraps legacy membership with the original ciphertext before any update', async () => {
    const { api, saved, original } = await fixture(list('old-realm'), true);
    await syncGuardedServerList(api, list('new-realm'), KEY, [], () => true);
    expect(api.post).toHaveBeenCalledTimes(2);
    expect(api.post.mock.calls[0][1]).toMatchObject({
      legacy: { payload: original.payload, iv: original.iv }, expectedRevision: 1,
      memberIds: await serverMembershipIds(['old-realm'], KEY), removedMemberIds: [],
    });
    expect(api.post.mock.calls[1][1]).toMatchObject({ expectedRevision: 2 });
    expect((await saved())?.servers.map(s => s.url)).toEqual(['new-realm', 'old-realm']);
  });

  it('fails closed on unreadable ciphertext or mismatched membership', async () => {
    const { api, original } = await fixture(list('realm'));
    api.get.mockResolvedValueOnce({ data: { ...original, entries: [{ ...original.entries![0], payload: 'corrupt' }] } });
    await expect(syncGuardedServerList(api, list(), KEY, [], () => true)).rejects.toThrow('unreadable');
    expect(api.post).not.toHaveBeenCalled();
    api.get.mockResolvedValueOnce({ data: { ...original, memberIds: [] } });
    await expect(syncGuardedServerList(api, list(), KEY, [], () => true)).rejects.toThrow('does not match');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('rereads on a version conflict and preserves a concurrently added realm', async () => {
    const { api, saved } = await fixture(list('realm'));
    const concurrent = { protocol: 2, payload: null, iv: null,
      ...await encryptServerEntries(list('realm', 'added-elsewhere'), KEY), revision: 2 };
    api.post.mockImplementationOnce(async () => {
      api.get.mockResolvedValueOnce({ data: concurrent });
      throw { isAxiosError: true, response: { status: 409, data: { code: 'SERVER_LIST_CONFLICT' } } };
    });
    expect(await syncGuardedServerList(api, list('realm'), KEY, [], () => true)).toBe(true);
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(api.post.mock.calls[1][1]).toMatchObject({ expectedRevision: 2, removedMemberIds: [] });
    expect((await saved())?.servers.map(s => s.url)).toEqual(['realm', 'added-elsewhere']);
  });

  it('does not write after logout/account switching during a read', async () => {
    const { api, original } = await fixture(list('realm'));
    let current = true;
    api.get.mockImplementationOnce(async () => { current = false; return { data: original }; });
    expect(await syncGuardedServerList(api, list(), KEY, ['realm'], () => current)).toBe(false);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('never falls back to unguarded writes on an older central service', async () => {
    const { api, original } = await fixture(list('realm'));
    api.get.mockResolvedValueOnce({ data: { ...original, protocol: 0 } });
    await expect(syncGuardedServerList(api, list(), KEY, ['realm'], () => true)).rejects.toThrow('guarded');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('allows intentional removal of the final realm', async () => {
    const { api, saved } = await fixture(list('last-realm'));
    await syncGuardedServerList(api, list(), KEY, ['last-realm'], () => true);
    expect((await saved())?.servers).toEqual([]);
    expect(api.post.mock.calls[0][1]).toMatchObject({
      memberIds: [], removedMemberIds: await serverMembershipIds(['last-realm'], KEY),
    });
  });
});
