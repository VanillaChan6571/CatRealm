import { AUTH_BASE } from './authApi';

// Album art for a mirrored Last.fm activity ("title — artist"), resolved from
// Central's public cache the same way game icons come from the game library.
const HIT_TTL_MS = 60 * 60 * 1000;
// A miss can turn into a hit once Central's poller sees the track, so retry soon.
const MISS_TTL_MS = 60 * 1000;
const artCache = new Map<string, { url: string | null; fetchedAt: number }>();
const inFlight = new Map<string, Promise<string | null>>();

export function fetchAlbumArtByText(text: string): Promise<string | null> {
  const key = text.trim().toLowerCase();
  if (!key) return Promise.resolve(null);
  const cached = artCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < (cached.url ? HIT_TTL_MS : MISS_TTL_MS)) {
    return Promise.resolve(cached.url);
  }
  const pending = inFlight.get(key);
  if (pending) return pending;
  const request = fetch(`${AUTH_BASE}/api/lastfm/art?text=${encodeURIComponent(text.trim())}`)
    .then(async (res) => {
      const url = res.ok ? ((await res.json()) as { imageUrl?: string | null }).imageUrl ?? null : null;
      artCache.set(key, { url, fetchedAt: Date.now() });
      return url;
    })
    .catch(() => {
      artCache.set(key, { url: null, fetchedAt: Date.now() });
      return null;
    })
    .finally(() => { inFlight.delete(key); });
  inFlight.set(key, request);
  return request;
}
