/**
 * Notifications tab — 7-day history of friend requests and DM messages.
 * Backed by notificationStore (AsyncStorage); new events are fed in via useSocket.
 */

import { SectionList, View, StyleSheet } from 'react-native';
import { SafeAreaView } from '@/components/SafeAreaView';
import { useRouter } from 'expo-router';
import { Bell, UserPlus, MessageCircle, AtSign } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { Text, Avatar, Pressable } from '@/components';
import { useFriendStore } from '@/stores/friendStore';
import { useNotificationStore } from '@/stores/notificationStore';
import type { FriendRequestNotification, DMNotification, ServerMentionNotification, NotificationItem } from '@/stores/notificationStore';
import { AUTH_BASE } from '@/lib/api';
import { dmContextPreviewText } from '@/lib/dmContext';

function resolveUrl(path?: string | null): string | null {
  if (!path) return null;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return AUTH_BASE.replace(/\/$/, '') + (path.startsWith('/') ? path : '/' + path);
}

function timeAgo(ms: number) {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// ─── Friend request row ───────────────────────────────────────────────────────

function FriendRequestRow({ notif, onAccept, onReject }: {
  notif: FriendRequestNotification;
  onAccept: () => void;
  onReject: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const avatarUri = resolveUrl(notif.fromAvatar);
  const isPending = !notif.outcome;

  return (
    <View style={[styles.row, { borderBottomColor: theme.colors.lineSoft }]}>
      <View style={styles.iconWrap}>
        <Avatar username={notif.fromUsername} uri={avatarUri} size={44} shape="circle" />
        <View style={[styles.typeBadge, { backgroundColor: theme.colors.accent }]}>
          <UserPlus color="#fff" size={10} />
        </View>
      </View>
      <View style={{ flex: 1, marginLeft: theme.spacing.md }}>
        <Text variant="subtitle" numberOfLines={1}>{notif.fromUsername}</Text>
        <Text variant="bodySmall" color={theme.colors.text3}>
          {notif.outcome === 'accepted'
            ? t('notifications.friendRequestAccepted')
            : notif.outcome === 'rejected'
            ? t('notifications.friendRequestRejected')
            : t('notifications.sentFriendRequest')}
          {'  ·  '}{timeAgo(notif.timestamp)}
        </Text>
      </View>
      {isPending && (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable
            haptic
            onPress={onAccept}
            style={[styles.btn, { backgroundColor: theme.colors.accent, borderRadius: theme.radius.sm }]}
          >
            <Text variant="caption" color={theme.colors.textOnAccent}>{t('home.requestAccept')}</Text>
          </Pressable>
          <Pressable
            haptic
            onPress={onReject}
            style={[styles.btn, { backgroundColor: theme.colors.bgElev2, borderRadius: theme.radius.sm }]}
          >
            <Text variant="caption" color={theme.colors.text2}>{t('home.requestReject')}</Text>
          </Pressable>
        </View>
      )}
      {notif.outcome === 'accepted' && (
        <View style={[styles.outcomeChip, { backgroundColor: theme.colors.accent + '22' }]}>
          <Text variant="caption" color={theme.colors.accent}>{t('notifications.accepted')}</Text>
        </View>
      )}
      {notif.outcome === 'rejected' && (
        <View style={[styles.outcomeChip, { backgroundColor: theme.colors.bgElev2 }]}>
          <Text variant="caption" color={theme.colors.text3}>{t('notifications.rejected')}</Text>
        </View>
      )}
    </View>
  );
}

// ─── DM notification row ──────────────────────────────────────────────────────

function DMNotifRow({ notif, onPress }: { notif: DMNotification; onPress: () => void }) {
  const theme = useTheme();
  const { t } = useTranslation();

  return (
    <Pressable
      haptic
      onPress={onPress}
      style={[styles.row, { borderBottomColor: theme.colors.lineSoft }]}
    >
      <View style={styles.iconWrap}>
        <Avatar username={notif.otherUsername} uri={resolveUrl(notif.otherAvatar)} size={44} />
        <View style={[styles.typeBadge, { backgroundColor: theme.colors.text3 }]}>
          <MessageCircle color="#fff" size={10} />
        </View>
      </View>
      <View style={{ flex: 1, marginLeft: theme.spacing.md }}>
        <Text variant="subtitle" numberOfLines={1}>
          {notif.otherDisplayName ?? notif.otherUsername}
        </Text>
        <Text variant="bodySmall" color={theme.colors.text3}>
          {(notif.localPreviewText ? dmContextPreviewText(notif.localPreviewText) : null) ?? (notif.count > 1 ? t('notifications.newMessages', { count: notif.count }) : t('notifications.sentMessage'))}
          {'  ·  '}{timeAgo(notif.timestamp)}
        </Text>
      </View>
      {!notif.read && notif.count > 0 && (
        <View
          style={{
            minWidth: 22,
            height: 22,
            paddingHorizontal: 7,
            borderRadius: 11,
            backgroundColor: theme.colors.accent,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text variant="caption" color={theme.colors.textOnAccent}>{notif.count}</Text>
        </View>
      )}
    </Pressable>
  );
}

function ServerMentionRow({ notif, onPress }: { notif: ServerMentionNotification; onPress: () => void }) {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <Pressable haptic onPress={onPress} style={[styles.row, { borderBottomColor: theme.colors.lineSoft }]}>
      <View style={styles.iconWrap}>
        <View style={[styles.mentionAvatar, { backgroundColor: theme.colors.bgElev2 }]}>
          <AtSign color={theme.colors.accent} size={20} />
        </View>
      </View>
      <View style={{ flex: 1, marginLeft: theme.spacing.md }}>
        <Text variant="subtitle" numberOfLines={1}>
          {t('notifications.mentionedYou', { sender: notif.senderUsername ?? t('notifications.someone') })}
        </Text>
        <Text variant="bodySmall" color={theme.colors.text3} numberOfLines={1}>
          {notif.channelName ? `#${notif.channelName}` : t('notifications.realmChannel')}
          {'  ·  '}{timeAgo(notif.timestamp)}
        </Text>
      </View>
    </Pressable>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: theme.spacing.lg,
        paddingTop: theme.spacing.md,
        paddingBottom: theme.spacing.xs,
        backgroundColor: theme.colors.bgApp,
      }}
    >
      <Text variant="caption" color={theme.colors.text3} style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>
        {title}
      </Text>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function NotificationsTab() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();

  const acceptRequest = useFriendStore((s) => s.acceptRequest);
  const rejectRequest = useFriendStore((s) => s.rejectRequest);

  const items = useNotificationStore((s) => s.items);
  const resolveFriendRequest = useNotificationStore((s) => s.resolveFriendRequest);
  const markDMRead = useNotificationStore((s) => s.markDMRead);
  const clear = useNotificationStore((s) => s.clear);

  const friendRequests = items.filter((n): n is FriendRequestNotification => n.type === 'friend_request');
  const dmNotifs = items.filter((n): n is DMNotification => n.type === 'dm_message');
  const mentionNotifs = items.filter((n): n is ServerMentionNotification => n.type === 'server_mention');

  type Section = { key: 'requests' | 'dms' | 'mentions'; title: string; data: NotificationItem[] };

  const sections: Section[] = [];
  if (friendRequests.length > 0) sections.push({ key: 'requests', title: t('notifications.sectionFriendRequests'), data: friendRequests });
  if (dmNotifs.length > 0) sections.push({ key: 'dms', title: t('notifications.sectionDirectMessages'), data: dmNotifs });
  if (mentionNotifs.length > 0) sections.push({ key: 'mentions', title: t('notifications.sectionMentions'), data: mentionNotifs });

  const isEmpty = sections.length === 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bgApp }} edges={['top']}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.md,
          paddingBottom: theme.spacing.sm,
        }}
      >
        <Text variant="display" style={{ flex: 1 }}>{t('tabs.notifications')}</Text>
        {!isEmpty && (
          <Pressable haptic onPress={() => void clear()}>
            <Text variant="bodySmall" color={theme.colors.text3}>{t('tabs.clearAll')}</Text>
          </Pressable>
        )}
      </View>

      {isEmpty ? (
        <View style={styles.empty}>
          <Bell color={theme.colors.text3} size={48} strokeWidth={1.5} />
          <Text variant="body" color={theme.colors.text3} style={{ marginTop: theme.spacing.md }}>
            {t('notifications.allCaughtUp')}
          </Text>
          <Text variant="bodySmall" color={theme.colors.text3} style={{ marginTop: 4 }}>
            {t('notifications.keptFor7Days')}
          </Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderSectionHeader={({ section }) => <SectionHeader title={section.title} />}
          renderItem={({ item, section }) => {
            if (section.key === 'requests') {
              const notif = item as FriendRequestNotification;
              return (
                <FriendRequestRow
                  notif={notif}
                  onAccept={async () => {
                    await acceptRequest(notif.requestId);
                    resolveFriendRequest(notif.requestId, 'accepted');
                  }}
                  onReject={async () => {
                    await rejectRequest(notif.requestId);
                    resolveFriendRequest(notif.requestId, 'rejected');
                  }}
                />
              );
            }
            if (item.type === 'server_mention') {
              const notif = item as ServerMentionNotification;
              return (
                <ServerMentionRow
                  notif={notif}
                  onPress={() => {
                    router.push({
                      pathname: '/server/[serverId]/channel/[channelId]',
                      params: { serverId: notif.serverId, channelId: notif.channelId },
                    });
                  }}
                />
              );
            }
            const notif = item as DMNotification;
            return (
              <DMNotifRow
                notif={notif}
                onPress={() => {
                  void markDMRead(notif.conversationId);
                  router.push({ pathname: '/dm/[conversationId]', params: { conversationId: notif.conversationId } });
                }}
              />
            );
          }}
          contentContainerStyle={{ paddingBottom: 24 }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconWrap: {
    position: 'relative',
  },
  typeBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mentionAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  outcomeChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 80,
  },
});
