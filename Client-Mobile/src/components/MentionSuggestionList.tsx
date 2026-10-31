import { ScrollView, StyleSheet, View } from 'react-native';
import { AtSign } from 'lucide-react-native';
import { useTheme } from '@/theme';
import type { MentionSuggestion } from '@/lib/mentionSuggestions';
import { Avatar } from './Avatar';
import { Pressable } from './Pressable';
import { Text } from './Text';

const SECTION_LABELS: Record<MentionSuggestion['type'], string> = {
  alias: 'Everyone',
  role: 'Roles',
  user: 'Members',
};

/** Tappable @mention suggestions shown above the composer while typing `@…`. */
export function MentionSuggestionList({ items, serverUrl, onSelect }: {
  items: MentionSuggestion[];
  serverUrl?: string | null;
  onSelect: (item: MentionSuggestion) => void;
}) {
  const theme = useTheme();
  if (items.length === 0) return null;

  return (
    <View
      testID="mention-suggestions"
      style={[styles.panel, { backgroundColor: theme.colors.bgElev1, borderColor: theme.colors.lineSoft }]}
    >
      {/* "always" keeps the keyboard up so the first tap selects instead of dismissing it. */}
      <ScrollView keyboardShouldPersistTaps="always" style={styles.scroll}>
        {items.map((item, index) => {
          const showSection = index === 0 || items[index - 1].type !== item.type;
          return (
            <View key={item.key}>
              {showSection ? (
                <Text variant="caption" color={theme.colors.text3} style={styles.section}>
                  {SECTION_LABELS[item.type]}
                </Text>
              ) : null}
              <Pressable haptic onPress={() => onSelect(item)} style={styles.row} accessibilityLabel={item.label}>
                {item.type === 'user' ? (
                  <Avatar username={item.label.slice(1)} uri={item.avatar ?? null} baseUrl={serverUrl ?? undefined} size={26} showStatus={false} />
                ) : (
                  <View style={[styles.badge, { backgroundColor: theme.colors.bgElev2 }]}>
                    {item.type === 'role'
                      ? <Text variant="caption" color={item.color || theme.colors.accentText} style={styles.roleGlyph}>R</Text>
                      : <AtSign size={14} color={theme.colors.accentText} />}
                  </View>
                )}
                <Text
                  variant="body"
                  numberOfLines={1}
                  color={item.type === 'role' && item.color ? item.color : theme.colors.text}
                  style={styles.label}
                >
                  {item.label}
                </Text>
                {item.description ? (
                  <Text variant="caption" color={theme.colors.text3} numberOfLines={1}>{item.description}</Text>
                ) : null}
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    marginHorizontal: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  scroll: {
    maxHeight: 240,
  },
  section: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 2,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontSize: 10,
  },
  row: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
  },
  badge: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleGlyph: {
    fontWeight: '800',
  },
  label: {
    flex: 1,
  },
});
