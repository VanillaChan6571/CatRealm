import { useEffect, useState } from 'react';
import { Eye, EyeOff, Radio, Square, Volume2, VolumeX } from 'lucide-react';
import { RADIO_TRACK_TITLE, getRadioPosition, useRadioStore } from '../../lib/catRealmRadio';

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// Decorative equalizer shown while the station is audibly playing. Each bar gets
// a random speed and phase per mount so the sway never settles into a pattern.
function RadioBars({ className }: { className: string }) {
  const [bars] = useState(() => [0, 1, 2, 3].map(() => ({
    animationDuration: `${(1.8 + Math.random() * 1.6).toFixed(2)}s`,
    animationDelay: `${(-Math.random() * 4).toFixed(2)}s`,
  })));
  return (
    <span className={`radio-bars shrink-0 ${className}`} aria-hidden="true">
      {bars.map((style, i) => <span key={i} style={style} />)}
    </span>
  );
}

export function RadioStatusPanel() {
  const status = useRadioStore((s) => s.status);
  const volume = useRadioStore((s) => s.volume);
  const stop = useRadioStore((s) => s.stop);
  const setVolume = useRadioStore((s) => s.setVolume);
  const nightSky = useRadioStore((s) => s.nightSky);
  const toggleNightSky = useRadioStore((s) => s.toggleNightSky);
  const [position, setPosition] = useState(getRadioPosition);

  const active = status === 'playing' || status === 'loading';
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setPosition(getRadioPosition()), 1000);
    return () => clearInterval(id);
  }, [active]);

  if (status === 'stopped') return null;
  const night = nightSky && status !== 'error';
  // The night sky stays dark in every theme, so its text uses fixed light tones.
  const textPrimary = night ? 'text-white' : 'text-text-primary';
  const textMuted = night ? 'text-white/70' : 'text-text-muted';
  const control = night ? 'text-white/60 hover:text-white' : 'text-text-muted hover:text-text-primary';

  return (
    <div
      className={`border-t px-3 py-2 ${night ? 'radio-night border-white/10' : 'bg-bg-elevated border-border'}`}
      data-debug-name="Radio Status Panel"
      data-debug-file="src/components/layout/RadioStatusPanel.tsx"
    >
      <div className="flex items-center gap-2">
        {status === 'playing'
          ? <RadioBars className={night ? 'text-indigo-200' : 'text-accent'} />
          : <Radio size={16} className={`shrink-0 ${status === 'error' ? 'text-danger' : night ? 'text-indigo-200' : 'text-accent'}`} />}
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-medium truncate ${textPrimary}`}>CatRealm Radio</p>
          <p className={`text-[11px] truncate ${textMuted}`}>
            {status === 'error'
              ? 'Station unavailable — try again later'
              : status === 'loading'
                ? `Tuning in to ${RADIO_TRACK_TITLE}…`
                : `${RADIO_TRACK_TITLE} · ${formatClock(position?.current ?? 0)} / ${formatClock(position?.total ?? 0)}`}
          </p>
        </div>
        {status !== 'error' && (
          <button
            type="button"
            onClick={toggleNightSky}
            className={`${control} transition-colors shrink-0 p-1`}
            title={nightSky ? 'Hide night sky' : 'Show night sky'}
            aria-pressed={nightSky}
          >
            {nightSky ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}
        <button
          type="button"
          onClick={stop}
          className={`${control} transition-colors shrink-0 p-1`}
          title={status === 'error' ? 'Dismiss' : 'Stop Radio'}
        >
          <Square size={14} />
        </button>
      </div>
      {status !== 'error' && (
        <div className="mt-1.5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setVolume(volume > 0 ? 0 : 50)}
            className={`${control} transition-colors shrink-0`}
            title={volume > 0 ? 'Mute Radio' : 'Unmute Radio'}
          >
            {volume > 0 ? <Volume2 size={14} /> : <VolumeX size={14} />}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            className={`flex-1 h-1 cursor-pointer ${night ? 'accent-indigo-300' : 'accent-[var(--color-accent)]'}`}
            aria-label="Radio volume"
          />
          <span className={`text-[10px] w-7 text-right tabular-nums ${textMuted}`}>{volume}%</span>
        </div>
      )}
    </div>
  );
}
