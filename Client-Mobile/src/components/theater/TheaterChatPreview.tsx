import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/Text';
import { Avatar } from '@/components/Avatar';
import { useAppForeground } from '@/hooks/useAppForeground';
import { useAuthStore } from '@/stores/authStore';
import { useBlockedUsersStore } from '@/stores/blockedUsersStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { THEATER_CHAT_PREVIEW_MS, useTheaterChatPreviewStore } from '@/stores/theaterChatPreviewStore';

interface Props {
  channelId: string;
  serverId: string;
  top: number;
  right: number;
  maxWidth: number;
  onOpenChat: () => void;
}

export function TheaterChatPreview({ channelId, serverId, top, right, maxWidth, onOpenChat }: Props) {
  const { t } = useTranslation();
  const preview = useTheaterChatPreviewStore((s) => s.preview);
  const clear = useTheaterChatPreviewStore((s) => s.clear);
  const enabled = useSettingsStore((s) => s.theaterChatPreviews);
  const accountId = useAuthStore((s) => s.user?.id);
  const blockedUsers = useBlockedUsersStore((s) => s.blockedUsers);
  const foreground = useAppForeground();
  const opacity = useRef(new Animated.Value(0)).current;
  const visible = preview && enabled && foreground && preview.channelId === channelId
    && preview.serverId === serverId && preview.accountId === accountId && !blockedUsers.has(preview.userId)
    ? preview : null;

  useEffect(() => () => clear(), [clear]);
  useEffect(() => {
    if (!visible) {
      if (preview) clear();
      return;
    }
    opacity.setValue(0);
    let transition = Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true });
    transition.start();
    const timer = setTimeout(() => {
      transition.stop();
      transition = Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true });
      transition.start(({ finished }) => {
        if (finished && useTheaterChatPreviewStore.getState().preview === visible) clear();
      });
    }, Math.max(0, THEATER_CHAT_PREVIEW_MS - (Date.now() - visible.receivedAt)));
    return () => { clearTimeout(timer); transition.stop(); };
  }, [clear, opacity, preview, visible]);

  if (!visible) return null;
  return (
    <Animated.View testID="theater-chat-preview" style={[styles.bubble, { top, right, maxWidth, opacity }]}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${t('theater.openChat')}: ${visible.name}. ${visible.text || t(`theater.${visible.fallback}`)}`}
        onPress={(event) => { event.stopPropagation(); clear(); onOpenChat(); }} style={styles.content}>
        <Avatar username={visible.name} uri={visible.avatar} baseUrl={visible.serverUrl}
          size={32} showStatus={false} style={styles.avatar} />
        <Animated.View style={styles.message}>
          <Text numberOfLines={1} style={styles.name}>{visible.name || t('theater.newChatMessage')}</Text>
          <Text numberOfLines={2} style={styles.text}>{visible.text || t(`theater.${visible.fallback}`)}</Text>
        </Animated.View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bubble: { position: 'absolute', zIndex: 5, backgroundColor: 'rgba(20, 16, 32, 0.88)', borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.3)' },
  content: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, minHeight: 48 },
  avatar: { flexShrink: 0 },
  message: { flexShrink: 1, minWidth: 0, gap: 3 },
  name: { color: '#fff', fontWeight: '700' },
  text: { color: '#fff', fontSize: 13 },
});
