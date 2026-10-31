/**
 * VoiceBar — persistent voice-session strip rendered above BottomDock.
 * Appears whenever the user is connected to a voice channel; lets them
 * mute/deafen/disconnect without leaving their current screen.
 */

import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Mic, MicOff, Volume2, VolumeX, PhoneOff } from 'lucide-react-native';
import { useTheme } from '@/theme';
import { Pressable } from './Pressable';
import { Text } from './Text';
import { useVoiceStore } from '@/stores/voiceStore';
import { useServerStore } from '@/stores/serverStore';
import { useDeviceLayout } from '@/hooks/useDeviceLayout';

export function VoiceBar() {
  const theme = useTheme();
  const router = useRouter();
  const { isTablet } = useDeviceLayout();

  const channelId = useVoiceStore((s) => s.channelId);
  const serverId = useVoiceStore((s) => s.serverId);
  const channelName = useVoiceStore((s) => s.channelName);
  const selfMicEnabled = useVoiceStore((s) => s.selfMicEnabled);
  const selfDeafened = useVoiceStore((s) => s.selfDeafened);
  const toggleMute = useVoiceStore((s) => s.toggleMute);
  const toggleDeafen = useVoiceStore((s) => s.toggleDeafen);
  const leaveChannel = useVoiceStore((s) => s.leaveChannel);
  const activeServerId = useServerStore((s) => s.activeServerId);

  if (!channelId) return null;

  const effectiveServerId = serverId ?? activeServerId ?? '';

  const openVoiceScreen = () => {
    router.push({
      pathname: isTablet ? '/server/[serverId]/channel/[channelId]' : '/server/[serverId]/voice/[channelId]',
      params: { serverId: effectiveServerId, channelId },
    });
  };

  return (
    <View style={[styles.bar, { backgroundColor: theme.colors.bgElev1, borderTopColor: theme.colors.line }]}>
      {/* Channel info — tap to open voice screen */}
      <Pressable onPress={openVoiceScreen} style={styles.channelInfo}>
        <Volume2 size={16} color={theme.colors.accent} />
        <Text
          variant="bodySmall"
          numberOfLines={1}
          style={[styles.channelName, { color: theme.colors.text }]}
        >
          {channelName ?? channelId}
        </Text>
        <Text variant="caption" color={theme.colors.text3} style={styles.liveLabel}>
          LIVE
        </Text>
      </Pressable>

      {/* Controls */}
      <View style={styles.controls}>
        <Pressable
          haptic
          onPress={() => void toggleMute()}
          style={[
            styles.controlBtn,
            { backgroundColor: selfMicEnabled ? theme.colors.bgElev2 : theme.colors.danger },
          ]}
        >
          {selfMicEnabled
            ? <Mic size={16} color={theme.colors.text2} />
            : <MicOff size={16} color="#fff" />}
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
            ? <VolumeX size={16} color="#000" />
            : <Volume2 size={16} color={theme.colors.text2} />}
        </Pressable>

        <Pressable
          haptic
          onPress={leaveChannel}
          style={[styles.controlBtn, { backgroundColor: theme.colors.danger }]}
        >
          <PhoneOff size={16} color="#fff" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    minHeight: 52,
  },
  channelInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingRight: 8,
  },
  channelName: {
    flex: 1,
    fontWeight: '600',
  },
  liveLabel: {
    letterSpacing: 0.5,
    fontWeight: '700',
    color: '#22c55e',
  },
  controls: {
    flexDirection: 'row',
    gap: 6,
  },
  controlBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
