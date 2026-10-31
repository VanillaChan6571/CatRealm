import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable as RNPressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Film } from 'lucide-react-native';
import { useTheme } from '@/theme';
import { Text } from '../Text';
import { Pressable } from '../Pressable';
import { Avatar } from '../Avatar';
import { useTheaterStore, type TheaterParticipant } from '@/stores/theaterStore';
import { useUIStore } from '@/stores/uiStore';
import { useAuthStore } from '@/stores/authStore';
import { useServerStore } from '@/stores/serverStore';

const EMPTY_PARTICIPANTS: TheaterParticipant[] = [];
/** The join ack normally lands well inside this; past it, treat the join as failed. */
const JOIN_TIMEOUT_MS = 10_000;

/** Open a theater channel: straight in if already joined, otherwise ask first. */
export function useOpenTheater() {
  const router = useRouter();
  const setTheaterPrompt = useUIStore((s) => s.setTheaterPrompt);
  return useCallback((serverId: string, channelId: string, channelName?: string) => {
    const theater = useTheaterStore.getState();
    if (theater.channelId === channelId && theater.serverId === serverId) {
      router.replace({ pathname: '/server/[serverId]/theater/[channelId]', params: { serverId, channelId } });
      return;
    }
    setTheaterPrompt({ serverId, channelId, channelName });
  }, [router, setTheaterPrompt]);
}

interface TheaterJoinModalProps {
  serverId: string;
  channelId: string;
  channelName?: string | null;
  onCancel: () => void;
  onJoined: () => void;
}

/** Explains theater, shows who is watching, and joins on confirmation. */
export function TheaterJoinModal({ serverId, channelId, channelName, onCancel, onJoined }: TheaterJoinModalProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const watchers = useTheaterStore((s) => s.roomUsersByChannel[channelId] ?? EMPTY_PARTICIPANTS);
  const joinedChannelId = useTheaterStore((s) => s.channelId);
  const joinedServerId = useTheaterStore((s) => s.serverId);
  const currentTheaterName = useTheaterStore((s) => s.channelName);
  const joinTheater = useTheaterStore((s) => s.joinTheater);
  const isCentral = useAuthStore((s) => s.user?.accountType === 'central');
  const localServerUrl = useAuthStore((s) => s.serverUrl);
  const realmUrl = useServerStore((s) => s.byId(serverId)?.url);
  const avatarBaseUrl = (isCentral ? realmUrl : localServerUrl) ?? undefined;
  const [joining, setJoining] = useState(false);
  const [failed, setFailed] = useState(false);
  const joined = joinedChannelId === channelId && joinedServerId === serverId;
  const switchingFrom = joinedChannelId && !joined ? currentTheaterName : null;

  useEffect(() => {
    if (joining && joined) onJoined();
  }, [joined, joining, onJoined]);

  useEffect(() => {
    if (!joining || joined) return;
    const timer = setTimeout(() => { setJoining(false); setFailed(true); }, JOIN_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [joined, joining]);

  const join = () => {
    setFailed(false);
    setJoining(true);
    void joinTheater({ serverId, channelId, channelName: channelName ?? undefined });
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent
      supportedOrientations={['portrait', 'portrait-upside-down', 'landscape', 'landscape-left', 'landscape-right']}>
      <View style={styles.scrim}>
        <RNPressable accessibilityLabel={t('common.cancel')} style={StyleSheet.absoluteFill} onPress={onCancel} />
        <View testID="theater-join-modal" style={[styles.panel, { backgroundColor: theme.colors.bgElev1, borderColor: theme.colors.line }]}>
          <View style={[styles.icon, { backgroundColor: theme.colors.accent + '22' }]}>
            <Film size={26} color={theme.colors.accent} />
          </View>
          <Text variant="subtitle" style={{ color: theme.colors.text, textAlign: 'center' }} numberOfLines={2}>
            {channelName ?? t('theater.defaultName')}
          </Text>
          <Text variant="bodySmall" color={theme.colors.text2} style={styles.copy}>
            {t('theater.joinDescription')}
          </Text>

          <View style={[styles.watchers, { borderColor: theme.colors.lineSoft }]}>
            {watchers.length > 0 ? (
              <>
                <Text variant="caption" color={theme.colors.text3} style={styles.watchersTitle}>
                  {t('theater.watchingNow', { count: watchers.length })}
                </Text>
                <ScrollView style={styles.watcherList} contentContainerStyle={{ gap: 8 }}>
                  {watchers.map((watcher) => (
                    <View key={watcher.userId} style={styles.watcherRow}>
                      <Avatar username={watcher.username} uri={watcher.avatar ?? null} baseUrl={avatarBaseUrl} size={28} showStatus={false} />
                      <Text variant="bodySmall" numberOfLines={1} style={{ flex: 1, color: watcher.roleColor ?? theme.colors.text }}>
                        {watcher.username}
                      </Text>
                    </View>
                  ))}
                </ScrollView>
              </>
            ) : (
              <Text variant="bodySmall" color={theme.colors.text3} style={{ textAlign: 'center' }}>
                {t('theater.nobodyWatching')}
              </Text>
            )}
          </View>

          {!!switchingFrom && (
            <Text variant="caption" color={theme.colors.warning} style={styles.copy}>
              {t('theater.switchTheater', { name: switchingFrom })}
            </Text>
          )}
          {failed && (
            <Text accessibilityRole="alert" variant="caption" color={theme.colors.danger} style={styles.copy}>
              {t('theater.joinFailed')}
            </Text>
          )}

          <View style={styles.actions}>
            <Pressable onPress={onCancel} style={[styles.button, { backgroundColor: theme.colors.bgElev2 }]}>
              <Text variant="body" style={{ color: theme.colors.text, fontWeight: '600' }}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable haptic disabled={joining} onPress={join} style={[styles.button, { backgroundColor: theme.colors.accent, opacity: joining ? 0.7 : 1 }]}>
              {joining ? <ActivityIndicator accessibilityLabel={t('theater.joining')} color="#fff" /> : (
                <Text variant="body" style={{ color: '#fff', fontWeight: '700' }}>{t('theater.join')}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** Renders the join modal for whichever theater a channel list asked about. */
export function TheaterJoinPromptHost() {
  const router = useRouter();
  const prompt = useUIStore((s) => s.theaterPrompt);
  const setTheaterPrompt = useUIStore((s) => s.setTheaterPrompt);
  const close = useCallback(() => setTheaterPrompt(null), [setTheaterPrompt]);
  const onJoined = useCallback(() => {
    if (!prompt) return;
    setTheaterPrompt(null);
    router.replace({ pathname: '/server/[serverId]/theater/[channelId]', params: { serverId: prompt.serverId, channelId: prompt.channelId } });
  }, [prompt, router, setTheaterPrompt]);
  if (!prompt) return null;
  return (
    <TheaterJoinModal key={`${prompt.serverId}:${prompt.channelId}`} serverId={prompt.serverId} channelId={prompt.channelId}
      channelName={prompt.channelName} onCancel={close} onJoined={onJoined} />
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.52)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  panel: { width: '100%', maxWidth: 400, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, padding: 20, alignItems: 'center', gap: 10 },
  icon: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  copy: { textAlign: 'center' },
  watchers: { alignSelf: 'stretch', borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 12, marginVertical: 4 },
  watchersTitle: { textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 },
  watcherList: { maxHeight: 180 },
  watcherRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  actions: { flexDirection: 'row', gap: 10, alignSelf: 'stretch', marginTop: 6 },
  button: { flex: 1, minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
