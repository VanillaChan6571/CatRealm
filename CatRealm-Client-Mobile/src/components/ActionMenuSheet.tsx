import type { ComponentType } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';
import { Pressable } from './Pressable';
import { Sheet } from './Sheet';
import { Text } from './Text';

export interface ActionMenuItem {
  key: string;
  label: string;
  icon: ComponentType<{ size?: number; color?: string }>;
  onPress: () => void;
}

/**
 * Bottom-sheet list of icon + label actions, for menus that replace a row of
 * header icons or a system alert. The sheet closes before the action runs so
 * a picker or another sheet can open cleanly behind it.
 */
export function ActionMenuSheet({
  open,
  onClose,
  title,
  items,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  items: ActionMenuItem[];
}) {
  const theme = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Sheet opens to a fixed fraction of the window, so size it to the rows:
  // handle + optional title + rows + Sheet's own bottom padding.
  const contentHeight =
    HANDLE_HEIGHT +
    (title ? TITLE_HEIGHT : 0) +
    items.length * (ROW_HEIGHT + ROW_GAP) +
    BODY_BOTTOM_PADDING +
    Math.max(24, insets.bottom + 8);
  const heightFraction = Math.min(0.85, contentHeight / windowHeight);
  return (
    <Sheet open={open} onClose={onClose} maxHeightFraction={heightFraction}>
      <View style={styles.body}>
        {title ? (
          <Text variant="caption" color={theme.colors.text3} style={styles.title}>
            {title}
          </Text>
        ) : null}
        {items.map(({ key, label, icon: Icon, onPress }) => (
          <Pressable
            key={key}
            haptic
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={() => {
              onClose();
              onPress();
            }}
            style={[
              styles.row,
              { backgroundColor: theme.colors.bgElev2, borderRadius: theme.radius.md },
            ]}
          >
            <Icon size={20} color={theme.colors.accentText} />
            <Text variant="body">{label}</Text>
          </Pressable>
        ))}
      </View>
    </Sheet>
  );
}

const HANDLE_HEIGHT = 20;
const TITLE_HEIGHT = 26;
const ROW_HEIGHT = 52;
const ROW_GAP = 8;
const BODY_BOTTOM_PADDING = 12;

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: 16,
    paddingBottom: BODY_BOTTOM_PADDING,
    gap: ROW_GAP,
  },
  title: {
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginBottom: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 14,
    height: ROW_HEIGHT,
    paddingHorizontal: 16,
  },
});
