import { useEffect, useRef, useState } from 'react';
import { Animated, Modal, StyleSheet, View } from 'react-native';
import { Phone, PhoneOff, Mic, MicOff, Volume2, VolumeX, Video, VideoOff } from 'lucide-react-native';
import { VideoView } from '@livekit/react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { useAuthStore } from '@/stores/authStore';
import { useCallStore } from '@/stores/callStore';
import { Text } from './Text';
import { Pressable } from './Pressable';
import { Avatar } from './Avatar';

export function CallOverlay() {
  const theme = useTheme();
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const incoming = useCallStore((s) => Object.values(s.incomingDMCalls)[0] ?? null);
  const active = useCallStore((s) => s.activeCall);
  const muted = useCallStore((s) => s.muted);
  const deafened = useCallStore((s) => s.deafened);
  const connecting = useCallStore((s) => s.connecting);
  const error = useCallStore((s) => s.error);
  const notice = useCallStore((s) => s.notice);
  const remoteVideoTracks = useCallStore((s) => s.remoteVideoTracks);
  const localVideoTrack = useCallStore((s) => s.localVideoTrack);
  const answer = useCallStore((s) => s.answerDMCall);
  const end = useCallStore((s) => s.endCall);
  const joinGroupCall = useCallStore((s) => s.joinGroupCall);
  const toggleMute = useCallStore((s) => s.toggleMute);
  const toggleDeafen = useCallStore((s) => s.toggleDeafen);
  const pulse = useRef(new Animated.Value(1)).current;
  const [now, setNow] = useState(Date.now());

  const isRinging = !!incoming || active?.status === 'ringing';
  useEffect(() => {
    if (!isRinging) {
      pulse.stopAnimation();
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1.08, duration: 700, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [isRinging, pulse]);

  useEffect(() => {
    if (!active?.connectedAt || active.status !== 'active') return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active?.connectedAt, active?.status]);

  if (!incoming && !active && !notice) return null;
  const selfParticipant = user ? {
    userId: user.id,
    username: user.username,
    displayName: user.displayName ?? null,
    avatar: user.avatar ?? null,
    muted,
    deafened,
    videoEnabled: !!localVideoTrack,
  } : null;
  const participants = active ? [...(selfParticipant ? [selfParticipant] : []), ...active.participants] : [];
  const disconnectedPeer = active?.callType === 'dm' ? active.participants.find((p) => p.connected === false) : null;
  const elapsed = active?.status === 'active' && active.connectedAt ? formatElapsed(Math.max(0, now - active.connectedAt)) : null;

  return (
    <Modal transparent animationType="fade" visible
      supportedOrientations={['portrait', 'portrait-upside-down', 'landscape', 'landscape-left', 'landscape-right']}>
      <View style={styles.scrim}>
        <View style={[styles.card, { backgroundColor: theme.colors.bgElev1, borderColor: theme.colors.lineSoft }]}>
          {notice && !incoming && !active ? (
            <>
              <Text variant="subtitle">{notice.title}</Text>
              <Text color={theme.colors.text2}>{notice.detail}</Text>
            </>
          ) : incoming && !active ? (
            <>
              <Animated.View style={{ transform: [{ scale: pulse }] }}>
                <Avatar username={incoming.callerName} uri={incoming.callerAvatar} accountType="central" size={72} showStatus={false} />
              </Animated.View>
              <Text variant="subtitle">{incoming.callerName}</Text>
              <Text color={theme.colors.text2}>{incoming.mediaType === 'video' ? t('call.incomingVideo') : t('call.incomingVoice')}</Text>
              {error ? <Text variant="caption" style={{ color: theme.colors.danger }}>{error}</Text> : null}
              <View style={styles.row}>
                <Action color="#ef4444" onPress={() => void answer(incoming.callId, false)}><PhoneOff size={22} color="#fff" /></Action>
                <Action color="#22c55e" onPress={() => void answer(incoming.callId, true)}><Phone size={22} color="#fff" /></Action>
              </View>
            </>
          ) : active ? (
            <>
              <Text variant="subtitle">{active.title}</Text>
              <Text color={theme.colors.text2}>
                {connecting ? t('call.connecting') : active.status === 'ringing' ? t('call.ringing') : disconnectedPeer ? t('call.reconnecting') : `${t('call.inCall', { count: participants.length })}${elapsed ? ` • ${elapsed}` : ''}`}
              </Text>
              {error ? <Text variant="caption" style={{ color: theme.colors.danger }}>{error}</Text> : null}
              {remoteVideoTracks.length > 0 ? (
                <View style={styles.videoGrid}>
                  {remoteVideoTracks.map(({ id, track }) => <VideoView key={id} videoTrack={track} style={styles.video} objectFit="cover" />)}
                </View>
              ) : null}
              {localVideoTrack ? <VideoView videoTrack={localVideoTrack} style={styles.localVideo} objectFit="cover" mirror /> : null}
              <View style={styles.tileGrid}>
                {participants.map((participant) => (
                  <ParticipantTile
                    key={participant.userId}
                    participant={participant}
                    self={participant.userId === user?.id}
                    pulse={active.status === 'ringing' && participant.userId !== user?.id ? pulse : undefined}
                  />
                ))}
              </View>
              <View style={styles.row}>
                {active.callType === 'group' && active.status === 'ringing' && active.groupChatId ? (
                  <Action color="#22c55e" onPress={() => joinGroupCall(active.callId, active.groupChatId!, active.mediaType)}><Phone size={22} color="#fff" /></Action>
                ) : null}
                <Action color={theme.colors.bgElev2} onPress={() => void toggleMute()}>{muted ? <MicOff size={21} color={theme.colors.text} /> : <Mic size={21} color={theme.colors.text} />}</Action>
                <Action color={theme.colors.bgElev2} onPress={toggleDeafen}>{deafened ? <VolumeX size={21} color={theme.colors.text} /> : <Volume2 size={21} color={theme.colors.text} />}</Action>
                <Action color="#ef4444" onPress={end}><PhoneOff size={22} color="#fff" /></Action>
              </View>
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function formatElapsed(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function ParticipantTile({
  participant,
  self,
  pulse,
}: {
  participant: { username: string; displayName: string | null; avatar: string | null; muted?: boolean; deafened?: boolean; videoEnabled?: boolean; connected?: boolean };
  self: boolean;
  pulse?: Animated.Value;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const content = (
    <View style={[styles.tile, { backgroundColor: theme.colors.bgElev2, borderColor: theme.colors.lineSoft }]}>
      <Avatar username={participant.username} uri={participant.avatar} accountType="central" size={42} showStatus={false} />
      <Text numberOfLines={1} style={styles.tileName}>{self ? t('call.you') : participant.displayName || participant.username}</Text>
      {!self && participant.connected === false ? <Text variant="caption" color={theme.colors.text3}>{t('call.reconnectingPeer')}</Text> : null}
      <View style={styles.badges}>
        {participant.muted ? <MicOff size={13} color={theme.colors.text2} /> : <Mic size={13} color={theme.colors.text2} />}
        {participant.deafened ? <VolumeX size={13} color={theme.colors.text2} /> : null}
        {participant.videoEnabled ? <Video size={13} color={theme.colors.text2} /> : <VideoOff size={13} color={theme.colors.text2} />}
      </View>
    </View>
  );
  return pulse ? <Animated.View style={{ transform: [{ scale: pulse }] }}>{content}</Animated.View> : content;
}

function Action({ children, color, onPress }: { children: React.ReactNode; color: string; onPress: () => void }) {
  return <Pressable haptic onPress={onPress} style={[styles.action, { backgroundColor: color }]}>{children}</Pressable>;
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', backgroundColor: 'rgba(0,0,0,.45)', padding: 20 },
  card: { width: '100%', maxWidth: 420, borderWidth: 1, borderRadius: 24, padding: 20, gap: 10, alignItems: 'center' },
  row: { flexDirection: 'row', gap: 14, marginTop: 8 },
  videoGrid: { width: '100%', gap: 8 },
  video: { width: '100%', height: 180, borderRadius: 16 },
  localVideo: { width: 96, height: 128, borderRadius: 14, alignSelf: 'flex-end' },
  tileGrid: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { width: 112, minHeight: 92, borderWidth: 1, borderRadius: 16, padding: 10, gap: 5, alignItems: 'center' },
  tileName: { maxWidth: 92, fontSize: 12 },
  badges: { flexDirection: 'row', gap: 6, minHeight: 14 },
  action: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
});
