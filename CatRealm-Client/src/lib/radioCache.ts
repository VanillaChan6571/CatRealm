// Keeps one full copy of the CatRealm Radio track in Cache Storage so repeat
// listens play from disk instead of streaming ~230 MB from Central again.
// Keyed by URL: renaming the track on Central makes clients fetch the new one,
// and the stale entry is dropped when the new one is saved.
export const RADIO_CACHE_NAME = 'catrealm-radio';

// Caches that app-update hard reloads must leave alone (they hold no app assets).
export const PRESERVED_CACHE_NAMES: ReadonlySet<string> = new Set([RADIO_CACHE_NAME]);

let inFlight: Promise<boolean> | null = null;

function hasCacheStorage(): boolean {
  return typeof caches !== 'undefined';
}

// Returns an object URL for the saved track, or null if it isn't saved yet.
// The caller owns the URL and must revoke it.
export async function getCachedRadioUrl(url: string): Promise<string | null> {
  if (!hasCacheStorage()) return null;
  try {
    const cache = await caches.open(RADIO_CACHE_NAME);
    const res = await cache.match(url);
    if (!res) return null;
    return URL.createObjectURL(await res.blob());
  } catch (err) {
    console.warn('[Radio] cache read failed:', err);
    return null;
  }
}

// Downloads the whole track once and saves it. Resolves true when it's saved.
export function saveRadioTrack(url: string): Promise<boolean> {
  if (!hasCacheStorage()) return Promise.resolve(false);
  inFlight ??= (async () => {
    try {
      const cache = await caches.open(RADIO_CACHE_NAME);
      if (await cache.match(url)) return true;
      const res = await fetch(url);
      // Only a complete 200 is worth keeping; a 206 slice would play truncated.
      if (res.status !== 200) return false;
      await cache.put(url, res);
      const keys = await cache.keys();
      await Promise.all(keys.filter((req) => req.url !== url).map((req) => cache.delete(req)));
      return true;
    } catch (err) {
      // Quota or network failure: keep streaming, try again next session.
      console.warn('[Radio] cache save failed:', err);
      return false;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export async function getRadioCacheBytes(url: string): Promise<number | null> {
  if (!hasCacheStorage()) return null;
  try {
    const cache = await caches.open(RADIO_CACHE_NAME);
    const res = await cache.match(url);
    if (!res) return null;
    const length = Number(res.headers.get('content-length'));
    return Number.isFinite(length) && length > 0 ? length : (await res.blob()).size;
  } catch {
    return null;
  }
}

export async function clearRadioCache(): Promise<void> {
  if (hasCacheStorage()) await caches.delete(RADIO_CACHE_NAME);
}
