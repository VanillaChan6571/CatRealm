import { useEffect, useRef, useState } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';

// Lightweight requestAnimationFrame-based frame meter. Renders nothing when the
// "FPS Overlay" developer toggle is off, so it costs nothing in normal use.
//
// Shows: current FPS, the worst frame in the last window expressed as an
// effective FPS (the "1% low" that captures scroll jank the average hides), and
// the last frame time in ms. The rAF loop only runs while the overlay is on.

type Stats = { fps: number; low: number; ms: number };

function colorFor(fps: number): string {
  if (fps >= 55) return '#4ade80'; // green
  if (fps >= 30) return '#facc15'; // yellow
  return '#f87171'; // red
}

export function FpsOverlay() {
  const enabled = useSettingsStore((s) => s.debugFpsOverlay);
  const [stats, setStats] = useState<Stats>({ fps: 0, low: 0, ms: 0 });
  const raf = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    let last = performance.now();
    let acc = 0; // accumulated time in the current reporting window
    let frames = 0; // frames counted in the current window
    let worstMs = 0; // longest frame in the current window

    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      frames += 1;
      acc += dt;
      if (dt > worstMs) worstMs = dt;

      // Report roughly every 500ms.
      if (acc >= 500) {
        const fps = Math.round((frames * 1000) / acc);
        const low = worstMs > 0 ? Math.round(1000 / worstMs) : fps;
        setStats({ fps, low, ms: Math.round(worstMs * 10) / 10 });
        acc = 0;
        frames = 0;
        worstMs = 0;
      }
      raf.current = requestAnimationFrame(tick);
    };

    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 8,
        right: 8,
        zIndex: 2147483647,
        pointerEvents: 'none',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 11,
        lineHeight: 1.35,
        padding: '6px 9px',
        borderRadius: 6,
        background: 'rgba(0, 0, 0, 0.72)',
        color: '#e5e7eb',
        border: '1px solid rgba(255,255,255,0.12)',
        userSelect: 'none',
        minWidth: 96,
      }}
      aria-hidden
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        <span>FPS</span>
        <span style={{ color: colorFor(stats.fps), fontWeight: 700 }}>{stats.fps}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        <span>1% low</span>
        <span style={{ color: colorFor(stats.low) }}>{stats.low}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, opacity: 0.7 }}>
        <span>worst</span>
        <span>{stats.ms}ms</span>
      </div>
    </div>
  );
}
