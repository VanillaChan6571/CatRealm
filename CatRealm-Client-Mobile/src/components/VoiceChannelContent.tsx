import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { useIOSAudioManagement, type AppleAudioConfiguration, type AudioTrackState } from '@livekit/react-native';
import { Mic, MicOff, Monitor, Volume2, VolumeX, PhoneOff, ChevronDown } from 'lucide-react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming } from 'react-native-reanimated';
import { useTheme } from '@/theme';
import { Text, Avatar, Pressable } from '@/components';
import { getActiveVoiceRoom, useVoiceStore, type VoiceParticipant } from '@/stores/voiceStore';
import { useServerStore } from '@/stores/serverStore';
import { useAuthStore } from '@/stores/authStore';
import { ScreenShareViewer, type ScreenShareViewerInfo } from './ScreenShareViewer';

const EMPTY: VoiceParticipant[] = [];
const GRID_SPACER_ID = '__grid_spacer__';
// Restreaming / switching capture source unpublishes the old screen-share track
// before the republished one is subscribed, leaving remoteScreenTracks empty for
// a beat. Wait this long for a replacement before tearing the viewer down.
const SCREEN_SHARE_REJOIN_GRACE_MS = 5000;

function VoiceIOSAudioManagement({ room }: { room: any }) {
  const configureNativeAudio = useCallback(
    (trackState: AudioTrackState, preferSpeakerOutput: boolean): AppleAudioConfiguration => {
      if (trackState === 'localAndRemote' || trackState === 'localOnly') {
        return {
          audioCategory: 'playAndRecord',
          audioCategoryOptions: preferSpeakerOutput ? ['allowBluetooth', 'defaultToSpeaker'] : ['allowBluetooth'],
          audioMode: preferSpeakerOutput ? 'videoChat' : 'voiceChat',
        };
      }
      if (trackState === 'remoteOnly') {
        return {
          audioCategory: 'playback',
          audioCategoryOptions: [],
          audioMode: 'spokenAudio',
        };
      }
      return {
        audioCategory: 'soloAmbient',
        audioCategoryOptions: [],
        audioMode: 'default',
      };
    },
    [],
  );

  useIOSAudioManagement(room, true, configureNativeAudio);
  return null;
}

function SpeakingRing({ speaking }: { speaking: boolean }) {
  const scale = useSharedValue(1);

  if (speaking) {
    scale.value = withRepeat(withTiming(1.15, { duration: 500 }), -1, true);
  } else {
    scale.value = withTiming(1);
  }

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View
      style={[
        styles.speakingRing,
        speaking && styles.speakingRingActive,
        style,
      ]}
    />
  );
}

function ParticipantTile({
  participant,
  sharingScreen,
  onWatch,
}: {
  participant: VoiceParticipant;
  sharingScreen?: boolean;
  onWatch?: () => void;
}) {
  const theme = useTheme();
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const server = useServerStore((s) => s.byId(activeServerId ?? ''));

  const inner = (
    <View style={[styles.tile, { backgroundColor: theme.colors.bgElev1 }]}>
      <View style={styles.tileAvatarWrap}>
        <SpeakingRing speaking={participant.speaking} />
        <Avatar
          username={participant.username}
          uri={participant.avatar}
          size={56}
          baseUrl={server?.url ?? serverUrl ?? undefined}
        />
      </View>
      <Text
        variant="bodySmall"
        numberOfLines={1}
        style={[styles.tileName, { color: theme.colors.text }]}
      >
        {participant.username}
      </Text>
      <View style={styles.tileIcons}>
        {sharingScreen && <Monitor size={14} color={theme.colors.accent} />}
        {participant.deafened ? (
          <VolumeX size={14} color={theme.colors.danger} />
        ) : participant.muted ? (
          <MicOff size={14} color={theme.colors.text3} />
        ) : (
          <Mic size={14} color={theme.colors.text2} />
        )}
      </View>
    </View>
  );

  if (sharingScreen && onWatch) {
    return (
      <Pressable haptic onPress={onWatch} style={styles.tilePressable}>
        {inner}
      </Pressable>
    );
  }
  return inner;
}

export interface VoiceChannelContentProps {
  channelId: string;
  serverId: string;
  onClose?: () => void;
  topInset?: number;
  bottomInset?: number;
  showHeader?: boolean;
}

