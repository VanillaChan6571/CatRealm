import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { Maximize2, Pause, Play, Volume2, VolumeX } from 'lucide-react-native';
import type { VideoPlayer } from 'expo-video';
import { useTheme } from '@/theme';
import { Text } from './Text';

function formatTime(seconds: number) {
  const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function CatRealmVideoControls({
  player,
  compact = false,
  onFullscreen,
}: {
  player: VideoPlayer;
  compact?: boolean;
  onFullscreen?: () => void;
}) {
  const theme = useTheme();
  const [playing, setPlaying] = useState(player.playing);
  const [position, setPosition] = useState(player.currentTime || 0);
  const [duration, setDuration] = useState(player.duration || 0);
  const [seeking, setSeeking] = useState(false);
  const [muted, setMuted] = useState(player.muted);
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    clearHideTimer();
    if (!player.playing || seeking) return;
    hideTimerRef.current = setTimeout(() => setControlsVisible(false), 2400);
  }, [clearHideTimer, player, seeking]);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    scheduleHide();
  }, [scheduleHide]);

  useEffect(() => {
    player.timeUpdateEventInterval = 0.5;

    const playingSub = player.addListener('playingChange', (payload) => {
      setPlaying(payload.isPlaying);
      setControlsVisible(true);
      clearHideTimer();
      if (payload.isPlaying && !seeking) {
        hideTimerRef.current = setTimeout(() => setControlsVisible(false), 2400);
      }
    });
    const mutedSub = player.addListener('mutedChange', (payload) => {
      setMuted(payload.muted);
    });
    const timeSub = player.addListener('timeUpdate', (payload) => {
      if (!seeking) setPosition(payload.currentTime);
      setDuration(player.duration || 0);
    });
    const sourceSub = player.addListener('sourceLoad', () => {
      setPosition(player.currentTime || 0);
      setDuration(player.duration || 0);
    });

    return () => {
      clearHideTimer();
      playingSub.remove();
      mutedSub.remove();
      timeSub.remove();
      sourceSub.remove();
    };
  }, [clearHideTimer, player, seeking]);

  useEffect(() => {
    if (controlsVisible) scheduleHide();
    return clearHideTimer;
  }, [clearHideTimer, controlsVisible, scheduleHide]);

  const togglePlayback = () => {
    try {
      if (playing) player.pause();
      else player.play();
    } catch {
      // The native player can be released during fullscreen modal teardown.
    }
    showControls();
  };

  const toggleMuted = () => {
    try {
      player.muted = !muted;
      setMuted(!muted);
    } catch {
      // Ignore mute changes racing with native player teardown.
    }
    showControls();
  };

  const commitSeek = (value: number) => {
    const next = Math.max(0, Math.min(value, duration || value));
    try {
      player.currentTime = next;
    } catch {
      // Ignore seeks racing with native player teardown.
    }
    setPosition(next);
    setSeeking(false);
    showControls();
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Show video controls"
      onPress={showControls}
      style={styles.root}
    >
      {controlsVisible ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={playing ? 'Pause video' : 'Play video'}
          onPress={togglePlayback}
          style={[
            compact ? styles.playButtonCompact : styles.playButton,
            { backgroundColor: theme.colors.bgElev1, borderColor: theme.colors.lineSoft },
          ]}
        >
          {playing
            ? <Pause size={compact ? 22 : 28} color={theme.colors.text} />
            : <Play size={compact ? 22 : 28} color={theme.colors.text} />}
        </Pressable>
      ) : null}

      {controlsVisible ? (
        <View style={[styles.controlBar, compact && styles.controlBarCompact, { backgroundColor: 'rgba(0,0,0,0.68)' }]}>
          <Text variant="caption" color="#fff" style={styles.timeLabel}>{formatTime(position)}</Text>
          <Slider
            style={styles.slider}
            minimumValue={0}
            maximumValue={duration > 0 ? duration : 1}
            value={duration > 0 ? Math.min(position, duration) : 0}
            step={0.5}
            minimumTrackTintColor={theme.colors.accent}
            maximumTrackTintColor="rgba(255,255,255,0.35)"
            thumbTintColor={theme.colors.accent}
            disabled={duration <= 0}
            onSlidingStart={() => {
              clearHideTimer();
              setSeeking(true);
              setControlsVisible(true);
            }}
            onValueChange={(value) => {
              setSeeking(true);
              setPosition(value);
            }}
            onSlidingComplete={commitSeek}
          />
          <Text variant="caption" color="#fff" style={styles.timeLabel}>{formatTime(duration)}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={muted ? 'Unmute video' : 'Mute video'}
            onPress={toggleMuted}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.iconButton}
          >
            {muted ? <VolumeX size={18} color="#fff" /> : <Volume2 size={18} color="#fff" />}
          </Pressable>
          {onFullscreen ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open video fullscreen"
              onPress={() => {
                showControls();
                onFullscreen();
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.iconButton}
            >
              <Maximize2 size={18} color="#fff" />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButtonCompact: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlBar: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 22,
    minHeight: 44,
    borderRadius: 8,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  controlBarCompact: {
    left: 8,
    right: 8,
    bottom: 8,
    minHeight: 38,
    paddingHorizontal: 8,
  },
  slider: {
    flex: 1,
    height: 34,
  },
  timeLabel: {
    minWidth: 38,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  iconButton: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
