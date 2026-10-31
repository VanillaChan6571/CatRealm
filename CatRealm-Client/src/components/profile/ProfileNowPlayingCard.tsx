import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { NowPlaying } from '../../types';
import { formatElapsed } from '../../lib/presenceActivity';

interface ProfileNowPlayingCardProps {
  track: NowPlaying;
}

export function ProfileNowPlayingCard({ track }: ProfileNowPlayingCardProps) {
  const { t } = useTranslation();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [failedArtUrl, setFailedArtUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!track.startedAt) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [track.startedAt]);

  const elapsed = formatElapsed(track.startedAt, nowMs, 'compact');
  const title = track.url
    ? <a href={track.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{track.title}</a>
    : track.title;

  return (
    <div className="rounded-2xl border border-border bg-bg-hover/40 p-4 shadow-[0_18px_50px_rgba(0,0,0,0.2)]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <span className="inline-flex items-center rounded-full border border-accent/30 bg-accent/12 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
          {t('lastfm.cardBadge')}
        </span>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-bg-hover/40 shadow-inner overflow-hidden text-3xl">
          {track.imageUrl && track.imageUrl !== failedArtUrl
            ? <img src={track.imageUrl} alt={track.album ?? ''} className="h-20 w-20 object-cover" onError={() => setFailedArtUrl(track.imageUrl)} />
            : <span aria-hidden>🎵</span>}
        </div>

        <div className="min-w-0">
          <p className="truncate text-xl font-semibold text-text-primary" title={track.title}>{title}</p>
          <p className="truncate text-sm text-text-secondary" title={track.artist}>{t('lastfm.byArtist', { artist: track.artist })}</p>
          {track.album && <p className="truncate text-xs text-text-muted" title={track.album}>{t('lastfm.onAlbum', { album: track.album })}</p>}
          <div className="mt-2 flex items-center gap-2 text-sm text-success">
            <span className="text-base leading-none">🎵</span>
            <span>{elapsed ? t('lastfm.listeningFor', { elapsed }) : t('lastfm.listeningNow')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