export function VoiceChannelContent({
  channelId,
  serverId,
  onClose,
  topInset = 0,
  bottomInset = 0,
  showHeader = true,
}: VoiceChannelContentProps) {
  const theme = useTheme();

  const channelName = useVoiceStore((s) => s.channelName);
  const participants = useVoiceStore((s) => s.participants) ?? EMPTY;
  const selfMicEnabled = useVoiceStore((s) => s.selfMicEnabled);
  const selfDeafened = useVoiceStore((s) => s.selfDeafened);
  const selfSpeaking = useVoiceStore((s) => s.selfSpeaking);
  const connecting = useVoiceStore((s) => s.connecting);
  const error = useVoiceStore((s) => s.error);
  const currentChannelId = useVoiceStore((s) => s.channelId);
  const voiceRoomUsers = useVoiceStore((s) => s.voiceRoomUsers);
  const screenSharingUserIds = useVoiceStore((s) => s.screenSharingUserIds);
  const remoteScreenTracks = useVoiceStore((s) => s.remoteScreenTracks);
  const screenShareViewersByUser = useVoiceStore((s) => s.screenShareViewersByUser);
  const screenShareViewerProfilesByUser = useVoiceStore((s) => s.screenShareViewerProfilesByUser);
  const roomRevision = useVoiceStore((s) => s.roomRevision);
  const joinChannel = useVoiceStore((s) => s.joinChannel);
  const leaveChannel = useVoiceStore((s) => s.leaveChannel);
  const toggleMute = useVoiceStore((s) => s.toggleMute);
  const toggleDeafen = useVoiceStore((s) => s.toggleDeafen);
  const watchScreenShare = useVoiceStore((s) => s.watchScreenShare);
  const stopWatchingScreenShare = useVoiceStore((s) => s.stopWatchingScreenShare);
  const setScreenShareVolume = useVoiceStore((s) => s.setScreenShareVolume);

  const [watchingOpen, setWatchingOpen] = useState(false);
  const [watchingInitialId, setWatchingInitialId] = useState<string | null>(null);
  const currentViewingIdRef = useRef<string | null>(null);
  const rejoinGraceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeServerId = useServerStore((s) => s.activeServerId);
  const previewServer = useServerStore((s) => s.byId(serverId || s.activeServerId || ''));
  const routeChannelName = useServerStore((s) => {
    const sid = serverId || s.activeServerId || '';
    return sid ? (s.channels[sid] ?? []).find((channel) => channel.id === channelId)?.name ?? null : null;
  });

  const isInThisChannel = currentChannelId === channelId;
  const activeVoiceRoom = isInThisChannel ? getActiveVoiceRoom() : null;
  void roomRevision;
  const resolvedChannelName = (isInThisChannel ? channelName : null) ?? routeChannelName;
  const visibleParticipants = isInThisChannel ? participants : (voiceRoomUsers[channelId] ?? EMPTY);
  const viewersByParticipantId = useMemo(() => {
    const participantById = new Map<string, VoiceParticipant>();
    [...participants, ...(voiceRoomUsers[channelId] ?? EMPTY)].forEach((participant) => {
      participantById.set(participant.userId, participant);
    });
    const selfUser = useAuthStore.getState().user;
    const next: Record<string, ScreenShareViewerInfo[]> = {};
    Object.entries(screenShareViewersByUser).forEach(([targetUserId, viewerIds]) => {
      const viewers = viewerIds
        .map<ScreenShareViewerInfo | null>((viewerId) => {
          const viewer = participantById.get(viewerId);
          if (!viewer) {
            const liveKitProfile = screenShareViewerProfilesByUser[viewerId];
            if (liveKitProfile) {
              return {
                id: viewerId,
                username: liveKitProfile.username,
                avatar: liveKitProfile.avatar ?? null,
                accountType: liveKitProfile.accountType ?? null,
              };
            }
            if (selfUser?.id !== viewerId) return null;
            return {
              id: selfUser.id,
              username: selfUser.username,
              avatar: selfUser.avatar ?? null,
              accountType: selfUser.accountType ?? null,
            };
          }
          return {
            id: viewer.userId,
            username: viewer.username,
            avatar: viewer.avatar,
            accountType: viewer.accountType ?? null,
          };
        })
        .filter((viewer): viewer is ScreenShareViewerInfo => Boolean(viewer));
      if (viewers.length > 0) next[targetUserId] = viewers;
    });
    return next;
  }, [participants, voiceRoomUsers, channelId, screenShareViewersByUser, screenShareViewerProfilesByUser]);

  const handleJoin = useCallback(() => {
    void joinChannel({
      serverId: serverId ?? activeServerId ?? '',
      channelId,
      channelName: resolvedChannelName ?? undefined,
    });
  }, [joinChannel, serverId, activeServerId, channelId, resolvedChannelName]);

  const handleWatch = useCallback((participantId: string) => {
    setWatchingInitialId(participantId);
    currentViewingIdRef.current = participantId;
    setWatchingOpen(true);
    watchScreenShare(participantId);
  }, [watchScreenShare]);

  const handleCloseViewer = useCallback(() => {
    const viewingId = currentViewingIdRef.current;
    setWatchingOpen(false);
    setWatchingInitialId(null);
    currentViewingIdRef.current = null;
    if (viewingId) stopWatchingScreenShare(viewingId);
  }, [stopWatchingScreenShare]);

  const handleActiveParticipantChange = useCallback((prev: string, next: string) => {
    currentViewingIdRef.current = next;
    stopWatchingScreenShare(prev);
    watchScreenShare(next);
  }, [stopWatchingScreenShare, watchScreenShare]);

  // Auto-close viewer if all sharers leave, or pivot to next sharer. A restream
  // or source switch briefly drops the watched track (unpublish → republish with
  // a new SID), so wait out a grace period before tearing down or pivoting —
  // otherwise viewers get kicked out and have to re-tap Watch on every restream.
  useEffect(() => {
    if (!watchingOpen) return;
    const watchedPresent = watchingInitialId
      ? remoteScreenTracks.some((t) => t.participantId === watchingInitialId)
      : remoteScreenTracks.length > 0;
    if (watchedPresent) {
      if (rejoinGraceTimerRef.current) {
        clearTimeout(rejoinGraceTimerRef.current);
        rejoinGraceTimerRef.current = null;
      }
      return;
    }
    if (rejoinGraceTimerRef.current) return;
    rejoinGraceTimerRef.current = setTimeout(() => {
      rejoinGraceTimerRef.current = null;
      const tracks = useVoiceStore.getState().remoteScreenTracks;
      if (watchingInitialId && tracks.some((t) => t.participantId === watchingInitialId)) return;
      if (tracks.length === 0) {
        handleCloseViewer();
      } else {
        const next = tracks[0].participantId;
        setWatchingInitialId(next);
        currentViewingIdRef.current = next;
      }
    }, SCREEN_SHARE_REJOIN_GRACE_MS);
  }, [remoteScreenTracks, watchingOpen, watchingInitialId, handleCloseViewer]);

  useEffect(() => () => {
    if (rejoinGraceTimerRef.current) clearTimeout(rejoinGraceTimerRef.current);
  }, []);

  const handleLeave = useCallback(() => {
    leaveChannel();
    onClose?.();
  }, [leaveChannel, onClose]);

  const renderParticipant = useCallback(
    ({ item }: { item: VoiceParticipant }) => {
      if (item.userId === GRID_SPACER_ID) {
        return <View style={styles.tilePressable} pointerEvents="none" />;
      }
      const sharing = screenSharingUserIds.includes(item.userId);
      return (
        <ParticipantTile
          participant={item}
          sharingScreen={sharing}
          onWatch={sharing ? () => handleWatch(item.userId) : undefined}
        />
      );
    },
    [screenSharingUserIds, handleWatch],
  );

  const keyExtractor = useCallback((item: VoiceParticipant) => item.userId, []);

  // Pad an odd participant count with an invisible spacer so the lone last tile
  // keeps half-width instead of stretching to fill the row (flex: 1 in a 2-col grid).
  const gridData = useMemo(
    () => (visibleParticipants.length % 2 === 1
      ? [...visibleParticipants, { userId: GRID_SPACER_ID } as VoiceParticipant]
      : visibleParticipants),
    [visibleParticipants],
  );

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.bgApp, paddingTop: topInset }]}>
      {activeVoiceRoom ? <VoiceIOSAudioManagement room={activeVoiceRoom} /> : null}
      {showHeader && (
        <View style={[styles.header, { borderBottomColor: theme.colors.line }]}>
          <Pressable onPress={onClose} style={styles.backBtn}>
            <ChevronDown size={22} color={theme.colors.text2} />
          </Pressable>
          <View style={styles.headerCenter}>
            <Volume2 size={16} color={theme.colors.accent} />
            <Text variant="subtitle" style={{ marginLeft: 6, color: theme.colors.text }}>
              {resolvedChannelName ?? `Voice — ${channelId?.slice(0, 8)}`}
            </Text>
          </View>
          <View style={styles.headerRight} />
        </View>
      )}

      {/* Participants grid */}
      {connecting ? (
        <View style={styles.centerFill}>
          <ActivityIndicator size="large" color={theme.colors.accent} />
          <Text variant="bodySmall" color={theme.colors.text2} style={{ marginTop: 12 }}>
            Connecting...
          </Text>
        </View>
      ) : error && !isInThisChannel ? (
        <View style={styles.centerFill}>
          <Text variant="body" color={theme.colors.danger} style={{ textAlign: 'center', paddingHorizontal: 24 }}>
            {error}
          </Text>
          <Pressable
            onPress={handleJoin}
            style={[styles.joinBtn, { backgroundColor: theme.colors.accent }]}
          >
            <Text variant="body" style={{ color: '#fff', fontWeight: '700' }}>
              Retry
            </Text>
          </Pressable>
        </View>
      ) : !isInThisChannel ? (
        <View style={styles.centerFill}>
          {visibleParticipants.length > 0 ? (
            <View style={styles.previewAvatarStack}>
              {visibleParticipants.slice(0, 5).map((participant, index) => (
                <View
                  key={participant.userId}
                  style={[
                    styles.previewAvatarWrap,
                    {
                      marginLeft: index === 0 ? 0 : -12,
                      borderColor: theme.colors.bgApp,
                      zIndex: 10 - index,
                    },
                  ]}
                >
                  <Avatar
                    username={participant.username}
                    uri={participant.avatar}
                    size={48}
                    baseUrl={previewServer?.url ?? undefined}
                  />
                </View>
              ))}
              {visibleParticipants.length > 5 ? (
                <View
                  style={[
                    styles.previewMoreBadge,
                    {
                      marginLeft: -12,
                      backgroundColor: theme.colors.bgElev2,
                      borderColor: theme.colors.bgApp,
                    },
                  ]}
                >
                  <Text variant="caption" style={{ color: theme.colors.text, fontWeight: '700' }}>
                    +{visibleParticipants.length - 5}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : (
            <Volume2 size={48} color={theme.colors.text3} />
          )}
          <Text variant="body" color={theme.colors.text2} style={{ marginTop: 16 }}>
            {visibleParticipants.length > 0
              ? `${visibleParticipants.length} ${visibleParticipants.length === 1 ? 'member is' : 'members are'} in voice`
              : 'Tap to join this voice channel'}
          </Text>
          <Pressable
            haptic
            onPress={handleJoin}
            style={[styles.joinBtn, { backgroundColor: theme.colors.accent }]}
          >
            <Text variant="body" style={{ color: '#fff', fontWeight: '700' }}>
              Join Voice
            </Text>
          </Pressable>
        </View>
      ) : (
        <>
          {/* Inline screen share card — replaces banner when watching */}
          {isInThisChannel && watchingOpen && watchingInitialId && remoteScreenTracks.length > 0 ? (
            <ScreenShareViewer
              tracks={remoteScreenTracks}
              getUsername={(id) => visibleParticipants.find((p) => p.userId === id)?.username ?? id}
              initialParticipantId={watchingInitialId}
              onClose={handleCloseViewer}
              onActiveParticipantChange={handleActiveParticipantChange}
              onVolumeChange={setScreenShareVolume}
              viewersByParticipantId={viewersByParticipantId}
              avatarBaseUrl={previewServer?.url}
            />
          ) : isInThisChannel && screenSharingUserIds.length > 0 ? (
            <View style={[styles.screenShareBanner, { backgroundColor: theme.colors.bgElev2, borderBottomColor: theme.colors.line }]}>
              <Monitor size={14} color={theme.colors.accent} />
              <Text variant="caption" style={{ color: theme.colors.text2, marginLeft: 6, flex: 1 }}>
                {screenSharingUserIds.length === 1
                  ? `${visibleParticipants.find((p) => p.userId === screenSharingUserIds[0])?.username ?? 'Someone'} is sharing their screen`
                  : `${screenSharingUserIds.length} people are sharing their screen`}
              </Text>
              <Pressable
                haptic
                onPress={() => handleWatch(screenSharingUserIds[0])}
                style={[styles.watchBtn, { backgroundColor: theme.colors.accent }]}
              >
                <Text variant="caption" style={{ color: '#fff', fontWeight: '700' }}>Watch</Text>
              </Pressable>
            </View>
          ) : null}
          {participants.length === 0 ? (
            <View style={styles.centerFill}>
              <Text variant="bodySmall" color={theme.colors.text3}>
                Nobody else is here yet.
              </Text>
            </View>
          ) : (
            <FlatList
              data={gridData}
              renderItem={renderParticipant}
              keyExtractor={keyExtractor}
              numColumns={2}
              contentContainerStyle={[styles.grid, { paddingBottom: bottomInset + 100 }]}
              columnWrapperStyle={styles.row}
              windowSize={5}
            />
          )}
        </>
      )}

      {/* Control bar — only shown when in voice */}
      {isInThisChannel && (
        <View
          style={[
            styles.controls,
            {
              backgroundColor: theme.colors.bgElev1,
              borderTopColor: theme.colors.line,
              paddingBottom: bottomInset + 12,
            },
          ]}
        >
          <View
            style={[
              styles.selfSpeakingBadge,
              {
                backgroundColor: selfSpeaking ? '#22c55e' : theme.colors.bgElev2,
                borderColor: selfSpeaking ? '#86efac' : theme.colors.lineSoft,
              },
            ]}
          >
            <View
              style={[
                styles.selfSpeakingDot,
                { backgroundColor: selfSpeaking ? '#dcfce7' : theme.colors.text3 },
              ]}
            />
            <Text
              variant="caption"
              style={{ color: selfSpeaking ? '#052e16' : theme.colors.text2, fontWeight: '700' }}
            >
              {selfSpeaking ? 'You are speaking' : 'Voice idle'}
            </Text>
          </View>

          <View style={styles.controlsRow}>
            <Pressable
              haptic
              onPress={() => void toggleMute()}
              style={[
                styles.controlBtn,
                { backgroundColor: selfMicEnabled ? theme.colors.bgElev2 : theme.colors.danger },
              ]}
            >
              {selfMicEnabled
                ? <Mic size={22} color={theme.colors.text} />
                : <MicOff size={22} color="#fff" />}
              <Text variant="caption" style={{ color: selfMicEnabled ? theme.colors.text2 : '#fff', marginTop: 4 }}>
                {selfMicEnabled ? 'Mute' : 'Unmute'}
              </Text>
            </Pressable>

            <Pressable
              haptic
              onPress={toggleDeafen}
              style={[
                styles.controlBtn,
                { backgroundColor: selfDeafened ? '#f59e0b' : theme.colors.bgElev2 },
              ]}
            >
              {selfDeafened
                ? <VolumeX size={22} color="#000" />
                : <Volume2 size={22} color={theme.colors.text} />}
              <Text variant="caption" style={{ color: selfDeafened ? '#000' : theme.colors.text2, marginTop: 4 }}>
                {selfDeafened ? 'Undeafen' : 'Deafen'}
              </Text>
            </Pressable>

            <Pressable
              haptic
              onPress={handleLeave}
              style={[styles.controlBtn, { backgroundColor: theme.colors.danger }]}
            >
              <PhoneOff size={22} color="#fff" />
              <Text variant="caption" style={{ color: '#fff', marginTop: 4 }}>
                Leave
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { padding: 4 },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  headerRight: { width: 30 },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  previewAvatarStack: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    paddingHorizontal: 12,
  },
  previewAvatarWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  previewMoreBadge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinBtn: {
    marginTop: 8,
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 24,
  },
  screenShareBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  watchBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginLeft: 8,
  },
  tilePressable: { flex: 1 },
  grid: { padding: 12, gap: 12 },
  row: { gap: 12 },
  tile: {
    flex: 1,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    gap: 8,
  },
  tileAvatarWrap: { position: 'relative', alignItems: 'center', justifyContent: 'center' },
  speakingRing: {
    position: 'absolute',
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  speakingRingActive: { borderColor: '#22c55e' },
  tileName: { textAlign: 'center', fontWeight: '600' },
  tileIcons: { flexDirection: 'row', gap: 4 },
  controls: {
    flexDirection: 'column',
    justifyContent: 'center',
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  selfSpeakingBadge: {
    alignSelf: 'center',
    marginBottom: 10,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  selfSpeakingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  controlBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 16,
    minWidth: 80,
  },
});
