import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { useSettingsStore, type AppLanguage } from '@/stores/settingsStore';
import { Pressable } from './Pressable';
import { Text } from './Text';

const OPTIONS: ReadonlyArray<{ id: AppLanguage; label: string }> = [
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Español' },
  { id: 'ru', label: 'Русский' },
  { id: 'ja', label: '日本語' },
];

export function LanguageSelector({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const language = useSettingsStore((state) => state.language);
  const setLanguage = useSettingsStore((state) => state.setLanguage);

  return (
    <View style={[styles.root, compact && styles.rootCompact]}>
      <Text variant="caption" color={theme.colors.text3}>{t('settings.navLanguage')}</Text>
      <View style={styles.options}>
        {OPTIONS.map((option) => {
          const selected = language === option.id;
          return (
            <Pressable
              key={option.id}
              minHit={32}
              onPress={() => setLanguage(option.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              style={[
                styles.option,
                {
                  backgroundColor: selected ? theme.colors.accent : theme.colors.bgElev3,
                  borderColor: selected ? theme.colors.accent : theme.colors.line,
                  borderRadius: theme.radius.md,
                },
              ]}
            >
              <Text variant="caption" color={selected ? theme.colors.textOnAccent : theme.colors.text2}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', gap: 8, marginBottom: 20 },
  rootCompact: { alignItems: 'flex-start', marginBottom: 0, marginTop: 12 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  option: { borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
});
