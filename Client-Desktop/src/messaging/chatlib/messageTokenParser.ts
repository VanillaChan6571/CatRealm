import { normalizeExpressionName, normalizeServerOrigin, normalizeTokenOwnerId } from '../../lib/expressions';
import { isHttpGatewayRealm } from '../../lib/httpRealmGateway';

export const MESSAGE_TOKEN_REGEX = /\[\[(emote|sticker):([^|\]]+)\|([^\]]+)\]\]|:(https?:\/\/[^\s:]+(?::\d{1,5})?):(?:(sticker):)?([a-z0-9_-]{1,64})(?::([a-z0-9_-]{3,128}))?:|:(?:(sticker):)?([a-z0-9_-]{1,64})(?::([a-z0-9_-]{3,128}))?:/gi;
export const COMPACT_EMOTE_TOKEN_REGEX = /:(https?:\/\/[^\s:]+(?::\d{1,5})?):(?:(sticker):)?([a-z0-9_-]{1,64})(?::([a-z0-9_-]{3,128}))?:|:(?:(sticker):)?([a-z0-9_-]{1,64})(?::([a-z0-9_-]{3,128}))?:/gi;
export const URL_REGEX = /https?:\/\/[^\s<>"'`]+/gi;

/**
 * Readable name for a reaction: `:name:` for custom emote/sticker tokens
 * (`:name:`, `:origin:sticker:name:owner:`, ...), otherwise the emoji itself.
 */
export function reactionDisplayName(emoji: string): string {
  const match = new RegExp(`^(?:${COMPACT_EMOTE_TOKEN_REGEX.source})$`, 'i').exec(emoji.trim());
  const name = match?.[3] || match?.[6];
  return name ? `:${name}:` : emoji;
}

export function resolveUrlWithBase(value: string | null | undefined, baseUrl: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!baseUrl) return trimmed;
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return trimmed;
  }
}

export function stripExpressionTokensForLinkScan(input: string): string {
  return input.replace(new RegExp(MESSAGE_TOKEN_REGEX.source, 'gi'), ' ');
}

export function getSingleUrlFromText(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const matches = [...trimmed.matchAll(/https?:\/\/[^\s<>"'`]+/gi)];
  if (matches.length !== 1) return null;
  const first = matches[0];
  const url = first[0];
  if (first.index !== 0) return null;
  if (url.length !== trimmed.length) return null;
  return url;
}

export type InviteLinkData = { code: string; canonicalUrl: string };

export function parseInviteLink(url: string): InviteLinkData | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const isInviteHost = host === 'catrealm.app' || host.endsWith('.catrealm.app');
    if (!isInviteHost) return null;

    const segments = parsed.pathname.split('/').filter(Boolean);
    let code = '';
    if (segments[0] === 'invite' && segments[1]) {
      code = segments[1];
    } else if (segments[0] === 'app' && segments[1] === 'invite' && segments[2]) {
      code = segments[2];
    } else {
      return null;
    }

    if (!/^[A-Za-z0-9_-]{4,128}$/.test(code)) return null;
    return { code, canonicalUrl: `${parsed.origin}/invite/${encodeURIComponent(code)}` };
  } catch {
    return null;
  }
}

export function isTrustedEmbedHostUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === 'x.com' ||
      host.endsWith('.x.com') ||
      host === 'twitter.com' ||
      host.endsWith('.twitter.com') ||
      host === 'vxtwitter.com' ||
      host.endsWith('.vxtwitter.com') ||
      host === 'fxtwitter.com' ||
      host.endsWith('.fxtwitter.com') ||
      host === 'fixupx.com' ||
      host.endsWith('.fixupx.com') ||
      host === 'fixvx.com' ||
      host.endsWith('.fixvx.com') ||
      host === 'youtube.com' ||
      host.endsWith('.youtube.com') ||
      host === 'youtu.be' ||
      host === 'instagram.com' ||
      host === 'www.instagram.com' ||
      host.endsWith('.instagram.com') ||
      host === 'twitch.tv' ||
      host.endsWith('.twitch.tv') ||
      host === 'kick.com' ||
      host.endsWith('.kick.com') ||
      host === 'iwara.tv' ||
      host === 'www.iwara.tv' ||
      host.endsWith('.iwara.tv')
    );
  } catch {
    return false;
  }
}

