import { useState } from 'react';
import { Modal, View, TextInput, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { Lock } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { Text } from '../Text';
import { Pressable } from '../Pressable';
import { usePersonalNotesStore, type PersonalNoteContent } from '@/stores/personalNotesStore';

interface Props {
  visible: boolean;
  onClose: () => void;
  noteId: string;
  lockType: 'pin' | '2fa';
  onUnlocked: (content: PersonalNoteContent, pin?: string) => void;
}

export function NoteUnlockModal({ visible, onClose, noteId, lockType, onUnlocked }: Props) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const loadNoteContent = usePersonalNotesStore((s) => s.loadNoteContent);

  const isPIN = lockType === 'pin';

  async function handleSubmit() {
    if (!code.trim()) return;
    setError(null);
    setLoading(true);
    try {
      const content = await loadNoteContent(noteId, isPIN ? { pin: code } : { totpCode: code });
      if (content) {
        onUnlocked(content, isPIN ? code : undefined);
        setCode('');
      } else {
        setError(isPIN ? t('notes.incorrectPIN') : t('notes.invalidCode'));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      setError(msg === 'Incorrect PIN' ? t('notes.incorrectPIN') : isPIN ? t('notes.incorrectPIN') : t('notes.invalidExpiredCode'));
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    setCode('');
    setError(null);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}
      supportedOrientations={['portrait', 'portrait-upside-down', 'landscape', 'landscape-left', 'landscape-right']}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.card, { backgroundColor: theme.colors.bgElev1, borderColor: theme.colors.line }]}>
          <View style={styles.header}>
            <View style={[styles.iconWrap, { backgroundColor: theme.colors.accent + '22' }]}>
              <Lock color={theme.colors.accent} size={20} />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="subtitle">{t('notes.unlockNoteTitle')}</Text>
              <Text variant="bodySmall" color={theme.colors.text3}>
                {isPIN ? t('notes.noteProtectedPIN') : t('notes.noteProtected2FA')}
              </Text>
            </View>
          </View>

          <Text variant="caption" color={theme.colors.text2} style={{ marginBottom: 6 }}>
            {isPIN ? t('notes.pinLabel') : t('notes.twoFACodeLabel')}
          </Text>
          <TextInput
            value={code}
            onChangeText={(v) => { setCode(v); setError(null); }}
            placeholder={isPIN ? t('notes.enterPINPlaceholder') : t('notes.enter6DigitPlaceholder')}
            placeholderTextColor={theme.colors.text3}
            secureTextEntry={isPIN}
            keyboardType={isPIN ? 'default' : 'number-pad'}
            maxLength={isPIN ? 64 : 6}
            autoFocus
            style={[
              styles.input,
              {
                backgroundColor: theme.colors.bgElev2,
                borderColor: error ? theme.colors.danger : theme.colors.line,
                color: theme.colors.text,
              },
            ]}
          />
          {error && (
            <Text variant="caption" color={theme.colors.danger} style={{ marginTop: 4 }}>
              {error}
            </Text>
          )}

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
              onPress={() => { void handleSubmit(); }}
              disabled={loading || !code.trim()}
              style={[
                styles.btn,
                { backgroundColor: theme.colors.accent, borderRadius: theme.radius.md, opacity: loading || !code.trim() ? 0.5 : 1 },
              ]}
            >
              <Text variant="body" color={theme.colors.textOnAccent}>
                {loading ? t('notes.unlocking') : t('notes.unlock')}
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
    maxWidth: 360,
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
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
