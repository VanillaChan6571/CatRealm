/**
 * Expression manifest fetcher + module-level cache.
 * One fetch per server origin per app session; results shared across all consumers.
 * Global pub/sub ensures all hook instances re-render when any manifest loads.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { AUTH_BASE } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { useServerStore } from '@/stores/serverStore';

export type ExpressionEntry = {
  name: string;
  emote?: string;
  sticker?: string;
  origin?: string;
  ownerId?: string | null;
  source?: 'server' | 'personal';
};
export type ExpressionLookup = Map<string, ExpressionEntry>; // key = normalized name

// Module-level cache: origin → lookup (empty map = loaded but none/failed)
export const expressionCacheMap = new Map<string, ExpressionLookup | null>();
const inflight = new Map<string, Promise<ExpressionLookup | null>>();
const personalExpressionCacheMap = new Map<string, ExpressionLookup | null>();
const personalInflight = new Map<string, Promise<ExpressionLookup | null>>();
// Another user's personal expressions, keyed `origin::ownerId`. The personal
// manifest above is authenticated and only ever returns the signed-in user's own
// set, so a sticker owned by someone else is only reachable through the public
// by-owner route. Mirrors desktop's messageTokenParser cache.
const ownerExpressionCacheMap = new Map<string, ExpressionLookup | null>();
const ownerInflight = new Map<string, Promise<ExpressionLookup | null>>();

// Pub/sub so any hook re-renders when any manifest loads
const watchers = new Set<() => void>();
function notifyWatchers() { watchers.forEach(cb => cb()); }

export function normalizeExprName(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 64);
}

/** Mirrors desktop's normalizeTokenOwnerId so both clients key/fetch identically. */
export function normalizeOwnerId(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 128);
}

export function getOrigin(url: string): string | null {
  try { return new globalThis.URL(url).origin; } catch { return null; }
}

function resolveAssetUrl(
  item: Record<string, unknown>,
  origin: string,
  preferredSize: number,
): string | null {
  const abs = (item.absolute_variants ?? {}) as Record<string, string>;
  const rel = (item.variants ?? {}) as Record<string, string>;
  const sizes = [...new Set([...Object.keys(abs), ...Object.keys(rel)])]
    .map(Number).filter(n => n > 0).sort((a, b) => a - b);

  if (sizes.length > 0) {
    const chosen =
      sizes.find(s => s === preferredSize) ??
      sizes.filter(s => s <= preferredSize).at(-1) ??
      sizes[0];
    const k = String(chosen);
    if (abs[k]) return abs[k];
    if (rel[k]) return /^https?:\/\//i.test(rel[k]) ? rel[k] : `${origin}${rel[k]}`;
  }

  const fileUrl = (item.absolute_url ?? item.file_url) as string | undefined;
  if (!fileUrl) return null;
  return /^https?:\/\//i.test(fileUrl) ? fileUrl : `${origin}${fileUrl}`;
}

function addManifestItems(
  lookup: ExpressionLookup,
  items: Record<string, unknown>[],
  origin: string,
  kind: 'emote' | 'sticker',
  source: 'server' | 'personal',
) {
  const preferredSize = kind === 'sticker' ? 320 : 64;

  for (const item of items) {
    const rawName = String(item.name ?? '');
    const name = normalizeExprName(rawName);
    if (!name) continue;
    const url = resolveAssetUrl(item, origin, preferredSize);
    if (!url) continue;
    const entry = lookup.get(name) ?? {
      name: rawName,
      origin,
      ownerId: typeof item.owner_id === 'string' ? item.owner_id : null,
      source,
    };
    entry.origin ??= origin;
    entry.ownerId ??= typeof item.owner_id === 'string' ? item.owner_id : null;
    entry.source ??= source;
    if (kind === 'emote' && !entry.emote) entry.emote = url;
    if (kind === 'sticker' && !entry.sticker) entry.sticker = url;
    lookup.set(name, entry);
  }
}

