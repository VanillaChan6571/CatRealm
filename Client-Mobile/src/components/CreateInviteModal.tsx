import { useState } from 'react';
import { Modal, Share, StyleSheet, View, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { Text } from './Text';
import { Pressable } from './Pressable';
import { createApi } from '@/lib/api';

interface Props {
  visible: boolean;
  onClose: () => void;
}

interface InviteResult {
  code: string;
  centralUrl?: string | null;
  directUrl?: string | null;
}

export function CreateInviteModal({ visible, onClose }: Props) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [invite, setInvite] = useState<InviteResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await createApi().post<InviteResult>('/api/invites', {});
      setInvite(res.data);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? t('chat.inviteFailedCreate');
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const inviteUrl = invite?.centralUrl ?? invite?.directUrl ?? (invite?.code ? t('chat.inviteCode', { code: invite.code }) : null);

  const handleShare = () => {
    if (!inviteUrl) return;
    void Share.share({ message: inviteUrl });
  };

  const handleClose = () => {
    setInvite(null);
    setError(null);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}
      supportedOrientations={['portrait', 'portrait-upside-down', 'landscape', 'landscape-left', 'landscape-right']}>
      <Pressable style={styles.backdrop} onPress={handleClose}>
        <View />
      </Pressable>
      <View style={styles.centerer} pointerEvents="box-none">
        <View style={[styles.card, { backgroundColor: theme.colors.bgElev1, borderRadius: theme.radius.xl }]}>
          <Text variant="subtitle" style={{ marginBottom: 12 }}>{t('chat.createInvite')}</Text>

          {!invite ? (
            <>
              <Text variant="bodySmall" color={theme.colors.text3} style={{ marginBottom: 16 }}>
                {t('chat.generateInviteDesc')}
              </Text>
              {error && (
                <Text variant="bodySmall" color={theme.colors.danger} style={{ marginBottom: 10 }}>
                  {error}
                </Text>
              )}
              <Pressable
                haptic
                onPress={() => void handleCreate()}
                disabled={loading}
                style={[styles.btn, { backgroundColor: theme.colors.accent, borderRadius: theme.radius.md }]}
              >
                {loading
                  ? <ActivityIndicator color={theme.colors.textOnAccent} />
                  : <Text variant="body" color={theme.colors.textOnAccent}>{t('chat.generateInvite')}</Text>}
              </Pressable>
            </>
          ) : (
            <>
              <View style={[styles.codeBox, { backgroundColor: theme.colors.bgElev2, borderRadius: theme.radius.md }]}>
                <Text variant="bodySmall" color={theme.colors.text} style={{ fontFamily: 'monospace' }} numberOfLines={2} selectable>
                  {inviteUrl}
                </Text>
              </View>
              <Pressable
                haptic
                onPress={handleShare}
                style={[styles.btn, { backgroundColor: theme.colors.accent, borderRadius: theme.radius.md, marginTop: 12 }]}
              >
                <Text variant="body" color={theme.colors.textOnAccent}>{t('chat.shareInvite')}</Text>
              </Pressable>
            </>
          )}

          <Pressable haptic onPress={handleClose} style={{ marginTop: 10, alignItems: 'center', padding: 8 }}>
            <Text variant="body" color={theme.colors.text3}>{t('common.close')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  centerer: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    padding: 24,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  btn: {
    paddingVertical: 13,
    alignItems: 'center',
  },
  codeBox: {
    padding: 12,
  },
});
