import { useState, useRef, useEffect, useCallback, useId } from 'react';
import { createPortal } from 'react-dom';

interface AudioPlayerProps {
  src: string;
  className?: string;
}

const BAR_COUNT = 40;
const SPEEDS = [0.75, 1, 1.5, 2] as const;
const VOLUME_POPUP_HEIGHT = 120;
const VOLUME_POPUP_HALF_WIDTH = 24;
const VIEWPORT_MARGIN = 8;
const SPEED_LABELS: Record<number, string> = { 0.75: '0.75X', 1: '1X', 1.5: '1.5X', 2: '2X' };

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || isNaN(seconds)) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function AudioPlayer({ src, className = '' }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const rafRef = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [waveformData, setWaveformData] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [speedIndex, setSpeedIndex] = useState(1); // default 1.0
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [showVolume, setShowVolume] = useState(false);
  const [volumePos, setVolumePos] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const volumeAreaRef = useRef<HTMLDivElement>(null);
  const volumeHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sliderId = useId();

  const startRaf = useCallback(() => {
    const tick = () => {
      const el = audioRef.current;
      if (el) setCurrentTime(el.currentTime);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const stopRaf = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  useEffect(() => { return () => stopRaf(); }, [stopRaf]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setWaveformData([]);

    (async () => {
      try {
        const resp = await fetch(src);
        const arrayBuffer = await resp.arrayBuffer();
        if (cancelled) return;
        const ctx = new AudioContext();
        const safeCloseCtx = () => { if (ctx.state !== 'closed') ctx.close(); };
        const decoded = await ctx.decodeAudioData(arrayBuffer);
        if (cancelled) { safeCloseCtx(); return; }
        const channelData = decoded.getChannelData(0);
        const blockSize = Math.floor(channelData.length / BAR_COUNT);
        const bars: number[] = [];
        for (let i = 0; i < BAR_COUNT; i++) {
          let sum = 0;
          for (let j = 0; j < blockSize; j++) {
            const s = channelData[i * blockSize + j] ?? 0;
            sum += s * s;
          }
          bars.push(Math.sqrt(sum / blockSize)); // RMS per block
        }
        // 3-sample moving average for smooth shape
        const smoothed = bars.map((v, i) => {
          const a = bars[i - 1] ?? v;
          const b = bars[i + 1] ?? v;
          return (a + v + b) / 3;
        });
        const maxVal = Math.max(...smoothed, 0.001);
        const normalized = smoothed.map((v) => v / maxVal);
        if (!cancelled) {
          setWaveformData(normalized);
          setDuration(decoded.duration);
        }
        safeCloseCtx();
      } catch {
        if (!cancelled) setWaveformData(Array(BAR_COUNT).fill(0.4));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [src]);

  const handleEnded = useCallback(() => {
    stopRaf();
    setPlaying(false);
    setCurrentTime(0);
  }, [stopRaf]);

  const togglePlay = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      stopRaf();
      setPlaying(false);
    } else {
      el.play().then(() => { setPlaying(true); startRaf(); }).catch(() => {});
    }
  }, [playing, startRaf, stopRaf]);

  const handleWaveformClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = audioRef.current;
    if (!el || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    el.currentTime = ratio * duration;
    setCurrentTime(el.currentTime);
  }, [duration]);

  const handleVolumeChange = useCallback((v: number) => {
    setVolume(v);
    setMuted(v === 0);
    if (audioRef.current) {
      audioRef.current.volume = v;
      audioRef.current.muted = v === 0;
    }
  }, []);

  const toggleMute = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    const next = !muted;
    setMuted(next);
    el.muted = next;
  }, [muted]);

  const openVolume = useCallback(() => {
    if (volumeHideTimer.current) clearTimeout(volumeHideTimer.current);
    const rect = volumeAreaRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Rendered in a portal with fixed coords so chat/bubble overflow can't clip it.
    const above = rect.top - VOLUME_POPUP_HEIGHT - VIEWPORT_MARGIN > 0;
    const minLeft = VOLUME_POPUP_HALF_WIDTH + VIEWPORT_MARGIN;
    const maxLeft = window.innerWidth - VOLUME_POPUP_HALF_WIDTH - VIEWPORT_MARGIN;
    setVolumePos({
      left: Math.min(maxLeft, Math.max(minLeft, rect.left + rect.width / 2)),
      top: above ? rect.top - VIEWPORT_MARGIN : rect.bottom + VIEWPORT_MARGIN,
      above,
    });
    setShowVolume(true);
  }, []);

  const closeVolume = useCallback(() => {
    volumeHideTimer.current = setTimeout(() => setShowVolume(false), 200);
  }, []);

  // Fixed coords go stale when the message list scrolls or the window resizes.
  useEffect(() => {
    if (!showVolume) return;
    const hide = () => setShowVolume(false);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [showVolume]);

  useEffect(() => () => {
    if (volumeHideTimer.current) clearTimeout(volumeHideTimer.current);
  }, []);

  const cycleSpeed = useCallback(() => {
    const nextIndex = (speedIndex + 1) % SPEEDS.length;
    setSpeedIndex(nextIndex);
    if (audioRef.current) {
      audioRef.current.playbackRate = SPEEDS[nextIndex];
    }
  }, [speedIndex]);

  const progress = duration > 0 ? currentTime / duration : 0;
  const currentSpeed = SPEEDS[speedIndex];

  return (
    <div className={`inline-flex items-center gap-2.5 bg-[#1a1a2e] rounded-full px-3 py-2 ${className}`}>
      <audio
        ref={audioRef}
        src={src}
        onEnded={handleEnded}
        preload="metadata"
        className="hidden"
      />

      {/* Play/pause button — purple filled circle */}
      <button
        type="button"
        onClick={togglePlay}
        disabled={loading}
        className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-accent hover:brightness-110 disabled:opacity-40 transition-all text-white"
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" />
            <rect x="14" y="4" width="4" height="16" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      {/* Waveform */}
      <div
        role="slider"
        aria-valuenow={Math.round(progress * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        tabIndex={0}
        className="flex items-center gap-px h-7 cursor-pointer"
        style={{ width: `${BAR_COUNT * 5}px` }}
        onClick={handleWaveformClick}
        onKeyDown={(e) => {
          const el = audioRef.current;
          if (!el) return;
          if (e.key === 'ArrowRight') el.currentTime = Math.min(duration, el.currentTime + 2);
          if (e.key === 'ArrowLeft') el.currentTime = Math.max(0, el.currentTime - 2);
        }}
      >
        {(loading ? Array(BAR_COUNT).fill(0.4) : waveformData).map((h, i) => {
          const barProgress = i / BAR_COUNT;
          const played = barProgress <= progress;
          return (
            <div
              key={i}
              className={`flex-1 rounded-full transition-colors ${
                loading
                  ? 'bg-white/20 animate-pulse'
                  : played
                    ? 'bg-white/90'
                    : 'bg-white/25'
              }`}
              style={{ height: `${Math.max(15, h * 100)}%` }}
            />
          );
        })}
      </div>

      {/* Current time */}
      <span className="shrink-0 text-xs text-white/70 tabular-nums whitespace-nowrap">
        {formatTime(currentTime)}
      </span>

      {/* Speed button */}
      <button
        type="button"
        onClick={cycleSpeed}
        className="shrink-0 text-[11px] font-semibold text-white/80 hover:text-white bg-white/10 hover:bg-white/20 rounded px-1.5 py-0.5 transition-colors tabular-nums"
        title="Playback speed"
      >
        {SPEED_LABELS[currentSpeed]}
      </button>

      {/* Volume control */}
      <div
        ref={volumeAreaRef}
        className="relative shrink-0 flex items-center"
        onMouseEnter={openVolume}
        onMouseLeave={closeVolume}
      >
        {/* Vertical slider popup */}
        {showVolume && volumePos && createPortal(
          <div
            className={`fixed -translate-x-1/2 ${volumePos.above ? '-translate-y-full' : ''} flex flex-col items-center gap-1 bg-[#1a1a2e] border border-white/10 rounded-lg px-2 py-2 shadow-lg z-[9999]`}
            style={{ left: volumePos.left, top: volumePos.top }}
            onMouseEnter={openVolume}
            onMouseLeave={closeVolume}
          >
            <span className="text-[10px] text-white/50 tabular-nums">{Math.round((muted ? 0 : volume) * 100)}%</span>
            <input
              id={sliderId}
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => handleVolumeChange(Number(e.target.value))}
              className="h-20 cursor-pointer accent-accent"
              style={{ writingMode: 'vertical-lr', direction: 'rtl' } as React.CSSProperties}
            />
          </div>,
          document.body
        )}
        {/* Speaker icon button */}
        <button
          type="button"
          onClick={toggleMute}
          className="text-white/50 hover:text-white/80 transition-colors"
          aria-label={muted ? 'Unmute' : 'Mute'}
        >
          {muted || volume === 0 ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
            </svg>
          ) : volume < 0.5 ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
