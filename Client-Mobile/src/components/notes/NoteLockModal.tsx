import { useState } from 'react';
import { Modal, View, TextInput, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { LockOpen, Lock, ShieldCheck } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { Text } from '../Text';
import { Pressable } from '../Pressable';
import { usePersonalNotesStore } from '@/stores/personalNotesStore';
import { useAuthStore } from '@/stores/authStore';

type LockOption = 'none' | 'pin' | '2fa';

interface Props {
  visible: boolean;
  onClose: () => void;
  noteId: string;
  currentTitle: string;
  currentBody: string;
  currentLockType: 'pin' | '2fa' | null;
  onLockChanged?: (newPin: string | null) => void;
}

export function NoteLockModal({ visible, onClose, noteId, currentTitle, currentBody, currentLockType, onLockChanged }: Props) {
  const theme = useTheme();
  const { t } = useTranslation();
  const isCentral = useAuthStore((s) => s.user?.accountType === 'central');
  const updateNote = usePersonalNotesStore((s) => s.updateNote);

  const [selected, setSelected] = useState<LockOption>(currentLockType ?? 'none');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setError(null);
    if (selected === 'pin') {
      if (pin.length < 4) { setError(t('notes.pinTooShort')); return; }
      if (pin !== confirmPin) { setError(t('notes.pinsMismatch')); return; }
    }
    setSaving(true);
    try {
      if (selected === 'none') {
        await updateNote(noteId, currentTitle, currentBody, { removeLock: true });
        onLockChanged?.(null);
      } else if (selected === 'pin') {
        await updateNote(noteId, currentTitle, currentBody, { pin });
        onLockChanged?.(pin);
      } else {
        await updateNote(noteId, currentTitle, currentBody, { use2fa: true });
        onLockChanged?.(null);
      }
      handleClose();
    } catch {
      setError(t('notes.lockUpdateFailed'));
    } finally {
      setSaving(false);
    }
  }

  function handleClose() {
    setPin('');
    setConfirmPin('');
    setError(null);
    onClose();
  }

  const options: { key: LockOption; label: string; desc: string; Icon: typeof Lock }[] = [
    { key: 'none', label: t('notes.noLock'), desc: t('notes.noLockDesc'), Icon: LockOpen },
    { key: 'pin', label: t('notes.pinLock'), desc: t('notes.pinLockDesc'), Icon: Lock },
    ...(isCentral ? [{ key: '2fa' as LockOption, label: t('notes.twoFALock'), desc: t('notes.twoFALockDesc'), Icon: ShieldCheck }] : []),
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}
      supportedOrientations={['portrait', 'portrait-upside-down', 'landscape', 'landscape-left', 'landscape-right']}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.card, { backgroundColor: theme.colors.bgElev1, borderColor: theme.colors.line }]}>
          <Text variant="subtitle" style={{ marginBottom: 14 }}>{t('notes.lockSettings')}</Text>

          <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 320 }}>
            {options.map(({ key, label, desc, Icon }) => (
              <Pressable
                key={key}
                haptic
                onPress={() => setSelected(key)}
                style={[
                  styles.option,
                  {
                    borderColor: selected === key ? theme.colors.accent : theme.colors.line,
                    backgroundColor: selected === key ? theme.colors.accent + '15' : theme.colors.bgElev2,
                    borderRadius: theme.radius.md,
                  },
                ]}
              >
                <Icon color={theme.colors.text2} size={18} />
                <View style={{ flex: 1 }}>
                  <Text variant="body" style={{ fontWeight: '600' }}>{label}</Text>
                  <Text variant="caption" color={theme.colors.text3}>{desc}</Text>
                </View>
              </Pressable>
            ))}

            {selected === 'pin' && (
              <View style={{ gap: 10, marginTop: 12 }}>
                <View>
                  <Text variant="caption" color={theme.colors.text2} style={{ marginBottom: 4 }}>{t('notes.newPIN')}</Text>
                  <TextInput
                    value={pin}
                    onChangeText={(v) => { setPin(v); setError(null); }}
                    placeholder={t('notes.pinPlaceholder')}
                    placeholderTextColor={theme.colors.text3}
                    secureTextEntry
                    style={[styles.input, { backgroundColor: theme.colors.bgApp, borderColor: theme.colors.line, color: theme.colors.text }]}
                  />
                </View>
                <View>
                  <Text variant="caption" color={theme.colors.text2} style={{ marginBottom: 4 }}>{t('notes.confirmPIN')}</Text>
                  <TextInput
                    value={confirmPin}
                    onChangeText={(v) => { setConfirmPin(v); setError(null); }}
                    placeholder={t('notes.confirmPINPlaceholder')}
                    placeholderTextColor={theme.colors.text3}
                    secureTextEntry
                    style={[styles.input, { backgroundColor: theme.colors.bgApp, borderColor: theme.colors.line, color: theme.colors.text }]}
                  />
                </View>
              </View>
            )}

            {error && (
              <Text variant="caption" color={theme.colors.danger} style={{ marginTop: 8 }}>
                {error}
              </Text>
            )}
          </ScrollView>

          <View style={styles.actions}>
            <Pressable
              haptic
              onPress={handleClose}
              style={[styles.btn, { backgroundColor: theme.colors.bgElev2, borderRadius: theme.radius.md }]}
            >
              <Text variant="body" color={theme.colors.text2}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable
              haptic
              onPress={() => { void handleSave(); }}
              disabled={saving}
              style={[styles.btn, { backgroundColor: theme.colors.accent, borderRadius: theme.radius.md, opacity: saving ? 0.5 : 1 }]}
            >
              <Text variant="body" color={theme.colors.textOnAccent}>
                {saving ? t('notes.saving') : t('common.save')}
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  btn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
});