// --- Expression resolution with module-level caches ---

type ExpressionManifestItem = {
  name: string;
  file_url: string;
  absolute_url?: string;
  variants?: Record<string, string>;
  absolute_variants?: Record<string, string>;
};

type ExpressionManifestResponse = {
  emotes?: ExpressionManifestItem[];
  'anim-emotes'?: ExpressionManifestItem[];
  stickers?: ExpressionManifestItem[];
  'anim-stickers'?: ExpressionManifestItem[];
};

export type CompactExpressionLookupEntry = { emote?: string; sticker?: string };
export type CompactExpressionLookup = Map<string, CompactExpressionLookupEntry>;

export const emoteLookupCache = new Map<string, CompactExpressionLookup | null>();
const emoteLookupInflight = new Map<string, Promise<CompactExpressionLookup | null>>();
export const personalLookupCache = new Map<string, CompactExpressionLookup | null>();
const personalLookupInflight = new Map<string, Promise<CompactExpressionLookup | null>>();

// Lookups are cached for the life of the window, which on desktop can be days.
// A name missing from a cached lookup (an expression uploaded after it was
// fetched) or an asset that no longer loads (a re-uploaded sticker) refetches
// the manifest once, at most once per cooldown per origin/owner; a name still
// missing after that is plain text like `:smile:` and never refetches again.
// A failed fetch retries on a slower cooldown.
export const LOOKUP_REFETCH_COOLDOWN_MS = 15_000;
export const FAILED_LOOKUP_RETRY_MS = 60_000;
const lookupFetchedAt = new Map<string, number>();
const staleLookupKeys = new Set<string>();
const namesFetchedFor = new Map<string, Set<string>>();

/** Mark a lookup stale (e.g. one of its assets failed to load) so its next load refetches. */
export function markExpressionLookupStale(cacheKey: string): void {
  staleLookupKeys.add(cacheKey);
}

/**
 * null when the cached lookup can serve `names`; otherwise how long until it
 * may be refetched (0 = now). Callers retry after the delay so a message that
 * arrives during the cooldown still resolves.
 */
export function lookupRefetchDelayMs(
  cache: Map<string, CompactExpressionLookup | null>,
  cacheKey: string,
  names: readonly string[] = [],
): number | null {
  if (!cache.has(cacheKey)) return 0;
  const lookup = cache.get(cacheKey);
  const elapsed = Date.now() - (lookupFetchedAt.get(cacheKey) ?? 0);
  if (!lookup) return Math.max(0, FAILED_LOOKUP_RETRY_MS - elapsed);
  const tried = namesFetchedFor.get(cacheKey);
  const outdated = staleLookupKeys.has(cacheKey)
    || names.some((name) => {
      const normalized = normalizeExpressionName(name);
      return !!normalized && !lookup.has(normalized) && !tried?.has(normalized);
    });
  if (!outdated) return null;
  return Math.max(0, LOOKUP_REFETCH_COOLDOWN_MS - elapsed);
}

function recordLookupFetch(cacheKey: string, names: readonly string[]): void {
  lookupFetchedAt.set(cacheKey, Date.now());
  staleLookupKeys.delete(cacheKey);
  const tried = namesFetchedFor.get(cacheKey) ?? new Set<string>();
  names.forEach((name) => tried.add(normalizeExpressionName(name)));
  namesFetchedFor.set(cacheKey, tried);
}
let defaultEmojiAliasesCache: Map<string, string> | null = null;
let defaultEmojiAliasesPromise: Promise<Map<string, string>> | null = null;

export function getDefaultEmojiAliasesCache(): Map<string, string> | null {
  return defaultEmojiAliasesCache;
}

