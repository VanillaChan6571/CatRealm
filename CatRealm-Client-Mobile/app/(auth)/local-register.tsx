import { useState, useEffect } from 'react';
import { View, TextInput, StyleSheet, ActivityIndicator, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { AuthCard, AuthScreenHeader, AuthScreenShell, Text, Pressable } from '@/components';
import { useAuthStore } from '@/stores/authStore';
import type { User } from '@/types';

export default function LocalRegisterScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const usernameValid = /^[a-zA-Z0-9_]{4,32}$/.test(username);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [method, setMethod] = useState<'password' | 'totp'>('password');
  const [pending, setPending] = useState<{ enrollmentId: string; qrCode: string; manualCode: string } | null>(null);
  const [confirmed, setConfirmed] = useState<{ token: string; user: User; recoveryCodes: string[] } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [savedCodes, setSavedCodes] = useState(false);
  const [matchError, setMatchError] = useState('');

  const localRegister = useAuthStore((s) => s.localRegister);
  const localTotpStart = useAuthStore((s) => s.localTotpStart);
  const localTotpConfirm = useAuthStore((s) => s.localTotpConfirm);
  const completeLocalTotpRegistration = useAuthStore((s) => s.completeLocalTotpRegistration);
  const serverInfo = useAuthStore((s) => s.serverInfo);
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const loading = useAuthStore((s) => s.loading);
  const error = useAuthStore((s) => s.error);
  const clearError = useAuthStore((s) => s.clearError);
  const totpAvailable = !!serverInfo?.localTotpAuth && !!serverUrl?.startsWith('https://');
  const effectiveMethod = totpAvailable ? method : 'password';

  useEffect(() => {
    if (token && user) router.replace('/(app)/(tabs)/home');
  }, [token, user, router]);

  const handleRegister = async () => {
    if (!usernameValid) return;
    if (pending) {
      if (!/^[0-9]{6}$/.test(totpCode)) return;
      const result = await localTotpConfirm(pending.enrollmentId, totpCode);
      if (result) setConfirmed(result);
      return;
    }
    if (effectiveMethod === 'totp') {
      const result = await localTotpStart(username);
      if (result) setPending(result);
      return;
    }
    if (Array.from(password).length < 15) {
      setMatchError('Password must be at least 15 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setMatchError(t('auth.passwordsDoNotMatch'));
      return;
    }
    setMatchError('');
    clearError();
    await localRegister(username, password);
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
          {confirmed ? <View style={{ gap: theme.spacing.md }}>
            <Text variant="bodySmall" color={theme.colors.text3}>Save these one-time recovery codes now. They will not be shown again.</Text>
            <Text variant="mono" selectable style={[styles.input, { borderColor: theme.colors.line, borderRadius: theme.radius.md }]}>
              {confirmed.recoveryCodes.join('\n')}
            </Text>
            <Pressable onPress={() => setSavedCodes(!savedCodes)}>
              <Text variant="bodySmall" color={theme.colors.text}>{savedCodes ? '☑' : '☐'} I saved my recovery codes</Text>
            </Pressable>
            <Pressable disabled={!savedCodes} onPress={() => void completeLocalTotpRegistration(confirmed)}>
              <Text variant="subtitle" color={savedCodes ? theme.colors.accent : theme.colors.text3}>Enter realm</Text>
            </Pressable>
          </View> : pending ? <View style={{ gap: theme.spacing.md }}>
            <Text variant="bodySmall" color={theme.colors.text3}>Add CatRealm - local {username} {serverInfo?.name || 'CatRealm Server'} to your authenticator. This secret belongs only to this realm.</Text>
            <Image source={{ uri: pending.qrCode }} style={{ width: 192, height: 192, alignSelf: 'center' }} />
            <Text variant="caption" color={theme.colors.text3}>Manual setup key</Text>
            <Text variant="mono" selectable style={[styles.input, { borderColor: theme.colors.line, borderRadius: theme.radius.md }]}>
              {pending.manualCode}
            </Text>
            <TextInput value={totpCode} onChangeText={(value) => { setTotpCode(value.replace(/\D/g, '').slice(0, 6)); clearError(); }}
              placeholder="Six-digit authenticator code" keyboardType="number-pad" maxLength={6}
              style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.line, borderRadius: theme.radius.md }]} />
            {error ? <Text variant="bodySmall" color={theme.colors.danger}>{error}</Text> : null}
            <Pressable disabled={loading || totpCode.length !== 6} onPress={() => void handleRegister()}>
              <Text variant="subtitle" color={totpCode.length === 6 ? theme.colors.accent : theme.colors.text3}>Confirm code</Text>
            </Pressable>
            <Pressable onPress={() => { setPending(null); setTotpCode(''); clearError(); }}>
              <Text variant="caption" color={theme.colors.text3}>Back</Text>
            </Pressable>
          </View> : <>
          {totpAvailable ? <View style={{ flexDirection: 'row', gap: 12, marginBottom: theme.spacing.md }}>
            <Pressable onPress={() => { setMethod('password'); clearError(); setMatchError(''); }}>
              <Text variant="bodySmall" color={method === 'password' ? theme.colors.accent : theme.colors.text3}>Password</Text>
            </Pressable>
            <Pressable onPress={() => { setMethod('totp'); clearError(); setMatchError(''); }}>
              <Text variant="bodySmall" color={method === 'totp' ? theme.colors.accent : theme.colors.text3}>Authenticator code</Text>
            </Pressable>
          </View> : null}
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

            {effectiveMethod === 'password' ? <><TextInput
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
            /></> : <Text variant="bodySmall" color={theme.colors.text3}>You will scan a QR code and confirm a rotating code before the account is created.</Text>}

            {hasError ? (
              <Text variant="bodySmall" color={theme.colors.danger} style={{ marginTop: theme.spacing.sm }}>
                {matchError || error}
              </Text>
            ) : null}
          </View>

          <Pressable
            haptic
            onPress={handleRegister}
            disabled={loading || !usernameValid || (effectiveMethod === 'password' && (!password || !confirmPassword))}
            style={[
              styles.btn,
              {
                backgroundColor:
                  loading || !usernameValid || (effectiveMethod === 'password' && (!password || !confirmPassword))
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
                  loading || !usernameValid || (effectiveMethod === 'password' && (!password || !confirmPassword))
                    ? theme.colors.text3
                    : theme.colors.textOnAccent
                }
              >
                {effectiveMethod === 'totp' ? 'Set up authenticator' : t('auth.createAccount')}
              </Text>
            )}
          </Pressable>

          <Pressable minHit={32} onPress={() => router.push('/(auth)/local-login')}>
            <Text variant="caption" color={theme.colors.text3}>
              {t('auth.alreadyHaveAccount')}
            </Text>
          </Pressable>
          </>}
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
