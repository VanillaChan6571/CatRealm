import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as desktop from '../src/lib/guardedServerSync';
import * as mobile from '../../CatRealm-Client-Mobile/src/lib/guardedServerSync';
import { encryptServerList } from '../src/utils/serverSyncCrypto';

vi.mock('../../CatRealm-Client-Mobile/node_modules/expo-crypto', () => ({
  getRandomBytes: (size: number) => webcrypto.getRandomValues(new Uint8Array(size)),
}));
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());

it('mobile and desktop can read each others encrypted entries, including Unicode without native text encoders', async () => {
  const key = 'synthetic-🔑-key';
  const list = { servers: [{ url: 'https://例.example', name: 'Realm 🐈', token: 'synthetic' }] };
  const fromDesktop = await desktop.encryptServerEntries(list, key);
  vi.stubGlobal('TextEncoder', undefined);
  vi.stubGlobal('TextDecoder', undefined);
  expect(await mobile.readServerList({ protocol: 2, revision: 1, payload: null, iv: null, ...fromDesktop }, key)).toEqual(list);
  const fromMobile = await mobile.encryptServerEntries(list, key);
  expect(fromMobile.memberIds).toEqual(fromDesktop.memberIds);
  vi.unstubAllGlobals();
  vi.stubGlobal('crypto', webcrypto);
  expect(await desktop.readServerList({ protocol: 2, revision: 1, payload: null, iv: null, ...fromMobile }, key)).toEqual(list);
});

for (const [name, reader] of [['desktop', desktop.readServerList], ['mobile', mobile.readServerList]] as const) {
  it(`${name} rejects hidden deletions and swapped identities inside otherwise valid ciphertext`, async () => {
    const key = 'synthetic-key';
    const list = { servers: [{ url: 'https://realm.example', name: 'Realm', token: 'synthetic' }] };
    const encrypted = await desktop.encryptServerEntries(list, key);
    const stored = { protocol: 2, revision: 1, payload: null, iv: null, ...encrypted };
    for (const servers of [[], [list.servers[0], { ...list.servers[0], url: 'https://another.example' }]]) {
      const entry = { id: encrypted.entries[0].id, ...await encryptServerList({ servers }, key) };
      await expect(reader({ ...stored, entries: [entry] }, key)).rejects.toThrow('exactly one');
    }
    const swapped = { id: encrypted.entries[0].id, ...await encryptServerList({ servers: [{ ...list.servers[0], url: 'https://other.example' }] }, key) };
    await expect(reader({ ...stored, entries: [swapped] }, key)).rejects.toThrow('identity');
    await expect(reader({ ...stored, metadata: await encryptServerList(list, key) }, key)).rejects.toThrow('metadata');
  });
}
