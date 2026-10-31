import { Alert, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Headphones, HeadphoneOff, Mic, MicOff, Phone, PhoneOff } from 'lucide-react-native';
import { Text } from '../Text';
import { useTheme } from '@/theme';
import { useTheaterStore } from '@/stores/theaterStore';

/** This badge describes this device's voice connection, not theater presence. */
export function TheaterVoiceControls({ overlay = false }: { overlay?: boolean }) {
  const theme = useTheme();
  const channelId = useTheaterStore((s) => s.channelId);
  const serverId = useTheaterStore((s) => s.serverId);
  const status = useTheaterStore((s) => s.voiceStatus);
  const micEnabled = useTheaterStore((s) => s.selfMicEnabled);
  const deafened = useTheaterStore((s) => s.selfDeafened);
  const busy = useTheaterStore((s) => s.mediaAudioUpdating);
  const joinVoice = useTheaterStore((s) => s.joinVoice);
  const leaveVoice = useTheaterStore((s) => s.leaveVoice);
  const toggleMic = useTheaterStore((s) => s.toggleMic);
  const toggleDeafen = useTheaterStore((s) => s.toggleDeafen);
  const connected = status === 'connected';
  const color = overlay ? '#fff' : theme.colors.text;
  const mutedColor = overlay ? '#ffb4b4' : theme.colors.danger;
  const label = connected ? 'In Call' : status === 'connecting' ? 'Connecting…'
    : status === 'disconnecting' ? 'Leaving Call…' : 'Not In Call';

  const confirmJoin = () => Alert.alert('Join theater voice?',
    'Joining voice may make the video quieter while your device prioritizes call audio, especially on iOS. Headphones and Bluetooth may behave differently; they do not guarantee full video volume.\n\nYou will join with your microphone muted. You can leave voice anytime and keep watching.',
    [{ text: 'Keep Watching', style: 'cancel' }, { text: 'Join Voice', onPress: () => {
      const current = useTheaterStore.getState();
      if (current.channelId === channelId && current.serverId === serverId) void joinVoice();
    } }]);

  return <View style={[styles.row, overlay && styles.overlay]}>
    <View accessibilityLabel={`Theater voice: ${label}`} style={[styles.badge, { borderColor: overlay ? 'rgba(255,255,255,0.4)' : theme.colors.line }]}>
      {connected ? <Phone size={14} color={color} /> : <PhoneOff size={14} color={color} />}
      <Text variant="caption" style={{ color }}>{label}</Text>
    </View>
    <View style={styles.actions}>
      {connected && <>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={micEnabled && !deafened ? 'Mute microphone' : 'Unmute microphone'}
          disabled={busy || deafened} style={styles.button} onPress={(event) => { event.stopPropagation(); void toggleMic(); }}>
          {micEnabled && !deafened ? <Mic size={18} color={color} /> : <MicOff size={18} color={mutedColor} />}
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={deafened ? 'Undeafen theater' : 'Deafen theater'}
          disabled={busy} style={styles.button} onPress={(event) => { event.stopPropagation(); void toggleDeafen(); }}>
          {deafened ? <HeadphoneOff size={18} color={mutedColor} /> : <Headphones size={18} color={color} />}
        </TouchableOpacity>
      </>}
      <TouchableOpacity accessibilityRole="button" disabled={!channelId || status === 'disconnecting'}
        accessibilityLabel={connected ? 'Leave theater voice' : status === 'connecting' ? 'Cancel joining theater voice' : 'Join theater voice'}
        style={styles.button} onPress={(event) => {
          event.stopPropagation();
          if (connected || status === 'connecting') void leaveVoice(); else confirmJoin();
        }}>
        <Text variant="caption" style={{ color }}>{connected ? 'Leave Voice' : status === 'connecting' ? 'Cancel' : status === 'disconnecting' ? 'Leaving…' : 'Join Voice'}</Text>
      </TouchableOpacity>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 4, paddingHorizontal: 8 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, paddingHorizontal: 8, borderWidth: 1, borderRadius: 8 },
  actions: { flexDirection: 'row', alignItems: 'center' },
  button: { minHeight: 44, minWidth: 44, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  overlay: { backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 12 },
});