function buildLookupFromManifest(
  data: Record<string, unknown>,
  origin: string,
  source: 'server' | 'personal',
): ExpressionLookup {
  const lookup: ExpressionLookup = new Map();
  const emotes = [
    ...(Array.isArray(data['anim-emotes']) ? data['anim-emotes'] as Record<string, unknown>[] : []),
    ...(Array.isArray(data.emotes) ? data.emotes as Record<string, unknown>[] : []),
  ];
  const stickers = [
    ...(Array.isArray(data['anim-stickers']) ? data['anim-stickers'] as Record<string, unknown>[] : []),
    ...(Array.isArray(data.stickers) ? data.stickers as Record<string, unknown>[] : []),
  ];

  addManifestItems(lookup, emotes, origin, 'emote', source);
  addManifestItems(lookup, stickers, origin, 'sticker', source);
  return lookup;
}

async function fetchForOrigin(origin: string): Promise<ExpressionLookup | null> {
  try {
    const res = await globalThis.fetch(`${origin}/api/expressions/manifest`, {
      headers: { 'X-CatRealm-Client': 'mobile' },
    });
    if (!res.ok) { expressionCacheMap.set(origin, new Map()); notifyWatchers(); return null; }
    const data = await res.json() as Record<string, unknown>;
    const lookup = buildLookupFromManifest(data, origin, 'server');

    expressionCacheMap.set(origin, lookup);
    notifyWatchers();
    return lookup;
  } catch {
    expressionCacheMap.set(origin, new Map());
    notifyWatchers();
    return null;
  }
}

async function fetchPersonalForOrigin(origin: string, token: string): Promise<ExpressionLookup | null> {
  try {
    const res = await globalThis.fetch(`${origin}/api/profile/personal-expressions/manifest`, {
      headers: { Authorization: `Bearer ${token}`, 'X-CatRealm-Client': 'mobile' },
    });
    if (!res.ok) { personalExpressionCacheMap.set(origin, new Map()); notifyWatchers(); return null; }
    const data = await res.json() as Record<string, unknown>;
    const lookup = buildLookupFromManifest(data, origin, 'personal');

    personalExpressionCacheMap.set(origin, lookup);
    notifyWatchers();
    return lookup;
  } catch {
    personalExpressionCacheMap.set(origin, new Map());
    notifyWatchers();
    return null;
  }
}

async function fetchOwnerExpressions(origin: string, ownerId: string): Promise<ExpressionLookup | null> {
  const key = makeOwnerLookupKey(origin, ownerId);
  try {
    const res = await globalThis.fetch(
      `${origin}/api/profile/${encodeURIComponent(ownerId)}/personal-expressions/manifest`,
      { headers: { 'X-CatRealm-Client': 'mobile' } },
    );
    if (!res.ok) { ownerExpressionCacheMap.set(key, new Map()); notifyWatchers(); return null; }
    const data = await res.json() as Record<string, unknown>;
    const lookup = buildLookupFromManifest(data, origin, 'personal');

    ownerExpressionCacheMap.set(key, lookup);
    notifyWatchers();
    return lookup;
  } catch {
    ownerExpressionCacheMap.set(key, new Map());
    notifyWatchers();
    return null;
  }
}

export function makeOwnerLookupKey(origin: string, ownerId: string): string {
  return `${origin}::${ownerId}`;
}

/** Fetch a specific user's personal expression manifest (public route, no auth). */
export async function loadOwnerExpressionLookup(
  origin: string,
  ownerId: string,
): Promise<ExpressionLookup | null> {
  const key = makeOwnerLookupKey(origin, ownerId);
  if (ownerExpressionCacheMap.has(key)) return ownerExpressionCacheMap.get(key) ?? null;
  if (ownerInflight.has(key)) return ownerInflight.get(key)!;
  const task = fetchOwnerExpressions(origin, ownerId).finally(() => ownerInflight.delete(key));
  ownerInflight.set(key, task);
  return task;
}

/** Fetch the manifest for a server; returns cached result immediately if available. */
export async function loadExpressionLookup(serverUrl: string): Promise<ExpressionLookup | null> {
  const origin = getOrigin(serverUrl);
  if (!origin) return null;
  if (expressionCacheMap.has(origin)) return expressionCacheMap.get(origin) ?? null;
  if (inflight.has(origin)) return inflight.get(origin)!;
  const task = fetchForOrigin(origin).finally(() => inflight.delete(origin));
  inflight.set(origin, task);
  return task;
}

/** Fire-and-forget: trigger manifest load for an origin if not already loaded/loading. */
export function prefetchExpressions(serverUrl: string): void {
  const origin = getOrigin(serverUrl);
  if (!origin || expressionCacheMap.has(origin) || inflight.has(origin)) return;
  void loadExpressionLookup(serverUrl);
}

