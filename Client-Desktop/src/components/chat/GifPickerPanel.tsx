/**
 * GIF search panel — the body of the expression picker's "GIFs" tab.
 *
 * Self-contained: owns its search box, trending default, result grid, and
 * infinite scroll. Talks only to Central's Klipy proxy via ../lib/gifApi, and
 * hands the chosen GIF's direct media URL back through `onSelect` (the composer
 * sends it as a message; the URL ends in .gif/.webp so it auto-embeds).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Star } from 'lucide-react';
import {
  searchGifs, trendingGifs,
  type GifAd, type GifFavorite, type GifProduct, type GifResult, type GifError,
} from '../../lib/gifApi';
import { favoriteKey, useGifFavoritesStore } from '../../stores/gifFavoritesStore';

interface GifPickerPanelProps {
  onSelect: (gifUrl: string) => void;
}

const DEBOUNCE_MS = 300;
type GifSection = GifProduct | 'favorites';

/**
 * Sandboxed: scripts yes, no same-origin, no top navigation — this is
 * third-party markup. Popups stay allowed so an ad click can open its landing
 * page, but Electron has no popup blocker, so the frame registers with the
 * desktop main process, which then refuses popups not preceded by a real click.
 */
function AdFrame({ ad }: { ad: GifAd }) {
  useEffect(() => {
    const setMounted = window.electron?.setAdFrameMounted;
    if (!setMounted) return;
    void setMounted(true).catch(() => {});
    return () => { void setMounted(false).catch(() => {}); };
  }, []);
  return (
    <iframe
      src={ad.content}
      title="Advertisement"
      width={ad.width ?? undefined}
      height={ad.height ?? undefined}
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      scrolling="no"
      className="border-0 max-w-full"
    />
  );
}

