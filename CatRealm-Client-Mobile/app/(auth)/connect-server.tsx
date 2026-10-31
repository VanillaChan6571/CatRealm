import { useState, useEffect } from 'react';
import { View, TextInput, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { AuthCard, AuthScreenHeader, AuthScreenShell, Text, Pressable } from '@/components';
import { useAuthStore } from '@/stores/authStore';

export default function ConnectServerScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const [urlDraft, setUrlDraft] = useState('');

  const fetchServerInfo = useAuthStore((s) => s.fetchServerInfo);
  const serverInfo = useAuthStore((s) => s.serverInfo);
  const loading = useAuthStore((s) => s.loading);
  const error = useAuthStore((s) => s.error);
  const clearError = useAuthStore((s) => s.clearError);

  useEffect(() => {
    if (!serverInfo || loading || error) return;
    switch (serverInfo.mode) {
      case 'central_only':
        router.push('/(auth)/central-login');
        break;
      case 'decentral_only':
      case 'mixed':
        router.push('/(auth)/local-login');
        break;
    }
  }, [serverInfo, loading, error, router]);

  const handleConnect = () => {
    if (!urlDraft.trim()) return;
    clearError();
    void fetchServerInfo(urlDraft.trim());
  };

  return (
    <AuthScreenShell>
      <AuthScreenHeader
        title="CatRealm"
        subtitle={t('auth.connectToServer')}
        backLabel={t('auth.back')}
        onBack={() => router.replace('/(auth)/welcome')}
      />

      <AuthCard>
          <View>
            <TextInput
              value={urlDraft}
              onChangeText={setUrlDraft}
              placeholder="http://localhost:3000"
              placeholderTextColor={theme.colors.text3}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              onSubmitEditing={handleConnect}
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
            onPress={handleConnect}
            disabled={loading || !urlDraft.trim()}
            style={[
              styles.btn,
              {
                backgroundColor:
                  loading || !urlDraft.trim() ? theme.colors.bgElev3 : theme.colors.accent,
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
                  loading || !urlDraft.trim() ? theme.colors.text3 : theme.colors.textOnAccent
                }
              >
                {t('auth.connect')}
              </Text>
            )}
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
