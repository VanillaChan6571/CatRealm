/**
 * GIF search client — talks to Central's Klipy-backed proxy (`/api/gif/*`).
 *
 * GIF search is a global, central-account utility (like emoji), not realm
 * content, so these calls always go to Central via `createAuthenticatedApi()`
 * (baseURL = AUTH_BASE, central JWT) regardless of which self-hosted realm is
 * active. The generic `createApi()` would target the active realm — wrong here.
 */

import { createAuthenticatedApi } from './authApi';

export interface GifItem {
  kind: 'gif';
  id: string;
  /** Full-size animated media URL (ends in .gif/.webp so it auto-embeds when sent). */
  url: string;
  /** Smaller variant for the picker grid. */
  previewUrl: string;
  width: number | null;
  height: number | null;
  title: string;
}

/**
 * Klipy inlines ads among the results at a position it chooses. `content` is a
 * URL to render in an iframe — never a GIF, and never sendable as a message.
 */
export interface GifAd {
  kind: 'ad';
  content: string;
  width: number | null;
  height: number | null;
}

export type GifResult = GifItem | GifAd;

export interface GifFavorite extends GifItem {
  product: GifProduct;
  createdAt: number;
}

export interface GifPage {
  results: GifResult[];
  /** Cursor to pass back as `pos` for the next page, or null when exhausted. */
  next: number | null;
}

export const isGifAd = (r: GifResult): r is GifAd => r.kind === 'ad';

/** Which Klipy library to read. `memes` is static images, not animations. */
export type GifProduct = 'gifs' | 'memes';

export interface GifQueryOptions {
  /** Page cursor echoed back from a previous GifPage.next. */
  pos?: number;
  /**
   * Pixel width the picker can give an ad. Klipy serves no creative under 250px
   * and sizes what it sends to this, so it must be the real container width —
   * not a grid cell. Omit it and the response simply carries no ads.
   */
  containerWidth?: number;
  product?: GifProduct;
}

function queryParams(opts?: GifQueryOptions): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  if (opts?.pos) params.pos = opts.pos;
  if (opts?.product && opts.product !== 'gifs') params.product = opts.product;
  if (opts?.containerWidth) {
    params.w = Math.round(opts.containerWidth);
    params.platform = 'desktop';
  }
  return params;
}

/** Reason a GIF request failed, so the UI can distinguish "hide tab" from "retry". */
export type GifErrorCode = 'not_configured' | 'rate_limited' | 'unavailable';

export class GifError extends Error {
  code: GifErrorCode;
  constructor(code: GifErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'GifError';
    this.code = code;
  }
}

function toGifError(err: unknown): GifError {
  const status = (err as { response?: { status?: number } })?.response?.status;
  if (status === 503) return new GifError('not_configured');
  if (status === 429) return new GifError('rate_limited');
  return new GifError('unavailable');
}

/**
 * Central only started tagging entries with `kind` when ads landed, and an older
 * Central is still a supported peer — so an untagged entry with a media URL is a
 * GIF. Anything we can't identify is dropped rather than handed to the grid.
 */
function coerceEntry(raw: unknown): GifResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as Partial<GifItem> & Partial<GifAd> & { kind?: string };
  if (entry.kind === 'ad') return typeof entry.content === 'string' ? (entry as GifAd) : null;
  if (typeof entry.url === 'string') return { ...(entry as GifItem), kind: 'gif' };
  return null;
}

async function fetchGifs(path: string, params: Record<string, string | number>): Promise<GifPage> {
  try {
    const res = await createAuthenticatedApi().get<GifPage>(path, { params });
    const data = res.data;
    const results = Array.isArray(data?.results) ? data.results : [];
    return {
      results: results.map(coerceEntry).filter((r): r is GifResult => r !== null),
      next: typeof data?.next === 'number' ? data.next : null,
    };
  } catch (err) {
    throw toGifError(err);
  }
}

export function trendingGifs(opts?: GifQueryOptions): Promise<GifPage> {
  return fetchGifs('/api/gif/trending', queryParams(opts));
}

export function searchGifs(query: string, opts?: GifQueryOptions): Promise<GifPage> {
  const q = query.trim();
  if (!q) return trendingGifs(opts);
  return fetchGifs('/api/gif/search', { q, ...queryParams(opts) });
}

/** Favorites live on Central so desktop and mobile see the same list. */
export async function getGifFavorites(): Promise<GifFavorite[]> {
  const res = await createAuthenticatedApi().get<{ favorites: GifFavorite[] }>('/api/gif/favorites');
  return Array.isArray(res.data?.favorites) ? res.data.favorites : [];
}

export async function saveGifFavorite(item: GifItem, product: GifProduct): Promise<GifFavorite> {
  const res = await createAuthenticatedApi().post<{ favorite: GifFavorite }>('/api/gif/favorites', {
    product, id: item.id, url: item.url, previewUrl: item.previewUrl,
    title: item.title, width: item.width, height: item.height,
  });
  return res.data.favorite;
}

export async function removeGifFavorite(id: string, product: GifProduct): Promise<void> {
  await createAuthenticatedApi().delete(`/api/gif/favorites/${product}/${encodeURIComponent(id)}`);
}
