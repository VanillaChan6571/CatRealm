import { afterEach, expect, it, vi } from 'vitest';
import { emoteLookupCache, loadServerEmoteLookup } from '../messageTokenParser';

afterEach(() => {
  emoteLookupCache.clear();
  vi.unstubAllGlobals();
});

it('does not request emote manifests from HTTP gateway realms', async () => {
  const fetchManifest = vi.fn();
  vi.stubGlobal('fetch', fetchManifest);
  const gatewayOrigin = `https://r-${'a'.repeat(40)}.bridge.catrealm.app`;

  expect(await loadServerEmoteLookup(gatewayOrigin)).toBeNull();
  expect(fetchManifest).not.toHaveBeenCalled();
});

it('continues to load emotes from HTTPS realms', async () => {
  const fetchManifest = vi.fn(async () => ({
    ok: true,
    json: async () => ({ emotes: [], 'anim-emotes': [], stickers: [], 'anim-stickers': [] }),
  }));
  vi.stubGlobal('fetch', fetchManifest);

  expect(await loadServerEmoteLookup('https://realm.example')).toEqual(new Map());
  expect(fetchManifest).toHaveBeenCalledOnce();
});
