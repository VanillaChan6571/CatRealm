import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { clearAllDMStorage, initDMStorage } from '../dmStorage';

beforeEach(() => {
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: new IDBFactory() });
});
afterEach(async () => { await clearAllDMStorage('bob'); });

it('clears only the signed-out account DM database', async () => {
  await initDMStorage('alice');
  await initDMStorage('bob');
  await clearAllDMStorage('alice');
  const names = (await indexedDB.databases()).map(database => database.name);
  expect(names).not.toContain('catrealm-dms-alice');
  expect(names).toContain('catrealm-dms-bob');
});

it('does not leave a stale account database active after overlapping opens', async () => {
  await Promise.all([initDMStorage('alice'), initDMStorage('bob')]);
  await clearAllDMStorage('alice');
  const names = (await indexedDB.databases()).map(database => database.name);
  expect(names).not.toContain('catrealm-dms-alice');
  expect(names).toContain('catrealm-dms-bob');
});
