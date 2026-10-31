import { useState, useEffect } from 'react';
import { View, TextInput, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { AuthCard, AuthScreenHeader, AuthScreenShell, Text, Pressable } from '@/components';
import { useAuthStore } from '@/stores/authStore';

export default function LocalRegisterScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const usernameValid = /^[a-zA-Z0-9_]{4,32}$/.test(username);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [matchError, setMatchError] = useState('');

  const localRegister = useAuthStore((s) => s.localRegister);
  const serverInfo = useAuthStore((s) => s.serverInfo);
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const loading = useAuthStore((s) => s.loading);
  const error = useAuthStore((s) => s.error);
  const clearError = useAuthStore((s) => s.clearError);

  useEffect(() => {
    if (token && user) router.replace('/(app)/(tabs)/home');
  }, [token, user, router]);

  const handleRegister = () => {
    if (!usernameValid || !password) return;
    if (password !== confirmPassword) {
      setMatchError(t('auth.passwordsDoNotMatch'));
      return;
    }
    setMatchError('');
    clearError();
    void localRegister(username, password);
  };

  const hasError = error || matchError;

  return (
    <AuthScreenShell>
      <AuthScreenHeader
        title={serverInfo?.name || 'CatRealm'}
        subtitle={t('auth.createLocalAccount')}
        backLabel={t('auth.back')}
        onBack={() => router.replace('/(auth)/local-login')}
      />

      <AuthCard>
          <View>
            <TextInput
              value={username}
              onChangeText={setUsername}
              placeholder={t('auth.usernamePlaceholder')}
              placeholderTextColor={theme.colors.text3}
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="username"
              autoComplete="username-new"
              maxLength={32}
              returnKeyType="next"
              style={[
                styles.input,
                {
                  backgroundColor: theme.colors.bgElev2,
                  color: theme.colors.text,
                  borderRadius: theme.radius.md,
                  borderColor: hasError ? theme.colors.danger : theme.colors.line,
                  marginBottom: theme.spacing.sm,
                },
              ]}
            />

            <Text variant="caption" color={theme.colors.text3} style={{ marginBottom: theme.spacing.sm }}>
              {t('auth.usernameRules')}
            </Text>

            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder={t('auth.passwordPlaceholder')}
              placeholderTextColor={theme.colors.text3}
              secureTextEntry
              textContentType="newPassword"
              autoComplete="new-password"
              returnKeyType="next"
              style={[
                styles.input,
                {
                  backgroundColor: theme.colors.bgElev2,
                  color: theme.colors.text,
                  borderRadius: theme.radius.md,
                  borderColor: hasError ? theme.colors.danger : theme.colors.line,
                  marginBottom: theme.spacing.sm,
                },
              ]}
            />

            <TextInput
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder={t('auth.confirmPasswordPlaceholder')}
              placeholderTextColor={theme.colors.text3}
              secureTextEntry
              textContentType="newPassword"
              autoComplete="new-password"
              returnKeyType="go"
              onSubmitEditing={handleRegister}
              style={[
                styles.input,
                {
                  backgroundColor: theme.colors.bgElev2,
                  color: theme.colors.text,
                  borderRadius: theme.radius.md,
                  borderColor: hasError ? theme.colors.danger : theme.colors.line,
                },
              ]}
            />

            {hasError ? (
              <Text variant="bodySmall" color={theme.colors.danger} style={{ marginTop: theme.spacing.sm }}>
                {matchError || error}
              </Text>
            ) : null}
          </View>

          <Pressable
            haptic
            onPress={handleRegister}
            disabled={loading || !usernameValid || !password || !confirmPassword}
            style={[
              styles.btn,
              {
                backgroundColor:
                  loading || !usernameValid || !password || !confirmPassword
                    ? theme.colors.bgElev3
                    : theme.colors.accent,
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
                  loading || !usernameValid || !password || !confirmPassword
                    ? theme.colors.text3
                    : theme.colors.textOnAccent
                }
              >
                {t('auth.createAccount')}
              </Text>
            )}
          </Pressable>

          <Pressable minHit={32} onPress={() => router.push('/(auth)/local-login')}>
            <Text variant="caption" color={theme.colors.text3}>
              {t('auth.alreadyHaveAccount')}
            </Text>
          </Pressable>
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
