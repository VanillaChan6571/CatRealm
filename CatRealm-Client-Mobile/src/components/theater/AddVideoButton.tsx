import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react-native';
import { useTheme } from '@/theme';
import { Text, Pressable } from '@/components';
import { PulsingBorder } from '../PulsingBorder';

const RADIUS = 20;

/** Labelled "Add Video" pill; its outline breathes while the queue is empty. */
export function AddVideoButton({ onPress, invite }: { onPress: () => void; invite: boolean }) {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <Pressable accessibilityLabel={t('theater.addVideo')} haptic onPress={onPress}
      style={[styles.button, { backgroundColor: theme.colors.accent + '24', borderColor: theme.colors.accent + '38' }]}>
      {invite && <PulsingBorder color={theme.colors.accent} radius={RADIUS} />}
      <View style={styles.content}>
        <Plus size={18} color={theme.colors.accent} />
        <Text variant="bodySmall" style={{ color: theme.colors.accent, fontWeight: '700' }}>{t('theater.addVideoShort')}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { minWidth: 44, minHeight: 44, paddingHorizontal: 16, borderRadius: RADIUS, borderWidth: 1, justifyContent: 'center' },
  content: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
