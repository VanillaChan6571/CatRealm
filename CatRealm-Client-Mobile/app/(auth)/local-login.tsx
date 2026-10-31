import { useState, useEffect } from 'react';
import { View, TextInput, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { AuthCard, AuthScreenHeader, AuthScreenShell, Text, Pressable } from '@/components';
import { useAuthStore } from '@/stores/authStore';

export default function LocalLoginScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const localLogin = useAuthStore((s) => s.localLogin);
  const serverInfo = useAuthStore((s) => s.serverInfo);
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const loading = useAuthStore((s) => s.loading);
  const error = useAuthStore((s) => s.error);
  const clearError = useAuthStore((s) => s.clearError);

  useEffect(() => {
    if (token && user) router.replace('/(app)/(tabs)/home');
  }, [token, user, router]);

  const handleSignIn = () => {
    if (!username.trim() || !password) return;
    clearError();
    void localLogin(username.trim(), password);
  };

  return (
    <AuthScreenShell>
      <AuthScreenHeader
        title={serverInfo?.name || 'CatRealm'}
        subtitle={t('auth.localAccount')}
        backLabel={t('auth.differentServer')}
        onBack={() => router.replace('/(auth)/connect-server')}
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
              value={password}
              onChangeText={setPassword}
              placeholder={t('auth.passwordPlaceholder')}
              placeholderTextColor={theme.colors.text3}
              secureTextEntry
              textContentType="password"
              autoComplete="current-password"
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

            {error ? (
              <Text variant="bodySmall" color={theme.colors.danger} style={{ marginTop: theme.spacing.sm }}>
                {error}
              </Text>
            ) : null}
          </View>

          <Pressable
            haptic
            onPress={handleSignIn}
            disabled={loading || !username.trim() || !password}
            style={[
              styles.btn,
              {
                backgroundColor:
                  loading || !username.trim() || !password
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
                  loading || !username.trim() || !password
                    ? theme.colors.text3
                    : theme.colors.textOnAccent
                }
              >
                {t('auth.signIn')}
              </Text>
            )}
          </Pressable>

          {serverInfo?.registrationOpen ? (
            <Pressable minHit={32} onPress={() => router.push('/(auth)/local-register')}>
              <Text variant="caption" color={theme.colors.text3}>
                {t('auth.createLocalLink')}
              </Text>
            </Pressable>
          ) : null}

          {serverInfo?.mode === 'mixed' ? (
            <Pressable minHit={32} onPress={() => router.push('/(auth)/central-login')}>
              <Text variant="caption" color={theme.colors.text3}>
                {t('auth.signInCentral')}
              </Text>
            </Pressable>
          ) : null}
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
