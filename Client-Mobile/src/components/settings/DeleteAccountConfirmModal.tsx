import { useState } from 'react';
import { Modal, View, TextInput, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { AlertTriangle } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { Text } from '../Text';
import { Pressable } from '../Pressable';
import { createAuthenticatedApi } from '@/lib/api';

type BlockingGroupChat = { id: string; name: string; memberCount: number };
type GroupMember = { id: string; username: string; displayName: string | null; isOwner: boolean };

interface Props {
  visible: boolean;
  onClose: () => void;
  onDeleted: () => void | Promise<void>;
}

export function DeleteAccountConfirmModal({ visible, onClose, onDeleted }: Props) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [blocked, setBlocked] = useState<BlockingGroupChat[] | null>(null);
  const [membersByGroup, setMembersByGroup] = useState<Record<string, GroupMember[]>>({});
  const [transferTarget, setTransferTarget] = useState<Record<string, string>>({});
  const [transferringId, setTransferringId] = useState<string | null>(null);

  function reset() {
    setCode('');
    setError(null);
    setBlocked(null);
    setMembersByGroup({});
    setTransferTarget({});
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function ensureMembersLoaded(groupId: string) {
    try {
      const r = await createAuthenticatedApi().get<{ members: GroupMember[] }>(`/api/group-chats/${groupId}`);
      setMembersByGroup((prev) => ({ ...prev, [groupId]: r.data.members }));
    } catch {
      // leave unset; that group's picker just stays empty
    }
  }

  async function handleTransfer(groupId: string) {
    const newOwnerId = transferTarget[groupId];
    if (!newOwnerId) return;
    setTransferringId(groupId);
    setError(null);
    try {
      await createAuthenticatedApi().post(`/api/group-chats/${groupId}/transfer-ownership`, { newOwnerId });
      setBlocked((prev) => (prev ? prev.filter((g) => g.id !== groupId) : prev));
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? t('settings.transferOwnershipFailed'));
    } finally {
      setTransferringId(null);
    }
  }

  async function handleSubmit() {
    if (!code.trim()) return;
    setError(null);
    setLoading(true);
    try {
      await createAuthenticatedApi().delete('/api/security/account', { data: { totpCode: code.trim() } });
      reset();
      await onDeleted();
    } catch (err) {
      const response = (err as { response?: { status?: number; data?: { error?: string; blockingGroupChats?: BlockingGroupChat[] } } })?.response;
      if (response?.status === 409 && response.data?.blockingGroupChats) {
        setBlocked(response.data.blockingGroupChats);
        for (const g of response.data.blockingGroupChats) void ensureMembersLoaded(g.id);
      } else {
        setError(response?.data?.error ?? t('settings.deleteAccountFailed'));
      }
    } finally {
      setLoading(false);
    }
  }

  const isBlocked = Array.isArray(blocked);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}
      supportedOrientations={['portrait', 'portrait-upside-down', 'landscape', 'landscape-left', 'landscape-right']}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.card, { backgroundColor: theme.colors.bgElev1, borderColor: theme.colors.line }]}>
          <View style={styles.header}>
            <View style={[styles.iconWrap, { backgroundColor: theme.colors.danger + '22' }]}>
              <AlertTriangle color={theme.colors.danger} size={20} />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="subtitle">
                {isBlocked ? t('settings.deleteAccountBlockedTitle') : t('settings.deleteAccount')}
              </Text>
              <Text variant="bodySmall" color={theme.colors.text3}>
                {isBlocked ? t('settings.deleteAccountBlockedIntro') : t('settings.deleteAccountTotpPrompt')}
              </Text>
            </View>
          </View>

          {!isBlocked && (
            <>
              <TextInput
                value={code}
                onChangeText={(v) => { setCode(v); setError(null); }}
                placeholder={t('settings.deleteAccountCodePlaceholder')}
                placeholderTextColor={theme.colors.text3}
                keyboardType="default"
                autoCapitalize="none"
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
                    { backgroundColor: theme.colors.danger, borderRadius: theme.radius.md, opacity: loading || !code.trim() ? 0.5 : 1 },
                  ]}
                >
                  <Text variant="body" color={theme.colors.textOnAccent}>
                    {t('settings.deleteAccount')}
                  </Text>
                </Pressable>
              </View>
            </>
          )}

          {isBlocked && (
            <ScrollView style={{ maxHeight: 300 }}>
              {blocked!.length === 0 ? (
                <Text variant="bodySmall" color={theme.colors.text2}>
                  {t('settings.deleteAccountTotpPrompt')}
                </Text>
              ) : (
                blocked!.map((group) => (
                  <View key={group.id} style={[styles.groupBlock, { borderColor: theme.colors.lineSoft }]}>
                    <Text variant="body">{group.name} ({group.memberCount})</Text>
                    {(membersByGroup[group.id] || []).filter((m) => !m.isOwner).map((m) => (
                      <Pressable
                        key={m.id}
                        haptic
                        onPress={() => setTransferTarget((prev) => ({ ...prev, [group.id]: m.id }))}
                        style={[
                          styles.memberRow,
                          {
                            backgroundColor: transferTarget[group.id] === m.id ? theme.colors.accent + '22' : theme.colors.bgElev2,
                            borderRadius: theme.radius.sm,
                          },
                        ]}
                      >
                        <Text variant="bodySmall" color={theme.colors.text2}>{m.displayName || m.username}</Text>
                      </Pressable>
                    ))}
                    <Pressable
                      haptic
                      onPress={() => void handleTransfer(group.id)}
                      disabled={!transferTarget[group.id] || transferringId === group.id}
                      style={[
                        styles.transferBtn,
                        {
                          backgroundColor: theme.colors.accent,
                          borderRadius: theme.radius.md,
                          opacity: !transferTarget[group.id] || transferringId === group.id ? 0.5 : 1,
                        },
                      ]}
                    >
                      <Text variant="bodySmall" color={theme.colors.textOnAccent}>
                        {t('settings.transferOwnership')}
                      </Text>
                    </Pressable>
                  </View>
                ))
              )}
              {error && (
                <Text variant="caption" color={theme.colors.danger} style={{ marginTop: 8 }}>
                  {error}
                </Text>
              )}
              {blocked!.length === 0 && (
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
                    onPress={() => { setBlocked(null); }}
                    style={[styles.btn, { backgroundColor: theme.colors.danger, borderRadius: theme.radius.md }]}
                  >
                    <Text variant="body" color={theme.colors.textOnAccent}>{t('settings.deleteAccount')}</Text>
                  </Pressable>
                </View>
              )}
            </ScrollView>
          )}
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
  groupBlock: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    gap: 6,
  },
  memberRow: {
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  transferBtn: {
    paddingVertical: 8,
    alignItems: 'center',
    marginTop: 4,
  },
});
