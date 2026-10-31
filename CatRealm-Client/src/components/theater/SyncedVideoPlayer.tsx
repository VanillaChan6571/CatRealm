import { AudioDeafenedIcon, AudioListeningIcon, MicrophoneLiveIcon, MicrophoneMutedIcon } from '../voice/VoiceStateIcons';
import { useRef, useEffect, useCallback, useState, useLayoutEffect } from 'react';
import {
  Cog6ToothIcon,
  VideoCameraIcon as VideoCameraIconOutline,
} from '@heroicons/react/24/outline';
import { VideoCameraIcon } from '@heroicons/react/24/solid';
import { Clapperboard, Lock, Maximize, Minimize, Pause, Play, TriangleAlert, Volume1, Volume2, VolumeX } from 'lucide-react';
import { setTheaterFullscreenActive } from './TheaterVideoManager';
import { useTheaterStore } from '../../stores/theaterStore';
import { useAuthStore } from '../../stores/authStore';
import { useServerStore } from '../../stores/serverStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';
import { useViewedChannels } from '../../hooks/useViewedChannels';
import { useLastAudibleVolume } from '../../hooks/useLastAudibleVolume';
import { PERMISSIONS, hasChannelPermission } from '../../utils/permissions';
import type { TheaterPlaybackState, TheaterQueueItem } from '../../types';

interface ReactionBubble {
  id: string;
  emoji: string;
  x: number;
  createdAt: number;
}

interface SyncedVideoPlayerProps {
  channelId: string;
  canControl: boolean;
  currentItem: TheaterQueueItem | null;
}

interface YouTubeDebugState {
  ready: boolean;
  playerState: number | null;
  currentTimeSec: number;
  durationSec: number;
  lastAction: string;
  lastError: string | null;
}