function resolveExpressionAssetUrl(item: ExpressionManifestItem, serverOrigin: string, preferredSize = 64): string | null {
  const absoluteVariants = item.absolute_variants ?? {};
  const relativeVariants = item.variants ?? {};
  const availableSizes = Array.from(
    new Set([
      ...Object.keys(absoluteVariants),
      ...Object.keys(relativeVariants),
    ].map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0))
  ).sort((a, b) => a - b);

  if (availableSizes.length > 0) {
    const exact = availableSizes.find((size) => size === preferredSize);
    const lowerOrEqual = availableSizes.filter((size) => size <= preferredSize);
    const chosen = exact ?? (lowerOrEqual.length > 0 ? lowerOrEqual[lowerOrEqual.length - 1] : availableSizes[0]);
    const chosenKey = String(chosen);
    if (absoluteVariants[chosenKey]) return absoluteVariants[chosenKey];
    if (relativeVariants[chosenKey]) {
      return /^https?:\/\//i.test(relativeVariants[chosenKey])
        ? relativeVariants[chosenKey]
        : `${serverOrigin}${relativeVariants[chosenKey]}`;
    }
  }

  if (item.absolute_url) return item.absolute_url;
  if (/^https?:\/\//i.test(item.file_url)) return item.file_url;
  return `${serverOrigin}${item.file_url}`;
}

export async function loadServerEmoteLookup(
  serverOrigin: string,
  neededNames: readonly string[] = [],
): Promise<CompactExpressionLookup | null> {
  if (isHttpGatewayRealm(serverOrigin)) return null;
  if (emoteLookupInflight.has(serverOrigin)) return emoteLookupInflight.get(serverOrigin) as Promise<CompactExpressionLookup | null>;
  if (lookupRefetchDelayMs(emoteLookupCache, serverOrigin, neededNames) !== 0) return emoteLookupCache.get(serverOrigin) ?? null;

  const task = (async () => {
    recordLookupFetch(serverOrigin, neededNames);
    try {
      const response = await fetch(`${serverOrigin}/api/expressions/manifest`, { credentials: 'omit' });
      if (!response.ok) {
        emoteLookupCache.set(serverOrigin, null);
        return null;
      }
      const payload = await response.json() as ExpressionManifestResponse;
      const lookup: CompactExpressionLookup = new Map();
      const emoteItems: ExpressionManifestItem[] = [
        ...(Array.isArray(payload['anim-emotes']) ? payload['anim-emotes'] : []),
        ...(Array.isArray(payload.emotes) ? payload.emotes : []),
      ];
      const stickerItems: ExpressionManifestItem[] = [
        ...(Array.isArray(payload['anim-stickers']) ? payload['anim-stickers'] : []),
        ...(Array.isArray(payload.stickers) ? payload.stickers : []),
      ];

      for (const item of emoteItems) {
        const normalizedName = normalizeExpressionName(item.name);
        if (!normalizedName) continue;
        const assetUrl = resolveExpressionAssetUrl(item, serverOrigin, 64);
        if (!assetUrl) continue;
        const existing = lookup.get(normalizedName) ?? {};
        if (!existing.emote) existing.emote = assetUrl;
        lookup.set(normalizedName, existing);
      }

      for (const item of stickerItems) {
        const normalizedName = normalizeExpressionName(item.name);
        if (!normalizedName) continue;
        const assetUrl = resolveExpressionAssetUrl(item, serverOrigin, 320);
        if (!assetUrl) continue;
        const existing = lookup.get(normalizedName) ?? {};
        if (!existing.sticker) existing.sticker = assetUrl;
        lookup.set(normalizedName, existing);
      }

      emoteLookupCache.set(serverOrigin, lookup);
      return lookup;
    } catch {
      emoteLookupCache.set(serverOrigin, null);
      return null;
    }
  })();

  emoteLookupInflight.set(serverOrigin, task);
  try {
    return await task;
  } finally {
    emoteLookupInflight.delete(serverOrigin);
  }
}

export function makePersonalLookupKey(origin: string, ownerId: string): string {
  return `${origin}::${ownerId}`;
}

