import { StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { AuthScreenHeader, AuthScreenShell, Text, Pressable } from '@/components';
import { LanguageSelector } from '@/components/LanguageSelector';

export default function Welcome() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <AuthScreenShell>
      <AuthScreenHeader title="CatRealm" subtitle={t('auth.welcomeSubtitle')} large />
      <LanguageSelector />

      <Pressable
        haptic
        onPress={() => router.push('/(auth)/central-login')}
        style={[
          styles.choicePrimary,
          { backgroundColor: theme.colors.accent, borderRadius: theme.radius.lg },
        ]}
      >
        <Text variant="subtitle" color={theme.colors.textOnAccent} style={styles.choiceText}>
          {t('auth.loginRegister')}
        </Text>
        <Text variant="caption" color={theme.colors.textOnAccent} style={styles.choiceMeta}>
          {t('auth.loginRegisterDesc')}
        </Text>
      </Pressable>

      <Pressable
        haptic
        onPress={() => router.push('/(auth)/connect-server')}
        style={[
          styles.choiceSecondary,
          {
            backgroundColor: theme.colors.bgSidebar,
            borderColor: theme.colors.line,
            borderRadius: theme.radius.lg,
          },
        ]}
      >
        <Text variant="subtitle" color={theme.colors.text} style={styles.choiceText}>
          {t('auth.connectServer')}
        </Text>
        <Text variant="caption" color={theme.colors.text3} style={styles.choiceMeta}>
          {t('auth.connectServerDesc')}
        </Text>
      </Pressable>
    </AuthScreenShell>
  );
}

const styles = StyleSheet.create({
  choicePrimary: {
    alignItems: 'flex-start',
    padding: 16,
  },
  choiceSecondary: {
    alignItems: 'flex-start',
    borderWidth: 1,
    marginTop: 12,
    padding: 16,
  },
  choiceText: {
    textAlign: 'left',
  },
  choiceMeta: {
    marginTop: 2,
    opacity: 0.82,
    textAlign: 'left',
  },
});