export function GifPickerPanel({ onSelect }: GifPickerPanelProps) {
  const [query, setQuery] = useState('');
  const [section, setSection] = useState<GifSection>('gifs');
  const [results, setResults] = useState<GifResult[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [errorCode, setErrorCode] = useState<GifError['code'] | null>(null);
  const favorites = useGifFavoritesStore((s) => s.favorites);
  const favoritesLoading = useGifFavoritesStore((s) => s.loading);
  const favoritesError = useGifFavoritesStore((s) => s.error);
  const favoriteBusy = useGifFavoritesStore((s) => s.busy);
  const loadFavorites = useGifFavoritesStore((s) => s.load);
  const toggleFavorite = useGifFavoritesStore((s) => s.toggle);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Guards against a stale in-flight request applying results after the query changed.
  const requestSeq = useRef(0);

  // Refresh on open: another device may have changed the list.
  useEffect(() => { void loadFavorites(); }, [loadFavorites]);

  const runQuery = useCallback(async (q: string, source: GifProduct) => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setErrorCode(null);
    try {
      const opts = { containerWidth: scrollRef.current?.clientWidth ?? 0, product: source };
      const page = q.trim() ? await searchGifs(q, opts) : await trendingGifs(opts);
      if (seq !== requestSeq.current) return;
      setResults(page.results);
      setNext(page.next);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setResults([]);
      setNext(null);
      setErrorCode((err as GifError)?.code ?? 'unavailable');
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, []);

  // Switching library clears the query: a search is scoped to one library, and
  // carrying terms across makes the empty state look like a failure.
  const selectSection = useCallback((next: GifSection) => {
    requestSeq.current++;
    setSection(next);
    setQuery('');
    setLoading(false);
    setLoadingMore(false);
  }, []);

  // Debounced search; also loads trending on first open (empty query).
  useEffect(() => {
    if (section === 'favorites') {
      return;
    }
    const handle = setTimeout(() => { void runQuery(query, section); }, query ? DEBOUNCE_MS : 0);
    return () => clearTimeout(handle);
  }, [query, section, runQuery]);

  const loadMore = useCallback(async () => {
    if (section === 'favorites' || next == null || loadingMore || loading) return;
    const seq = requestSeq.current;
    setLoadingMore(true);
    try {
      const opts = { pos: next, containerWidth: scrollRef.current?.clientWidth ?? 0, product: section };
      const page = query.trim() ? await searchGifs(query, opts) : await trendingGifs(opts);
      if (seq !== requestSeq.current) return;
      setResults((prev) => [...prev, ...page.results]);
      setNext(page.next);
    } catch {
      if (seq === requestSeq.current) setNext(null); // stop paging on error
    } finally {
      if (seq === requestSeq.current) setLoadingMore(false);
    }
  }, [next, loadingMore, loading, query, section]);

  const displayedResults: GifResult[] = section === 'favorites'
    ? favorites.filter((favorite) => favorite.title.toLowerCase().includes(query.trim().toLowerCase()))
    : results;

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) void loadMore();
  }, [loadMore]);

  const errorText = errorCode === 'not_configured'
    ? 'GIF search is not available on this server.'
    : errorCode === 'rate_limited'
      ? 'Too many searches — slow down a moment.'
      : errorCode
        ? 'Could not load GIFs. Try again.'
        : null;

  return (
    <div className="flex flex-col h-full">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={section === 'favorites' ? 'Search favorites' : 'Search KLIPY'}
        aria-label={section === 'favorites' ? 'Search favorites' : 'Search KLIPY'}
        autoFocus
        className="mb-2 w-full px-2 py-1 rounded bg-bg-input border border-border text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
      />

      <div className="mb-2 flex gap-1.5" aria-label="Klipy categories">
        {([['gifs', 'Trending'], ['memes', 'Trending Memes'], ['favorites', 'Favorites']] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => selectSection(id)}
            className={`px-2 py-1 rounded-full border text-xs ${section === id ? 'border-accent bg-accent/15 text-accent' : 'border-border bg-bg-input text-text-secondary hover:text-text-primary'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
        {section === 'favorites' && favoritesLoading ? (
          <div className="text-xs text-text-muted p-2">Loading favorites…</div>
        ) : section === 'favorites' && favoritesError && favorites.length === 0 ? (
          <div className="space-y-2 p-2">
            <div className="text-xs text-danger">{favoritesError}</div>
            <button type="button" onClick={() => void loadFavorites()} className="px-2 py-1 rounded text-xs bg-bg-hover text-text-secondary">Retry</button>
          </div>
        ) : section !== 'favorites' && loading ? (
          <div className="text-xs text-text-muted p-2">Loading GIFs…</div>
        ) : section !== 'favorites' && errorText ? (
          <div className="space-y-2 p-2">
            <div className="text-xs text-danger">{errorText}</div>
            {errorCode !== 'not_configured' && (
              <button
                type="button"
                onClick={() => void runQuery(query, section)}
                className="px-2 py-1 rounded text-xs bg-bg-hover text-text-secondary hover:text-text-primary"
              >
                Retry
              </button>
            )}
          </div>
        ) : displayedResults.length === 0 ? (
          <div className="text-xs text-text-muted p-2">
            {section === 'favorites' ? (query ? 'No matching favorites.' : 'No favorites yet. Star a GIF to save it here.') : 'No GIFs found.'}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {displayedResults.map((item, i) => (
              item.kind === 'ad' ? (
                // Klipy picks the ad's index deliberately, so it stays in place
                // and spans the grid rather than being pulled out or appended.
                <div key={`ad:${i}:${item.content}`} className="col-span-3 flex justify-center py-1">
                  <AdFrame ad={item} />
                </div>
              ) : (() => {
                const itemProduct: GifProduct = section === 'favorites' ? (item as GifFavorite).product : section;
                const key = favoriteKey(itemProduct, item.id);
                const saved = favorites.some((favorite) => favoriteKey(favorite.product, favorite.id) === key);
                return (
                  <div key={key} className="relative rounded border border-border bg-bg-input hover:border-accent overflow-hidden aspect-square">
                    <button type="button" onClick={() => onSelect(item.url)} className="w-full h-full" title={item.title || 'GIF'}>
                      <img src={item.previewUrl} alt={item.title || 'GIF'} loading="lazy" className="w-full h-full object-cover" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void toggleFavorite(item, itemProduct)}
                      disabled={favoritesLoading || favoriteBusy.has(key)}
                      aria-label={saved ? 'Remove from favorites' : 'Add to favorites'}
                      aria-pressed={saved}
                      className={`absolute right-1 top-1 rounded bg-black/75 p-1 hover:text-amber-300 disabled:opacity-50 ${saved ? 'text-amber-300' : 'text-white'}`}
                    >
                      <Star size={16} fill={saved ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                );
              })()
            ))}
          </div>
        )}
        {section !== 'favorites' && loadingMore && <div className="text-xs text-text-muted p-2">Loading more…</div>}
      </div>

      {favoritesError && favorites.length > 0 && <div role="alert" className="px-2 text-xs text-danger">{favoritesError}</div>}

      <div className="pt-1 text-right text-[10px] text-text-muted">Powered by Klipy</div>
    </div>
  );
}
