import { useEffect, useRef, useState } from 'react';
import { ArrowsPointingInIcon, ArrowsPointingOutIcon } from '@heroicons/react/24/solid';

type VideoStreamTileProps = {
  stream?: MediaStream | null;
  label: string;
  subtitle?: string;
  isScreenShare: boolean;
  screenshareMetaBadge?: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
};

export function VideoStreamTile({
  stream,
  label,
  subtitle,
  isScreenShare,
  screenshareMetaBadge,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
}: VideoStreamTileProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const hasStream = !!stream;

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !stream) return;
    el.srcObject = stream;
    void el.play().catch(() => {});
    return () => {
      el.srcObject = null;
    };
  }, [stream]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    const container = containerRef.current;
    if (!container) return;
    if (document.fullscreenElement === container) {
      await document.exitFullscreen?.();
      return;
    }
    await container.requestFullscreen?.();
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full aspect-video rounded-xl overflow-hidden border border-white/10 bg-black shadow-2xl"
    >
      {hasStream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className={`w-full h-full ${isScreenShare ? 'object-contain' : 'object-cover transform scale-x-[-1]'}`}
        />
      ) : (
        <div className="w-full h-full bg-gradient-to-br from-bg-tertiary to-bg-secondary flex items-center justify-center">
          <div className="text-center px-6">
            <div className="text-sm font-semibold text-white">{label}</div>
            {subtitle && <div className="text-xs text-white/70 mt-1">{subtitle}</div>}
          </div>
        </div>
      )}

      <div className="absolute top-3 left-3 z-10 text-xs text-white/80 bg-black/50 px-2 py-1 rounded">
        {label}
      </div>

      {hasStream && (
        <button
          type="button"
          onClick={() => { void toggleFullscreen(); }}
          className="absolute top-3 right-3 z-10 inline-flex items-center justify-center w-9 h-9 rounded-md bg-black/70 hover:bg-black/80 text-white transition-colors"
          title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        >
          {isFullscreen ? <ArrowsPointingInIcon className="w-4 h-4" /> : <ArrowsPointingOutIcon className="w-4 h-4" />}
        </button>
      )}

      {hasStream && isScreenShare && screenshareMetaBadge && (
        <div className="absolute top-3 right-14 z-10 text-[10px] text-white/85 bg-black/55 px-2 py-1 rounded whitespace-nowrap">
          {screenshareMetaBadge}
        </div>
      )}

      {onAction && actionLabel && (
        <div className="absolute bottom-3 right-3 z-10 flex items-center gap-2">
          {secondaryActionLabel && onSecondaryAction && (
            <button
              type="button"
              onClick={onSecondaryAction}
              className="px-3 py-1.5 rounded border border-white/30 bg-black/55 hover:bg-black/70 text-[11px] text-white font-medium transition-colors"
            >
              {secondaryActionLabel}
            </button>
          )}
          <button
            type="button"
            onClick={onAction}
            className="px-3 py-1.5 rounded bg-black/70 hover:bg-black/80 text-[11px] text-white font-medium transition-colors"
          >
            {actionLabel}
          </button>
        </div>
      )}
    </div>
  );
}
