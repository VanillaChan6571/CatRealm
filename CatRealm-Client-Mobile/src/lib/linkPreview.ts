/**
 * Link previews (unfurls) for chat messages.
 * Mirrors CatRealm-Client's MessageFormatter fetchPreview: noembed first for broad
 * oEmbed coverage, then the authenticated `/api/embeds` route (X/Twitter,
 * Instagram, Kick, OpenGraph). Central accounts ask Central; local accounts ask
 * their own realm.
 */

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { AUTH_BASE, createApi, createAuthenticatedApi } from './api';

export interface LinkPreview {
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
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function isTwitterLikeUrl(url: string): boolean {
  const host = hostOf(url);
  return (
    host.includes('twitter.com') ||
    host === 'x.com' ||
    host.endsWith('.x.com') ||
    host.includes('vxtwitter.com') ||
    host.includes('fxtwitter.com') ||
    host.includes('fixupx.com') ||
    host.includes('fixvx.com')
  );
}

export function isInstagramUrl(url: string): boolean {
  const host = hostOf(url);
  return host === 'instagram.com' || host.endsWith('.instagram.com');
}

export function getTwitchChannelFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes('twitch.tv')) return null;
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length !== 1) return null;
    return /^[a-zA-Z0-9_]{3,25}$/.test(segments[0]) ? segments[0] : null;
  } catch {
    return null;
  }
}

function resolveUrl(value: string | null | undefined, base: string): string | null {
  if (!value) return null;
  try {
    return new URL(value, base).toString();
  } catch {
    return null;
  }
}

/** `/api/embeds` may return proxied media as relative paths; make them absolute. */
function normalizeEmbedUrls(embed: LinkPreview, base: string): LinkPreview {
  return {
    ...embed,
    url: resolveUrl(embed.url, base) || embed.url,
    image: resolveUrl(embed.image, base),
    images: Array.isArray(embed.images)
      ? embed.images.map((entry) => resolveUrl(entry, base)).filter((entry): entry is string => !!entry)
      : null,
    authorAvatar: resolveUrl(embed.authorAvatar, base),
  };
}

interface NoembedResponse {
  title?: string;
  thumbnail_url?: string;
  provider_name?: string;
  description?: string;
  author_name?: string;
}

async function fetchNoembed(url: string): Promise<LinkPreview | null> {
  const resp = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(url)}`);
  if (!resp.ok) return null;
  const data = (await resp.json()) as NoembedResponse | null;
  if (!data || !(data.title || data.thumbnail_url || data.provider_name)) return null;
  // noembed's Twitch thumbnail is the channel avatar, not a stream frame.
  const isTwitch = hostOf(url).includes('twitch.tv');
  return {
    type: 'link',
    url,
    siteName: data.provider_name || null,
    title: data.title || null,
    description: data.description || (data.author_name ? `By ${data.author_name}` : null),
    image: isTwitch ? null : data.thumbnail_url || null,
    authorName: data.author_name || null,
    authorAvatar: isTwitch ? data.thumbnail_url || null : null,
  };
}

async function fetchServerEmbed(url: string): Promise<LinkPreview | null> {
  const isCentral = useAuthStore.getState().user?.accountType === 'central';
  const api = isCentral ? createAuthenticatedApi() : createApi();
  const base = (isCentral ? AUTH_BASE : api.defaults.baseURL) || AUTH_BASE;
  const resp = await api.get<{ embed?: LinkPreview | null }>('/api/embeds', { params: { url } });
  const embed = resp.data?.embed;
  return embed ? normalizeEmbedUrls(embed, base) : null;
}

const cache = new Map<string, LinkPreview | null>();
const inflight = new Map<string, Promise<LinkPreview | null>>();

export function fetchLinkPreview(url: string): Promise<LinkPreview | null> {
  if (cache.has(url)) return Promise.resolve(cache.get(url) ?? null);
  const pending = inflight.get(url);
  if (pending) return pending;

  const task = (async () => {
    if (!isTwitterLikeUrl(url) && !isInstagramUrl(url)) {
      try {
        const result = await fetchNoembed(url);
        if (result) return result;
      } catch {
        // fall through to the server route
      }
    }
    try {
      return await fetchServerEmbed(url);
    } catch {
      return null;
    }
  })().then((result) => {
    cache.set(url, result);
    inflight.delete(url);
    return result;
  });

  inflight.set(url, task);
  return task;
}

/** Preview for `url` (null while loading, when absent, or when `url` is null). */
export function useLinkPreview(url: string | null): LinkPreview | null {
  const [state, setState] = useState<{ url: string; data: LinkPreview | null } | null>(null);

  useEffect(() => {
    if (!url || cache.has(url)) return;
    let cancelled = false;
    void fetchLinkPreview(url).then((data) => {
      if (!cancelled) setState({ url, data });
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!url) return null;
  if (cache.has(url)) return cache.get(url) ?? null;
  return state?.url === url ? state.data : null;
}
