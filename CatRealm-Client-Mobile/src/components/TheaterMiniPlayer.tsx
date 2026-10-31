import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, BackHandler, PanResponder, StyleSheet, type GestureResponderEvent, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GripHorizontal, Maximize, Maximize2, MessageCircle, Pause, Play, Volume2, VolumeX, X } from 'lucide-react-native';
import { Text } from './Text';
import { useTheme } from '@/theme';
import { useTheaterStore } from '@/stores/theaterStore';
import { useTheaterPlaybackPermission } from '@/hooks/useTheaterPlaybackPermission';
import { TheaterMediaSurface } from './theater/TheaterMediaSurface';
import { TheaterVoiceControls } from './theater/TheaterVoiceControls';
import { TheaterChatPreview } from './theater/TheaterChatPreview';

const MINI_WIDTH = 184;
const MINI_MIN_WIDTH = 144;
const MINI_MAX_WIDTH = 560;
const MINI_META_HEIGHT = 28;
const miniHeightFor = (width: number) => Math.round(width * 9 / 16);

function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}
export function TheaterOverlayHost() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const channelId = useTheaterStore((s) => s.channelId);
  const serverId = useTheaterStore((s) => s.serverId);
  const channelName = useTheaterStore((s) => s.channelName);
  const queue = useTheaterStore((s) => s.queue);
  const playbackState = useTheaterStore((s) => s.playbackState);
  const overlayMode = useTheaterStore((s) => s.overlayMode);
  const leaveTheater = useTheaterStore((s) => s.leaveTheater);
  const expandedFrame = useTheaterStore((s) => s.expandedFrame);
  const focused = useTheaterStore((s) => s.focused);
  const setFocused = useTheaterStore((s) => s.setFocused);
  const setPanelTab = useTheaterStore((s) => s.setPanelTab);
  const openChat = () => {
    if (!serverId || !channelId) return;
    setFocused(false);
    setPanelTab('chat');
  };
  const focusControlsVisible = useTheaterStore((s) => s.focusControlsVisible);
  const setFocusControlsVisible = useTheaterStore((s) => s.setFocusControlsVisible);
  const control = useTheaterStore((s) => s.control);
  const computeExpectedPositionMs = useTheaterStore((s) => s.computeExpectedPositionMs);
  const canControlPlayback = useTheaterPlaybackPermission(serverId, channelId);
  const controlError = useTheaterStore((s) => s.controlError);
  const mediaError = useTheaterStore((s) => s.mediaError);
  const [seekPreviewMs, setSeekPreviewMs] = useState<number | null>(null);
  const muted = useTheaterStore((s) => s.mediaMuted);
  const volume = useTheaterStore((s) => s.mediaVolume);
  const deafened = useTheaterStore((s) => s.selfDeafened);
  const setMuted = useTheaterStore((s) => s.setMediaMuted);
  const setVolume = useTheaterStore((s) => s.setMediaVolume);
  const localMuted = muted || volume === 0;
  const toggleMediaMute = () => {
    if (localMuted) {
      if (volume === 0) setVolume(1);
      setMuted(false);
    } else {
      setMuted(true);
    }
  };
  const [, tick] = useState(0);
  useEffect(() => {
    if (!channelId) return;
    const timer = setInterval(() => tick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [channelId]);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controlsTouchActive = useRef(false);
  const controlsOpacity = useRef(new Animated.Value(1)).current;

  const currentItem = playbackState?.current_item_id
    ? queue.find((item) => item.id === playbackState.current_item_id)
    : null;
  const videoUrl = playbackState?.videoUrl ?? currentItem?.videoUrl ?? currentItem?.source_url ?? null;
  const positionMs = computeExpectedPositionMs();
  const playing = playbackState?.playing ?? false;
  const durationMs = playbackState?.duration_ms ?? 0;
  const effectivePositionMs = seekPreviewMs ?? positionMs;

  const isFullscreen = overlayMode === 'expanded' && focused;
  const isExpanded = overlayMode === 'expanded' && (!!expandedFrame || isFullscreen);
  const controlsVisible = !isFullscreen || focusControlsVisible || !!controlError || !!mediaError;
  const clearControlsTimer = useCallback(() => {
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = null;
  }, []);
  const revealFocusControls = useCallback(() => {
    clearControlsTimer();
    setFocusControlsVisible(true);
    if (!controlsTouchActive.current) {
      controlsTimerRef.current = setTimeout(() => {
        controlsTimerRef.current = null;
        setFocusControlsVisible(false);
      }, 2500);
    }
  }, [clearControlsTimer, setFocusControlsVisible]);
  const holdFocusControls = () => {
    controlsTouchActive.current = true;
    revealFocusControls();
  };
  const releaseFocusControls = () => {
    controlsTouchActive.current = false;
    revealFocusControls();
  };

  useEffect(() => {
    controlsTouchActive.current = false;
    if (isFullscreen) revealFocusControls();
    else { clearControlsTimer(); setFocusControlsVisible(true); }
    return () => {
      clearControlsTimer();
      controlsTouchActive.current = false;
    };
  }, [channelId, isFullscreen, clearControlsTimer, revealFocusControls, setFocusControlsVisible]);

  useEffect(() => {
    // Keep controls mounted to animate out, but disable invisible hit targets.
    // Stopping the previous animation lets a tap reverse an in-progress fade.
    const transition = Animated.timing(controlsOpacity, {
      toValue: controlsVisible ? 1 : 0,
      duration: controlsVisible ? 180 : 250,
      useNativeDriver: true,
    });
    transition.start();
    return () => transition.stop();
  }, [controlsOpacity, controlsVisible]);
  useEffect(() => {
    if (!isFullscreen) return;
    const back = BackHandler.addEventListener('hardwareBackPress', () => { setFocused(false); return true; });
    return () => back.remove();
  }, [isFullscreen, setFocused]);
  const fullscreenFrame = useMemo(() => ({ x: 0, y: 0, width: screenWidth, height: screenHeight }), [screenWidth, screenHeight]);
  const [floatingOrigin, setFloatingOrigin] = useState<{ x: number; y: number } | null>(null);
  const [preferredMiniWidth, setPreferredMiniWidth] = useState(MINI_WIDTH);
  // Frame while a pinch is in progress. The box and the video both render from
  // it, so they resize in the same commit instead of the box leading by a frame
  // (the surface resizes in place; playback is not reloaded).
  const [livePinchFrame, setLivePinchFrame] = useState<{ x: number; y: number; width: number } | null>(null);
  const livePinchRaf = useRef<number | null>(null);
  useEffect(() => () => {
    if (livePinchRaf.current !== null) cancelAnimationFrame(livePinchRaf.current);
  }, []);
  const maxMiniWidth = Math.max(MINI_MIN_WIDTH, Math.min(MINI_MAX_WIDTH, screenWidth - 24));
  const clampMiniWidth = useCallback((width: number) => Math.max(MINI_MIN_WIDTH, Math.min(maxMiniWidth, width)), [maxMiniWidth]);
  const miniWidth = clampMiniWidth(preferredMiniWidth);
  const miniHeight = miniHeightFor(miniWidth);
  // Keeps a floating frame of the given width fully on screen.
  const clampOrigin = useCallback((x: number, y: number, width: number) => ({
    x: Math.max(12, Math.min(screenWidth - width - 12, x)),
    y: Math.max(insets.top + 12, Math.min(screenHeight - (miniHeightFor(width) + MINI_META_HEIGHT) - insets.bottom - 12, y)),
  }), [insets.bottom, insets.top, screenHeight, screenWidth]);
  const boundedFloatingOrigin = useMemo(() => {
    const origin = floatingOrigin ?? {
      x: screenWidth - miniWidth - 12,
      y: screenHeight - (miniHeight + MINI_META_HEIGHT) - insets.bottom - 76,
    };
    return clampOrigin(origin.x, origin.y, miniWidth);
  }, [clampOrigin, floatingOrigin, insets.bottom, miniHeight, miniWidth, screenHeight, screenWidth]);
  const floatingFrame = useMemo(() => ({
    x: boundedFloatingOrigin.x,
    y: boundedFloatingOrigin.y,
    width: miniWidth,
    height: miniHeight + MINI_META_HEIGHT,
  }), [boundedFloatingOrigin.x, boundedFloatingOrigin.y, miniHeight, miniWidth]);
  const targetFrame = isFullscreen ? fullscreenFrame : isExpanded ? expandedFrame : floatingFrame;
  const animatedLeft = useRef(new Animated.Value(0)).current;
  const animatedTop = useRef(new Animated.Value(0)).current;
  const animatedWidth = useRef(new Animated.Value(MINI_WIDTH)).current;
  const animatedHeight = useRef(new Animated.Value(miniHeightFor(MINI_WIDTH) + MINI_META_HEIGHT)).current;
  const hasSeededFrameRef = useRef(false);

  useEffect(() => {
    if (!targetFrame) return;
    const nextLeft = targetFrame.x;
    const nextTop = targetFrame.y;
    if (!hasSeededFrameRef.current || isExpanded) {
      animatedLeft.setValue(nextLeft);
      animatedTop.setValue(nextTop);
      animatedWidth.setValue(targetFrame.width);
      animatedHeight.setValue(targetFrame.height);
      hasSeededFrameRef.current = true;
      return;
    }
    Animated.parallel([
      Animated.timing(animatedLeft, { toValue: nextLeft, duration: 220, useNativeDriver: false }),
      Animated.timing(animatedTop, { toValue: nextTop, duration: 220, useNativeDriver: false }),
      Animated.timing(animatedWidth, { toValue: targetFrame.width, duration: 220, useNativeDriver: false }),
      Animated.timing(animatedHeight, { toValue: targetFrame.height, duration: 220, useNativeDriver: false }),
    ]).start();
  }, [animatedHeight, animatedLeft, animatedTop, animatedWidth, isExpanded, targetFrame]);


  const dragStartRef = useRef({ x: 0, y: 0 });
  const dragged = useRef(false);
  // Live frame during a gesture; a pinch resizes around the player's centre.
  const gestureFrame = useRef({ x: 0, y: 0, width: MINI_WIDTH });
  const pinchRef = useRef<{ distance: number; width: number; centerX: number; centerY: number } | null>(null);
  const panResponder = useMemo(() => {
    const touchDistance = (event: GestureResponderEvent) => {
      const [a, b] = event.nativeEvent.touches;
      return a && b ? Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY) : null;
    };
    const applyFrame = (x: number, y: number, width: number) => {
      const origin = clampOrigin(x, y, width);
      gestureFrame.current = { ...origin, width };
      animatedLeft.setValue(origin.x);
      animatedTop.setValue(origin.y);
      animatedWidth.setValue(width);
      animatedHeight.setValue(miniHeightFor(width) + MINI_META_HEIGHT);
    };
    const finishDrag = (_event: unknown, gesture: { dx: number; dy: number }) => {
      if (!pinchRef.current) applyFrame(dragStartRef.current.x + gesture.dx, dragStartRef.current.y + gesture.dy, gestureFrame.current.width);
      const { x, y, width } = gestureFrame.current;
      const height = miniHeightFor(width) + MINI_META_HEIGHT;
      const next = {
        x: x + width / 2 < screenWidth / 2 ? 12 : screenWidth - width - 12,
        y: y + height / 2 < screenHeight / 2 ? insets.top + 12 : screenHeight - height - insets.bottom - 12,
      };
      pinchRef.current = null;
      if (livePinchRaf.current !== null) cancelAnimationFrame(livePinchRaf.current);
      livePinchRaf.current = null;
      // Hand the final size back to the animated frame before the live one is dropped.
      animatedWidth.setValue(width);
      animatedHeight.setValue(height);
      setLivePinchFrame(null);
      // Also settle when dropping back in the same corner: the memoized frame
      // does not change in that case, so its layout effect will not run.
      animatedLeft.setValue(next.x);
      animatedTop.setValue(next.y);
      setPreferredMiniWidth(width);
      setFloatingOrigin(next);
    };
    const shouldDrag = (_event: unknown, gesture: { dx: number; dy: number; numberActiveTouches: number }) => !isExpanded
      && (gesture.numberActiveTouches >= 2 || Math.abs(gesture.dx) > 3 || Math.abs(gesture.dy) > 3);
    return PanResponder.create({
      onStartShouldSetPanResponderCapture: () => { dragged.current = false; return false; },
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: shouldDrag,
      onMoveShouldSetPanResponderCapture: shouldDrag,
      onPanResponderGrant: () => {
        dragged.current = true;
        pinchRef.current = null;
        dragStartRef.current = { x: floatingFrame.x, y: floatingFrame.y };
        gestureFrame.current = { x: floatingFrame.x, y: floatingFrame.y, width: miniWidth };
        animatedLeft.stopAnimation((x) => { dragStartRef.current.x = x; gestureFrame.current.x = x; });
        animatedTop.stopAnimation((y) => { dragStartRef.current.y = y; gestureFrame.current.y = y; });
      },
      onPanResponderMove: (event, gesture) => {
        const distance = touchDistance(event);
        if (distance !== null) {
          const frame = gestureFrame.current;
          pinchRef.current ??= {
            distance, width: frame.width,
            centerX: frame.x + frame.width / 2,
            centerY: frame.y + (miniHeightFor(frame.width) + MINI_META_HEIGHT) / 2,
          };
          const pinch = pinchRef.current;
          const width = clampMiniWidth(pinch.width * distance / Math.max(1, pinch.distance));
          const origin = clampOrigin(pinch.centerX - width / 2, pinch.centerY - (miniHeightFor(width) + MINI_META_HEIGHT) / 2, width);
          gestureFrame.current = { ...origin, width };
          // One render per frame, however fast touches arrive.
          if (livePinchRaf.current === null) {
            livePinchRaf.current = requestAnimationFrame(() => {
              livePinchRaf.current = null;
              setLivePinchFrame({ ...gestureFrame.current });
            });
          }
          return;
        }
        // Lifting one finger ends the resize; do not jump into a drag.
        if (pinchRef.current) return;
        applyFrame(dragStartRef.current.x + gesture.dx, dragStartRef.current.y + gesture.dy, gestureFrame.current.width);
      },
      onPanResponderRelease: finishDrag,
      onPanResponderTerminate: finishDrag,
    });
  }, [animatedHeight, animatedLeft, animatedTop, animatedWidth, clampMiniWidth, clampOrigin, floatingFrame.x, floatingFrame.y, insets.bottom, insets.top, isExpanded, miniWidth, screenHeight, screenWidth]);

  const floatingMediaWidth = livePinchFrame?.width ?? miniWidth;
  const mediaWidth = isExpanded ? targetFrame!.width : floatingMediaWidth;
  const mediaHeight = isExpanded ? targetFrame!.height : miniHeightFor(floatingMediaWidth);

  if (overlayMode === 'hidden' || !channelId || !serverId) return null;

  return (
    <Animated.View
      testID="theater-positioner"
      pointerEvents="box-none"
      style={[
        styles.positioner,
        livePinchFrame ? { left: livePinchFrame.x, top: livePinchFrame.y } : { left: animatedLeft, top: animatedTop },
      ]}
    >
      <Animated.View
        testID="theater-drag-surface"
        {...(!isExpanded ? panResponder.panHandlers : {})}
        style={[
          styles.shell,
          {
            width: livePinchFrame ? livePinchFrame.width : animatedWidth,
            height: livePinchFrame ? miniHeightFor(livePinchFrame.width) + MINI_META_HEIGHT : animatedHeight,
            borderWidth: isExpanded ? 0 : 1,
            borderRadius: isExpanded ? 0 : 14,
            backgroundColor: theme.colors.bgElev1,
            borderColor: theme.colors.line,
          },
        ]}
      >
        <TouchableOpacity
          accessibilityLabel={isExpanded ? 'Theater player' : 'Return to theater'}
          activeOpacity={isExpanded ? 1 : 0.92}
          onPress={isExpanded ? (focused ? revealFocusControls : undefined) : () => {
            if (dragged.current) return;
            // The destination screen owns expansion, after it receives focus.
            router.replace({
              pathname: '/server/[serverId]/theater/[channelId]',
              params: { serverId, channelId },
            });
          }}
          style={styles.touchSurface}
        >
          <View testID="theater-media-surface" pointerEvents={isExpanded ? 'auto' : 'none'} style={[styles.surface, { width: mediaWidth, height: mediaHeight }]}>
            {videoUrl ? <TheaterMediaSurface
              videoUrl={videoUrl}
              playing={playbackState?.playing ?? false}
              positionMs={positionMs}
              width={mediaWidth}
              height={mediaHeight}
              muted={muted || deafened}
              volume={volume}
              controlsVisible={controlsVisible}
              controlsOpacity={controlsOpacity}
              onControlsInteraction={isFullscreen ? revealFocusControls : undefined}
              pictureInPictureTop={isFullscreen ? Math.max(8, insets.top) + 52 : 8}
            /> : <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
              <Text style={{ color: '#fff' }}>No video queued</Text>
            </View>}
            {isFullscreen && <Animated.View testID="theater-fullscreen-header"
              pointerEvents={controlsVisible ? 'box-none' : 'none'}
              accessibilityElementsHidden={!controlsVisible} importantForAccessibility={controlsVisible ? 'auto' : 'no-hide-descendants'}
              onTouchStart={holdFocusControls} onTouchEnd={releaseFocusControls} onTouchCancel={releaseFocusControls}
              style={[styles.fullscreenHeader, { opacity: controlsOpacity, top: Math.max(8, insets.top), left: Math.max(12, insets.left), right: Math.max(12, insets.right) }]}>
              <TouchableOpacity accessibilityLabel="Exit fullscreen" style={styles.fullscreenAction}
                onPress={(event) => { event.stopPropagation(); setFocused(false); }}>
                <Maximize size={18} color="#fff" />
                <Text style={{ color: '#fff' }}>Exit fullscreen</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityLabel={t('theater.openChat')} style={styles.fullscreenAction}
                onPress={(event) => { event.stopPropagation(); openChat(); }}>
                <MessageCircle size={18} color="#fff" />
                <Text style={{ color: '#fff' }}>{t('theater.openChat')}</Text>
              </TouchableOpacity>
            </Animated.View>}
            {isFullscreen && <TheaterChatPreview channelId={channelId} serverId={serverId}
              top={Math.max(8, insets.top) + 60} right={Math.max(12, insets.right) + 52}
              maxWidth={Math.min(320, screenWidth - insets.left - insets.right - 76)} onOpenChat={openChat} />}
            {isFullscreen && (
              <Animated.View testID="theater-fullscreen-controls"
                pointerEvents={controlsVisible ? 'auto' : 'none'}
                accessibilityElementsHidden={!controlsVisible} importantForAccessibility={controlsVisible ? 'auto' : 'no-hide-descendants'}
                onTouchStart={holdFocusControls} onTouchEnd={releaseFocusControls} onTouchCancel={releaseFocusControls}
                style={[styles.focusOverlay, { opacity: controlsOpacity, paddingBottom: Math.max(14, insets.bottom), paddingLeft: Math.max(16, insets.left), paddingRight: Math.max(16, insets.right) }]}>
                {!!controlError && <Text accessibilityRole="alert" style={{ color: '#fff' }}>{controlError}</Text>}
                {!!mediaError && <Text accessibilityRole="alert" style={{ color: '#fff' }}>{mediaError}</Text>}
                <TheaterVoiceControls overlay />
                {durationMs > 0 && (
                  <Slider
                    minimumValue={0}
                    maximumValue={durationMs}
                    value={Math.min(effectivePositionMs, durationMs)}
                    step={1000}
                    minimumTrackTintColor={theme.colors.accent}
                    maximumTrackTintColor="rgba(255,255,255,0.35)"
                    thumbTintColor={theme.colors.accent}
                    disabled={!canControlPlayback}
                    onValueChange={(value) => { revealFocusControls(); setSeekPreviewMs(value); }}
                    onSlidingComplete={(value) => {
                      setSeekPreviewMs(null);
                      if (canControlPlayback && channelId) control(channelId, { positionMs: Math.max(0, Math.floor(value)), playing });
                      revealFocusControls();
                    }}
                  />
                )}
                <View style={styles.focusMetaRow}>
                  <View style={styles.focusMetaLeft}>
                    {canControlPlayback && (
                      <TouchableOpacity
                        accessibilityLabel={playing ? 'Pause theater video' : 'Play theater video'}
                        activeOpacity={0.7}
                        onPress={() => {
                          revealFocusControls();
                          if (channelId) control(channelId, { playing: !playing, positionMs });
                        }}
                        style={styles.focusIconBtn}
                      >
                        {playing ? <Pause size={16} color="#fff" /> : <Play size={16} color="#fff" />}
                      </TouchableOpacity>
                    )}
                    <Text variant="caption" style={{ color: '#fff', fontVariant: ['tabular-nums'] }}>
                      {formatTime(effectivePositionMs / 1000)}{durationMs > 0 ? ` / ${formatTime(durationMs / 1000)}` : ''}
                    </Text>
                  </View>
                  <View style={styles.focusMetaRight}>
                    <TouchableOpacity activeOpacity={0.7} onPress={(event) => { event.stopPropagation(); revealFocusControls(); toggleMediaMute(); }} style={styles.focusIconBtn}>
                      {localMuted ? <VolumeX size={16} color="#fff" /> : <Volume2 size={16} color="#fff" />}
                    </TouchableOpacity>
                  </View>
                </View>
              </Animated.View>
            )}
            {isExpanded && !focused && (
              <TouchableOpacity
                accessibilityLabel="Enter fullscreen"
                activeOpacity={0.7}
                onPress={(event) => { event.stopPropagation(); setFocused(true); }}
                style={styles.expandedFullscreenBtn}
              >
                <Maximize size={18} color="#fff" />
              </TouchableOpacity>
            )}
          </View>
          {!isExpanded && <View style={styles.meta}>
            <View style={styles.metaLabel}>
              <GripHorizontal size={14} color={theme.colors.text3} />
              <Text variant="caption" numberOfLines={1} style={{ color: theme.colors.text, flex: 1 }}>
                {currentItem?.title || channelName || 'Theater'}
              </Text>
            </View>
            <Maximize2 size={13} color={theme.colors.text3} />
            <TouchableOpacity accessibilityLabel="Leave theater" hitSlop={8}
              onPress={(event) => { event.stopPropagation(); leaveTheater(); }}>
              <X size={18} color={theme.colors.text3} />
            </TouchableOpacity>
          </View>}
        </TouchableOpacity>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  positioner: {
    position: 'absolute',
    zIndex: 40,
    elevation: 12,
  },
  shell: {
    borderWidth: 1,
    overflow: 'hidden',
  },
  touchSurface: {
    flex: 1,
  },
  surface: {
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  fullscreenHeader: { position: 'absolute', flexDirection: 'row', justifyContent: 'space-between' },
  fullscreenAction: { minHeight: 44, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.7)' },
  focusOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 14,
    backgroundColor: 'rgba(0,0,0,0.58)',
  },
  focusMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  focusMetaLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  focusMetaRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  focusIconBtn: {
    minWidth: 28,
    minHeight: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  expandedFullscreenBtn: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    padding: 10,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  meta: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    paddingHorizontal: 8,
  },
  metaLabel: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
});
