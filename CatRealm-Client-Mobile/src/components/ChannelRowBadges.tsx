import { StyleSheet, View } from 'react-native';
import { TriangleAlert } from 'lucide-react-native';
import { useTheme } from '@/theme';
import { useChannelStore } from '@/stores/channelStore';
import { Text } from './Text';

/** NSFW warning shown after a channel name. Shared by the phone sheet and tablet sidebar. */
export function ChannelNsfwTag({ nsfw }: { nsfw?: boolean | number | null }) {
  const theme = useTheme();
  if (!nsfw) return null;
  return (
    <View style={styles.nsfwTag} accessibilityLabel="18+ channel">
      <TriangleAlert size={14} color={theme.colors.warning} />
      <Text style={[styles.nsfwText, { color: theme.colors.danger }]}>18+</Text>
    </View>
  );
}

/** Mention count (red) or unread count, read straight from the channel store. */
export function ChannelUnreadBadge({ channelId }: { channelId: string }) {
  const theme = useTheme();
  const unread = useChannelStore((s) => s.unreadByChannel[channelId] ?? 0);
  const mentions = useChannelStore((s) => s.mentionByChannel[channelId] ?? 0);
  const count = mentions > 0 ? mentions : unread;
  if (count <= 0) return null;
  return (
    <View style={[styles.badge, { backgroundColor: mentions > 0 ? theme.colors.danger : theme.colors.text }]}>
      <Text style={[styles.badgeText, { color: mentions > 0 ? '#fff' : theme.colors.bgApp }]}>
        {count > 99 ? '99+' : count}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  nsfwTag: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  nsfwText: { fontSize: 11, fontWeight: '700' },
  badge: {
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeText: { fontSize: 11, fontWeight: '700', lineHeight: 14 },
});
