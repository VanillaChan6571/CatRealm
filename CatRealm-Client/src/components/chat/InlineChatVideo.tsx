import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Images, Maximize, Minimize, Pause, Pencil, Play, Volume1, Volume2, VolumeX } from 'lucide-react';
import { formatVideoTime, type MediaViewerPlayback } from '../../lib/chatMedia';
import { downloadMediaUrl, mediaFileNameFromUrl } from '../../lib/mediaDownload';
import { useLastAudibleVolume } from '../../hooks/useLastAudibleVolume';

const VOLUME_STORAGE_KEY = 'catrealm.chatVideoVolumePct';

type InlineChatVideoProps = {
  src: string;
  /** Classes for the <video> element itself (size, border, NSFW blur). */
  className?: string;
  /** Classes for the wrapper that positions the overlays. */
  wrapperClassName?: string;
  /** Opens CatRealm's media viewer. */
  onExpand?: (playback: MediaViewerPlayback) => void;
  /** Edits the message this video belongs to; only passed when the viewer may edit it. */
  onModify?: () => void;
  /** File name for the Download button; defaults to the URL's file name. */
  downloadName?: string | null;
  /** Hide every overlay control, e.g. while the parent shows an NSFW/spoiler cover. */
  hideControls?: boolean;
  /** GIF-style preview: loops muted without player controls (callers honour "Disable Autoplay"). */
  loopMuted?: boolean;
};

function halt(event: React.MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
}

function readStoredVolume(): number {
  try {
    const stored = window.localStorage.getItem(VOLUME_STORAGE_KEY);
    const raw = stored === null ? NaN : Number(stored);
    return Number.isFinite(raw) && raw >= 0 && raw <= 100 ? raw : 100;
  } catch {
    return 100;
  }
}


const overlayButton =
  'flex h-7 w-7 items-center justify-center rounded-md bg-black/65 text-white transition-colors hover:bg-black/85 hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';
const barButton =
  'flex h-7 w-7 items-center justify-center rounded text-text-primary transition-colors hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';

/**
 * Chat video with CatRealm's own player chrome. Before playback it shows the first
 * frame with a purple play button (hover pulses in the composer send button's
 * "ready" colours); once started it gets a Theater-style control bar. Nothing ever
 * autoplays with sound. Fullscreen is real fullscreen like Theater's; the media
 * viewer stays reachable from its own button.
 */
