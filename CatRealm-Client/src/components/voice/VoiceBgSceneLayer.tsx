import type { CSSProperties } from 'react';
import type { VoiceBgScene } from '../../stores/settingsStore';

/**
 * Decorative "signature effect" layer for the voice call background —
 * Xbox-360-style rings, a Steam-style orbit, floating particles, or drifting
 * pixels. Pure DOM + CSS; colors come from the user's palette so re-mixing a
 * scene with different colors just works. When `animated` is false the
 * decorations render static. `.voice-bg-scene` is targeted by the
 * prefers-reduced-motion override in index.css.
 */

// Deterministic pseudo-random in [0,1) so layouts are stable across renders.
function rand(i: number, salt: number) {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function hexWithAlpha(hex: string, alpha: number) {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

function pickColor(colors: string[], i: number) {
  return colors[i % Math.max(colors.length, 1)] ?? '#ffffff';
}

/**
 * Xbox-360-style scene: a pulsing glow orb, wide blurred light bands sweeping
 * across the view (the dashboard "swoosh"), and comet-tail arcs — conic
 * gradients masked into thin rings so each has a bright head fading out
 * behind it, instead of a plain border spinner.
 */
function Rings({ colors, animated }: { colors: string[]; animated: boolean }) {
  const accent = pickColor(colors, 0);
  const secondary = pickColor(colors, 1);
  const comets = [
    { size: '44%', duration: 9, reverse: false, from: 0 },
    { size: '68%', duration: 16, reverse: true, from: 140 },
    { size: '90%', duration: 26, reverse: false, from: 250 },
  ];
  const cometRing = (from: number) =>
    `conic-gradient(from ${from}deg, transparent 0deg, transparent 210deg, ${hexWithAlpha(accent, 0.0)} 210deg, ${hexWithAlpha(accent, 0.85)} 330deg, #ffffff 352deg, transparent 360deg)`;
  const ringMask = 'radial-gradient(closest-side, transparent calc(100% - 6px), #000 calc(100% - 5px))';
  return (
    <>
      {/* Pulsing glow orb anchored bottom-left. */}
      <div
        className="absolute rounded-full"
        style={{
          left: '-15%',
          bottom: '-30%',
          width: '75%',
          aspectRatio: '1',
          background: `radial-gradient(circle, ${hexWithAlpha(accent, 0.45)} 0%, transparent 65%)`,
          filter: 'blur(12px)',
          animation: animated ? 'voiceBgPulse 9s ease-in-out infinite' : undefined,
        }}
      />
      {/* Wide soft light bands sweeping across, dashboard-swoosh style. */}
      {[0, 1].map((i) => (
        <div
          key={`band-${i}`}
          className="absolute rounded-full"
          style={{
            width: '170%',
            aspectRatio: '1',
            left: i === 0 ? '-20%' : '-45%',
            top: i === 0 ? '30%' : '48%',
            border: `48px solid ${hexWithAlpha(i === 0 ? accent : secondary, i === 0 ? 0.16 : 0.11)}`,
            filter: 'blur(16px)',
            animation: animated ? `voiceBgSway ${20 + i * 9}s ease-in-out infinite` : undefined,
          }}
        />
      ))}
      {/* Comet-tail arcs. */}
      {comets.map((comet, i) => (
        <div
          key={`comet-${i}`}
          className="absolute inset-0 m-auto aspect-square rounded-full"
          style={{
            width: comet.size,
            background: cometRing(animated ? 0 : comet.from),
            WebkitMask: ringMask,
            mask: ringMask,
            filter: `drop-shadow(0 0 6px ${hexWithAlpha(accent, 0.7)})`,
            opacity: 0.45 + 0.3 * (comets.length - i) / comets.length,
            animation: animated
              ? `${comet.reverse ? 'voiceBgSpinRev' : 'voiceBgSpin'} ${comet.duration}s linear infinite`
              : undefined,
          }}
        />
      ))}
    </>
  );
}

function Orbit({ colors, animated }: { colors: string[]; animated: boolean }) {
  const accent = pickColor(colors, 0);
  const secondary = pickColor(colors, 1);
  const systems = [
    { size: '58%', knob: 16, duration: 30, reverse: false, color: accent, alpha: 0.45 },
    { size: '30%', knob: 10, duration: 18, reverse: true, color: secondary, alpha: 0.5 },
  ];
  return (
    <>
      {systems.map((sys, i) => (
        <div
          key={i}
          className="absolute inset-0 m-auto aspect-square rounded-full"
          style={{
            width: sys.size,
            border: `2px solid ${hexWithAlpha(sys.color, sys.alpha * 0.6)}`,
            animation: animated
              ? `${sys.reverse ? 'voiceBgSpinRev' : 'voiceBgSpin'} ${sys.duration}s linear infinite`
              : undefined,
            transform: animated ? undefined : `rotate(${i * 200}deg)`,
          }}
        >
          {/* Knob riding the ring, Steam-logo style. */}
          <span
            className="absolute left-1/2 rounded-full"
            style={{
              width: sys.knob,
              height: sys.knob,
              top: -sys.knob / 2,
              marginLeft: -sys.knob / 2,
              background: sys.color,
              boxShadow: `0 0 12px ${hexWithAlpha(sys.color, 0.8)}`,
            }}
          />
        </div>
      ))}
    </>
  );
}

function Drifters({
  colors,
  animated,
  square,
}: {
  colors: string[];
  animated: boolean;
  square: boolean;
}) {
  const count = square ? 12 : 14;
  const salt = square ? 7 : 3;
  return (
    <>
      {Array.from({ length: count }, (_, i) => {
        const size = square ? 6 + rand(i, salt) * 12 : 3 + rand(i, salt) * 7;
        const color = square ? pickColor(colors, i) : pickColor(colors, i % 2);
        const duration = 12 + rand(i, salt + 1) * 16;
        const style: CSSProperties = {
          left: `${(rand(i, salt + 2) * 96 + 2).toFixed(1)}%`,
          width: size,
          height: size,
          background: hexWithAlpha(color, square ? 0.55 : 0.8),
          borderRadius: square ? 2 : '9999px',
          boxShadow: square ? undefined : `0 0 ${size * 2.5}px ${hexWithAlpha(color, 0.6)}`,
        };
        if (animated) {
          style.top = '105%';
          style.animation = `voiceBgRise ${duration.toFixed(1)}s linear infinite`;
          style.animationDelay = `-${(rand(i, salt + 3) * duration).toFixed(1)}s`;
        } else {
          style.top = `${(rand(i, salt + 4) * 88 + 4).toFixed(1)}%`;
          style.opacity = 0.7;
        }
        return <span key={i} className="absolute" style={style} />;
      })}
    </>
  );
}

export function VoiceBgSceneLayer({
  scene,
  colors,
  animated,
}: {
  scene: VoiceBgScene;
  colors: string[];
  animated: boolean;
}) {
  const palette = colors.filter((c) => /^#[0-9a-fA-F]{6}$/.test(c));
  const safeColors = palette.length > 0 ? palette : ['#3a418f'];
  return (
    <div className="voice-bg-scene pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {scene === 'rings' && <Rings colors={safeColors} animated={animated} />}
      {scene === 'orbit' && <Orbit colors={safeColors} animated={animated} />}
      {scene === 'particles' && <Drifters colors={safeColors} animated={animated} square={false} />}
      {scene === 'pixels' && <Drifters colors={safeColors} animated={animated} square />}
    </div>
  );
}
