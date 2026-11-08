import { useState, useEffect, type ReactNode } from 'react';
import { View, TextInput, Image, StyleSheet, ActivityIndicator, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { Check } from 'lucide-react-native';
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
import { HCaptchaModal } from '@/components/HCaptchaModal';
import { useAuthStore, fetchRegisterCaptchaConfig } from '@/stores/authStore';
import { oneTimeCodeKeyboardType } from '@/hooks/useDeviceLayout';

const PRIVACY_URL = 'https://catrealm.app/privacy/';
const TERMS_URL = 'https://catrealm.app/terms/';
const CHILD_SAFETY_URL = 'https://catrealm.app/child-safety/';

/** Checkbox row whose label may end in an inline policy link, as on desktop. */
function ConsentCheckbox({
  checked,
  onToggle,
  link,
  children,
}: {
  checked: boolean;
  onToggle: () => void;
  link?: { label: string; url: string };
  children: ReactNode;
}) {
  const theme = useTheme();
  const openLink = link ? () => void Linking.openURL(link.url) : undefined;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      // The row is one accessibility element, so expose the inline link as an action.
      accessibilityActions={link ? [{ name: 'openLink', label: `Read ${link.label}` }] : undefined}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'openLink') openLink?.();
      }}
      onPress={onToggle}
      style={styles.checkRow}
    >
      <View
        style={[
          styles.checkBox,
          {
            borderRadius: theme.radius.sm,
            borderColor: checked ? theme.colors.accent : theme.colors.text3,
            backgroundColor: checked ? theme.colors.accent : 'transparent',
          },
        ]}
      >
        {checked ? <Check size={14} strokeWidth={3} color={theme.colors.textOnAccent} /> : null}
      </View>
      <Text variant="bodySmall" color={theme.colors.text2} style={styles.checkLabel}>
        {children}
        {link ? (
          <>
            <Text
              variant="bodySmall"
              color={theme.colors.accentText}
              weight="600"
              suppressHighlighting
              onPress={openLink}
            >
              {link.label}
            </Text>
            .
          </>
        ) : null}
      </Text>
    </Pressable>
  );
}