export function InlineChatVideo({
  src,
  className = '',
  wrapperClassName = '',
  onExpand,
  onModify,
  downloadName,
  hideControls = false,
  loopMuted = false,
}: InlineChatVideoProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volumePct, setVolumePct] = useState(readStoredVolume);
  const getLastAudibleVolumePct = useLastAudibleVolume(volumePct);
  /** 'native' = element fullscreen; 'window' = CSS cover (Electron window fullscreen / no API). */
  const [fullscreen, setFullscreen] = useState<null | 'native' | 'window'>(null);
  /**
   * The player renders into this stable node. Chat rows sit inside containers that trap
   * `position: fixed` (transforms/containment), so window fullscreen moves the node to
   * <body>. Moving it keeps the same <video> element, so playback carries on.
   */
  const [host] = useState(() => {
    const node = document.createElement('div');
    node.style.display = 'contents';
    return node;
  });
  const anchorRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const parent = fullscreen === 'window' ? document.body : anchorRef.current;
    if (parent && host.parentNode !== parent) parent.appendChild(host);
  }, [fullscreen, host]);

  const fullscreenRef = useRef(fullscreen);
  useEffect(() => {
    fullscreenRef.current = fullscreen;
  }, [fullscreen]);

  useEffect(() => () => {
    host.remove();
    // A chat row can unmount (virtualised list) while its video fills the window.
    if (fullscreenRef.current === 'window') void window.electron?.setWindowFullscreen?.(false).catch(() => {});
  }, [host]);

  // Leaving window fullscreen some other way (F11, OS controls) drops the cover too.
  useEffect(() => {
    if (fullscreen !== 'window') return;
    return window.electron?.onWindowFullscreenChanged?.((active: boolean) => {
      if (!active) setFullscreen(null);
    });
  }, [fullscreen]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || loopMuted) return;
    video.volume = volumePct / 100;
    video.muted = volumePct === 0;
    try {
      window.localStorage.setItem(VOLUME_STORAGE_KEY, String(volumePct));
    } catch {
      // Storage can be unavailable (private mode); volume still applies.
    }
  }, [volumePct, loopMuted]);

  useEffect(() => {
    const onChange = () => {
      if (document.fullscreenElement === containerRef.current) setFullscreen('native');
      else setFullscreen((current) => (current === 'native' ? null : current));
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const exitFullscreen = useCallback(() => {
    if (document.fullscreenElement === containerRef.current) {
      void document.exitFullscreen().catch(() => {});
    }
    if (fullscreen === 'window') void window.electron?.setWindowFullscreen?.(false).catch(() => {});
    setFullscreen(null);
  }, [fullscreen]);

  useEffect(() => {
    if (fullscreen !== 'window') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') exitFullscreen();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen, exitFullscreen]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused || video.ended) {
      // The user pressed play: it plays at their volume (with sound unless they muted).
      setStarted(true);
      void video.play()?.catch?.(() => {});
    } else {
      video.pause();
    }
  };

  const toggleFullscreen = () => {
    if (fullscreen) {
      exitFullscreen();
      return;
    }
    const electronApi = window.electron;
    // Electron's element.requestFullscreen() resolves without doing anything (see Theater).
    if (electronApi?.setWindowFullscreen) {
      setFullscreen('window');
      void electronApi.setWindowFullscreen(true).catch(() => {});
      return;
    }
    const element = containerRef.current;
    if (element?.requestFullscreen) {
      element.requestFullscreen().then(() => setFullscreen('native')).catch(() => setFullscreen('window'));
    } else {
      setFullscreen('window');
    }
  };

  const openViewer = () => {
    const video = videoRef.current;
    const playback: MediaViewerPlayback = video
      ? {
          startTime: video.currentTime,
          // A muted GIF-style loop isn't a user choice to keep sound off, so it doesn't "resume".
          resume: !loopMuted && !video.paused && !video.ended,
          muted: video.muted,
        }
      : {};
    if (video && !loopMuted) video.pause();
    if (fullscreen) exitFullscreen();
    onExpand?.(playback);
  };

  const download = () => {
    void downloadMediaUrl(src, downloadName || mediaFileNameFromUrl(src, 'video'));
  };


  const isFullscreen = fullscreen !== null;
  const showBigPlay = !loopMuted && !playing && (!started || position === 0 || position >= duration);
  const showBar = !loopMuted && started;
  const hoverReveal = 'opacity-0 transition-opacity group-hover/chatvideo:opacity-100 group-focus-within/chatvideo:opacity-100 [@media(hover:none)]:opacity-100';

  const player = (
    <div
      ref={containerRef}
      className={isFullscreen
        ? `group/chatvideo ${fullscreen === 'window' ? 'fixed inset-0 z-[2147483647]' : 'relative h-full w-full'} flex items-center justify-center bg-black`
        : `group/chatvideo relative inline-block max-w-full align-top ${wrapperClassName}`}
      data-testid="inline-chat-video"
    >
      <video
        ref={videoRef}
        src={src}
        autoPlay={loopMuted}
        muted={loopMuted}
        loop={loopMuted}
        playsInline
        preload="metadata"
        className={isFullscreen ? 'block h-full w-full object-contain' : `block ${className}`}
        onClick={loopMuted ? undefined : togglePlay}
        onDoubleClick={loopMuted ? undefined : toggleFullscreen}
        onPlay={() => { setPlaying(true); setStarted(true); }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration || 0)}
      />

      {!hideControls && (
        <>
          {/* Top left: modify / download / open in media viewer */}
          <div className={`absolute left-1.5 top-1.5 z-[2] flex gap-1 ${hoverReveal}`}>
            {onModify && (
              <button type="button" className={overlayButton} title="Modify" aria-label="Modify" onClick={(event) => { halt(event); onModify(); }}>
                <Pencil size={14} />
              </button>
            )}
            <button type="button" className={overlayButton} title="Download" aria-label="Download" onClick={(event) => { halt(event); download(); }}>
              <Download size={14} />
            </button>
            {onExpand && (
              <button type="button" className={overlayButton} title="Open in media viewer" aria-label="Open in media viewer" onClick={(event) => { halt(event); openViewer(); }}>
                <Images size={14} />
              </button>
            )}
          </div>

          {showBigPlay && (
            <button
              type="button"
              onClick={(event) => { halt(event); togglePlay(); }}
              title="Play"
              aria-label="Play video"
              className="absolute left-1/2 top-1/2 z-[1] flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-[#2b1648]/90 text-white shadow-lg transition-transform hover:scale-105 hover:[animation:sendPulse_1.6s_ease-in-out_infinite] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:[animation:sendPulse_1.6s_ease-in-out_infinite]"
            >
              <Play size={24} className="ml-0.5" fill="currentColor" />
            </button>
          )}

          {showBar && (
            <div
              className={`absolute inset-x-0 bottom-0 z-[2] flex flex-col gap-0.5 rounded-b bg-gradient-to-t from-black/95 via-black/70 to-transparent px-2 pb-1.5 pt-4 ${playing ? hoverReveal : ''}`}
              onClick={(e) => e.stopPropagation()}
            >
              {duration > 0 && (
                <input
                  type="range"
                  min={0}
                  max={duration}
                  step={0.1}
                  value={Math.min(position, duration)}
                  onChange={(e) => {
                    const video = videoRef.current;
                    if (video) video.currentTime = Number(e.target.value) || 0;
                  }}
                  className="h-1 w-full cursor-pointer accent-accent"
                  aria-label="Seek"
                />
              )}
              <div className="flex items-center gap-1.5">
                <button type="button" className={barButton} onClick={(event) => { halt(event); togglePlay(); }} title={playing ? 'Pause' : 'Play'} aria-label={playing ? 'Pause' : 'Play'}>
                  {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </button>
                <span className="whitespace-nowrap font-mono text-xs text-text-muted">
                  {formatVideoTime(position)}{duration > 0 ? ` / ${formatVideoTime(duration)}` : ''}
                </span>
                <button
                  type="button"
                  className={barButton}
                  onClick={(event) => { halt(event); setVolumePct((v) => (v === 0 ? getLastAudibleVolumePct() : 0)); }}
                  title={volumePct === 0 ? 'Unmute' : 'Mute'}
                  aria-label={volumePct === 0 ? 'Unmute' : 'Mute'}
                >
                  {volumePct === 0 ? <VolumeX className="h-4 w-4" /> : volumePct < 50 ? <Volume1 className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={volumePct}
                  onChange={(e) => setVolumePct(Number(e.target.value) || 0)}
                  className="w-16 cursor-pointer accent-accent"
                  aria-label="Volume"
                />
                <span className="flex-1" />
                <button
                  type="button"
                  className={barButton}
                  onClick={(event) => { halt(event); toggleFullscreen(); }}
                  title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                  aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                >
                  {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );

  return (
    <>
      <span ref={anchorRef} style={{ display: 'contents' }} />
      {createPortal(player, host)}
    </>
  );
}
