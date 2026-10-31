/**
 * Add Server — join a realm by address or invite link (desktop AddServerModal
 * + InviteEmbedModal). Invites show a preview before joining.
 */
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from '@/components/SafeAreaView';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, SquarePlus } from 'lucide-react-native';
import { useTheme } from '@/theme';
import { Text, Pressable, Avatar, FadeInImage } from '@/components';
import { useAuthStore } from '@/stores/authStore';
import { useJoinServer } from '@/hooks/useJoinServer';
import { lookupInvite, parseInviteCode, type InviteInfo } from '@/lib/serverDirectory';
import { resolveMediaUrl } from '@/utils/mediaUrl';

export default function AddServerScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const isCentral = useAuthStore((s) => s.user?.accountType === 'central');
  const { join, joiningKey, error, clearError } = useJoinServer();
  const [input, setInput] = useState('');
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const busy = lookingUp || joiningKey !== null;
  const shownError = lookupError ?? error;

  const submit = async () => {
    const value = input.trim();
    if (!value || busy) return;
    clearError();
    setLookupError(null);
    const code = parseInviteCode(value);
    if (!code) {
      await join({ serverUrl: value });
      return;
    }
    setLookingUp(true);
    try {
      setInvite(await lookupInvite(code));
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'Could not load that invite.');
    } finally {
      setLookingUp(false);
    }
  };

  const inviteIcon = invite ? resolveMediaUrl(invite.serverIcon, invite.serverUrl) : null;
  const inviteBanner = invite ? resolveMediaUrl(invite.serverBanner, invite.serverUrl) : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bgApp }} edges={['top']}>
      <View style={styles.header}>
        <Pressable haptic accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => router.back()} style={styles.back}>
          <ChevronLeft size={24} color={theme.colors.text2} />
        </Pressable>
        <Text variant="display" style={{ flex: 1 }}>{t('joinServers.addTitle')}</Text>
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {!isCentral ? (
            <Text variant="body" color={theme.colors.text2}>{t('joinServers.centralOnly')}</Text>
          ) : invite ? (
            <View style={[styles.card, { backgroundColor: theme.colors.bgElev1, borderColor: theme.colors.lineSoft }]}>
              {inviteBanner ? <FadeInImage uri={inviteBanner} style={styles.banner} /> : <View style={[styles.banner, { backgroundColor: theme.colors.bgElev2 }]} />}
              <View style={styles.cardBody}>
                <Text variant="caption" color={theme.colors.text3}>{t('joinServers.inviteFrom')}</Text>
                <View style={styles.inviteRow}>
                  <Avatar username={invite.serverName} uri={inviteIcon} size={48} shape="square" showStatus={false} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text variant="subtitle" numberOfLines={1}>{invite.serverName}</Text>
                    {typeof invite.memberCount === 'number' && (
                      <Text variant="caption" color={theme.colors.text3}>{t('joinServers.members', { count: invite.memberCount })}</Text>
                    )}
                  </View>
                </View>
                {!!invite.serverDescription && (
                  <Text variant="bodySmall" color={theme.colors.text2} numberOfLines={4}>{invite.serverDescription}</Text>
                )}
                {!!shownError && <Text accessibilityRole="alert" variant="bodySmall" color={theme.colors.danger}>{shownError}</Text>}
                <View style={styles.row}>
                  <Pressable haptic onPress={() => { setInvite(null); clearError(); }} disabled={busy}
                    style={[styles.button, { backgroundColor: theme.colors.bgElev2 }]}>
                    <Text variant="body" style={{ fontWeight: '600' }}>{t('common.cancel')}</Text>
                  </Pressable>
                  <Pressable haptic disabled={busy} onPress={() => void join({ serverUrl: invite.serverUrl, inviteCode: invite.code })}
                    style={[styles.button, { backgroundColor: theme.colors.accent, opacity: busy ? 0.7 : 1 }]}>
                    {joiningKey ? <ActivityIndicator accessibilityLabel={t('joinServers.joining')} color="#fff" />
                      : <Text variant="body" style={{ color: '#fff', fontWeight: '700' }}>{t('joinServers.join')}</Text>}
                  </Pressable>
                </View>
              </View>
            </View>
          ) : (
            <>
              <Text variant="bodySmall" color={theme.colors.text3}>{t('joinServers.addHint')}</Text>
              <TextInput
                value={input}
                onChangeText={(value) => { setInput(value); clearError(); setLookupError(null); }}
                onSubmitEditing={() => void submit()}
                placeholder={t('joinServers.addPlaceholder')}
                placeholderTextColor={theme.colors.text3}
                accessibilityLabel={t('joinServers.addHint')}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                returnKeyType="go"
                editable={!busy}
                style={[styles.input, { backgroundColor: theme.colors.bgElev2, color: theme.colors.text, borderColor: theme.colors.lineSoft }]}
              />
              {!!shownError && <Text accessibilityRole="alert" variant="bodySmall" color={theme.colors.danger}>{shownError}</Text>}
              <Pressable haptic disabled={busy || !input.trim()} onPress={() => void submit()}
                style={[styles.button, styles.primary, { backgroundColor: theme.colors.accent, opacity: busy || !input.trim() ? 0.6 : 1 }]}>
                {busy ? <ActivityIndicator accessibilityLabel={t('joinServers.joining')} color="#fff" /> : (
                  <>
                    <SquarePlus size={18} color="#fff" />
                    <Text variant="body" style={{ color: '#fff', fontWeight: '700' }}>{t('joinServers.continue')}</Text>
                  </>
                )}
              </Pressable>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 12, gap: 4 },
  back: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 16, gap: 12, maxWidth: 560, width: '100%', alignSelf: 'center' },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  button: { flex: 1, minHeight: 46, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primary: { flex: 0, alignSelf: 'stretch' },
  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  banner: { height: 110 },
  cardBody: { padding: 16, gap: 10 },
  inviteRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  row: { flexDirection: 'row', gap: 10, marginTop: 4 },
});
