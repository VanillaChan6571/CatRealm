import { create } from 'zustand';
import {
  getGifFavorites, removeGifFavorite, saveGifFavorite,
  type GifFavorite, type GifItem, type GifProduct,
} from '../lib/gifApi';

/**
 * One favorites list shared by the GIF picker and the stars on Klipy GIFs in
 * chat / the media viewer, so starring in one place shows everywhere.
 */
interface GifFavoritesState {
  favorites: GifFavorite[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  busy: ReadonlySet<string>;
  load: () => Promise<void>;
  /** Loads once per session; the picker calls `load` to refresh instead. */
  ensureLoaded: () => void;
  toggle: (item: GifItem, product: GifProduct) => Promise<void>;
  /** Star/unstar a GIF known only by its media URL (a chat message). */
  toggleUrl: (url: string) => Promise<void>;
}

export function favoriteKey(product: GifProduct, id: string): string {
  return `${product}:${id}`;
}

export function findFavoriteByUrl(favorites: GifFavorite[], url: string): GifFavorite | undefined {
  return favorites.find((favorite) => favorite.url === url || favorite.id === url);
}

const EMPTY_BUSY: ReadonlySet<string> = new Set();

export const useGifFavoritesStore = create<GifFavoritesState>((set, get) => ({
  favorites: [],
  loading: false,
  loaded: false,
  error: null,
  busy: EMPTY_BUSY,

  load: async () => {
    set({ loading: true, error: null });
    try {
      set({ favorites: await getGifFavorites(), loaded: true });
    } catch {
      set({ error: 'Could not load favorites. Try again.' });
    } finally {
      set({ loading: false });
    }
  },

  ensureLoaded: () => {
    const { loaded, loading } = get();
    if (!loaded && !loading) void get().load();
  },

  toggle: async (item, product) => {
    const key = favoriteKey(product, item.id);
    const { busy, loading, favorites } = get();
    if (busy.has(key) || loading) return;
    const alreadySaved = favorites.some((favorite) => favoriteKey(favorite.product, favorite.id) === key);
    set({ busy: new Set(busy).add(key), error: null });
    const others = (list: GifFavorite[]) => list.filter((favorite) => favoriteKey(favorite.product, favorite.id) !== key);
    try {
      if (alreadySaved) {
        await removeGifFavorite(item.id, product);
        set((state) => ({ favorites: others(state.favorites) }));
      } else {
        const saved = await saveGifFavorite(item, product);
        set((state) => ({ favorites: [saved, ...others(state.favorites)] }));
      }
    } catch {
      set({ error: 'Could not update favorites. Try again.' });
    } finally {
      set((state) => { const next = new Set(state.busy); next.delete(key); return { busy: next }; });
    }
  },

  toggleUrl: async (url) => {
    const existing = findFavoriteByUrl(get().favorites, url);
    if (existing) return get().toggle(existing, existing.product);
    // A chat message carries only the media URL, so it doubles as the id —
    // the same fallback Central uses for Klipy items that arrive without one.
    return get().toggle({ kind: 'gif', id: url, url, previewUrl: url, width: null, height: null, title: '' }, 'gifs');
  },
}));
