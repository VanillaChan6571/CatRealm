import { useState, useEffect } from 'react';
import { View, TextInput, StyleSheet, ActivityIndicator, useWindowDimensions } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { AuthCard, AuthScreenHeader, AuthScreenShell, Text, Pressable } from '@/components';
import { useAuthStore } from '@/stores/authStore';
import { PasteCodeButton } from '@/components/PasteCodeButton';

export default function Verify2FAScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const { username } = useLocalSearchParams<{ username?: string }>();
  const [totpCode, setTotpCode] = useState('');

  const centralLogin = useAuthStore((s) => s.centralLogin);
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const loading = useAuthStore((s) => s.loading);
  const error = useAuthStore((s) => s.error);
  const clearError = useAuthStore((s) => s.clearError);
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;

  useEffect(() => {
    if (token && user) router.replace('/(app)/(tabs)/home');
  }, [token, user, router]);

  const handleVerify = () => {
    if (loading || !username || !totpCode.trim()) return;
    clearError();
    void centralLogin(username, totpCode.trim());
  };

  return (
    <AuthScreenShell>
      <AuthScreenHeader
        title={t('auth.verifyIdentity')}
        subtitle={t('auth.verifyIdentityDesc')}
        backLabel={t('auth.back')}
        onBack={() => router.back()}
      />

      <AuthCard>
          <View>
            <TextInput
              value={totpCode}
              onChangeText={setTotpCode}
              placeholder={t('auth.sixDigitCodePlaceholder')}
              placeholderTextColor={theme.colors.text3}
              keyboardType={isTablet ? 'default' : 'number-pad'}
              maxLength={6}
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              returnKeyType="go"
              onSubmitEditing={handleVerify}
              autoFocus
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
              <Text variant="bodySmall" color={theme.colors.danger} style={{ marginTop: theme.spacing.sm }}>
                {error}
              </Text>
            ) : null}
          </View>

          <Pressable
            haptic
            onPress={handleVerify}
            disabled={loading || totpCode.length < 6}
            style={[
              styles.btn,
              {
                backgroundColor:
                  loading || totpCode.length < 6 ? theme.colors.bgElev3 : theme.colors.accent,
                borderRadius: theme.radius.lg,
              },
            ]}
          >
            {loading ? (
              <ActivityIndicator color={theme.colors.textOnAccent} />
            ) : (
              <Text
                variant="subtitle"
                color={loading || totpCode.length < 6 ? theme.colors.text3 : theme.colors.textOnAccent}
              >
                {t('auth.verify')}
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
    textAlign: 'center',
    letterSpacing: 4,
  },
  btn: {
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