export async function loadPersonalExpressionLookup(
  baseUrl: string,
  token: string,
): Promise<ExpressionLookup | null> {
  const origin = getOrigin(baseUrl);
  if (!origin) return null;
  if (personalExpressionCacheMap.has(origin)) return personalExpressionCacheMap.get(origin) ?? null;
  if (personalInflight.has(origin)) return personalInflight.get(origin)!;
  const task = fetchPersonalForOrigin(origin, token).finally(() => personalInflight.delete(origin));
  personalInflight.set(origin, task);
  return task;
}

export function clearPersonalExpressionLookup(baseUrl: string): void {
  const origin = getOrigin(baseUrl);
  if (!origin) return;
  personalExpressionCacheMap.delete(origin);
  personalInflight.delete(origin);
  notifyWatchers();
}

function addDisplayEntries(target: ExpressionLookup, lookup: ExpressionLookup | null) {
  for (const entry of lookup?.values() ?? []) {
    const key = [
      entry.source ?? 'server',
      entry.origin ?? '',
      entry.ownerId ?? '',
      normalizeExprName(entry.name),
    ].join(':');
    target.set(key, entry);
  }
}

export type ExpressionKind = 'emote' | 'sticker';
export type ResolvedExpression = { url: string; kind: ExpressionKind };

/**
 * Pick an asset off a manifest entry. A `sticker:` marker in the token is a hint,
 * not a guarantee: with no marker the canonical alias `:name:ownerId:` must still
 * resolve a sticker-only expression, so an unhinted lookup falls back
 * emote → sticker and reports which kind it actually found. Mirrors desktop's
 * resolvePersonalExpressionAsset.
 */
function pickFromEntry(
  entry: ExpressionEntry | undefined,
  kindHint: ExpressionKind | null,
): ResolvedExpression | null {
  if (!entry) return null;
  if (kindHint === 'sticker') return entry.sticker ? { url: entry.sticker, kind: 'sticker' } : null;
  if (kindHint === 'emote') return entry.emote ? { url: entry.emote, kind: 'emote' } : null;
  if (entry.emote) return { url: entry.emote, kind: 'emote' };
  if (entry.sticker) return { url: entry.sticker, kind: 'sticker' };
  return null;
}

/**
 * Look up an emote/sticker from any cached manifest, reporting the kind found.
 * For external tokens (serverOrigin ≠ null), checks that server's manifest first,
 * then falls back to the current server's manifest.
 * When the token carries an ownerId, that user's personal manifest wins — it is
 * the only place another user's personal expressions live.
 * Also triggers a prefetch for any uncached server/owner.
 */
export function resolveExpressionAsset(
  name: string,
  kindHint: ExpressionKind | null,
  primaryServerUrl: string | null | undefined,
  tokenServerUrl: string | null | undefined,
  ownerId?: string | null,
): ResolvedExpression | null {
  const normalizedName = normalizeExprName(name);

  // Owner-scoped tokens always resolve against AUTH_BASE, whatever server the
  // token names: personal expressions only exist on Central (the self-hostable
  // server serves no personal-expressions route). Matches desktop's authOrigin.
  const normalizedOwnerId = ownerId ? normalizeOwnerId(ownerId) : '';
  if (normalizedOwnerId) {
    const authOrigin = getOrigin(AUTH_BASE);
    if (authOrigin) {
      const key = makeOwnerLookupKey(authOrigin, normalizedOwnerId);
      if (!ownerExpressionCacheMap.has(key) && !ownerInflight.has(key)) {
        void loadOwnerExpressionLookup(authOrigin, normalizedOwnerId);
      }
      const hit = pickFromEntry(ownerExpressionCacheMap.get(key)?.get(normalizedName), kindHint);
      if (hit) return hit;
    }
  }

  const origins: string[] = [];
  if (tokenServerUrl) {
    const o = getOrigin(tokenServerUrl);
    if (o) {
      origins.push(o);
      if (!expressionCacheMap.has(o) && !inflight.has(o)) prefetchExpressions(tokenServerUrl);
    }
  }
  if (primaryServerUrl) {
    const o = getOrigin(primaryServerUrl);
    if (o && !origins.includes(o)) origins.push(o);
  }

  for (const origin of origins) {
    const hit =
      pickFromEntry(personalExpressionCacheMap.get(origin)?.get(normalizedName), kindHint) ??
      pickFromEntry(expressionCacheMap.get(origin)?.get(normalizedName), kindHint);
    if (hit) return hit;
  }
  return null;
}

