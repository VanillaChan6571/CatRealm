import { useEffect } from 'react';
import { Star } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { findFavoriteByUrl, useGifFavoritesStore } from '../../stores/gifFavoritesStore';

/** Klipy's media CDN — only GIFs served from here can be favorited. */
export function isKlipyMediaUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'static.klipy.com' || host === 'static1.klipy.com' || host === 'static2.klipy.com';
  } catch {
    return false;
  }
}

/**
 * Star toggle for a Klipy GIF seen outside the picker (chat embed, media
 * viewer). Favorites live on Central, so it only renders for Central accounts.
 */
export function KlipyFavoriteButton({ url, className = '', size = 14 }: { url: string; className?: string; size?: number }) {
  const isCentral = useAuthStore((s) => s.user?.accountType === 'central');
  const saved = useGifFavoritesStore((s) => !!findFavoriteByUrl(s.favorites, url));
  const busy = useGifFavoritesStore((s) => s.loading || s.busy.size > 0);
  const error = useGifFavoritesStore((s) => s.error);
  const ensureLoaded = useGifFavoritesStore((s) => s.ensureLoaded);
  const toggleUrl = useGifFavoritesStore((s) => s.toggleUrl);

  useEffect(() => { if (isCentral) ensureLoaded(); }, [isCentral, ensureLoaded]);

  if (!isCentral || !isKlipyMediaUrl(url)) return null;
  const label = saved ? 'Remove from favorites' : 'Add to favorites';

  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void toggleUrl(url);
      }}
      disabled={busy}
      aria-label={label}
      aria-pressed={saved}
      title={error ?? label}
      className={`${saved ? 'text-amber-300' : 'text-white'} hover:text-amber-300 disabled:opacity-50 ${className}`}
    >
      <Star size={size} fill={saved ? 'currentColor' : 'none'} />
    </button>
  );
}
