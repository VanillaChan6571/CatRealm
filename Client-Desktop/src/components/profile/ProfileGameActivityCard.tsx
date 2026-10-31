import { useEffect, useState } from 'react';
import { GameIcon } from '../ui/GameIcon';
import { fetchIconByTitle } from '../../lib/gameLibraryIcons';

function formatGameElapsedClock(startedAt: number | null | undefined, nowMs: number) {
  if (!Number.isFinite(startedAt) || !startedAt || startedAt <= 0) return null;
  const totalSeconds = Math.max(0, Math.floor(nowMs / 1000) - startedAt);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

interface ProfileGameActivityCardProps {
  title: string;
  startedAt?: number | null;
}

export function ProfileGameActivityCard({
  title,
  startedAt,
}: ProfileGameActivityCardProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [gameIconUrl, setGameIconUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchIconByTitle(title).then((url) => { if (!cancelled) setGameIconUrl(url); }).catch(() => {});
    return () => { cancelled = true; };
  }, [title]);

  useEffect(() => {
    if (!startedAt) return;
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  const elapsed = formatGameElapsedClock(startedAt, nowMs);

  return (
    <div className="rounded-2xl border border-border bg-bg-hover/40 p-4 shadow-[0_18px_50px_rgba(0,0,0,0.2)]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <span className="inline-flex items-center rounded-full border border-accent/30 bg-accent/12 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
          CatLab Experimental
        </span>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-bg-hover/40 shadow-inner overflow-hidden">
          <GameIcon iconUrl={gameIconUrl} size={80} className="rounded-2xl" />
        </div>

        <div className="min-w-0">
          <p className="truncate text-2xl font-semibold text-text-primary">{title}</p>
          <div className="mt-2 flex items-center gap-2 text-sm text-success">
            <span className="text-base leading-none">🎮</span>
            <span>{elapsed ?? 'Active now'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