/** URL-only wrapper. `isSticker` is the token's marker, so false means "no hint". */
export function resolveEmoteFromCache(
  name: string,
  isSticker: boolean,
  primaryServerUrl: string | null | undefined,
  tokenServerUrl: string | null | undefined,
  ownerId?: string | null,
): string | null {
  return resolveExpressionAsset(
    name,
    isSticker ? 'sticker' : null,
    primaryServerUrl,
    tokenServerUrl,
    ownerId,
  )?.url ?? null;
}

/**
 * Hook: subscribes to all manifest cache updates and returns the primary server's lookup.
 * Re-renders whenever ANY manifest loads (needed for cross-server emotes).
 */
export function useExpressionLookup(serverUrl: string | null | undefined): ExpressionLookup | null {
  const origin = serverUrl ? getOrigin(serverUrl) : null;
  const token = useAuthStore((s) => s.token);
  const accountType = useAuthStore((s) => s.user?.accountType);
  const servers = useServerStore((s) => s.servers);
  const personalBaseUrl = token
    ? accountType === 'central'
      ? AUTH_BASE
      : serverUrl
    : null;
  const personalOrigin = personalBaseUrl ? getOrigin(personalBaseUrl) : null;
  const serverOrigins = useMemo(
    () => [
      ...new Set([
        ...(origin ? [origin] : []),
        ...servers.map((server) => getOrigin(server.url)).filter((value): value is string => Boolean(value)),
      ]),
    ],
    [origin, servers],
  );
  const [, rerender] = useState(0);

  // Subscribe to all cache updates
  useEffect(() => {
    const cb = () => rerender(n => n + 1);
    watchers.add(cb);
    return () => { watchers.delete(cb); };
  }, []);

  // Trigger primary server manifest load
  useEffect(() => {
    for (const serverOrigin of serverOrigins) {
      if (expressionCacheMap.has(serverOrigin)) continue;
      void loadExpressionLookup(serverOrigin);
    }
  }, [serverOrigins]);

  useEffect(() => {
    if (!personalOrigin || !token || personalExpressionCacheMap.has(personalOrigin)) return;
    void loadPersonalExpressionLookup(personalOrigin, token);
  }, [personalOrigin, token]);

  if (serverOrigins.length === 0 && !personalOrigin) return null;

  const serverLoaded = serverOrigins.every((serverOrigin) => expressionCacheMap.has(serverOrigin));
  const personalLoaded = personalOrigin ? personalExpressionCacheMap.has(personalOrigin) : true;
  const personalLookup = personalOrigin ? (personalExpressionCacheMap.get(personalOrigin) ?? null) : null;
  const combinedWithPersonal: ExpressionLookup = new Map();
  for (const serverOrigin of serverOrigins) {
    addDisplayEntries(combinedWithPersonal, expressionCacheMap.get(serverOrigin) ?? null);
  }
  addDisplayEntries(combinedWithPersonal, personalLookup);

  if (combinedWithPersonal.size === 0 && (!serverLoaded || !personalLoaded)) return null;
  return combinedWithPersonal;
}

/**
 * Hook: returns a stable resolver function for inline emote/sticker resolution.
 * Handles both local and external server tokens automatically.
 */
export function useEmoteResolver(primaryServerUrl: string | null | undefined) {
  const origin = primaryServerUrl ? getOrigin(primaryServerUrl) : null;
  const [, rerender] = useState(0);

  useEffect(() => {
    const cb = () => rerender(n => n + 1);
    watchers.add(cb);
    return () => { watchers.delete(cb); };
  }, []);

  useEffect(() => {
    if (!origin || expressionCacheMap.has(origin)) return;
    void loadExpressionLookup(origin);
  }, [origin]);

  return useCallback((name: string, isSticker: boolean, tokenServerUrl?: string | null): string | null => {
    return resolveEmoteFromCache(name, isSticker, primaryServerUrl, tokenServerUrl);
  }, // eslint-disable-next-line react-hooks/exhaustive-deps
  [primaryServerUrl, origin]);
}
