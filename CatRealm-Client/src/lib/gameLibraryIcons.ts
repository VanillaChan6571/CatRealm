import { AUTH_BASE } from './authApi';

const ICON_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
// Keys: "proc:{processName}" or "title:{gameTitle}" (both lowercased)
const iconCache = new Map<string, { url: string | null; fetchedAt: number }>();

function resolveIconUrl(data: { steamAppId?: number; iconVariants?: Record<string, string> }): string | null {
  if (data.steamAppId) {
    return `https://cdn.akamai.steamstatic.com/steam/apps/${data.steamAppId}/capsule_sm_120.jpg`;
  }
  return data.iconVariants?.['64'] ?? data.iconVariants?.['128'] ?? null;
}

async function fetchAndCache(key: string, url: string): Promise<string | null> {
  const cached = iconCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < ICON_CACHE_TTL_MS) return cached.url;
  try {
    const res = await fetch(url);
    if (!res.ok) { iconCache.set(key, { url: null, fetchedAt: Date.now() }); return null; }
    const data = await res.json() as { steamAppId?: number; iconVariants?: Record<string, string> };
    const iconUrl = resolveIconUrl(data);
    iconCache.set(key, { url: iconUrl, fetchedAt: Date.now() });
    return iconUrl;
  } catch {
    iconCache.set(key, { url: null, fetchedAt: Date.now() });
    return null;
  }
}

export function fetchIconByProcess(processName: string): Promise<string | null> {
  return fetchAndCache(
    `proc:${processName.toLowerCase()}`,
    `${AUTH_BASE}/api/gamelibrary/games/lookup?process=${encodeURIComponent(processName)}`,
  );
}

export function fetchIconByTitle(title: string): Promise<string | null> {
  return fetchAndCache(
    `title:${title.toLowerCase()}`,
    `${AUTH_BASE}/api/gamelibrary/games/lookup?title=${encodeURIComponent(title)}`,
  );
}

export function evictIconCacheByProcess(processNames: string[]): void {
  for (const name of processNames) iconCache.delete(`proc:${name.toLowerCase()}`);
}

export function evictIconCacheByTitle(title: string): void {
  iconCache.delete(`title:${title.toLowerCase()}`);
}