export function SyncedVideoPlayer({ channelId, canControl, currentItem }: SyncedVideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const syncStateRef = useRef<TheaterPlaybackState | null>(null);
  const [reactionBubbles, setReactionBubbles] = useState<ReactionBubble[]>([]);
  const [youtubeError, setYoutubeError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [youtubeDebugState, setYouTubeDebugState] = useState<YouTubeDebugState>({
    ready: false,
    playerState: null,
    currentTimeSec: 0,
    durationSec: 0,
    lastAction: 'init',
    lastError: null,
  });
  const [volumePct, setVolumePct] = useState(() => {
    if (typeof window === 'undefined') return 100;
    const raw = window.localStorage.getItem('catrealm.theaterVideoVolumePct');
    const parsed = raw ? Number(raw) : 100;
    return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : 100;
  });
  const getLastAudibleVolumePct = useLastAudibleVolume(volumePct);

  // YouTube player refs
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ytPlayerRef = useRef<any>(null);
  const ytWrapperRef = useRef<HTMLDivElement>(null);
  const onYouTubeEndedRef = useRef<() => void>(() => {});
  const youtubePlaybackStartedRef = useRef(false);
  const youtubeRecoveriesRef = useRef(0);
  const youtubeRecoveryWindowRef = useRef(0);
  const youtubeReadyRef = useRef(false);
  const suppressYouTubeStateUntilRef = useRef(0);
  const lastAppliedYouTubeVideoIdRef = useRef<string | null>(null);
  const volumePctRef = useRef(volumePct);
  const lastReportedDurationMsRef = useRef(0);
  const controlsTimerRef = useRef<number | null>(null);
  const [, setRenderTick] = useState(0);

  const state = useTheaterStore((s) => s.state);
  const control = useTheaterStore((s) => s.control);
  const reactions = useTheaterStore((s) => s.reactions);
  const debugEvents = useTheaterStore((s) => s.debugEvents);
  const addDebugEvent = useTheaterStore((s) => s.addDebugEvent);
  const computeExpectedPositionMs = useTheaterStore((s) => s.computeExpectedPositionMs);
  const theaterServerUrl = useTheaterStore((s) => s.theaterServerUrl);
  const activeTheaterChannelId = useTheaterStore((s) => s.activeChannelId);
  const theaterChannelName = useTheaterStore((s) => s.theaterChannelName);
  const micEnabled = useTheaterStore((s) => s.micEnabled);
  const cameraEnabled = useTheaterStore((s) => s.cameraEnabled);
  const selfDeafened = useTheaterStore((s) => s.selfDeafened);
  const toggleCamera = useTheaterStore((s) => s.toggleCamera);
  const toggleMic = useTheaterStore((s) => s.toggleMic);
  const toggleDeafen = useTheaterStore((s) => s.toggleDeafen);
  const leaveTheater = useTheaterStore((s) => s.leaveTheater);
  const debugTheaterStates = useSettingsStore((s) => s.debugTheaterStates);
  const theaterSidePanelRetracted = useUIStore((s) => s.theaterSidePanelRetracted);
  const toggleTheaterSidePanelRetracted = useUIStore((s) => s.toggleTheaterSidePanelRetracted);
  const openModal = useUIStore((s) => s.openModal);
  const channels = useViewedChannels();

  const user = useAuthStore((s) => s.user);
  const authServerUrl = useAuthStore((s) => s.serverUrl);
  const authToken = useAuthStore((s) => s.token);
  const activeServerUrl = useServerStore((s) => s.activeServerUrl);
  const theaterServerToken = useServerStore((s) =>
    theaterServerUrl ? (s.servers.find((srv) => srv.url === theaterServerUrl)?.token ?? null) : null
  );
  const serverBase = theaterServerUrl ?? (user?.accountType === 'central' ? activeServerUrl : authServerUrl);
  const serverToken = user?.accountType === 'central' ? (theaterServerToken ?? authToken) : authToken;
  const micEffectivelyMuted = !micEnabled || selfDeafened;
  const activeTheaterChannel = channels.find((channel) => channel.id === activeTheaterChannelId);
  const canCamera = !!activeTheaterChannel && hasChannelPermission(
    user?.permissions,
    activeTheaterChannel.effective_permissions,
    PERMISSIONS.CAMERA,
  );

  const pushDebug = useCallback((message: string) => {
    addDebugEvent(`[player] ${message}`);
  }, [addDebugEvent]);

  // Resolve a relative server path to an absolute authenticated URL
  const resolveVideoUrl = useCallback((url: string | null | undefined): string | null => {
    if (!url) return null;
    if (/^https?:\/\//i.test(url)) return url; // already absolute
    if (url.startsWith('youtube:')) return url; // YouTube ID — handled by YT iframe player
    return `${serverBase ?? ''}${url}?token=${encodeURIComponent(serverToken ?? '')}`;
  }, [serverBase, serverToken]);

  // Sync incoming reactions to bubbles
  useEffect(() => {
    if (!reactions.length) return;
    const last = reactions[reactions.length - 1];
    if (!last) return;
    const bubble: ReactionBubble = {
      id: last.id,
      emoji: last.emoji,
      x: 10 + Math.random() * 80,
      createdAt: last.at,
    };
    setReactionBubbles((prev) => [...prev.slice(-19), bubble]);
    const timer = setTimeout(() => {
      setReactionBubbles((prev) => prev.filter((b) => b.id !== bubble.id));
    }, 3500);
    return () => clearTimeout(timer);
  }, [reactions]);

  const reportDurationMs = useCallback((rawDurationMs: number) => {
    if (!canControl) return;
    const durationMs = Math.max(0, Math.round(rawDurationMs || 0));
    if (!durationMs) return;
    if (Math.abs(durationMs - lastReportedDurationMsRef.current) < 500) return;
    lastReportedDurationMsRef.current = durationMs;
    control(channelId, { durationMs });
  }, [canControl, channelId, control]);

  const reportPlaybackEnded = useCallback((source: 'native' | 'youtube') => {
    if (!canControl) return;
    const video = videoRef.current;
    const player = ytPlayerRef.current;
    const durationMs = source === 'youtube'
      ? Math.max(0, Math.round((Number(player?.getDuration?.() ?? 0) || 0) * 1000))
      : (video && Number.isFinite(video.duration) ? Math.max(0, Math.round(video.duration * 1000)) : (state?.duration_ms ?? 0));
    const positionMs = durationMs > 0
      ? durationMs
      : (source === 'youtube'
        ? Math.max(0, Math.round((Number(player?.getCurrentTime?.() ?? 0) || 0) * 1000))
        : (video ? Math.max(0, Math.round(video.currentTime * 1000)) : (state?.position_ms ?? 0)));

    pushDebug(`${source} ended; reporting completed playback`);
    control(channelId, {
      playing: false,
      positionMs,
      durationMs: durationMs > 0 ? durationMs : undefined,
    });
  }, [canControl, channelId, control, pushDebug, state?.duration_ms, state?.position_ms]);

  // Keep onYouTubeEnded ref fresh so the YT callback doesn't capture a stale closure
  useLayoutEffect(() => {
    onYouTubeEndedRef.current = () => {
      reportPlaybackEnded('youtube');
    };
  });

  // Derive YouTube video ID from the resolved URL
  const videoUrl = resolveVideoUrl(state?.videoUrl);
  const youtubeVideoId = videoUrl?.startsWith('youtube:') ? videoUrl.slice(8) : null;

  useEffect(() => {
    youtubePlaybackStartedRef.current = false;
    youtubeRecoveriesRef.current = 0;
    youtubeRecoveryWindowRef.current = 0;
    youtubeReadyRef.current = false;
    suppressYouTubeStateUntilRef.current = 0;
    lastAppliedYouTubeVideoIdRef.current = null;
    lastReportedDurationMsRef.current = 0;
    setYoutubeError(null);
    setYouTubeDebugState({
      ready: false,
      playerState: null,
      currentTimeSec: 0,
      durationSec: 0,
      lastAction: youtubeVideoId ? `source youtube:${youtubeVideoId}` : 'source native-video',
      lastError: null,
    });
    pushDebug(youtubeVideoId ? `source youtube:${youtubeVideoId}` : 'source native-video');
  }, [youtubeVideoId, pushDebug]);

  useEffect(() => {
    volumePctRef.current = volumePct;
    window.localStorage.setItem('catrealm.theaterVideoVolumePct', String(volumePct));
  }, [volumePct]);

  useEffect(() => {
    const onFullscreenChange = () => {
      const fullscreenElement = document.fullscreenElement;
      const active = fullscreenElement === containerRef.current;
      setIsNativeFullscreen(active);
      setIsFullscreen(active);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);

    const unsubElectron = window.electron?.onWindowFullscreenChanged?.((fullscreen: boolean) => {
      setIsNativeFullscreen(false);
      setIsFullscreen(fullscreen);
    });

    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      unsubElectron?.();
    };
  }, []);

  useEffect(() => {
    if (!isFullscreen || document.fullscreenElement) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Desktop shells fullscreen the whole window; leave that too, and its change event
      // turns the theater layout off. Otherwise just drop the in-page fullscreen layout.
      const electronApi = window.electron;
      if (electronApi?.setWindowFullscreen) {
        void electronApi.setWindowFullscreen(false).catch(() => setIsFullscreen(false));
      } else {
        setIsFullscreen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isFullscreen]);

  useEffect(() => {
    setTheaterFullscreenActive(isFullscreen);
    return () => {
      setTheaterFullscreenActive(false);
    };
  }, [isFullscreen]);

  const isDownloading = currentItem?.cache_status === 'downloading' || currentItem?.cache_status === 'pending';
  const isError = currentItem?.cache_status === 'error';
  const hasPlayableMedia = (!!youtubeVideoId || (!!videoUrl && !isDownloading && !isError)) && !youtubeError;

  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (controlsTimerRef.current !== null) {
      window.clearTimeout(controlsTimerRef.current);
    }
    if (!hasPlayableMedia) return;
    controlsTimerRef.current = window.setTimeout(() => {
      setControlsVisible(false);
      controlsTimerRef.current = null;
    }, 2500);
  }, [hasPlayableMedia]);

  useEffect(() => {
    if (!hasPlayableMedia) {
      setControlsVisible(true);
      if (controlsTimerRef.current !== null) {
        window.clearTimeout(controlsTimerRef.current);
        controlsTimerRef.current = null;
      }
      return undefined;
    }
    showControls();
    return () => {
      if (controlsTimerRef.current !== null) {
        window.clearTimeout(controlsTimerRef.current);
        controlsTimerRef.current = null;
      }
    };
  }, [hasPlayableMedia, showControls]);

  useEffect(() => {
    if (!state?.playing) return undefined;
    const timer = window.setInterval(() => {
      setRenderTick((tick) => tick + 1);
    }, 250);
    return () => window.clearInterval(timer);
  }, [state?.playing]);

  const computeExpectedSeconds = useCallback((playbackState: TheaterPlaybackState | null, clampToDuration = true) => {
    if (!playbackState) return 0;
    const elapsed = playbackState.playing ? Math.max(0, Date.now() - playbackState.updated_at) : 0;
    const expectedMs = Math.max(0, playbackState.position_ms + elapsed);
    const durationMs = playbackState.duration_ms && playbackState.duration_ms > 0 ? playbackState.duration_ms : 0;
    const normalizedMs = clampToDuration && durationMs > 0 ? Math.min(expectedMs, durationMs) : expectedMs;
    return normalizedMs / 1000;
  }, []);

  const syncYouTubePlayer = useCallback((
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    player: any,
    playbackState: TheaterPlaybackState | null,
    videoId: string,
    forceReload = false,
  ) => {
    if (!player || !videoId || !playbackState) return;
    const rawExpectedSec = computeExpectedSeconds(playbackState, false);
    const expectedSec = computeExpectedSeconds(playbackState, true);
    const currentVideoId = String(player.getVideoData?.()?.video_id ?? '');
    const currentTime = Number(player.getCurrentTime?.() ?? 0);
    const ytState = Number(player.getPlayerState?.() ?? -1);
    const needsFreshVideo = forceReload || currentVideoId !== videoId || lastAppliedYouTubeVideoIdRef.current !== videoId;
    const durationSec = playbackState.duration_ms && playbackState.duration_ms > 0
      ? playbackState.duration_ms / 1000
      : 0;
    const overflowedPlaybackClock = durationSec > 0 && rawExpectedSec >= durationSec + 1;

    suppressYouTubeStateUntilRef.current = Date.now() + 1600;

    if (needsFreshVideo) {
      if (playbackState.playing) {
        player.loadVideoById?.({ videoId, startSeconds: expectedSec });
        youtubePlaybackStartedRef.current = expectedSec > 0;
        setYouTubeDebugState((prev) => ({ ...prev, lastAction: `loadVideoById(${videoId}, ${expectedSec.toFixed(2)}s)` }));
        pushDebug(`sync load video=${videoId} at=${expectedSec.toFixed(2)} playing=1`);
      } else {
        player.cueVideoById?.({ videoId, startSeconds: expectedSec });
        youtubePlaybackStartedRef.current = false;
        setYouTubeDebugState((prev) => ({ ...prev, lastAction: `cueVideoById(${videoId}, ${expectedSec.toFixed(2)}s)` }));
        pushDebug(`sync cue video=${videoId} at=${expectedSec.toFixed(2)} playing=0`);
      }
      lastAppliedYouTubeVideoIdRef.current = videoId;
      return;
    }

    if (playbackState.pendingAutoAdvance && playbackState.playing) {
      setYouTubeDebugState((prev) => ({ ...prev, lastAction: 'pending auto-advance' }));
      return;
    }

    const drift = Math.abs(currentTime - expectedSec);
    if (drift > (playbackState.playing ? 2 : 0.75)) {
      player.seekTo?.(expectedSec, true);
      setYouTubeDebugState((prev) => ({ ...prev, lastAction: `seekTo(${expectedSec.toFixed(2)}s)` }));
      pushDebug(`sync seek drift=${drift.toFixed(2)} expected=${expectedSec.toFixed(2)} current=${currentTime.toFixed(2)}`);
    }

    if (playbackState.playing) {
      if (overflowedPlaybackClock) {
        if (ytState === 1 || ytState === 3) {
          player.pauseVideo?.();
        }
        setYouTubeDebugState((prev) => ({ ...prev, lastAction: `suppress stale-end raw=${rawExpectedSec.toFixed(2)}s` }));
        pushDebug(`sync suppress stale-end expected=${rawExpectedSec.toFixed(2)} duration=${durationSec.toFixed(2)}`);
        return;
      }
      if (ytState !== 1 && ytState !== 3) {
        player.playVideo?.();
        setYouTubeDebugState((prev) => ({ ...prev, lastAction: 'playVideo()' }));
        pushDebug(`sync play ytState=${ytState}`);
      }
    } else {
      player.pauseVideo?.();
      setYouTubeDebugState((prev) => ({ ...prev, lastAction: 'pauseVideo()' }));
      pushDebug(`sync pause ytState=${ytState}`);
      if (expectedSec <= 0.25 && currentTime <= 0.25) {
        player.cueVideoById?.({ videoId, startSeconds: 0 });
        youtubePlaybackStartedRef.current = false;
        setYouTubeDebugState((prev) => ({ ...prev, lastAction: `cueVideoById(${videoId}, 0s)` }));
        pushDebug(`sync recue video=${videoId} at=0`);
      }
    }
  }, [computeExpectedSeconds, pushDebug]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.volume = volumePct / 100;
      video.muted = volumePct === 0;
    }
    const player = ytPlayerRef.current;
    if (player?.setVolume) {
      player.setVolume(volumePct);
      if (volumePct === 0) player.mute?.();
      else player.unMute?.();
    }
  }, [volumePct, youtubeVideoId]);

  useEffect(() => {
    if (!debugTheaterStates || !youtubeVideoId) return undefined;
    const timer = window.setInterval(() => {
      const player = ytPlayerRef.current;
      if (!player) return;
      setYouTubeDebugState((prev) => ({
        ...prev,
        ready: youtubeReadyRef.current,
        playerState: Number(player.getPlayerState?.() ?? prev.playerState ?? -1),
        currentTimeSec: Number(player.getCurrentTime?.() ?? prev.currentTimeSec ?? 0),
        durationSec: Number(player.getDuration?.() ?? prev.durationSec ?? 0),
      }));
    }, 500);
    return () => window.clearInterval(timer);
  }, [debugTheaterStates, youtubeVideoId]);

  // Load YouTube iframe API and create player when a YouTube item is active
  useEffect(() => {
    if (!youtubeVideoId) return;
    let destroyed = false;

    function initPlayer() {
      const wrapper = ytWrapperRef.current;
      if (!wrapper || destroyed) return;
      // Create a fresh target div inside wrapper for YT to replace with iframe
      wrapper.innerHTML = '';
      const div = document.createElement('div');
      div.style.width = '100%';
      div.style.height = '100%';
      wrapper.appendChild(div);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ytPlayerRef.current = new (window as any).YT.Player(div, {
        width: '100%',
        height: '100%',
        playerVars: { autoplay: 0, controls: 0, modestbranding: 1, rel: 0, playsinline: 1 },
        events: {
          onReady: (event: { target: { seekTo: (s: number, b: boolean) => void; playVideo: () => void } }) => {
            if (destroyed) return;
            youtubeReadyRef.current = true;
            setYoutubeError(null);
            pushDebug(`yt ready video=${youtubeVideoId ?? '-'}`);
            setYouTubeDebugState((prev) => ({
              ...prev,
              ready: true,
              playerState: Number(ytPlayerRef.current?.getPlayerState?.() ?? prev.playerState ?? -1),
              currentTimeSec: Number(ytPlayerRef.current?.getCurrentTime?.() ?? 0),
              durationSec: Number(ytPlayerRef.current?.getDuration?.() ?? 0),
              lastAction: 'onReady',
              lastError: null,
            }));
            ytPlayerRef.current?.setVolume?.(volumePctRef.current);
            if (volumePctRef.current === 0) ytPlayerRef.current?.mute?.();
            else ytPlayerRef.current?.unMute?.();
            const s = syncStateRef.current;
            if (s) {
              const currentYoutubeVideoId = youtubeVideoId;
              if (currentYoutubeVideoId) {
                syncYouTubePlayer(event.target, s, currentYoutubeVideoId, true);
              }
            }
          },
          onStateChange: (event: { data: number }) => {
            if (destroyed) return;
            const now = Date.now();
            setYouTubeDebugState((prev) => ({
              ...prev,
              ready: youtubeReadyRef.current,
              playerState: event.data,
              currentTimeSec: Number(ytPlayerRef.current?.getCurrentTime?.() ?? prev.currentTimeSec ?? 0),
              durationSec: Number(ytPlayerRef.current?.getDuration?.() ?? prev.durationSec ?? 0),
              lastAction: `onStateChange(${describeYouTubeState(event.data)})`,
            }));
            pushDebug(`yt state=${describeYouTubeState(event.data)} time=${Number(ytPlayerRef.current?.getCurrentTime?.() ?? 0).toFixed(2)} duration=${Number(ytPlayerRef.current?.getDuration?.() ?? 0).toFixed(2)}`);
            const duration = Number(ytPlayerRef.current?.getDuration?.() ?? 0);
            if (duration > 0) reportDurationMs(duration * 1000);
            if (now < suppressYouTubeStateUntilRef.current) {
              return;
            }
            if (event.data === 1) {
              youtubePlaybackStartedRef.current = true;
              youtubeRecoveriesRef.current = 0;
              youtubeRecoveryWindowRef.current = 0;
              setYoutubeError(null);
              return;
            }
            if (event.data === 2 || event.data === 5 || event.data === -1) {
              return;
            }
            if (event.data === 0) {
              const player = ytPlayerRef.current;
              const currentTime = Number(player?.getCurrentTime?.() ?? 0);
              const looksEnded = youtubePlaybackStartedRef.current
                && duration > 0
                && currentTime >= Math.max(1, duration - 2);

              if (looksEnded) {
                pushDebug('yt ended normally');
                onYouTubeEndedRef.current(); // 0 = ended
              } else {
                if (now - youtubeRecoveryWindowRef.current > 10000) {
                  youtubeRecoveryWindowRef.current = now;
                  youtubeRecoveriesRef.current = 0;
                }
                const s = syncStateRef.current;
                const expectedSec = s
                  ? Math.max(0, s.position_ms + (s.playing ? Math.max(0, Date.now() - s.updated_at) : 0)) / 1000
                  : Math.max(0, currentTime);

                if (s?.playing && youtubeRecoveriesRef.current < 2) {
                  youtubeRecoveriesRef.current += 1;
                  try {
                    suppressYouTubeStateUntilRef.current = Date.now() + 1200;
                    player?.seekTo?.(expectedSec, true);
                    player?.playVideo?.();
                    setYouTubeDebugState((prev) => ({ ...prev, lastAction: `recovery seek=${expectedSec.toFixed(2)} play` }));
                    pushDebug(`yt recovery attempt=${youtubeRecoveriesRef.current} seek=${expectedSec.toFixed(2)}`);
                  } catch {
                    // Ignore recovery call failures.
                  }
                } else {
                  setYoutubeError('YouTube embed stopped unexpectedly before the video finished.');
                  setYouTubeDebugState((prev) => ({ ...prev, lastError: 'Unexpected early stop', lastAction: 'unexpected-ended' }));
                  pushDebug('yt unexpected early stop');
                }
              }
            }
          },
          onError: (event: { data: number }) => {
            if (destroyed) return;
            const code = event?.data;
            const message = code === 101 || code === 150
              ? 'This YouTube video does not allow embedded playback.'
              : 'YouTube playback failed for this video.';
            setYoutubeError(message);
            setYouTubeDebugState((prev) => ({ ...prev, lastError: `${message} (code ${code})`, lastAction: `onError(${code})` }));
            pushDebug(`yt error code=${code} message=${message}`);
          },
        },
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof (window as any).YT?.Player === 'function') {
      initPlayer();
    } else {
      if (!document.getElementById('yt-iframe-api')) {
        const script = document.createElement('script');
        script.id = 'yt-iframe-api';
        script.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(script);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const prev = (window as any).onYouTubeIframeAPIReady;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).onYouTubeIframeAPIReady = () => {
        if (typeof prev === 'function') prev();
        initPlayer();
      };
    }

    return () => {
      destroyed = true;
      youtubeReadyRef.current = false;
      try { ytPlayerRef.current?.destroy(); } catch { /* ignore */ }
      ytPlayerRef.current = null;
      const wrapper = ytWrapperRef.current;
      if (wrapper) wrapper.innerHTML = '';
    };
  }, [youtubeVideoId, reportDurationMs, syncYouTubePlayer]);

  // Apply sync from server state to video element or YouTube player
  useEffect(() => {
    const prevState = syncStateRef.current;
    syncStateRef.current = state;
    if (!state) return;

    const expectedSec = computeExpectedSeconds(state);

    if (youtubeVideoId) {
      // YouTube sync
      const player = ytPlayerRef.current;
      if (!player || !youtubeReadyRef.current) return;
      try {
        const currentYoutubeVideoId = youtubeVideoId;
        const forceReload = prevState?.videoUrl !== state.videoUrl;
        syncYouTubePlayer(player, state, currentYoutubeVideoId, forceReload);
      } catch { /* ignore */ }
      return;
    }

    // Regular video sync
    const video = videoRef.current;
    if (!video) return;

    if (state.pendingAutoAdvance && prevState?.videoUrl === state.videoUrl && state.playing) {
      return;
    }

    const drift = Math.abs(video.currentTime - expectedSec);
    if (drift > 3) video.currentTime = expectedSec;

    if (state.playing && video.paused && !video.ended) {
      video.play().catch(() => {});
    } else if (!state.playing) {
      video.pause();
    }

    if (prevState?.videoUrl !== state.videoUrl && state.videoUrl && !state.videoUrl.startsWith('youtube:')) {
      video.src = resolveVideoUrl(state.videoUrl) ?? '';
      video.currentTime = expectedSec;
      if (state.playing) video.play().catch(() => {});
    }
  }, [state, resolveVideoUrl, youtubeVideoId, computeExpectedSeconds, syncYouTubePlayer]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || youtubeVideoId) return;

    const onLoadedMetadata = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        reportDurationMs(video.duration * 1000);
        pushDebug(`native metadata duration=${video.duration.toFixed(2)}s`);
      }
    };

    video.addEventListener('loadedmetadata', onLoadedMetadata);
    return () => video.removeEventListener('loadedmetadata', onLoadedMetadata);
  }, [videoUrl, youtubeVideoId, reportDurationMs, pushDebug]);

  const handlePlayPause = useCallback(() => {
    if (!canControl || !state) return;
    const video = videoRef.current;
    const player = ytPlayerRef.current;
    const positionMs = youtubeVideoId
      ? Math.floor((Number(player?.getCurrentTime?.() ?? 0) || 0) * 1000)
      : (video ? Math.floor(video.currentTime * 1000) : state.position_ms);
    const inlineDurationMs = youtubeVideoId
      ? Math.max(0, Math.round((Number(player?.getDuration?.() ?? 0) || 0) * 1000))
      : (video && Number.isFinite(video.duration) ? Math.max(0, Math.round(video.duration * 1000)) : (state.duration_ms ?? 0));
    pushDebug(`ui ${state.playing ? 'pause' : 'play'} positionMs=${positionMs}`);
    control(channelId, {
      playing: !state.playing,
      positionMs,
      durationMs: inlineDurationMs > 0 ? inlineDurationMs : undefined,
    });
  }, [canControl, state, control, channelId, youtubeVideoId, pushDebug]);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canControl) return;
    const positionSec = parseFloat(e.target.value);
    const positionMs = Math.floor(positionSec * 1000);
    const video = videoRef.current;
    const inlineDurationMs = youtubeVideoId
      ? Math.max(0, Math.round((Number(ytPlayerRef.current?.getDuration?.() ?? 0) || 0) * 1000))
      : (video && Number.isFinite(video.duration) ? Math.max(0, Math.round(video.duration * 1000)) : (state?.duration_ms ?? 0));
    if (youtubeVideoId) {
      try { ytPlayerRef.current?.seekTo?.(positionSec, true); } catch { /* ignore */ }
    } else if (video) {
      video.currentTime = positionSec;
    }
    pushDebug(`ui seek positionSec=${positionSec.toFixed(2)} playing=${state?.playing ? '1' : '0'}`);
    control(channelId, {
      positionMs,
      playing: state?.playing ?? false,
      durationMs: inlineDurationMs > 0 ? inlineDurationMs : undefined,
    });
  }, [canControl, control, channelId, state, youtubeVideoId, pushDebug]);

  const handleVideoEnded = useCallback(() => {
    reportPlaybackEnded('native');
  }, [reportPlaybackEnded]);

  const durationSec = (state?.duration_ms && state.duration_ms > 0)
    ? state.duration_ms / 1000
    : (currentItem?.duration_seconds ?? 0);
  const positionSec = state
    ? computeExpectedSeconds(state)
    : 0;
  const pendingAutoAdvance = state?.pendingAutoAdvance ?? null;
  const pendingDurationMs = pendingAutoAdvance
    ? Math.max(1, pendingAutoAdvance.endsAt - pendingAutoAdvance.startedAt)
    : 1;
  const pendingElapsedMs = pendingAutoAdvance
    ? Math.max(0, Math.min(pendingDurationMs, Date.now() - pendingAutoAdvance.startedAt))
    : 0;
  const pendingProgressPct = pendingAutoAdvance
    ? Math.max(0, Math.min(100, (pendingElapsedMs / pendingDurationMs) * 100))
    : 0;
  const pendingSecondsLeft = pendingAutoAdvance
    ? Math.max(0, Math.ceil((pendingAutoAdvance.endsAt - Date.now()) / 1000))
    : 0;
  const toggleVolumeMute = useCallback(() => {
    setVolumePct((current) => (current === 0 ? getLastAudibleVolumePct() : 0));
  }, [getLastAudibleVolumePct]);

  const toggleFullscreen = useCallback(async () => {
    // In Electron, element.requestFullscreen() resolves silently without doing
    // anything — use the native BrowserWindow fullscreen via IPC instead.
    const electronApi = window.electron;
    if (electronApi?.setWindowFullscreen && electronApi?.getWindowFullscreen) {
      try {
        const current = await electronApi.getWindowFullscreen();
        await electronApi.setWindowFullscreen(!current);
      } catch {
        setIsNativeFullscreen(false);
        setIsFullscreen((f) => !f);
      }
      return;
    }

    const element = containerRef.current;
    if (!element) {
      setIsFullscreen((f) => !f);
      return;
    }

    if (isFullscreen) {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {
          setIsNativeFullscreen(false);
          setIsFullscreen(false);
        });
      } else {
        setIsFullscreen(false);
      }
      return;
    }

    if (element.requestFullscreen) {
      element.requestFullscreen()
        .then(() => {
          setIsNativeFullscreen(true);
          setIsFullscreen(true);
        })
        .catch(() => {
          setIsNativeFullscreen(false);
          setIsFullscreen(true);
        });
    } else {
      setIsNativeFullscreen(false);
      setIsFullscreen(true);
    }
  }, [isFullscreen]);

  const openFullscreenVoiceSettings = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    window.electron?.setWindowFullscreen?.(false).catch?.(() => {});
    setIsNativeFullscreen(false);
    setIsFullscreen(false);
    openModal('profileSettings', { initialTab: 'voice' });
  }, [openModal]);

