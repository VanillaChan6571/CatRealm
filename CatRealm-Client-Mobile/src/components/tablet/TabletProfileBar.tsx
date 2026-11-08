/**
 * Desktop-style profile bar for the tablet left column (desktop: UserProfileBar).
 * Shows who you are and your status, the voice controls while connected, and
 * Settings. Tapping the name opens your profile, as the phone's floating pill does.
 * Your banner fills the bar behind a scrim of the theme's background, as it fills the phone's pill.
 */

import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Headphones,
  HeadphoneOff,
  Mic,
  MicOff,
  PhoneOff,
  Settings,
  Volume2,
} from 'lucide-react-native';
import { useTheme } from '@/theme';
import { Avatar } from '@/components/Avatar';
import { FadeInImage } from '@/components/FadeInImage';
import { Pressable } from '@/components/Pressable';
import { Text } from '@/components/Text';
import { TourAnchor } from '@/components/TourAnchor';
import { AUTH_BASE } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { useVoiceStore } from '@/stores/voiceStore';
import type { UserStatus } from '@/types';

function resolveMediaUrl(path?: string | null): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return AUTH_BASE.replace(/\/$/, '') + (path.startsWith('/') ? path : '/' + path);
}

function statusKey(status?: UserStatus | null): string {
  if (status === 'away') return 'status.away';
  if (status === 'sleeping') return 'status.sleeping';
  if (status === 'invisible') return 'status.invisible';
  return 'status.online';
}

export function TabletProfileBar() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);

  const voiceChannelId = useVoiceStore((s) => s.channelId);
  const voiceChannelName = useVoiceStore((s) => s.channelName);
  const selfMicEnabled = useVoiceStore((s) => s.selfMicEnabled);
  const selfDeafened = useVoiceStore((s) => s.selfDeafened);
  const toggleMute = useVoiceStore((s) => s.toggleMute);
  const toggleDeafen = useVoiceStore((s) => s.toggleDeafen);
  const leaveChannel = useVoiceStore((s) => s.leaveChannel);

  const displayName = user?.displayName?.trim() || user?.username || t('tabs.you');
  const subtitle = user?.customStatusText?.trim() || t(statusKey(user?.status));
  const inVoice = !!voiceChannelId;
  const bannerUri = resolveMediaUrl(user?.banner);
  // Lifts the name and status off busy banners.
  const textOverBanner = {
    textShadowColor: theme.colors.bgDeepest,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  };

  const iconButton = (label: string, onPress: () => void, icon: ReactNode, danger = false) => (
    <Pressable
      haptic
      minHit={36}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[
        styles.iconBtn,
        { borderRadius: theme.radius.md },
        danger && { backgroundColor: theme.colors.danger },
      ]}
    >
      {icon}
    </Pressable>
  );

  return (
    <View
      style={[
        styles.wrap,
        {
          backgroundColor: theme.colors.bgDeepest,
          borderTopColor: theme.colors.lineSoft,
          paddingBottom: Math.max(insets.bottom, 10),
        },
      ]}
    >
      {bannerUri ? (
        <>
          <FadeInImage uri={bannerUri} mark={false} style={StyleSheet.absoluteFill} />
          {/* Keeps the name, status and buttons readable over any banner. */}
          <View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { backgroundColor: `${theme.colors.bgDeepest}A6` }]}
          />
        </>
      ) : null}
      {inVoice ? (
        <View style={[styles.voiceRow, { borderBottomColor: theme.colors.lineSoft }]}>
          <Volume2 size={16} color={theme.colors.online} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="caption" color={theme.colors.online} weight="600">
              {t('tablet.voiceConnected')}
            </Text>
            <Text variant="caption" color={theme.colors.text3} numberOfLines={1}>
              {voiceChannelName ?? voiceChannelId}
            </Text>
          </View>
          {iconButton(
            t('tablet.disconnect'),
            leaveChannel,
            <PhoneOff size={16} color="#fff" />,
            true,
          )}
        </View>
      ) : null}

      <View style={styles.row}>
        <TourAnchor name="dock-me" style={{ flex: 1, minWidth: 0 }}>
          <Pressable
            haptic
            accessibilityRole="button"
            accessibilityLabel={t('tabs.you')}
            onPress={() => router.replace('/(app)/(tabs)/me')}
            style={[styles.identity, { borderRadius: theme.radius.md }]}
          >
            <Avatar
              username={user?.username ?? t('tabs.you')}
              uri={resolveMediaUrl(user?.avatar) ?? user?.avatar ?? null}
              size={36}
              status={user?.status ?? 'online'}
            />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                variant="bodySmall"
                weight="600"
                numberOfLines={1}
                style={bannerUri ? textOverBanner : undefined}
              >
                {displayName}
              </Text>
              <Text
                variant="caption"
                color={bannerUri ? theme.colors.text2 : theme.colors.text3}
                numberOfLines={1}
                style={bannerUri ? textOverBanner : undefined}
              >
                {subtitle}
              </Text>
            </View>
          </Pressable>
        </TourAnchor>

        {inVoice
          ? iconButton(
              selfMicEnabled ? t('tablet.mute') : t('tablet.unmute'),
              () => void toggleMute(),
              selfMicEnabled ? (
                <Mic size={18} color={theme.colors.text2} />
              ) : (
                <MicOff size={18} color={theme.colors.danger} />
              ),
            )
          : null}
        {inVoice
          ? iconButton(
              selfDeafened ? t('tablet.undeafen') : t('tablet.deafen'),
              toggleDeafen,
              selfDeafened ? (
                <HeadphoneOff size={18} color={theme.colors.danger} />
              ) : (
                <Headphones size={18} color={theme.colors.text2} />
              ),
            )
          : null}
        {iconButton(
          t('tablet.settings'),
          () => router.push('/settings'),
          <Settings size={18} color={theme.colors.text2} />,
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    paddingTop: 8,
  },
  voiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 6,
    paddingBottom: 8,
    marginBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 10,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  iconBtn: {
    width: 36,
    height: 36,
  },
});