export default function CentralRegisterScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [confirmAge18, setConfirmAge18] = useState(false);
  const acknowledgmentsComplete = acceptPrivacy && acceptTerms && confirmAge18;
  const usernameValid = /^[a-zA-Z0-9_]{4,32}$/.test(username);

  const centralRegisterStart = useAuthStore((s) => s.centralRegisterStart);
  const centralRegisterConfirm = useAuthStore((s) => s.centralRegisterConfirm);
  const centralRegPending = useAuthStore((s) => s.centralRegPending);
  const loading = useAuthStore((s) => s.loading);
  const error = useAuthStore((s) => s.error);
  const clearError = useAuthStore((s) => s.clearError);

  const [confirming, setConfirming] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [captchaSiteKey, setCaptchaSiteKey] = useState<string | null>(null);
  useEffect(() => {
    if (confirming && !centralRegPending && !loading && !error) {
      router.replace('/(auth)/central-login');
    }
  }, [confirming, centralRegPending, loading, error, router]);

  // A fresh token per attempt: Central's settings decide whether one is needed.
  const handleStart = async () => {
    if (!usernameValid || !acknowledgmentsComplete || preparing) return;
    clearError();
    setPreparing(true);
    const captcha = await fetchRegisterCaptchaConfig();
    setPreparing(false);
    if (captcha?.enabled && captcha.siteKey) setCaptchaSiteKey(captcha.siteKey);
    else void centralRegisterStart(username);
  };

  const handleCaptchaToken = (token: string) => {
    setCaptchaSiteKey(null);
    void centralRegisterStart(username, token);
  };

  const handleConfirm = () => {
    if (!totpCode.trim()) return;
    clearError();
    setConfirming(true);
    void centralRegisterConfirm(totpCode.trim());
  };

  const phase = centralRegPending ? 2 : 1;

  return (
    <AuthScreenShell scroll>
      <AuthScreenHeader
        title="CatRealm"
        subtitle={phase === 1 ? t('auth.centralAccount') : t('auth.setupTwoFactor')}
        backLabel={t('auth.back')}
        onBack={() => router.replace('/(auth)/welcome')}
      />

      <AuthCard>
          {phase === 1 ? (
            <>
              <AuthTabRow
                active="register"
                onLogin={() => router.replace('/(auth)/central-login')}
                onRegister={() => undefined}
              />

              <Text variant="bodySmall" color={theme.colors.text2}>
                {t('auth.pickUsername')}
              </Text>

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
                  returnKeyType="go"
                  onSubmitEditing={() => void handleStart()}
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

                <Text variant="caption" color={theme.colors.text3} style={{ marginTop: theme.spacing.sm }}>
                  {t('auth.usernameRules')}
                </Text>

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

              <View style={[styles.consent, { borderTopColor: theme.colors.line }]}>
                <ConsentCheckbox
                  checked={acceptPrivacy}
                  onToggle={() => setAcceptPrivacy(!acceptPrivacy)}
                  link={{ label: 'Privacy Policy', url: PRIVACY_URL }}
                >
                  I have read and agree to the{' '}
                </ConsentCheckbox>
                <ConsentCheckbox
                  checked={acceptTerms}
                  onToggle={() => setAcceptTerms(!acceptTerms)}
                  link={{ label: 'Terms of Service', url: TERMS_URL }}
                >
                  I have read and agree to the{' '}
                </ConsentCheckbox>
                <ConsentCheckbox checked={confirmAge18} onToggle={() => setConfirmAge18(!confirmAge18)}>
                  I confirm that I am 18 years of age or older.
                </ConsentCheckbox>
                <Pressable
                  minHit={32}
                  accessibilityRole="link"
                  onPress={() => void Linking.openURL(CHILD_SAFETY_URL)}
                  style={styles.childSafetyLink}
                >
                  <Text variant="caption" color={theme.colors.accentText}>
                    Read CatRealm's Child Safety Standards
                  </Text>
                </Pressable>
              </View>

              <Pressable
                haptic
                onPress={() => void handleStart()}
                disabled={loading || preparing || !usernameValid || !acknowledgmentsComplete}
                style={[
                  styles.btn,
                  {
                    backgroundColor:
                      loading || preparing || !usernameValid || !acknowledgmentsComplete ? theme.colors.bgElev3 : theme.colors.accent,
                    borderRadius: theme.radius.lg,
                  },
                ]}
              >
                {loading || preparing ? (
                  <ActivityIndicator color={theme.colors.textOnAccent} />
                ) : (
                  <Text
                    variant="subtitle"
                    color={!usernameValid || !acknowledgmentsComplete ? theme.colors.text3 : theme.colors.textOnAccent}
                  >
                    {t('auth.continue')}
                  </Text>
                )}
              </Pressable>

              <Text variant="caption" color={theme.colors.text3} style={{ textAlign: 'center' }}>
                {t('auth.centralAccountsDesc')}
              </Text>
            </>
          ) : (
            <>
              <Text variant="bodySmall" color={theme.colors.text2}>
                {t('auth.scanQR')}
              </Text>

              {centralRegPending?.qrCode ? (
                <Image
                  source={{ uri: centralRegPending.qrCode }}
                  style={[styles.qr, { borderRadius: theme.radius.md }]}
                  resizeMode="contain"
                />
              ) : null}

              {centralRegPending?.manualCode ? (
                <View
                  style={{
                    backgroundColor: theme.colors.bgElev2,
                    borderRadius: theme.radius.md,
                    padding: theme.spacing.md,
                  }}
                >
                  <Text variant="caption" color={theme.colors.text3} style={{ marginBottom: 4 }}>
                    {t('auth.manualEntryKey')}
                  </Text>
                  <Text variant="mono" color={theme.colors.text}>
                    {centralRegPending.manualCode}
                  </Text>
                </View>
              ) : null}

              <View>
                <TextInput
                  value={totpCode}
                  onChangeText={setTotpCode}
                  placeholder={t('auth.sixDigitCodePlaceholder')}
                  placeholderTextColor={theme.colors.text3}
                  keyboardType={oneTimeCodeKeyboardType}
                  maxLength={6}
                  textContentType="oneTimeCode"
                  autoComplete="one-time-code"
                  returnKeyType="go"
                  onSubmitEditing={handleConfirm}
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
                onPress={handleConfirm}
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
            </>
          )}
      </AuthCard>
      {captchaSiteKey ? (
        <HCaptchaModal
          visible
          siteKey={captchaSiteKey}
          onToken={handleCaptchaToken}
          onCancel={() => setCaptchaSiteKey(null)}
        />
      ) : null}
    </AuthScreenShell>
  );
}

const styles = StyleSheet.create({
  consent: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8 },
  checkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 12, paddingVertical: 4 },
  checkBox: { width: 20, height: 20, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  checkLabel: { flex: 1, lineHeight: 20 },
  childSafetyLink: { alignSelf: 'flex-start', alignItems: 'flex-start', marginLeft: 32 },
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
  qr: {
    width: 200,
    height: 200,
    alignSelf: 'center',
  },
});
