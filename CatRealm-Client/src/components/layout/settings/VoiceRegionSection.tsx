import { useEffect, useState, type ReactNode } from 'react';
import {
  getVoiceRegionPreference,
  measureVoiceRegions,
  setVoiceRegionPreference,
  type RegionLatency,
  type VoiceRegionPreference,
} from '../../../lib/voiceRegions';

const REFRESH_MS = 20_000;

function latencyClass(ms: number | null) {
  if (ms === null) return 'text-text-muted';
  if (ms < 80) return 'text-emerald-400';
  if (ms < 160) return 'text-amber-400';
  return 'text-rose-400';
}

/**
 * Central voice region preference. Automatic uses the lowest-latency region;
 * a fixed region is sent as this device's preference instead. Latency is
 * re-measured every 20 seconds while the section is open.
 */
export function VoiceRegionSection() {
  const [preference, setPreference] = useState<VoiceRegionPreference>('auto');
  const [regions, setRegions] = useState<RegionLatency[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getVoiceRegionPreference().then((value) => { if (!cancelled) setPreference(value); });
    const refresh = async () => {
      const measured = await measureVoiceRegions();
      if (!cancelled) setRegions(measured);
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, REFRESH_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  // Hidden until Central offers regions (feature off or unreachable).
  if (regions !== null && regions.length === 0) return null;

  const fastest = (regions ?? [])
    .filter((r) => r.ms !== null)
    .sort((a, b) => (a.ms as number) - (b.ms as number))[0];

  const choose = (next: VoiceRegionPreference) => {
    setPreference(next);
    void setVoiceRegionPreference(next);
  };

  const option = (value: VoiceRegionPreference, title: string, detail: ReactNode) => (
    <button
      key={value}
      type="button"
      onClick={() => choose(value)}
      className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors ${
        preference === value
          ? 'border-accent/70 bg-accent/10 text-text-primary'
          : 'border-border bg-bg-input/50 text-text-muted hover:bg-bg-input'
      }`}
    >
      <span className="text-sm font-medium">{title}</span>
      <span className="text-xs tabular-nums">{detail}</span>
    </button>
  );

  return (
    <div className="space-y-3 bg-bg-hover/30 p-4 rounded-lg">
      <div>
        <p className="text-sm font-medium text-text-primary">Voice region</p>
        <p className="text-xs text-text-muted">
          Used when you start a call or are first into a Central voice channel. Everyone else joins
          the same region. Latency refreshes every 20 seconds.
        </p>
      </div>
      <div className="space-y-2">
        {option('auto', 'Automatic', fastest ? `Lowest: ${fastest.label}` : 'Measuring…')}
        {(regions ?? []).map((region) => option(
          region.id,
          region.label,
          <span className={latencyClass(region.ms)}>{region.ms === null ? 'Unreachable' : `${region.ms} ms`}</span>,
        ))}
      </div>
    </div>
  );
}
