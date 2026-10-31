import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  FAILED_LOOKUP_RETRY_MS,
  LOOKUP_REFETCH_COOLDOWN_MS,
  loadPersonalExpressionLookup,
  makePersonalLookupKey,
  markExpressionLookupStale,
  personalLookupCache,
} from '../messageTokenParser';

const origin = 'https://auth.example';

function manifestWith(stickers: Array<{ name: string; url: string }>) {
  return {
    ok: true,
    json: async () => ({
      emotes: [],
      'anim-emotes': [],
      stickers: stickers.map(({ name, url }) => ({ name, file_url: url })),
      'anim-stickers': [],
    }),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-26T12:00:00Z'));
});

afterEach(() => {
  personalLookupCache.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('refetches an owner manifest when a message needs a sticker uploaded after it was cached', async () => {
  const fetchManifest = vi.fn()
    .mockResolvedValueOnce(manifestWith([{ name: 'squishy', url: '/s.png' }]))
    .mockResolvedValueOnce(manifestWith([{ name: 'squishy', url: '/s.png' }, { name: 'reactive-idle', url: '/idle.png' }]));
  vi.stubGlobal('fetch', fetchManifest);

  await loadPersonalExpressionLookup(origin, 'owner-new', ['squishy']);
  vi.advanceTimersByTime(LOOKUP_REFETCH_COOLDOWN_MS);
  const lookup = await loadPersonalExpressionLookup(origin, 'owner-new', ['reactive-idle']);

  expect(fetchManifest).toHaveBeenCalledTimes(2);
  expect(lookup?.get('reactive-idle')?.sticker).toBe(`${origin}/idle.png`);
});

it('serves a satisfied lookup from cache and tries a missing name only once', async () => {
  const fetchManifest = vi.fn(async () => manifestWith([{ name: 'squishy', url: '/s.png' }]));
  vi.stubGlobal('fetch', fetchManifest);

  await loadPersonalExpressionLookup(origin, 'owner-plain', ['squishy']);
  await loadPersonalExpressionLookup(origin, 'owner-plain', ['squishy']);
  expect(fetchManifest).toHaveBeenCalledTimes(1);

  vi.advanceTimersByTime(LOOKUP_REFETCH_COOLDOWN_MS);
  await loadPersonalExpressionLookup(origin, 'owner-plain', ['smile']);
  vi.advanceTimersByTime(LOOKUP_REFETCH_COOLDOWN_MS);
  await loadPersonalExpressionLookup(origin, 'owner-plain', ['smile']);
  expect(fetchManifest).toHaveBeenCalledTimes(2);
});

it('waits out the cooldown before refetching', async () => {
  const fetchManifest = vi.fn(async () => manifestWith([]));
  vi.stubGlobal('fetch', fetchManifest);

  await loadPersonalExpressionLookup(origin, 'owner-cool', []);
  await loadPersonalExpressionLookup(origin, 'owner-cool', ['fresh']);
  expect(fetchManifest).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(LOOKUP_REFETCH_COOLDOWN_MS);
  await loadPersonalExpressionLookup(origin, 'owner-cool', ['fresh']);
  expect(fetchManifest).toHaveBeenCalledTimes(2);
});

it('refetches a stale lookup after a broken asset, and retries failed loads slowly', async () => {
  const fetchManifest = vi.fn()
    .mockResolvedValueOnce({ ok: false })
    .mockResolvedValueOnce(manifestWith([{ name: 'idle', url: '/old.png' }]))
    .mockResolvedValueOnce(manifestWith([{ name: 'idle', url: '/new.png' }]));
  vi.stubGlobal('fetch', fetchManifest);

  expect(await loadPersonalExpressionLookup(origin, 'owner-stale', ['idle'])).toBeNull();
  vi.advanceTimersByTime(LOOKUP_REFETCH_COOLDOWN_MS);
  expect(await loadPersonalExpressionLookup(origin, 'owner-stale', ['idle'])).toBeNull();
  vi.advanceTimersByTime(FAILED_LOOKUP_RETRY_MS);
  expect((await loadPersonalExpressionLookup(origin, 'owner-stale', ['idle']))?.get('idle')?.sticker).toBe(`${origin}/old.png`);

  markExpressionLookupStale(makePersonalLookupKey(origin, 'owner-stale'));
  vi.advanceTimersByTime(LOOKUP_REFETCH_COOLDOWN_MS);
  expect((await loadPersonalExpressionLookup(origin, 'owner-stale', ['idle']))?.get('idle')?.sticker).toBe(`${origin}/new.png`);
  expect(fetchManifest).toHaveBeenCalledTimes(3);
});
