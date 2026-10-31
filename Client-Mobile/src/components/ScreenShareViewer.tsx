import { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Animated,
  Modal,
  TouchableWithoutFeedback,
  useWindowDimensions,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import * as ScreenOrientation from 'expo-screen-orientation';
import Slider from '@react-native-community/slider';
import { VideoView } from '@livekit/react-native';
import { VideoQuality } from 'livekit-client';
import { X, ChevronLeft, ChevronRight, Maximize2, Minimize2, Volume2, VolumeX, Eye, MonitorX } from 'lucide-react-native';
import { Avatar, Text, Pressable } from '@/components';
import { useTheme } from '@/theme';
import { isTabletDevice } from '@/hooks/useDeviceLayout';
import { useSettingsStore, type ScreenShareViewerQuality } from '@/stores/settingsStore';
import type { AccountType } from '@/types';

const OVERLAY_HIDE_DELAY = 2500;
const QUALITY_LABELS: Record<ScreenShareViewerQuality, string> = {
  auto: 'Auto',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};
const QUALITY_ORDER: ScreenShareViewerQuality[] = ['auto', 'high', 'medium', 'low'];

export type ScreenShareVideoTarget = { height: number; fps: number };
export type ScreenShareEntry = { id: string; track: any; publication?: any; participantId: string; videoTarget?: ScreenShareVideoTarget };
export type ScreenShareViewerInfo = {
  id: string;
  username: string;
  avatar?: string | null;
  accountType?: AccountType | null;
};

type Props = {
  tracks: ScreenShareEntry[];
  getUsername: (participantId: string) => string;
  initialParticipantId: string;
  onClose: () => void;
  onActiveParticipantChange?: (prev: string, next: string) => void;
  onVolumeChange?: (participantId: string, volume: number) => void;
  viewersByParticipantId?: Record<string, ScreenShareViewerInfo[]>;
  avatarBaseUrl?: string | null;
};

// LiveKit RemoteTrackPublication exposes the negotiated codec, e.g. "video/h265".
function isHevcMimeType(mimeType?: string | null): boolean {
  if (!mimeType) return false;
  return /h\.?265|hevc/i.test(mimeType);
}

function getQualityTarget(
  quality: ScreenShareViewerQuality,
  videoTarget: ScreenShareVideoTarget | undefined,
  width: number,
  height: number,
) {
  if (quality === 'high' && videoTarget) {
    return { width: Math.round((videoTarget.height * 16) / 9), height: videoTarget.height, fps: videoTarget.fps };
  }
  if (quality === 'medium') {
    const targetHeight = videoTarget ? Math.min(720, Math.max(360, Math.round(videoTarget.height / 2))) : 720;
    return { width: Math.round((targetHeight * 16) / 9), height: targetHeight, fps: videoTarget ? Math.min(videoTarget.fps, 30) : 30 };
  }
  if (quality === 'low') {
    const targetHeight = videoTarget ? Math.min(360, Math.max(180, Math.round(videoTarget.height / 4))) : 360;
    return { width: Math.round((targetHeight * 16) / 9), height: targetHeight, fps: videoTarget ? Math.min(videoTarget.fps, 30) : 30 };
  }
  return { width: Math.max(320, Math.round(width)), height: Math.max(180, Math.round(height)), fps: videoTarget?.fps ?? 30 };
}

export function ScreenShareViewer({
  tracks,
  getUsername,
  initialParticipantId,
  onClose,
  onActiveParticipantChange,
  onVolumeChange,
  viewersByParticipantId,
  avatarBaseUrl,
}: Props) {
  const theme = useTheme();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const viewerQuality = useSettingsStore((s) => s.screenShareViewerQuality);
  const setViewerQuality = useSettingsStore((s) => s.setScreenShareViewerQuality);
  const initialIndex = Math.max(0, tracks.findIndex((t) => t.participantId === initialParticipantId));

  // Shared page state
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const currentIndexRef = useRef(currentIndex);

  // Volume state
  const [volumePct, setVolumePct] = useState(100);
  const lastNonZeroVolume = useRef(100);

  // Fullscreen state
  const [fullscreen, setFullscreen] = useState(false);
  const [cardWidth, setCardWidth] = useState(screenWidth);
  const [modalWidth, setModalWidth] = useState(screenWidth);

  // Two scroll refs — one for inline card, one for fullscreen modal
  const cardScrollRef = useRef<ScrollView | null>(null);
  const modalScrollRef = useRef<ScrollView | null>(null);

  // Overlay fade animation
  const overlayOpacity = useRef(new Animated.Value(1)).current;
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showOverlay = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    Animated.timing(overlayOpacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    hideTimerRef.current = setTimeout(() => {
      Animated.timing(overlayOpacity, { toValue: 0, duration: 300, useNativeDriver: true }).start();
    }, OVERLAY_HIDE_DELAY);
  }, [overlayOpacity]);

  useEffect(() => {
    showOverlay();
    if (initialIndex > 0) {
      cardScrollRef.current?.scrollTo({ x: initialIndex * cardWidth, animated: false });
    }
    return () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync modal scroll position when fullscreen opens
  useEffect(() => {
    if (fullscreen) {
      modalScrollRef.current?.scrollTo({ x: currentIndex * modalWidth, animated: false });
      showOverlay();
    }
  }, [fullscreen, currentIndex, modalWidth, showOverlay]);

  // Re-sync scroll positions after layout/orientation changes.
  useEffect(() => {
    cardScrollRef.current?.scrollTo({ x: currentIndex * cardWidth, animated: false });
    if (fullscreen) {
      modalScrollRef.current?.scrollTo({ x: currentIndex * modalWidth, animated: false });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardWidth, modalWidth]);

  // Restore the app-wide orientation policy on unmount (handles X-close while
  // in fullscreen): tablets rotate freely, phones go back to portrait — a bare
  // unlock here used to leave phones free-rotating app-wide after a share.
  useEffect(() => {
    return () => {
      if (isTabletDevice()) void ScreenOrientation.unlockAsync().catch(() => {});
      else void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (fullscreen) {
      // Close modal first, then restore portrait — avoids flash of landscape content in portrait
      setFullscreen(false);
      if (!isTabletDevice()) await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    } else {
      // Lock orientation before opening modal so dimensions are correct on mount
      if (!isTabletDevice()) await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
      setFullscreen(true);
    }
    showOverlay();
  }, [fullscreen, showOverlay]);

  const changePage = useCallback((page: number) => {
    if (page === currentIndexRef.current) return;
    const prev = tracks[currentIndexRef.current]?.participantId;
    const next = tracks[page]?.participantId;
    // Keep both scrollViews in sync
    cardScrollRef.current?.scrollTo({ x: page * cardWidth, animated: false });
    modalScrollRef.current?.scrollTo({ x: page * modalWidth, animated: false });
    // Restore volume for new participant
    if (next) onVolumeChange?.(next, volumePct / 100);
    currentIndexRef.current = page;
    setCurrentIndex(page);
    if (prev && next && prev !== next) onActiveParticipantChange?.(prev, next);
    showOverlay();
  }, [tracks, onActiveParticipantChange, onVolumeChange, volumePct, cardWidth, modalWidth, showOverlay]);

  const handleCardScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const page = Math.round(e.nativeEvent.contentOffset.x / cardWidth);
      changePage(page);
    },
    [changePage, cardWidth],
  );

  const handleModalScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const page = Math.round(e.nativeEvent.contentOffset.x / modalWidth);
      changePage(page);
    },
    [changePage, modalWidth],
  );

  const goTo = useCallback((index: number) => {
    const clamped = Math.max(0, Math.min(tracks.length - 1, index));
    cardScrollRef.current?.scrollTo({ x: clamped * cardWidth, animated: true });
    modalScrollRef.current?.scrollTo({ x: clamped * modalWidth, animated: true });
    const prev = tracks[currentIndexRef.current]?.participantId;
    const next = tracks[clamped]?.participantId;
    if (next) onVolumeChange?.(next, volumePct / 100);
    currentIndexRef.current = clamped;
    setCurrentIndex(clamped);
    if (prev && next && prev !== next) onActiveParticipantChange?.(prev, next);
    showOverlay();
  }, [tracks, onActiveParticipantChange, onVolumeChange, volumePct, cardWidth, modalWidth, showOverlay]);

  const handleCardLayout = useCallback((event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    if (width > 0) setCardWidth(width);
  }, []);

  const handleModalLayout = useCallback((event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    if (width > 0) setModalWidth(width);
  }, []);

  const handleVolumeChange = useCallback((v: number) => {
    if (v > 0) lastNonZeroVolume.current = v;
    setVolumePct(v);
    const participantId = tracks[currentIndexRef.current]?.participantId;
    if (participantId) onVolumeChange?.(participantId, v / 100);
  }, [tracks, onVolumeChange]);

  const toggleMute = useCallback(() => {
    handleVolumeChange(volumePct > 0 ? 0 : (lastNonZeroVolume.current || 100));
  }, [volumePct, handleVolumeChange]);

  const current = tracks[currentIndex];
  const [receivedVideo, setReceivedVideo] = useState<ScreenShareVideoTarget | null>(null);
  // Grace window before we trust "no frames decoded" — a healthy stream produces
  // frames within a second or two; this avoids flashing the notice on slow starts.
  const [decodeGraceElapsed, setDecodeGraceElapsed] = useState(false);
  const previousReceivedStatsRef = useRef<{ frames: number; timestamp: number } | null>(null);
  const currentViewers = current ? (viewersByParticipantId?.[current.participantId] ?? []) : [];
  const showStreamInfo = Boolean(current?.videoTarget || receivedVideo || currentViewers.length > 0);
  const titleText = `${getUsername(current?.participantId ?? '')}'s Screen${tracks.length > 1 ? `  ${currentIndex + 1}/${tracks.length}` : ''}`;

  useEffect(() => {
    const publication = current?.publication;
    if (!publication) return;
    const target = getQualityTarget(
      viewerQuality,
      current?.videoTarget,
      fullscreen ? modalWidth : cardWidth,
      fullscreen ? screenHeight : Math.round(cardWidth * 9 / 16),
    );
    publication.setVideoFPS?.(target.fps);
    if (viewerQuality === 'high') publication.setVideoQuality?.(VideoQuality.HIGH);
    else if (viewerQuality === 'medium') publication.setVideoQuality?.(VideoQuality.MEDIUM);
    else if (viewerQuality === 'low') publication.setVideoQuality?.(VideoQuality.LOW);
    else publication.setVideoDimensions?.({ width: target.width, height: target.height });
  }, [cardWidth, current?.id, current?.publication, current?.videoTarget, fullscreen, modalWidth, screenHeight, viewerQuality]);

  useEffect(() => {
    let cancelled = false;
    const readReceivedVideo = () => {
      const videoSettings = current?.track?.mediaStreamTrack?.getSettings?.();
      const height = typeof videoSettings?.height === 'number' ? Math.round(videoSettings.height) : null;
      const fps = typeof videoSettings?.frameRate === 'number' ? Math.round(videoSettings.frameRate) : null;
      if (height) {
        setReceivedVideo({ height, fps: fps ?? 0 });
        return;
      }
      void current?.track?.getReceiverStats?.()
        ?.then((stats: any) => {
          if (cancelled) return;
          const statHeight = typeof stats?.frameHeight === 'number' ? Math.round(stats.frameHeight) : null;
          const frames = typeof stats?.framesDecoded === 'number'
            ? stats.framesDecoded
            : (typeof stats?.framesReceived === 'number' ? stats.framesReceived : null);
          const timestamp = typeof stats?.timestamp === 'number' ? stats.timestamp : Date.now();
          const previous = previousReceivedStatsRef.current;
          const statFps = previous && frames !== null && timestamp > previous.timestamp
            ? Math.max(0, Math.round(((frames - previous.frames) * 1000) / (timestamp - previous.timestamp)))
            : 0;
          if (frames !== null) previousReceivedStatsRef.current = { frames, timestamp };
          setReceivedVideo(statHeight ? { height: statHeight, fps: statFps } : null);
        })
        .catch(() => {
          if (!cancelled) setReceivedVideo(null);
        });
    };
    previousReceivedStatsRef.current = null;
    readReceivedVideo();
    const interval = setInterval(readReceivedVideo, 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [current?.id, current?.track]);

  // Restart the decode grace window whenever the active stream changes.
  useEffect(() => {
    setDecodeGraceElapsed(false);
    const timer = setTimeout(() => setDecodeGraceElapsed(true), 6000);
    return () => clearTimeout(timer);
  }, [current?.id]);

  // Ground-truth decode check: frames are actually arriving (height resolved).
  // The publisher's share is H.265 and, after the grace window, this device is
  // still not decoding any frames — show an explainer instead of a blank tile.
  // Auto-clears if frames start arriving.
  const isDecodingVideo = Boolean(receivedVideo && receivedVideo.height > 0);
  const hevcUnsupported = isHevcMimeType(current?.publication?.mimeType) && decodeGraceElapsed && !isDecodingVideo;

  // ── Shared overlay UI pieces ─────────────────────────────────────────────

  const bottomBar = (isFullscreen: boolean) => (
    <View style={styles.bottomOverlay}>
      <Text style={styles.title} numberOfLines={1}>{titleText}</Text>
      <View style={styles.bottomControls}>
        <Pressable onPress={toggleMute} style={styles.overlayBtn} hitSlop={10}>
          {volumePct === 0
            ? <VolumeX size={17} color="#fff" />
            : <Volume2 size={17} color="#fff" />}
        </Pressable>
        <Slider
          style={styles.slider}
          minimumValue={0}
          maximumValue={100}
          step={5}
          value={volumePct}
          onValueChange={handleVolumeChange}
          minimumTrackTintColor="#fff"
          maximumTrackTintColor="rgba(255,255,255,0.3)"
          thumbTintColor="#fff"
        />
        <Text style={styles.volLabel}>{volumePct === 0 ? 'Muted' : `${volumePct}%`}</Text>
        <View style={styles.bottomActions}>
          <Pressable
            onPress={() => {
              const currentQualityIndex = QUALITY_ORDER.indexOf(viewerQuality);
              const nextQuality = QUALITY_ORDER[(currentQualityIndex + 1) % QUALITY_ORDER.length] ?? 'auto';
              setViewerQuality(nextQuality);
              showOverlay();
            }}
            style={styles.qualityBtn}
            hitSlop={10}
          >
            <Text style={styles.qualityText}>{QUALITY_LABELS[viewerQuality]}</Text>
          </Pressable>
          <Pressable onPress={() => void toggleFullscreen()} style={styles.overlayBtn} hitSlop={10}>
            {isFullscreen
              ? <Minimize2 size={17} color="#fff" />
              : <Maximize2 size={17} color="#fff" />}
          </Pressable>
          <Pressable onPress={onClose} style={styles.overlayBtn} hitSlop={10}>
            <X size={17} color="#fff" />
          </Pressable>
        </View>
      </View>
    </View>
  );

  const chevrons = (
    <>
      {tracks.length > 1 && currentIndex > 0 && (
        <Pressable
          onPress={() => goTo(currentIndex - 1)}
          style={[styles.chevron, styles.chevronLeft, { backgroundColor: theme.colors.bgElev1 + 'cc' }]}
          hitSlop={8}
        >
          <ChevronLeft size={18} color="#fff" />
        </Pressable>
      )}
      {tracks.length > 1 && currentIndex < tracks.length - 1 && (
        <Pressable
          onPress={() => goTo(currentIndex + 1)}
          style={[styles.chevron, styles.chevronRight, { backgroundColor: theme.colors.bgElev1 + 'cc' }]}
          hitSlop={8}
        >
          <ChevronRight size={18} color="#fff" />
        </Pressable>
      )}
    </>
  );

  const dots = tracks.length > 1 && (
    <View style={styles.dotsRow}>
      {tracks.map((_, i) => (
        <View
          key={i}
          style={[styles.dot, { backgroundColor: i === currentIndex ? '#fff' : 'rgba(255,255,255,0.35)' }]}
        />
      ))}
    </View>
  );

  const streamInfo = showStreamInfo ? (
    <View style={styles.streamInfo}>
      {current?.videoTarget ? (
        <View style={styles.infoPill}>
          <Text style={[styles.infoText, styles.targetText]}>
            {current.videoTarget.height}p{current.videoTarget.fps} Target
          </Text>
        </View>
      ) : null}
      {receivedVideo ? (
        <View style={styles.infoPill}>
          <Text style={styles.infoText}>
            {receivedVideo.height}p{receivedVideo.fps ? `${receivedVideo.fps}` : ''} Received
          </Text>
        </View>
      ) : null}
      {currentViewers.length > 0 ? (
        <View style={styles.viewerPill}>
          <View style={styles.viewerCount}>
            <Eye size={13} color="#fff" />
            <Text style={styles.infoText}>{currentViewers.length}</Text>
          </View>
          <View style={styles.viewerAvatars}>
            {currentViewers.slice(0, 5).map((viewer, index) => (
              <View key={viewer.id} style={[styles.viewerAvatar, { marginLeft: index === 0 ? 0 : -8 }]}>
                <Avatar
                  username={viewer.username}
                  uri={viewer.avatar}
                  size={24}
                  accountType={viewer.accountType}
                  baseUrl={viewer.accountType === 'local' ? avatarBaseUrl : undefined}
                  showStatus={false}
                />
              </View>
            ))}
            {currentViewers.length > 5 ? (
              <View style={[styles.viewerExtra, { marginLeft: -8 }]}>
                <Text style={styles.viewerExtraText}>+{currentViewers.length - 5}</Text>
              </View>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  ) : null;

  const hevcNotice = hevcUnsupported ? (
    <View style={styles.hevcNotice} pointerEvents="none">
      <View style={styles.hevcNoticeBox}>
        <MonitorX size={28} color="#fff" />
        <Text style={styles.hevcNoticeTitle}>H.265 not supported</Text>
        <Text style={styles.hevcNoticeText}>
          This screen share is encoded in H.265 (HEVC), which this device can&apos;t decode. Open it on the
          desktop app or a device with HEVC support to watch.
        </Text>
      </View>
    </View>
  ) : null;

  // ── Inline card ───────────────────────────────────────────────────────────

  const card = (
    <TouchableWithoutFeedback onPress={showOverlay}>
      <View style={[styles.card, { backgroundColor: '#000' }]} onLayout={handleCardLayout}>
        <ScrollView
          ref={cardScrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={handleCardScroll}
          scrollEventThrottle={16}
          style={styles.fill}
        >
          {tracks.map((entry) => (
            <View key={entry.id} style={[styles.page, { width: cardWidth }]}>
              <VideoView videoTrack={entry.track} style={styles.fill} objectFit="contain" />
            </View>
          ))}
        </ScrollView>

        {hevcNotice}

        <Animated.View style={[StyleSheet.absoluteFill, { opacity: overlayOpacity }]} pointerEvents="box-none">
          {streamInfo}
          {bottomBar(false)}
          {chevrons}
          {dots}
        </Animated.View>
      </View>
    </TouchableWithoutFeedback>
  );

  // ── Fullscreen modal ──────────────────────────────────────────────────────

  const modal = (
    <Modal
      visible={fullscreen}
      transparent={false}
      animationType="fade"
      statusBarTranslucent
      supportedOrientations={['portrait', 'portrait-upside-down', 'landscape', 'landscape-left', 'landscape-right']}
      onRequestClose={() => void toggleFullscreen()}
    >
      <TouchableWithoutFeedback onPress={showOverlay}>
        <View style={[styles.fullscreenContainer, { backgroundColor: '#000' }]} onLayout={handleModalLayout}>
          <ScrollView
            ref={modalScrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={handleModalScroll}
            scrollEventThrottle={16}
            style={styles.fill}
          >
            {tracks.map((entry) => (
              <View key={entry.id} style={[styles.fullscreenPage, { width: modalWidth, height: screenHeight }]}>
                <VideoView videoTrack={entry.track} style={styles.fill} objectFit="contain" />
              </View>
            ))}
          </ScrollView>

          {hevcNotice}

          <Animated.View style={[StyleSheet.absoluteFill, { opacity: overlayOpacity }]} pointerEvents="box-none">
            {streamInfo}
            {bottomBar(true)}
            {chevrons}
            {dots}
          </Animated.View>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );

  return (
    <>
      {card}
      {modal}
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    aspectRatio: 16 / 9,
    overflow: 'hidden',
  },
  fill: { flex: 1 },
  page: {
    flex: 1,
    justifyContent: 'center',
  },
  fullscreenContainer: {
    flex: 1,
    overflow: 'hidden',
  },
  fullscreenPage: {
    justifyContent: 'center',
  },
  streamInfo: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  infoPill: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(110,231,183,0.45)',
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  viewerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  viewerCount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  viewerAvatars: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  viewerAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.7)',
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  viewerExtra: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.7)',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  viewerExtraText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  infoText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  targetText: {
    color: '#bbf7d0',
  },
  title: {
    color: 'rgba(255,255,255,0.85)',
    fontWeight: '600',
    fontSize: 12,
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  overlayBtn: { padding: 4 },
  qualityBtn: {
    minWidth: 54,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qualityText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  bottomOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    paddingTop: 18,
    paddingBottom: 8,
    gap: 4,
  },
  bottomControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bottomActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 2,
  },
  slider: {
    flex: 1,
    height: 28,
    minWidth: 70,
  },
  volLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    minWidth: 36,
    textAlign: 'right',
  },
  hevcNotice: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  hevcNoticeBox: {
    maxWidth: 360,
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 18,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  hevcNoticeTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  hevcNoticeText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
  chevron: {
    position: 'absolute',
    top: '50%',
    marginTop: -18,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevronLeft: { left: 10 },
  chevronRight: { right: 10 },
  dotsRow: {
    position: 'absolute',
    bottom: 76,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