function formatTime(sec: number) {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    if (h > 0) return `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  }

  const player = (
    <div
      ref={containerRef}
      className={isFullscreen
        ? (isNativeFullscreen
          ? 'relative h-screen w-screen overflow-hidden bg-black'
          : 'fixed inset-0 z-[2147483647] overflow-hidden bg-black')
        : 'relative w-full h-full bg-black rounded-xl overflow-hidden'}
      data-debug-name="Synced Video Player"
      data-debug-file="src/components/theater/SyncedVideoPlayer.tsx"
      onMouseMove={showControls}
      onPointerMove={showControls}
    >
      {/* Video */}
      <div
        className="absolute inset-0 bg-black"
        data-debug-name="Synced Video Surface"
        data-debug-file="src/components/theater/SyncedVideoPlayer.tsx"
        onMouseMove={showControls}
        onPointerMove={showControls}
      >
        {youtubeVideoId ? (
          <>
            <div ref={ytWrapperRef} className="absolute inset-0 w-full h-full" />
            <button
              type="button"
              className="absolute inset-0 z-10 bg-transparent cursor-default"
              onClick={canControl ? handlePlayPause : undefined}
              onDoubleClick={toggleFullscreen}
              title={canControl ? 'Use CatRealm Theater controls to play or pause.' : 'Playback is controlled by the Theater host.'}
              aria-label={canControl ? 'Use synced Theater playback controls' : 'Theater playback is controlled by the host'}
            />
            {youtubeError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 text-white gap-2 px-6 text-center">
                <TriangleAlert className="h-10 w-10" />
                <p className="text-sm text-white">{youtubeError}</p>
              </div>
            )}
          </>
        ) : videoUrl && !isDownloading && !isError ? (
          <video
            ref={videoRef}
            src={videoUrl}
            className="w-full h-full object-contain"
            onEnded={handleVideoEnded}
            playsInline
            preload="auto"
          />
        ) : isDownloading ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white gap-3">
            <Clapperboard className="h-10 w-10" />
            <p className="text-sm text-text-muted">Downloading video…</p>
            <div className="w-48 bg-bg-hover rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-accent transition-all duration-300"
                style={{ width: `${currentItem?.cache_progress ?? 0}%` }}
              />
            </div>
            <p className="text-xs text-text-muted">{currentItem?.cache_progress ?? 0}%</p>
          </div>
        ) : isError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white gap-2">
            <TriangleAlert className="h-10 w-10" />
            <p className="text-sm text-text-muted">Failed to load video</p>
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white gap-2">
            <Clapperboard className="h-12 w-12" />
            <p className="text-sm text-text-muted">
              {currentItem ? 'Preparing…' : 'Nothing in queue'}
            </p>
          </div>
        )}

        {pendingAutoAdvance && (
          <div className="absolute left-4 right-4 top-4 z-30 overflow-hidden rounded-lg border border-accent/50 bg-bg-elevated/95 shadow-xl backdrop-blur">
            <div
              className="absolute inset-y-0 left-0 bg-accent/25 transition-[width] duration-200 ease-linear"
              style={{ width: `${pendingProgressPct}%` }}
            />
            <div className="relative flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase text-accent">
                  {pendingAutoAdvance.nextAddedByUsername
                    ? `@${pendingAutoAdvance.nextAddedByUsername} Video is Up Next!`
                    : 'Video is Up Next!'}
                </div>
                <div className="truncate text-sm font-semibold text-text-primary">
                  {pendingAutoAdvance.nextTitle}
                </div>
              </div>
              <div className="shrink-0 rounded-full bg-black/25 px-2.5 py-1 text-xs font-semibold text-white">
                {pendingSecondsLeft}s
              </div>
            </div>
          </div>
        )}

        {/* Reaction overlay */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {reactionBubbles.map((b) => (
            <span
              key={b.id}
              className="absolute text-2xl animate-bounce-up select-none"
              style={{
                left: `${b.x}%`,
                bottom: '10%',
                animation: 'theaterReactionFloat 3.5s ease-out forwards',
              }}
            >
              {b.emoji}
            </span>
          ))}
        </div>
        {debugTheaterStates && (
          <div className="absolute right-2 top-2 max-w-[26rem] rounded-lg border border-cyan-400/40 bg-black/80 p-3 text-[11px] leading-4 text-cyan-100 shadow-lg">
            <div className="font-semibold text-cyan-200">Theater Debug</div>
            <div>Source: {youtubeVideoId ? `YouTube iframe (${youtubeVideoId})` : 'Native video'}</div>
            <div>Server: {state?.playing ? 'playing' : 'paused'} pos={formatDebugSeconds(computeExpectedPositionMs() / 1000)} dur={formatDebugSeconds((state?.duration_ms ?? 0) / 1000)}</div>
            <div>Server Item: {state?.current_item_id ?? '-'}</div>
            <div>Server URL: {state?.videoUrl ?? '-'}</div>
            <div>YT Ready: {youtubeDebugState.ready ? 'yes' : 'no'}</div>
            <div>YT State: {describeYouTubeState(youtubeDebugState.playerState)}</div>
            <div>YT Time: {formatDebugSeconds(youtubeDebugState.currentTimeSec)} / {formatDebugSeconds(youtubeDebugState.durationSec)}</div>
            <div>Recoveries: {youtubeRecoveriesRef.current}</div>
            <div>Started: {youtubePlaybackStartedRef.current ? 'yes' : 'no'}</div>
            <div>Suppressed For: {Math.max(0, suppressYouTubeStateUntilRef.current - Date.now())} ms</div>
            <div>Last Action: {youtubeDebugState.lastAction}</div>
            <div>Error: {youtubeDebugState.lastError ?? youtubeError ?? '-'}</div>
            <div className="mt-2 border-t border-cyan-400/20 pt-2 font-semibold text-cyan-200">Recent Events</div>
            <div className="max-h-40 overflow-hidden whitespace-pre-wrap break-words text-cyan-50">
              {debugEvents.length > 0
                ? debugEvents.slice(-8).map((event) => `${formatDebugStamp(event.at)} ${event.message}`).join('\n')
                : 'No Theater events yet.'}
            </div>
          </div>
        )}
      </div>

      {/* Controls bar */}
      <div
        className={isFullscreen
          ? `absolute bottom-0 left-0 right-0 z-40 flex flex-col gap-1 px-4 py-2 bg-gradient-to-t from-black/95 via-black/70 to-transparent transition-opacity duration-300 ${controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0'}`
          : `absolute bottom-0 left-0 right-0 z-20 flex flex-col gap-1 px-4 py-2 bg-gradient-to-t from-black/95 via-black/70 to-transparent transition-opacity duration-300 ${controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        data-debug-name="Synced Video Controls"
        data-debug-file="src/components/theater/SyncedVideoPlayer.tsx"
        onMouseMove={showControls}
        onPointerMove={showControls}
        onMouseEnter={showControls}
        onFocusCapture={showControls}
      >
        {/* Seek bar */}
        {durationSec > 0 && (
          <input
            data-debug-name="Synced Video Seek Bar"
            data-debug-file="src/components/theater/SyncedVideoPlayer.tsx"
            type="range"
            min={0}
            max={durationSec}
            step={1}
            value={Math.min(positionSec, durationSec)}
            onChange={handleSeek}
            disabled={!canControl}
            className="w-full accent-accent cursor-pointer disabled:cursor-default disabled:opacity-50"
          />
        )}
        <div className="flex flex-wrap items-center gap-2">
          {canControl && (
            <button
              onClick={handlePlayPause}
              className="text-text-primary hover:text-accent transition-colors text-lg"
              title={state?.playing ? 'Pause' : 'Play'}
            >
              {state?.playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>
          )}
          <span className="text-xs text-text-muted font-mono">
            {formatTime(positionSec)}{durationSec > 0 ? ` / ${formatTime(durationSec)}` : ''}
          </span>
          <div className="flex items-center gap-2 min-w-[160px]">
            <button
              type="button"
              onClick={toggleVolumeMute}
              className="text-text-primary hover:text-accent transition-colors text-sm"
              title={volumePct === 0 ? 'Unmute video audio' : 'Mute video audio'}
            >
              {volumePct === 0 ? <VolumeX className="h-4 w-4" /> : volumePct < 50 ? <Volume1 className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <input
              data-debug-name="Synced Video Volume Slider"
              data-debug-file="src/components/theater/SyncedVideoPlayer.tsx"
              type="range"
              min={0}
              max={100}
              step={1}
              value={volumePct}
              onChange={(e) => setVolumePct(Number(e.target.value) || 0)}
              className="w-24 accent-accent cursor-pointer"
              aria-label="Theater player volume"
            />
            <span className="w-9 text-right text-xs text-text-muted tabular-nums">{volumePct}%</span>
          </div>
          <button
            type="button"
            onClick={toggleFullscreen}
            className="h-8 px-2 text-sm text-text-primary transition-colors hover:text-accent"
            title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            data-debug-name="Synced Video Fullscreen Button"
            data-debug-file="src/components/theater/SyncedVideoPlayer.tsx"
          >
            {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </button>
          <span className="flex-1" />
          {isFullscreen && activeTheaterChannelId && (
            <div
              className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1 rounded-full border border-white/10 bg-black/45 px-2 py-1 shadow-lg"
              data-debug-name="Synced Video Fullscreen Theater Controls"
              data-debug-file="src/components/theater/SyncedVideoPlayer.tsx"
            >
              <div className="flex min-w-0 items-center gap-1 border-r border-white/10 pr-2">
                <Clapperboard className="h-4 w-4 text-text-muted" />
                <span className="max-w-[9rem] truncate text-xs font-medium text-text-primary">
                  {theaterChannelName ?? 'Theater'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => toggleMic()}
                className={`flex h-8 items-center justify-center gap-1 rounded-lg px-2 text-xs font-medium transition-colors ${
                  micEffectivelyMuted ? 'bg-danger text-white' : 'bg-bg-hover text-text-primary hover:bg-bg-input'
                }`}
                title={micEffectivelyMuted ? 'Enable mic' : 'Mute mic'}
              >
                {micEffectivelyMuted ? <MicrophoneMutedIcon className="h-4 w-4" /> : <MicrophoneLiveIcon className="h-4 w-4" />}
                <span className="hidden sm:inline">{micEffectivelyMuted ? 'Muted' : 'Mic'}</span>
              </button>
              <button
                type="button"
                onClick={toggleDeafen}
                className={`flex h-8 items-center justify-center gap-1 rounded-lg px-2 text-xs font-medium transition-colors ${
                  selfDeafened ? 'bg-warning text-black' : 'bg-bg-hover text-text-primary hover:bg-bg-input'
                }`}
                title={selfDeafened ? 'Undeafen' : 'Deafen'}
              >
                {selfDeafened ? <AudioDeafenedIcon className="h-4 w-4" /> : <AudioListeningIcon className="h-4 w-4" />}
                <span className="hidden sm:inline">{selfDeafened ? 'Deafened' : 'Deafen'}</span>
              </button>
              {canCamera && (
                <button
                  type="button"
                  onClick={() => { void toggleCamera(); }}
                  className={`flex h-8 items-center justify-center gap-1 rounded-lg px-2 text-xs font-medium transition-colors ${
                    cameraEnabled ? 'bg-accent text-white' : 'bg-bg-hover text-text-primary hover:bg-bg-input'
                  }`}
                  title={cameraEnabled ? 'Turn camera off' : 'Turn camera on'}
                  aria-label={cameraEnabled ? 'Turn theater camera off' : 'Turn theater camera on'}
                >
                  {cameraEnabled ? <VideoCameraIcon className="h-4 w-4" /> : <VideoCameraIconOutline className="h-4 w-4" />}
                  <span className="hidden sm:inline">{cameraEnabled ? 'Camera On' : 'Camera'}</span>
                </button>
              )}
              <button
                type="button"
                onClick={openFullscreenVoiceSettings}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-bg-hover text-text-primary transition-colors hover:bg-bg-input"
                title="Voice settings"
                aria-label="Open voice settings"
              >
                <Cog6ToothIcon className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={toggleTheaterSidePanelRetracted}
                className="h-8 rounded-lg bg-bg-hover px-2 text-xs font-medium text-text-primary transition-colors hover:bg-bg-input"
                title={theaterSidePanelRetracted ? 'Show Theater Side Panel' : 'Hide Theater Side Panel'}
                aria-label={theaterSidePanelRetracted ? 'Show Theater side panel' : 'Hide Theater side panel'}
              >
                {theaterSidePanelRetracted ? 'Show Panel' : 'Hide Panel'}
              </button>
              <button
                type="button"
                onClick={leaveTheater}
                className="h-8 rounded-lg bg-danger px-2 text-xs font-medium text-white"
                title="Leave Theater"
              >
                Leave
              </button>
            </div>
          )}
          {!canControl && (
            <span className="inline-flex items-center gap-1 text-xs text-text-muted"><Lock className="h-3 w-3" /> Host controls playback</span>
          )}
        </div>
      </div>

      {/* Inject keyframe animation */}
      <style>{`
        @keyframes theaterReactionFloat {
          0%   { transform: translateY(0) scale(1); opacity: 1; }
          80%  { opacity: 0.8; }
          100% { transform: translateY(-120px) scale(1.3); opacity: 0; }
        }
      `}</style>
    </div>
  );

  return player;
}

function describeYouTubeState(state: number | null | undefined) {
  switch (state) {
    case -1: return 'unstarted (-1)';
    case 0: return 'ended (0)';
    case 1: return 'playing (1)';
    case 2: return 'paused (2)';
    case 3: return 'buffering (3)';
    case 5: return 'cued (5)';
    default: return `${state ?? 'unknown'}`
  }
}

function formatDebugSeconds(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return '0.00s';
  return `${sec.toFixed(2)}s`;
}

function formatDebugStamp(at: number) {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}.${String(date.getMilliseconds()).padStart(3, '0')}`;
}