export async function loadPersonalExpressionLookup(
  origin: string,
  ownerId: string,
  neededNames: readonly string[] = [],
): Promise<CompactExpressionLookup | null> {
  const key = makePersonalLookupKey(origin, ownerId);
  if (personalLookupInflight.has(key)) return personalLookupInflight.get(key) as Promise<CompactExpressionLookup | null>;
  if (lookupRefetchDelayMs(personalLookupCache, key, neededNames) !== 0) return personalLookupCache.get(key) ?? null;

  const task = (async () => {
    recordLookupFetch(key, neededNames);
    try {
      const encodedOwner = encodeURIComponent(ownerId);
      const response = await fetch(`${origin}/api/profile/${encodedOwner}/personal-expressions/manifest`, { credentials: 'omit' });
      if (!response.ok) {
        personalLookupCache.set(key, null);
        return null;
      }
      const payload = await response.json() as ExpressionManifestResponse;
      const lookup: CompactExpressionLookup = new Map();
      const emoteItems: ExpressionManifestItem[] = [
        ...(Array.isArray(payload['anim-emotes']) ? payload['anim-emotes'] : []),
        ...(Array.isArray(payload.emotes) ? payload.emotes : []),
      ];
      const stickerItems: ExpressionManifestItem[] = [
        ...(Array.isArray(payload['anim-stickers']) ? payload['anim-stickers'] : []),
        ...(Array.isArray(payload.stickers) ? payload.stickers : []),
      ];

      for (const item of emoteItems) {
        const normalizedName = normalizeExpressionName(item.name);
        if (!normalizedName) continue;
        const assetUrl = resolveExpressionAssetUrl(item, origin, 64);
        if (!assetUrl) continue;
        const existing = lookup.get(normalizedName) ?? {};
        if (!existing.emote) existing.emote = assetUrl;
        lookup.set(normalizedName, existing);
      }

      for (const item of stickerItems) {
        const normalizedName = normalizeExpressionName(item.name);
        if (!normalizedName) continue;
        const assetUrl = resolveExpressionAssetUrl(item, origin, 320);
        if (!assetUrl) continue;
        const existing = lookup.get(normalizedName) ?? {};
        if (!existing.sticker) existing.sticker = assetUrl;
        lookup.set(normalizedName, existing);
      }

      personalLookupCache.set(key, lookup);
      return lookup;
    } catch {
      personalLookupCache.set(key, null);
      return null;
    }
  })();

  personalLookupInflight.set(key, task);
  try {
    return await task;
  } finally {
    personalLookupInflight.delete(key);
  }
}

export async function loadDefaultEmojiAliases(): Promise<Map<string, string>> {
  if (defaultEmojiAliasesCache) return defaultEmojiAliasesCache;
  if (defaultEmojiAliasesPromise) return defaultEmojiAliasesPromise;

  defaultEmojiAliasesPromise = (async () => {
    const [emojiDataModule, iamcalModule, githubModule, emojibaseModule] = await Promise.all([
      import('emojibase-data/en/data.json'),
      import('emojibase-data/en/shortcodes/iamcal.json'),
      import('emojibase-data/en/shortcodes/github.json'),
      import('emojibase-data/en/shortcodes/emojibase.json'),
    ]);

    const emojiData = Array.isArray(emojiDataModule.default) ? emojiDataModule.default : [];
    const shortcodeDatasets: Array<Record<string, string | string[]>> = [
      (iamcalModule.default ?? {}) as Record<string, string | string[]>,
      (githubModule.default ?? {}) as Record<string, string | string[]>,
      (emojibaseModule.default ?? {}) as Record<string, string | string[]>,
    ];
    const aliases = new Map<string, string>();

    for (const entry of emojiData) {
      if (typeof entry?.emoji !== 'string') continue;
      const key = String(entry?.hexcode || '');
      if (!key) continue;

      for (const dataset of shortcodeDatasets) {
        const shortcodeEntry = dataset[key];
        if (!shortcodeEntry) continue;
        const shortcodeValues = Array.isArray(shortcodeEntry) ? shortcodeEntry : [shortcodeEntry];
        for (const code of shortcodeValues) {
          const normalized = normalizeExpressionName(String(code || '').replace(/:/g, ''));
          if (!normalized || aliases.has(normalized)) continue;
          aliases.set(normalized, entry.emoji);
        }
      }
    }

    // Guardrail aliases for common shortcodes expected by users.
    if (!aliases.has('skull')) aliases.set('skull', '💀');
    if (!aliases.has('skull_crossbones')) aliases.set('skull_crossbones', '☠️');

    defaultEmojiAliasesCache = aliases;
    defaultEmojiAliasesPromise = null;
    return aliases;
  })();

  return defaultEmojiAliasesPromise;
}

