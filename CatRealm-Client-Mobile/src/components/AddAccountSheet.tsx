import { useEffect, useState } from 'react';
import axios from 'axios';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { Text, Pressable } from '@/components';
import { useAuthStore } from '@/stores/authStore';
import { useSavedAccountsStore } from '@/stores/savedAccountsStore';
import { oneTimeCodeKeyboardType } from '@/hooks/useDeviceLayout';

type Tab = 'central' | 'local';

interface AddAccountSheetProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function AddAccountSheet({ visible, onClose, onSuccess }: AddAccountSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const addCentralAccount = useAuthStore((s) => s.addCentralAccount);
  const addLocalAccount = useAuthStore((s) => s.addLocalAccount);
  const accounts = useSavedAccountsStore((s) => s.accounts);

  const [tab, setTab] = useState<Tab>('central');
  const [username, setUsername] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [password, setPassword] = useState('');
  const [localMethod, setLocalMethod] = useState<'password' | 'totp'>('password');
  const [targetSupportsTotp, setTargetSupportsTotp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Android runs edge-to-edge, so the window no longer shrinks for the keyboard:
  // lift the sheet by the IME height (reported without the nav bar) plus that inset.
  const [androidKeyboardLift, setAndroidKeyboardLift] = useState(0);

  useEffect(() => {
    if (!visible || Platform.OS !== 'android') return;
    const show = Keyboard.addListener('keyboardDidShow', (e) => {
      setAndroidKeyboardLift(e.endCoordinates.height + insets.bottom);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => setAndroidKeyboardLift(0));
    return () => {
      show.remove();
      hide.remove();
      setAndroidKeyboardLift(0);
    };
  }, [visible, insets.bottom]);

  useEffect(() => {
    setTargetSupportsTotp(false);
    setLocalMethod('password');
    if (!visible || tab !== 'local') return;
    const target = serverUrl.trim().replace(/\/+$/, '');
    if (!/^https:\/\/[^/]+$/i.test(target)) return;
    let active = true;
    const timer = setTimeout(() => {
      void axios.get(`${target}/api/server`, { timeout: 5000 })
        .then((response) => { if (active) setTargetSupportsTotp(response.data?.localTotpAuth === true); })
        .catch(() => {});
    }, 500);
    return () => { active = false; clearTimeout(timer); };
  }, [visible, tab, serverUrl]);

  const atLimit = accounts.length >= 5;

  const reset = () => {
    setUsername('');
    setTotpCode('');
    setServerUrl('');
    setPassword('');
    setLocalMethod('password');
    setError(null);
    setLoading(false);
    setTab('central');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    if (loading) return;
    setError(null);
    setLoading(true);
    let err: string | null = null;

    if (tab === 'central') {
      err = await addCentralAccount(username.trim(), totpCode.trim());
    } else {
      err = await addLocalAccount(serverUrl.trim(), username.trim(), password, localMethod);
    }

    setLoading(false);
    if (err) {
      setError(err);
    } else {
      reset();
      onSuccess();
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
      supportedOrientations={['portrait', 'portrait-upside-down', 'landscape', 'landscape-left', 'landscape-right']}
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={handleClose} />
        <View style={[styles.sheet, { backgroundColor: theme.colors.bgElev1, marginBottom: androidKeyboardLift }]}>
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: theme.colors.lineSoft }]}>
            <Text variant="subtitle" color={theme.colors.text}>
              {t('settings.addAccount')}
            </Text>
            <Pressable haptic onPress={handleClose} style={styles.closeBtn}>
              <X size={20} color={theme.colors.text3} />
            </Pressable>
          </View>

          {/* Edge-to-edge modals draw under the system nav bar, so pad the bottom like Sheet does. */}
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[
              styles.body,
              // Above the keyboard the nav bar is covered anyway; only keep a small gap.
              { paddingBottom: androidKeyboardLift > 0 ? 16 : Math.max(24, insets.bottom + 8) },
            ]}
          >
            {atLimit ? (
              <View style={[styles.limitBox, { backgroundColor: theme.colors.bgElev2 }]}>
                <Text variant="body" color={theme.colors.text3} style={{ textAlign: 'center' }}>
                  {t('addAccount.accountLimit')}
                </Text>
              </View>
            ) : (
              <>
                {/* Tab row */}
                <View style={[styles.tabRow, { backgroundColor: theme.colors.bgElev2, borderColor: theme.colors.lineSoft }]}>
                  {(['central', 'local'] as Tab[]).map((tabKey) => (
                    <Pressable
                      key={tabKey}
                      haptic
                      onPress={() => { setTab(tabKey); setError(null); }}
                      style={[
                        styles.tabBtn,
                        tab === tabKey && { backgroundColor: theme.colors.accent },
                      ]}
                    >
                      <Text
                        variant="bodySmall"
                        color={tab === tabKey ? theme.colors.textOnAccent : theme.colors.text2}
                      >
                        {tabKey === 'central' ? t('account.centralAccountLabel') : t('account.localServerLabel')}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {tab === 'central' ? (
                  <>
                    <TextInput
                      value={username}
                      onChangeText={setUsername}
                      placeholder={t('auth.usernamePlaceholder')}
                      placeholderTextColor={theme.colors.text3}
                      autoCapitalize="none"
                      autoCorrect={false}
                      textContentType="username"
                      autoComplete="username"
                      style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.lineSoft }]}
                    />
                    <TextInput
                      value={totpCode}
                      onChangeText={setTotpCode}
                      placeholder={t('auth.twoFACodePlaceholder')}
                      placeholderTextColor={theme.colors.text3}
                      keyboardType={oneTimeCodeKeyboardType}
                      maxLength={6}
                      textContentType="oneTimeCode"
                      autoComplete="one-time-code"
                      style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.lineSoft }]}
                    />
                  </>
                ) : (
                  <>
                    <TextInput
                      value={serverUrl}
                      onChangeText={setServerUrl}
                      placeholder={t('addAccount.serverUrlPlaceholder')}
                      placeholderTextColor={theme.colors.text3}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="url"
                      style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.lineSoft }]}
                    />
                    <TextInput
                      value={username}
                      onChangeText={setUsername}
                      placeholder={t('auth.usernamePlaceholder')}
                      placeholderTextColor={theme.colors.text3}
                      autoCapitalize="none"
                      autoCorrect={false}
                      textContentType="username"
                      autoComplete="username"
                      style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.lineSoft }]}
                    />
                    {targetSupportsTotp ? <View style={{ flexDirection: 'row', gap: 16 }}>
                      <Pressable onPress={() => { setLocalMethod('password'); setPassword(''); }}>
                        <Text variant="bodySmall" color={localMethod === 'password' ? theme.colors.accent : theme.colors.text3}>Password</Text>
                      </Pressable>
                      <Pressable onPress={() => { setLocalMethod('totp'); setPassword(''); }}>
                        <Text variant="bodySmall" color={localMethod === 'totp' ? theme.colors.accent : theme.colors.text3}>Authenticator code</Text>
                      </Pressable>
                    </View> : null}
                    <TextInput
                      value={password}
                      onChangeText={setPassword}
                      placeholder={localMethod === 'totp' ? 'Six-digit or recovery code' : t('auth.passwordPlaceholder')}
                      placeholderTextColor={theme.colors.text3}
                      autoCapitalize="none"
                      autoCorrect={false}
                      secureTextEntry={localMethod === 'password'}
                      textContentType={localMethod === 'totp' ? 'oneTimeCode' : 'password'}
                      autoComplete={localMethod === 'totp' ? 'one-time-code' : 'current-password'}
                      style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.lineSoft }]}
                    />
                  </>
                )}

                {error ? (
                  <Text variant="bodySmall" color={theme.colors.danger} style={styles.errorText}>
                    {error}
                  </Text>
                ) : null}

                <Pressable
                  haptic
                  onPress={() => void handleSubmit()}
                  disabled={loading}
                  style={[styles.submitBtn, { backgroundColor: theme.colors.accent, opacity: loading ? 0.65 : 1 }]}
                >
                  {loading ? (
                    <ActivityIndicator color={theme.colors.textOnAccent} />
                  ) : (
                    <Text variant="subtitle" color={theme.colors.textOnAccent}>
                      {t('addAccount.signInSwitch')}
                    </Text>
                  )}
                </Pressable>
              </>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
    maxHeight: '85%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  closeBtn: {
    padding: 4,
  },
  body: {
    padding: 16,
    gap: 12,
  },
  tabRow: {
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 9,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
  },
  errorText: {
    marginTop: 4,
  },
  submitBtn: {
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  limitBox: {
    borderRadius: 10,
    padding: 20,
    alignItems: 'center',
  },
});
