import { StyleSheet, View } from 'react-native';
import { useTheme } from '@/theme';
import { useVoiceStore } from '@/stores/voiceStore';
import { useTheaterStore } from '@/stores/theaterStore';
import { PulsingBorder } from './PulsingBorder';

/** The voice and theater channels this account is connected to in `serverId`. */
export function useConnectedChannelIds(serverId: string | null | undefined) {
  const voiceServerId = useVoiceStore((s) => s.serverId);
  const voiceChannelId = useVoiceStore((s) => s.channelId);
  const theaterServerId = useTheaterStore((s) => s.serverId);
  const theaterChannelId = useTheaterStore((s) => s.channelId);
  return {
    voiceChannelId: serverId && voiceServerId === serverId ? voiceChannelId : null,
    theaterChannelId: serverId && theaterServerId === serverId ? theaterChannelId : null,
  };
}

/**
 * Green highlight on a channel row marking the call or theater the user is
 * still in while looking elsewhere: a faint fill with a breathing outline.
 * Place inside the row; it fills it.
 */
export function ConnectedChannelPulse({ radius }: { radius: number }) {
  const theme = useTheme();
  const green = theme.colors.statusColor.online;
  return (
    <View testID="connected-channel-pulse" pointerEvents="none"
      style={[StyleSheet.absoluteFill, { borderRadius: radius, backgroundColor: green + '1A' }]}>
      <PulsingBorder color={green} radius={radius} />
    </View>
  );
}