// --- URL / embed helpers ---

export type LinkPreview = {
  type: 'link' | 'media' | 'kick';
  url: string;
  mime?: string | null;
  animated?: boolean | null;
  siteName?: string | null;
  title?: string | null;
  description?: string | null;
  image?: string | null;
  images?: string[] | null;
  authorName?: string | null;
  authorAvatar?: string | null;
};

export function normalizeEmbedUrls(embed: LinkPreview, baseUrl: string | undefined): LinkPreview {
  return {
    ...embed,
    url: resolveUrlWithBase(embed.url, baseUrl) || embed.url,
    image: resolveUrlWithBase(embed.image || null, baseUrl),
    images: Array.isArray(embed.images)
      ? embed.images
        .map((entry) => resolveUrlWithBase(entry, baseUrl))
        .filter((entry): entry is string => !!entry)
      : null,
    authorAvatar: resolveUrlWithBase(embed.authorAvatar || null, baseUrl),
  };
}

export function decodeExpressionUrl(raw: string, baseUrl: string | null): string | null {
  const decodeSafe = (value: string): string | null => {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
      const path = parsed.pathname.toLowerCase();
      const isExpressionAsset =
        path.includes('/ugc/expressions/') ||
        path.includes('/uploads/expressions/');
      if (!isExpressionAsset) return null;
      return parsed.toString();
    } catch {
      return null;
    }
  };

  const resolveRelative = (value: string): string | null => {
    const trimmed = value.trim();
    const lower = trimmed.toLowerCase();
    const isExpressionAsset =
      lower.startsWith('/ugc/expressions/') ||
      lower.startsWith('/uploads/expressions/');
    if (!isExpressionAsset) return null;

    const fallbackBase = (typeof window !== 'undefined' && /^https?:$/i.test(window.location.protocol))
      ? window.location.origin
      : null;
    const candidateBase = baseUrl || fallbackBase;
    if (!candidateBase) return null;

    try {
      return new URL(trimmed, `${candidateBase}/`).toString();
    } catch {
      return null;
    }
  };

  const decoded = (() => {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  })();

  return decodeSafe(decoded) || decodeSafe(raw) || resolveRelative(decoded) || resolveRelative(raw);
}

export function isTwitterLikeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return (
      host.includes('twitter.com') ||
      host === 'x.com' ||
      host.endsWith('.x.com') ||
      host.includes('vxtwitter.com') ||
      host.includes('fxtwitter.com') ||
      host.includes('fixupx.com') ||
      host.includes('fixvx.com')
    );
  } catch {
    return false;
  }
}

export function isInstagramUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'instagram.com' || host === 'www.instagram.com' || host.endsWith('.instagram.com');
  } catch {
    return false;
  }
}

export function getEmbedRequestOrigin(): string {
  if (typeof window !== 'undefined' && /^https?:$/i.test(window.location.protocol)) {
    return window.location.origin;
  }
  return 'https://catrealm.app';
}

export function toYouTubeEmbed(url: string): string | null {
  try {
    const parsed = new URL(url);
    const embedOrigin = getEmbedRequestOrigin();
    if (parsed.hostname === 'youtu.be') {
      const id = parsed.pathname.replace('/', '');
      return id
        ? `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1&playsinline=1&origin=${encodeURIComponent(embedOrigin)}&widget_referrer=${encodeURIComponent(embedOrigin)}`
        : null;
    }
    if (parsed.hostname.includes('youtube.com')) {
      // Shorts: /shorts/<id>
      const shortsMatch = parsed.pathname.match(/^\/shorts\/([^/?#]+)/);
      if (shortsMatch) {
        const id = shortsMatch[1];
        return `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1&playsinline=1&origin=${encodeURIComponent(embedOrigin)}&widget_referrer=${encodeURIComponent(embedOrigin)}`;
      }
      const id = parsed.searchParams.get('v');
      return id
        ? `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1&playsinline=1&origin=${encodeURIComponent(embedOrigin)}&widget_referrer=${encodeURIComponent(embedOrigin)}`
        : null;
    }
  } catch {
    return null;
  }
  return null;
}

export function toVimeoEmbed(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes('vimeo.com')) return null;
    const id = parsed.pathname.split('/').filter(Boolean)[0];
    return id && /^\d+$/.test(id) ? `https://player.vimeo.com/video/${id}` : null;
  } catch {
    return null;
  }
}

export function canEmbedTwitchInCurrentContext(): boolean {
  return typeof window !== 'undefined' && /^https?:$/i.test(window.location.protocol) && Boolean(window.location.hostname);
}

export function getTwitchChannelFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes('twitch.tv')) return null;
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length !== 1) return null;
    const channel = segments[0];
    return /^[a-zA-Z0-9_]{3,25}$/.test(channel) ? channel : null;
  } catch {
    return null;
  }
}

