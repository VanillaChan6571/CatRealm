import { useState, useEffect } from 'react';
import { View, TextInput, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import {
  AuthCard,
  AuthScreenHeader,
  AuthScreenShell,
  AuthTabRow,
  Text,
  Pressable,
} from '@/components';
import { useAuthStore } from '@/stores/authStore';
import { PasteCodeButton } from '@/components/PasteCodeButton';

export default function CentralLoginScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [totpCode, setTotpCode] = useState('');

  const centralLogin = useAuthStore((s) => s.centralLogin);
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const loading = useAuthStore((s) => s.loading);
  const error = useAuthStore((s) => s.error);
  const clearError = useAuthStore((s) => s.clearError);

  useEffect(() => {
    if (token && user) router.replace('/(app)/(tabs)/home');
  }, [token, user, router]);

  const handleSignIn = () => {
    if (loading || !username.trim()) return;
    clearError();
    void centralLogin(username.trim(), totpCode.trim());
  };

  return (
    <AuthScreenShell>
      <AuthScreenHeader
        title="CatRealm"
        subtitle={t('auth.centralAccount')}
        backLabel={t('auth.back')}
        onBack={() => router.replace('/(auth)/welcome')}
      />

      <AuthCard>
          <AuthTabRow
            active="login"
            onLogin={() => undefined}
            onRegister={() => router.replace('/(auth)/central-register')}
          />

          <View>
            <TextInput
              value={username}
              onChangeText={setUsername}
              placeholder={t('auth.usernamePlaceholder')}
              placeholderTextColor={theme.colors.text3}
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="username"
              autoComplete="username"
              returnKeyType="next"
              style={[
                styles.input,
                {
                  backgroundColor: theme.colors.bgElev2,
                  color: theme.colors.text,
                  borderRadius: theme.radius.md,
                  borderColor: error ? theme.colors.danger : theme.colors.line,
                  marginBottom: theme.spacing.sm,
                },
              ]}
            />

            <TextInput
              value={totpCode}
              onChangeText={setTotpCode}
              placeholder={t('auth.twoFACodePlaceholder')}
              placeholderTextColor={theme.colors.text3}
              keyboardType="number-pad"
              maxLength={6}
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              returnKeyType="go"
              onSubmitEditing={handleSignIn}
              style={[
                styles.input,
                {
                  backgroundColor: theme.colors.bgElev2,
                  color: theme.colors.text,
                  borderRadius: theme.radius.md,
                  borderColor: error ? theme.colors.danger : theme.colors.line,
                },
              ]}
            />

            <PasteCodeButton
              disabled={loading || !username?.trim()}
              onCode={async (code) => {
                if (!username?.trim() || loading) return;
                setTotpCode(code);
                clearError();
                await centralLogin(username.trim(), code);
              }}
            />

            {error ? (
              <Text
                variant="bodySmall"
                color={theme.colors.danger}
                style={{ marginTop: theme.spacing.sm }}
              >
                {error}
              </Text>
            ) : null}
          </View>

          <Pressable
            haptic
            onPress={handleSignIn}
            disabled={loading || !username.trim()}
            style={[
              styles.btn,
              {
                backgroundColor:
                  loading || !username.trim() ? theme.colors.bgElev3 : theme.colors.accent,
                borderRadius: theme.radius.lg,
              },
            ]}
          >
            {loading ? (
              <ActivityIndicator color={theme.colors.textOnAccent} />
            ) : (
              <Text
                variant="subtitle"
                color={
                  loading || !username.trim() ? theme.colors.text3 : theme.colors.textOnAccent
                }
              >
                {t('auth.signIn')}
              </Text>
            )}
          </Pressable>

          <Text variant="caption" color={theme.colors.text3} style={{ textAlign: 'center' }}>
            {t('auth.centralAccountsDesc')}
          </Text>
      </AuthCard>
    </AuthScreenShell>
  );
}

const styles = StyleSheet.create({
  input: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    borderWidth: 1,
  },
  btn: {
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
