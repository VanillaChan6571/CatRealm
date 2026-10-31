import { useCallback, useEffect, useState } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDeviceLayout } from '@/hooks/useDeviceLayout';
import { useTheaterOverlayStage } from '@/hooks/useTheaterOverlayStage';
import { useTheaterPlaybackPermission } from '@/hooks/useTheaterPlaybackPermission';
import { TheaterVoiceControls } from '@/components/theater/TheaterVoiceControls';
import { TheaterChatPanel } from '@/components/theater/TheaterChatPanel';
import { TheaterJoinModal } from '@/components/theater/TheaterJoinModal';
import { AddVideoButton } from '@/components/theater/AddVideoButton';
import { theaterLayout } from '@/lib/theaterLayout';
import Slider from '@react-native-community/slider';
import {
  ChevronLeft,
  Film,
  Play,
  Pause,
  SkipForward,
  Users,
  List,
  MessageCircle,
  Trash2,
  ThumbsUp,
  Crown,
  MicOff,
  Volume2,
  VolumeX,
} from 'lucide-react-native';
import { useTheme } from '@/theme';
import { Text, Pressable, Avatar } from '@/components';
import { useTranslation } from 'react-i18next';
import { useTheaterStore, type TheaterParticipant } from '@/stores/theaterStore';
import { useAuthStore } from '@/stores/authStore';
import { useServerStore } from '@/stores/serverStore';
import { useChannelStore } from '@/stores/channelStore';
import { useUIStore } from '@/stores/uiStore';
import type { Channel, TheaterQueueItem } from '@/types';

// The join modal's own screen re-renders into the theater once joined.
const noop = () => {};

// Stable fallback — a fresh [] per snapshot re-renders forever (React #185).
const EMPTY_CHANNELS: Channel[] = [];

function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// ── URL helpers ────────────────────────────────────────────────────────────

function isYouTubeUrl(url: string): boolean {
  return url.startsWith('youtube:') || /youtube\.com|youtu\.be/.test(url);
}

// ── Queue item row ─────────────────────────────────────────────────────────