export function toTwitchChannelEmbed(url: string): string | null {
  const channel = getTwitchChannelFromUrl(url);
  if (!channel || !canEmbedTwitchInCurrentContext()) return null;
  const parent = window.location.hostname;
  return `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&parent=${encodeURIComponent(parent)}&muted=true`;
}

export function toInstagramEmbed(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const supportedHost = host === 'instagram.com' || host === 'www.instagram.com' || host.endsWith('.instagram.com');
    if (!supportedHost) return null;
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length < 2) return null;
    const kind = segments[0].toLowerCase();
    if (!['p', 'reel', 'tv'].includes(kind)) return null;
    const shortcode = segments[1];
    if (!/^[a-zA-Z0-9_-]+$/.test(shortcode)) return null;
    return `https://www.instagram.com/${kind}/${shortcode}/embed/captioned/`;
  } catch {
    return null;
  }
}

export function parseIwaraVideoUrl(url: string): { id: string; slug: string | null } | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const supportedHost = host === 'iwara.tv' || host === 'www.iwara.tv' || host.endsWith('.iwara.tv');
    if (!supportedHost) return null;

    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length < 2) return null;
    if (segments[0].toLowerCase() !== 'video') return null;

    const id = segments[1];
    const slug = segments[2] ?? null;
    if (!/^[A-Za-z0-9]+$/.test(id)) return null;
    if (slug && !/^[A-Za-z0-9_-]+$/.test(slug)) return null;

    return { id, slug };
  } catch {
    return null;
  }
}

export function toIwaraEmbed(url: string): { originalUrl: string; mirrorUrl: string; sources: string[] } | null {
  const videoRef = parseIwaraVideoUrl(url);
  if (!videoRef) return null;
  const canonicalSlug = videoRef.slug || videoRef.id;
  const originalUrl = `https://www.iwara.tv/video/${encodeURIComponent(videoRef.id)}/${encodeURIComponent(canonicalSlug)}`;
  const mirrorUrl = `https://fxiwara.seria.moe/video/${encodeURIComponent(videoRef.id)}/${encodeURIComponent(canonicalSlug)}`;
  // Try several common mirror qualities before falling back to links.
  const sources = ['Source', '1080', '720', '540', '480', '360', '240']
    .map((quality) => `https://fxiwara.seria.moe/dl/${encodeURIComponent(videoRef.id)}/${encodeURIComponent(quality)}`);
  return { originalUrl, mirrorUrl, sources };
}

export function toIwaraDirectMediaUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const isIwaraMediaHost = host.endsWith('.iwara.tv');
    if (!isIwaraMediaHost) return null;
    if (parsed.pathname !== '/view') return null;

    const hash = parsed.searchParams.get('hash');
    const filename = parsed.searchParams.get('filename');
    const path = parsed.searchParams.get('path');
    const expires = parsed.searchParams.get('expires');

    if (!hash || !/^[a-f0-9]{32,128}$/i.test(hash)) return null;
    if (!filename || !/\.(mp4|webm|ogg)$/i.test(filename)) return null;
    if (!path) return null;
    if (!expires || !/^\d{6,}$/.test(expires)) return null;

    return parsed.toString();
  } catch {
    return null;
  }
}

// Re-export helpers used by MessageFormatter
export { normalizeExpressionName, normalizeServerOrigin, normalizeTokenOwnerId };
