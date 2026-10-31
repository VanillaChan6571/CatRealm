import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatElapsed, type ActivityElapsedFormat } from '../../lib/presenceActivity';
import { fetchIconByTitle } from '../../lib/gameLibraryIcons';
import { fetchAlbumArtByText } from '../../lib/lastfmAlbumArt';

interface ActivityDisplayProps {
  customStatusText?: string | null | undefined;
  activityType: string | null | undefined;
  activityText: string | null | undefined;
  activityStartedAt?: number | null | undefined;
  elapsedFormat?: ActivityElapsedFormat;
  displayMode?: 'status' | 'profile';
  className?: string;
}

export function ActivityDisplay({
  customStatusText,
  activityType,
  activityText,
  activityStartedAt,
  elapsedFormat = 'compact',
  displayMode = 'status',
  className = '',
}: ActivityDisplayProps) {
  const { t } = useTranslation();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [gameIconUrl, setGameIconUrl] = useState<string | null>(null);
  const [albumArt, setAlbumArt] = useState<{ text: string; url: string | null } | null>(null);
  const [failedAlbumArtUrl, setFailedAlbumArtUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!activityStartedAt) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activityStartedAt]);

  useEffect(() => {
    if (activityType !== 'Playing' || !activityText) { setGameIconUrl(null); return; }
    let cancelled = false;
    fetchIconByTitle(activityText).then((url) => { if (!cancelled) setGameIconUrl(url); }).catch(() => {});
    return () => { cancelled = true; };
  }, [activityType, activityText]);

  // Last.fm album art for a mirrored "title — artist" activity; manual
  // Listening text simply misses and keeps the 🎵 icon.
  useEffect(() => {
    if (activityType !== 'Listening' || !activityText) return;
    let cancelled = false;
    fetchAlbumArtByText(activityText).then((url) => { if (!cancelled) setAlbumArt({ text: activityText, url }); }).catch(() => {});
    return () => { cancelled = true; };
  }, [activityType, activityText]);
  const imageUrl = activityType === 'Listening' && albumArt && albumArt.text === activityText ? albumArt.url : null;

  const hasActivity = !!activityType && !!activityText;
  const trimmedCustomStatus = typeof customStatusText === 'string' ? customStatusText.trim() : '';
  if (!trimmedCustomStatus && !hasActivity) return null;

  const elapsed = formatElapsed(activityStartedAt, nowMs, elapsedFormat);
  const activityLabel = activityType === 'Listening' ? t('lastfm.listeningTo') : activityType;

  const iconEl: React.ReactNode = activityType === 'Playing' ? (
    gameIconUrl
      ? <img src={gameIconUrl} alt="" width={14} height={14} className="inline-block rounded-sm object-contain shrink-0 align-middle" style={{ verticalAlign: 'middle' }} onError={() => setGameIconUrl(null)} />
      : '🎮'
  ) : activityType === 'Listening' ? (
    imageUrl && imageUrl !== failedAlbumArtUrl
      ? <img src={imageUrl} alt="" width={14} height={14} className="inline-block rounded-sm object-cover shrink-0 align-middle" style={{ verticalAlign: 'middle' }} onError={() => setFailedAlbumArtUrl(imageUrl)} />
      : '🎵'
  )
    : activityType === 'Watching' ? '📺'
    : null;

  if (displayMode === 'status') {
    return (
      <div className={`text-xs text-text-muted flex items-center gap-1 ${className}`}>
        <span className="truncate">
          {hasActivity ? (
            <>
              {iconEl != null ? <span>{iconEl}{' '}</span> : null}
              {activityType !== 'Custom' && <span className="font-medium">{activityLabel} </span>}
              {activityText}
              {elapsed ? <span className="text-text-muted"> • {elapsed}</span> : null}
            </>
          ) : trimmedCustomStatus ? <span>{trimmedCustomStatus}</span> : null}
        </span>
      </div>
    );
  }

  return (
    <div className={`text-xs text-text-muted flex items-center gap-1 ${className}`}>
      <span className="truncate">
        {trimmedCustomStatus ? <span>{trimmedCustomStatus}</span> : null}
        {trimmedCustomStatus && hasActivity ? <span className="text-text-muted"> • </span> : null}
        {hasActivity ? (
          <>
            {iconEl != null ? <span>{iconEl}{' '}</span> : null}
            {activityType !== 'Custom' && <span className="font-medium">{activityLabel} </span>}
            {activityText}
            {elapsed ? <span className="text-text-muted"> • {elapsed}</span> : null}
          </>
        ) : null}
      </span>
    </div>
  );
}