function QueueRow({
  item,
  isCurrentItem,
  canRemove,
  onRemove,
  onVote,
}: {
  item: TheaterQueueItem;
  isCurrentItem: boolean;
  canRemove: boolean;
  onRemove: () => void;
  onVote: (up: boolean) => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <View
      style={[
        styles.queueRow,
        { backgroundColor: isCurrentItem ? theme.colors.bgElev2 : 'transparent' },
      ]}
    >
      {isCurrentItem && <Play size={12} color={theme.colors.accent} style={{ marginRight: 4 }} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="body" numberOfLines={1} style={{ color: theme.colors.text }}>
          {item.title || item.source_url}
        </Text>
        {item.added_by_username && (
          <Text variant="caption" color={theme.colors.text3}>
            {t('theater.addedBy', { username: item.added_by_username })}
          </Text>
        )}
      </View>
      <View style={styles.queueRowActions}>
        <TouchableOpacity onPress={() => onVote(true)} style={styles.voteBtn}>
          <ThumbsUp size={14} color={item.myVote ? theme.colors.accent : theme.colors.text3} />
          <Text variant="caption" color={item.myVote ? theme.colors.accent : theme.colors.text3}>
            {item.votes}
          </Text>
        </TouchableOpacity>
        {canRemove && (
          <TouchableOpacity onPress={onRemove} style={styles.voteBtn}>
            <Trash2 size={14} color={theme.colors.danger} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ── Participant row ────────────────────────────────────────────────────────

function ParticipantRow({ participant, isHost }: { participant: TheaterParticipant; isHost: boolean }) {
  const theme = useTheme();
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const muted = !participant.micEnabled || participant.deafened;
  return (
    <View style={styles.participantRow}>
      <Avatar
        username={participant.username}
        uri={participant.avatar}
        size={32}
        baseUrl={serverUrl ?? undefined}
      />
      <Text variant="body" numberOfLines={1} style={{ flex: 1, color: theme.colors.text }}>
        {participant.username}
      </Text>
      {muted && <MicOff size={12} color={theme.colors.danger} />}
      {isHost && <Crown size={14} color={theme.colors.warning} />}
    </View>
  );
}

// ── Add URL modal ──────────────────────────────────────────────────────────

function AddUrlModal({
  visible,
  onClose,
  onAdd,
}: {
  visible: boolean;
  onClose: () => void;
  onAdd: (url: string) => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [url, setUrl] = useState('');

  const handleAdd = () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setUrl('');
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}
      supportedOrientations={['portrait', 'portrait-upside-down', 'landscape', 'landscape-left', 'landscape-right']}>
      <View style={styles.modalBackdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.modalBox, { backgroundColor: theme.colors.bgElev1 }]}>
            <Text variant="subtitle" style={{ color: theme.colors.text, marginBottom: 12 }}>
              {t('theater.addVideo')}
            </Text>
            <TextInput
              value={url}
              onChangeText={setUrl}
              placeholder={t('theater.videoUrlPlaceholder')}
              placeholderTextColor={theme.colors.text3}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={[styles.urlInput, { color: theme.colors.text, borderColor: theme.colors.line, backgroundColor: theme.colors.bgElev2 }]}
            />
            <View style={styles.modalActions}>
              <Pressable onPress={onClose} style={[styles.modalBtn, { backgroundColor: theme.colors.bgElev2 }]}>
                <Text variant="body" color={theme.colors.text2}>{t('common.cancel')}</Text>
              </Pressable>
              <Pressable onPress={handleAdd} style={[styles.modalBtn, { backgroundColor: theme.colors.accent }]}>
                <Text variant="body" style={{ color: '#fff', fontWeight: '700' }}>{t('theater.add')}</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ── Main screen ────────────────────────────────────────────────────────────

export default function TheaterScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { channelId, serverId } = useLocalSearchParams<{ channelId: string; serverId: string }>();

  const channelName = useTheaterStore((s) => s.channelName);
  const channelIdInStore = useTheaterStore((s) => s.channelId);
  const participants = useTheaterStore((s) => s.participants);
  const queue = useTheaterStore((s) => s.queue);
  const playbackState = useTheaterStore((s) => s.playbackState);
  const hostUserId = useTheaterStore((s) => s.hostUserId);
  const leaveTheater = useTheaterStore((s) => s.leaveTheater);
  const focused = useTheaterStore((s) => s.focused);
  const addToQueue = useTheaterStore((s) => s.addToQueue);
  const removeFromQueue = useTheaterStore((s) => s.removeFromQueue);
  const voteQueue = useTheaterStore((s) => s.voteQueue);
  const control = useTheaterStore((s) => s.control);
  const castSkipVote = useTheaterStore((s) => s.castSkipVote);
  const computeExpectedPositionMs = useTheaterStore((s) => s.computeExpectedPositionMs);
  const mediaError = useTheaterStore((s) => s.mediaError);
  const controlError = useTheaterStore((s) => s.controlError);

  const selfUser = useAuthStore((s) => s.user);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const setChannelsSheetOpen = useUIStore((s) => s.setChannelsSheetOpen);
  const lastChannelByServer = useChannelStore((s) => s.lastChannelByServer);
  const channelsForServer = useServerStore((s) => {
    const sid = (serverId ?? s.activeServerId ?? '') as string;
    return sid ? (s.channels[sid] ?? EMPTY_CHANNELS) : EMPTY_CHANNELS;
  });
  const serverKey = serverId ?? activeServerId ?? '';

  const joinedServerId = useTheaterStore((s) => s.serverId);
  const isInThisChannel = channelIdInStore === channelId && joinedServerId === serverKey;
  const effectiveHostUserId = isInThisChannel ? (hostUserId ?? playbackState?.host_user_id ?? null) : null;
  const canControlPlayback = useTheaterPlaybackPermission(serverKey, channelId);
  const resolvedChannelName = (isInThisChannel ? channelName : null)
    ?? channelsForServer.find((c) => c.id === channelId)?.name
    ?? null;

  const { width: viewportWidth, height: viewportHeight } = useDeviceLayout();
  const [bodySize, setBodySize] = useState<{ width: number; height: number } | null>(null);
  const [controlsHeight, setControlsHeight] = useState(112);

  const tab = useTheaterStore((s) => s.panelTab);
  const setTab = useTheaterStore((s) => s.setPanelTab);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [seekPreviewMs, setSeekPreviewMs] = useState<number | null>(null);
  const mediaVolume = useTheaterStore((s) => s.mediaVolume);
  const setMediaVolume = useTheaterStore((s) => s.setMediaVolume);
  const mediaMuted = useTheaterStore((s) => s.mediaMuted);
  const setMediaMuted = useTheaterStore((s) => s.setMediaMuted);
  const volumePct = mediaVolume * 100;
  const setVolumePct = (value: number) => {
    setMediaVolume(value / 100);
    if (value > 0) setMediaMuted(false);
  };
  const toggleMediaMute = () => {
    if (mediaMuted || mediaVolume === 0) {
      if (mediaVolume === 0) setMediaVolume(1);
      setMediaMuted(false);
    } else {
      setMediaMuted(true);
    }
  };

  const isLeanBackMode = focused;
  const layout = theaterLayout(bodySize?.width ?? viewportWidth,
    bodySize?.height ?? Math.max(0, viewportHeight - insets.top - 120), controlsHeight, focused);
  const expectedPlayerWidth = layout.playerWidth;
  const expectedPlayerHeight = keyboardVisible && tab === 'chat' && !focused && !layout.split
    ? Math.min(layout.playerHeight, 90) : layout.playerHeight;

  const { stageRef: playerStageRef, measure: measurePlayerStage } = useTheaterOverlayStage(
    serverKey, channelId, isInThisChannel, expectedPlayerWidth, expectedPlayerHeight,
  );

  const handleBack = useCallback(() => {
    const rememberedChannelId = serverKey ? (lastChannelByServer[serverKey] ?? null) : null;
    const rememberedChannel = rememberedChannelId
      ? channelsForServer.find((channel) => channel.id === rememberedChannelId && channel.type !== 'voice' && channel.type !== 'theater')
      : null;
    const fallbackChannel = channelsForServer.find(
      (channel) => channel.type !== 'voice' && channel.type !== 'theater',
    ) ?? null;
    const targetChannel = rememberedChannel ?? fallbackChannel;

    if (serverKey && targetChannel) {
      router.replace({
        pathname: '/server/[serverId]/channel/[channelId]',
        params: { serverId: serverKey, channelId: targetChannel.id },
      });
      return;
    }

    setChannelsSheetOpen(true);
  }, [channelsForServer, lastChannelByServer, router, serverKey, setChannelsSheetOpen]);

  const handleLeaveTheater = useCallback(() => {
    leaveTheater();
  }, [leaveTheater]);

  const currentItemId = playbackState?.current_item_id ?? null;
  const currentQueueItem = currentItemId ? queue.find((q) => q.id === currentItemId) : null;
  const videoUrl = playbackState?.videoUrl ??
    currentQueueItem?.videoUrl ??
    currentQueueItem?.source_url ??
    null;
  const resolvedPlayerKind: 'youtube' | 'video' | 'empty' = videoUrl ? (isYouTubeUrl(videoUrl) ? 'youtube' : 'video') : 'empty';
  const localMuted = mediaMuted || volumePct === 0;
  const positionMs = computeExpectedPositionMs();
  const playing = playbackState?.playing ?? false;
  const durationMs = playbackState?.duration_ms ?? 0;
  const effectivePositionMs = seekPreviewMs ?? positionMs;
  const handlePlayPause = useCallback((play: boolean) => {
    control(channelId, { playing: play, positionMs: computeExpectedPositionMs() });
  }, [channelId, control, computeExpectedPositionMs]);

  const handleSeekCommit = useCallback((nextMs: number) => {
    control(channelId, { positionMs: Math.max(0, Math.floor(nextMs)), playing });
  }, [channelId, control, playing]);

  const handleAddToQueue = useCallback((url: string) => {
    void addToQueue(channelId, url);
  }, [channelId, addToQueue]);

  const handleRemoveFromQueue = useCallback((itemId: string) => {
    void removeFromQueue(channelId, itemId);
  }, [channelId, removeFromQueue]);

  const handleVote = useCallback((itemId: string, up: boolean) => {
    void voteQueue(channelId, itemId, up);
  }, [channelId, voteQueue]);

  const renderQueueItem = useCallback(({ item }: { item: TheaterQueueItem }) => (
    <QueueRow
      item={item}
      isCurrentItem={item.id === currentItemId}
      canRemove={canControlPlayback || item.added_by === selfUser?.id}
      onRemove={() => handleRemoveFromQueue(item.id)}
      onVote={(up) => handleVote(item.id, up)}
    />
  ), [canControlPlayback, currentItemId, selfUser?.id, handleRemoveFromQueue, handleVote]);

  const renderParticipant = useCallback(({ item }: { item: TheaterParticipant }) => (
    <ParticipantRow participant={item} isHost={item.userId === effectiveHostUserId} />
  ), [effectiveHostUserId]);

  const keyExtractorQ = useCallback((item: TheaterQueueItem) => item.id, []);
  const keyExtractorP = useCallback((item: TheaterParticipant) => item.userId, []);

  if (!isInThisChannel) {
    return (
      <View style={[styles.root, { backgroundColor: theme.colors.bgApp, paddingTop: insets.top }]}>
        <View style={[styles.header, { borderBottomColor: theme.colors.line }]}>
          <Pressable onPress={handleBack} style={styles.backBtn}>
            <ChevronLeft size={22} color={theme.colors.text2} />
          </Pressable>
          <View style={styles.headerCenter}>
            <Film size={16} color={theme.colors.accent} />
            <Text variant="subtitle" style={{ marginLeft: 6, color: theme.colors.text }}>
              {resolvedChannelName ?? t('theater.fallbackTitle', { id: channelId?.slice(0, 8) })}
            </Text>
          </View>
          <View style={styles.headerRight} />
        </View>

        {/* Reached without joining (e.g. a notification): ask, don't cover the screen. */}
        <TheaterJoinModal serverId={serverKey} channelId={channelId} channelName={resolvedChannelName}
          onCancel={handleBack} onJoined={noop} />
      </View>
    );
  }

  // Shared controls panel (player + seek + volume + skip)
  const controlsPanel = (
    <View testID="theater-inline-controls" onLayout={({ nativeEvent }) => setControlsHeight(nativeEvent.layout.height)}>
      {!!(controlError || mediaError) && <Text accessibilityRole="alert" style={{ color: theme.colors.danger, padding: 8 }}>{controlError || mediaError}</Text>}
      <View style={[styles.syncedControlsBar, { backgroundColor: theme.colors.bgElev1, borderBottomColor: theme.colors.line }]}>
        {durationMs > 0 && (
          <Slider
            minimumValue={0}
            maximumValue={durationMs}
            value={Math.min(effectivePositionMs, durationMs)}
            step={1000}
            minimumTrackTintColor={theme.colors.accent}
            maximumTrackTintColor={theme.colors.line}
            thumbTintColor={theme.colors.accent}
            disabled={!canControlPlayback}
            onValueChange={(v) => setSeekPreviewMs(v)}
            onSlidingComplete={(v) => {
              setSeekPreviewMs(null);
              if (canControlPlayback) handleSeekCommit(v);
            }}
          />
        )}
        {!isLeanBackMode && <View style={styles.syncedControlsRow}>
          <TouchableOpacity
            accessibilityLabel={playing ? 'Pause theater video' : 'Play theater video'}
            activeOpacity={0.7}
            disabled={!canControlPlayback}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            onPress={() => {
              if (!canControlPlayback) return;
              handlePlayPause(!playing);
            }}
            style={[styles.syncedPlayBtn, !canControlPlayback && { opacity: 0.4 }]}
          >
            {playing ? <Pause size={16} color={theme.colors.text} /> : <Play size={16} color={theme.colors.text} />}
          </TouchableOpacity>
          <Text variant="caption" color={theme.colors.text2} style={{ fontVariant: ['tabular-nums'] }}>
            {formatTime(effectivePositionMs / 1000)}{durationMs > 0 ? ` / ${formatTime(durationMs / 1000)}` : ''}
          </Text>
          <View style={{ flex: 1 }} />
          <Pressable accessibilityLabel={localMuted ? 'Unmute theater video' : 'Mute theater video'} onPress={toggleMediaMute} style={styles.syncedPlayBtn}>
            {localMuted ? <VolumeX size={18} color={theme.colors.text2} /> : <Volume2 size={18} color={theme.colors.text2} />}
          </Pressable>
          {canControlPlayback && currentItemId && <Pressable accessibilityLabel="Skip theater video" onPress={() => void castSkipVote(channelId)} style={styles.syncedPlayBtn}>
            <SkipForward size={18} color={theme.colors.text2} />
          </Pressable>}
          <AddVideoButton invite={queue.length === 0} onPress={() => setAddModalVisible(true)} />
        </View>}
        <TheaterVoiceControls />
        {!isLeanBackMode && resolvedPlayerKind !== 'youtube' && (
          <View style={styles.volumeRow}>
            <Text variant="caption" color={theme.colors.text3}>{t('theater.volumeShort')}</Text>
            <Slider
              style={styles.volumeSlider}
              minimumValue={0}
              maximumValue={100}
              value={volumePct}
              step={1}
              minimumTrackTintColor={theme.colors.accent}
              maximumTrackTintColor={theme.colors.line}
              thumbTintColor={theme.colors.accent}
              onValueChange={(v) => setVolumePct(v)}
            />
            <Text variant="caption" color={theme.colors.text3} style={{ width: 36, textAlign: 'right', fontVariant: ['tabular-nums'] }}>
              {Math.round(volumePct)}%
            </Text>
          </View>
        )}
      </View>
    </View>
  );

  // Shared tab panel (queue/chat/participants)
  const tabPanel = (
    <>
      <View style={[styles.tabs, { borderBottomColor: theme.colors.line }]}>
        <Pressable
          accessibilityRole="tab" accessibilityState={{ selected: tab === 'queue' }}
          onPress={() => setTab('queue')}
          style={[styles.tab, tab === 'queue' && { borderBottomColor: theme.colors.accent, borderBottomWidth: 2 }]}
        >
          <List size={16} color={tab === 'queue' ? theme.colors.accent : theme.colors.text3} />
          <Text variant="bodySmall" style={{ color: tab === 'queue' ? theme.colors.accent : theme.colors.text3, marginLeft: 4 }}>
            {t('theater.queue', { count: queue.length })}
          </Text>
        </Pressable>
        <Pressable accessibilityRole="tab" accessibilityLabel="Theater chat" accessibilityState={{ selected: tab === 'chat' }}
          onPress={() => setTab('chat')} style={[styles.tab, tab === 'chat' && { borderBottomColor: theme.colors.accent, borderBottomWidth: 2 }]}>
          <MessageCircle size={16} color={tab === 'chat' ? theme.colors.accent : theme.colors.text3} />
          <Text variant="bodySmall" style={{ color: tab === 'chat' ? theme.colors.accent : theme.colors.text3 }}>{t('theater.chat')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="tab" accessibilityState={{ selected: tab === 'participants' }}
          onPress={() => setTab('participants')}
          style={[styles.tab, tab === 'participants' && { borderBottomColor: theme.colors.accent, borderBottomWidth: 2 }]}
        >
          <Users size={16} color={tab === 'participants' ? theme.colors.accent : theme.colors.text3} />
          <Text variant="bodySmall" style={{ color: tab === 'participants' ? theme.colors.accent : theme.colors.text3, marginLeft: 4 }}>
            {t('theater.watching', { count: participants.length })}
          </Text>
        </Pressable>
      </View>
      {tab === 'chat' ? <TheaterChatPanel key={`${serverKey}:${channelId}`} serverId={serverKey} channelId={channelId} /> : tab === 'queue' ? (
        <FlatList
          data={queue}
          renderItem={renderQueueItem}
          keyExtractor={keyExtractorQ}
          contentContainerStyle={[styles.listContent, { paddingBottom: 12 }]}
          ListEmptyComponent={
            <View style={styles.emptyList}>
              <Text variant="bodySmall" color={theme.colors.text3}>{t('theater.queueEmpty')}</Text>
            </View>
          }
          windowSize={5}
        />
      ) : (
        <FlatList
          data={participants}
          renderItem={renderParticipant}
          keyExtractor={keyExtractorP}
          contentContainerStyle={[styles.listContent, { paddingBottom: 12 }]}
          windowSize={5}
        />
      )}
    </>
  );

  return (
    // iOS "padding" mode overwrites the view's own paddingBottom, which hid the
    // tablet chat composer behind the dock; keep the dock inset on a wrapper.
    // On iOS the inset stays while typing (the keyboard covers it): dropping it
    // mid-animation left the avoidance padding stale and the composer under the keys.
    // Android resizes the window instead, so the hidden dock's inset must go.
    <View style={[styles.root, { backgroundColor: theme.colors.bgApp, paddingTop: focused ? 0 : insets.top, paddingBottom: focused || (keyboardVisible && Platform.OS !== 'ios') ? 0 : 64 }]}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.root}>
      {!focused && <View style={[styles.header, { borderBottomColor: theme.colors.line }]}>
        <Pressable onPress={handleBack} style={styles.backBtn}>
          <ChevronLeft size={22} color={theme.colors.text2} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Film size={16} color={theme.colors.accent} />
          <Text variant="subtitle" style={{ marginLeft: 6, color: theme.colors.text }}>
            {resolvedChannelName ?? t('theater.fallbackTitle', { id: channelId?.slice(0, 8) })}
          </Text>
        </View>
        <View style={styles.headerRight}>
          <Pressable haptic onPress={handleLeaveTheater} style={styles.leaveBtn}>
            <Text variant="caption" style={{ color: theme.colors.danger, fontWeight: '700' }}>
              {t('theater.leave')}
            </Text>
          </Pressable>
        </View>
      </View>}

      <View testID="theater-body" onLayout={({ nativeEvent }) => {
        const { width, height } = nativeEvent.layout;
        setBodySize((previous) => previous?.width === width && previous.height === height ? previous : { width, height });
      }} style={[styles.responsiveBody, layout.split && styles.tabletBody]}>
        <View
          style={[styles.mediaColumn, layout.split && styles.tabletLeft]}
        >
          <View
            ref={playerStageRef}
            onLayout={measurePlayerStage}
            style={[styles.playerStage, { width: expectedPlayerWidth, height: expectedPlayerHeight, backgroundColor: '#000' }]}
          >
            {/* Persistent overlay owns the media and fullscreen controls. */}
          </View>
          {!isLeanBackMode && !(keyboardVisible && tab === 'chat' && !layout.split) && controlsPanel}
        </View>

        {!isLeanBackMode && <View
          style={[
            styles.listColumn,
            layout.split
              ? [styles.tabletRight, { width: layout.sidebarWidth, borderLeftColor: theme.colors.line }]
              : styles.stackedListColumn,
          ]}
        >
          {tabPanel}
        </View>}
      </View>

      <AddUrlModal
        visible={addModalVisible}
        onClose={() => setAddModalVisible(false)}
        onAdd={handleAddToQueue}
      />
    </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  responsiveBody: {
    flex: 1,
  },
  tabletBody: {
    flex: 1,
    flexDirection: 'row',
  },
  mediaColumn: {
    position: 'relative',
  },
  playerStage: {
    position: 'relative',
  },
  tabletLeft: {
    flex: 1,
  },
  listColumn: { minHeight: 0 },
  stackedListColumn: {
    flex: 1,
  },
  tabletRight: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    flexShrink: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { minWidth: 44, minHeight: 44, justifyContent: 'center' },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  headerRight: { width: 64, alignItems: 'flex-end' },
  leaveBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 10,
  },
  syncedControlsBar: {
    paddingHorizontal: 12,
    paddingTop: 0,
    paddingBottom: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  syncedControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 2,
  },
  syncedPlayBtn: {
    minWidth: 44,
    minHeight: 44,
    padding: 6,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  volumeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  volumeSlider: {
    flex: 1,
    height: 26,
  },
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    paddingVertical: 6,
    gap: 4,
  },
  listContent: { paddingTop: 4 },
  emptyList: { padding: 24, alignItems: 'center' },
  queueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  queueRowActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  voteBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, padding: 4 },
  participantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 10,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalBox: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 16,
    padding: 20,
  },
  urlInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    marginBottom: 16,
  },
  modalActions: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
  modalBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
});
