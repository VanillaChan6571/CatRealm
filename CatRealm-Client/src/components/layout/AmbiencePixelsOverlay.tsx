import { useEffect, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import { useAmbienceFxStore } from '../../stores/ambienceFxStore';
import { useUIStore } from '../../stores/uiStore';
import { useSettingsStore } from '../../stores/settingsStore';

export function AmbiencePixelsOverlay() {
  const pixels = useAmbienceFxStore((s) => s.pixels);
  const tick = useAmbienceFxStore((s) => s.tick);
  const spawning = useAmbienceFxStore((s) => s.spawning);
  const heavyFxEnabled = useSettingsStore((s) => s.heavyAnimationsEnabled);
  const overlayPaused = useUIStore((s) => s.activeModal === 'adminSettings');
  const trailing = pixels.length > 0;
  const timerRef = useRef<number | null>(null);
  const richCompositor = typeof document !== 'undefined'
    && (document.body.classList.contains('compositor-d3d11') || document.body.classList.contains('compositor-browser'));
  const particleConfig = useMemo(() => (
    richCompositor && heavyFxEnabled
      ? { maxPixels: 56, spawnRatePerSec: 8 }
      : { maxPixels: 24, spawnRatePerSec: 3 }
  ), [heavyFxEnabled, richCompositor]);

  useEffect(() => {
    if (overlayPaused || (!spawning && !trailing)) {
      return;
    }

    tick(0.2, particleConfig);
    timerRef.current = window.setInterval(() => tick(0.2, particleConfig), 200);
    return () => {
      if (timerRef.current != null) window.clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [overlayPaused, particleConfig, spawning, tick, trailing]);

  const active = !overlayPaused && (spawning || trailing);
  if (!active) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[90] overflow-hidden [contain:strict]">
      {spawning && heavyFxEnabled && (
        <div className="absolute inset-0 bg-black/20" />
      )}
      <style>
        {`
          @keyframes ambiencePixelRise {
            0% { opacity: 0; transform: translate3d(0, 0, 0) scale(0.88); }
            10% { opacity: 1; }
            82% { opacity: 0.85; }
            100% { opacity: 0; transform: translate3d(var(--ambience-drift), -118vh, 0) scale(0.55); }
          }
        `}
      </style>
      {pixels.map((pixel) => (
        <div
          key={pixel.id}
          className={`absolute ${richCompositor ? 'rounded-full' : 'rounded-[1px]'}`}
          style={{
            left: `${pixel.xPct}%`,
            top: '102%',
            width: `${richCompositor ? pixel.sizePx * 1.35 : pixel.sizePx}px`,
            height: `${richCompositor ? pixel.sizePx * 1.35 : pixel.sizePx}px`,
            backgroundColor: pixel.color,
            boxShadow: richCompositor
              ? `0 0 10px ${pixel.color}, 0 0 22px ${pixel.color}`
              : `0 0 8px ${pixel.color}`,
            animation: `ambiencePixelRise ${pixel.durationSec}s linear forwards`,
            backfaceVisibility: 'hidden',
            contain: 'strict',
            willChange: 'transform, opacity',
            '--ambience-drift': `${pixel.driftVw}vw`,
          } as CSSProperties}
        />
      ))}
    </div>
  );
}
