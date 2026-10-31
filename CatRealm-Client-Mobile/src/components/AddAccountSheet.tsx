import { useState } from 'react';
import {
  ActivityIndicator,
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
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { Text, Pressable } from '@/components';
import { useAuthStore } from '@/stores/authStore';
import { useSavedAccountsStore } from '@/stores/savedAccountsStore';

type Tab = 'central' | 'local';

interface AddAccountSheetProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function AddAccountSheet({ visible, onClose, onSuccess }: AddAccountSheetProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const addCentralAccount = useAuthStore((s) => s.addCentralAccount);
  const addLocalAccount = useAuthStore((s) => s.addLocalAccount);
  const accounts = useSavedAccountsStore((s) => s.accounts);

  const [tab, setTab] = useState<Tab>('central');
  const [username, setUsername] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const atLimit = accounts.length >= 5;

  const reset = () => {
    setUsername('');
    setTotpCode('');
    setServerUrl('');
    setPassword('');
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
      err = await addLocalAccount(serverUrl.trim(), username.trim(), password);
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
        <View style={[styles.sheet, { backgroundColor: theme.colors.bgElev1 }]}>
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: theme.colors.lineSoft }]}>
            <Text variant="subtitle" color={theme.colors.text}>
              {t('settings.addAccount')}
            </Text>
            <Pressable haptic onPress={handleClose} style={styles.closeBtn}>
              <X size={20} color={theme.colors.text3} />
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
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
                      keyboardType="number-pad"
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
                    <TextInput
                      value={password}
                      onChangeText={setPassword}
                      placeholder={t('auth.passwordPlaceholder')}
                      placeholderTextColor={theme.colors.text3}
                      secureTextEntry
                      textContentType="password"
                      autoComplete="current-password"
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
