/**
 * Chats tab — DMs + group chats merged into one inbox with a pill tab switcher.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from '@/components/SafeAreaView';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pin } from 'lucide-react-native';
import { useTheme } from '@/theme';
import { Text, Avatar, Pressable } from '@/components';
import { useDMStore } from '@/stores/dmStore';
import { useGroupChatStore } from '@/stores/groupChatStore';
import { useAuthStore } from '@/stores/authStore';
import { usePresenceStore } from '@/stores/presenceStore';
import { useDmPinStore } from '@/stores/dmPinStore';
import { isIncomingRequest } from '@/lib/dmRequests';

function timeAgo(ms: number) {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

type Tab = 'dms' | 'groups' | 'requests';

export default function ChatsTab() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('dms');
  const serverUrl = useAuthStore((s) => s.serverUrl);

  const conversations = useDMStore((s) => s.conversations);
  const fetchConversations = useDMStore((s) => s.fetchConversations);
  const presence = usePresenceStore((s) => s.centralByUserId);
  const groups = useGroupChatStore((s) => s.groups);
  const fetchGroups = useGroupChatStore((s) => s.fetchGroups);

  const pinnedDms = useDmPinStore((s) => s.pinnedDms);
  const pinnedIds = useDmPinStore((s) => s.pinnedIds);
  const togglePin = useDmPinStore((s) => s.togglePin);
  const hydratePins = useDmPinStore((s) => s.hydrate);

  useEffect(() => {
    void fetchConversations();
    void fetchGroups();
    void hydratePins();
  }, [fetchConversations, fetchGroups, hydratePins]);

  // Pinned conversations float to the top, in pin order; the rest keep their
  // recency order.
  const orderedConversations = useMemo(() => {
    if (pinnedIds.size === 0) return conversations;
    const pinRank = new Map(pinnedDms.map((p, i) => [p.otherUserId, i]));
    const pinned = conversations.filter((c) => pinnedIds.has(c.otherUserId));
    const rest = conversations.filter((c) => !pinnedIds.has(c.otherUserId));
    pinned.sort((a, b) => (pinRank.get(a.otherUserId) ?? 0) - (pinRank.get(b.otherUserId) ?? 0));
    return [...pinned, ...rest];
  }, [conversations, pinnedDms, pinnedIds]);

  const promptTogglePin = useCallback((conversation: typeof conversations[number]) => {
    const name = conversation.otherDisplayName ?? conversation.otherUsername;
    const pinned = pinnedIds.has(conversation.otherUserId);
    Alert.alert(
      name,
      pinned ? t('chats.unpinPrompt') : t('chats.pinPrompt'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: pinned ? t('chats.unpin') : t('chats.pin'),
          onPress: () => togglePin({
            otherUserId: conversation.otherUserId,
            username: conversation.otherUsername,
            avatar: conversation.otherAvatar,
          }),
        },
      ],
    );
  }, [pinnedIds, t, togglePin]);

  const resolveGroupAvatarUri = useCallback((avatarPath: string | null | undefined): string | undefined => {
    if (!avatarPath) return undefined;
    if (avatarPath.startsWith('http')) return avatarPath;
    const base = serverUrl?.replace(/\/$/, '') ?? '';
    return base + (avatarPath.startsWith('/') ? avatarPath : '/' + avatarPath);
  }, [serverUrl]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bgApp }} edges={['top']}>
      <View style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.md }}>
        <Text variant="display">{t('tabs.chats')}</Text>
        {/* Tab switcher */}
        <View style={[styles.tabRow, { backgroundColor: theme.colors.bgElev1, borderRadius: theme.radius.xl }]}>
          <Pressable
            haptic
            onPress={() => setTab('dms')}
            style={[
              styles.tabPill,
              tab === 'dms' && { backgroundColor: theme.colors.accent, borderRadius: theme.radius.xl - 2 },
            ]}
          >
            <Text
              variant="bodySmall"
              style={{ fontWeight: '600' }}
              color={tab === 'dms' ? theme.colors.textOnAccent : theme.colors.text3}
            >
              {t('chats.directMessages')}
            </Text>
          </Pressable>
          <Pressable
            haptic
            onPress={() => setTab('groups')}
            style={[
              styles.tabPill,
              tab === 'groups' && { backgroundColor: theme.colors.accent, borderRadius: theme.radius.xl - 2 },
            ]}
          >
            <Text
              variant="bodySmall"
              style={{ fontWeight: '600' }}
              color={tab === 'groups' ? theme.colors.textOnAccent : theme.colors.text3}
            >
              {t('chats.groups')}
            </Text>
          </Pressable>
        </View>
      </View>

      <Pressable onPress={() => setTab(tab === 'requests' ? 'dms' : 'requests')} style={{ padding: 16 }}>
        <Text color={theme.colors.accent}>{tab === 'requests' ? 'Back to messages' : `Message requests (${conversations.filter((c) => c.requestState === 'pending').length})`}</Text>
      </Pressable>
      {tab !== 'groups' ? (
        <FlatList
          data={orderedConversations.filter((c) => isIncomingRequest(c) === (tab === 'requests'))}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingTop: 8 }}
          ItemSeparatorComponent={() => (
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.lineSoft, marginLeft: 72 }} />
          )}
          renderItem={({ item }) => {
            const status = presence[item.otherUserId]?.status ?? item.otherStatus ?? null;
            const pinned = pinnedIds.has(item.otherUserId);
            return (
              <Pressable
                haptic
                onPress={() =>
                  router.push({ pathname: '/dm/[conversationId]', params: { conversationId: item.id } })
                }
                onLongPress={() => promptTogglePin(item)}
                style={[styles.row, pinned && { backgroundColor: theme.colors.bgElev1 }]}
              >
                <Pressable haptic onPress={(event) => { event.stopPropagation(); router.push({ pathname: '/profile/[userId]', params: { userId: item.otherUserId, context: 'central' } }); }}>
                  <Avatar username={item.otherUsername} uri={item.otherAvatar} size={48} status={status} />
                </Pressable>
                <View style={{ flex: 1 }}>
                  <Text variant="subtitle" numberOfLines={1}>
                    {item.otherDisplayName ?? item.otherUsername}
                  </Text>
                  <Text variant="bodySmall" color={theme.colors.text3} numberOfLines={1}>
                    {item.lastMessageAt ? `${timeAgo(item.lastMessageAt)} ${t('chats.ago')}` : t('chats.noMessages')}
                  </Text>
                </View>
                {pinned && (
                  <Pin size={14} color={theme.colors.text3} />
                )}
                {item.unreadCount > 0 && (
                  <View style={[styles.badge, { backgroundColor: theme.colors.accent }]}>
                    <Text variant="caption" color={theme.colors.textOnAccent}>{item.unreadCount}</Text>
                  </View>
                )}
              </Pressable>
            );
          }}
        />
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingTop: 8 }}
          ListEmptyComponent={
            <View style={{ padding: 32, alignItems: 'center' }}>
              <Text variant="bodySmall" color={theme.colors.text3}>{t('chat.noGroupChats')}</Text>
            </View>
          }
          ItemSeparatorComponent={() => (
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.lineSoft, marginLeft: 72 }} />
          )}
          renderItem={({ item }) => (
            <Pressable
              haptic
              onPress={() =>
                router.push({ pathname: '/group/[groupChatId]', params: { groupChatId: item.id } })
              }
              style={styles.row}
            >
              <Avatar
                username={item.name}
                uri={resolveGroupAvatarUri(item.avatar)}
                size={48}
              />
              <View style={{ flex: 1 }}>
                <Text variant="subtitle" numberOfLines={1}>{item.name}</Text>
                <Text variant="bodySmall" color={theme.colors.text3} numberOfLines={1}>
                  {t('chats.memberCount', { count: item.memberCount })}
                  {item.lastMessageAt ? ` · ${timeAgo(item.lastMessageAt)} ${t('chats.ago')}` : ''}
                </Text>
              </View>
              {item.unreadCount > 0 && (
                <View style={[styles.badge, { backgroundColor: theme.colors.accent }]}>
                  <Text variant="caption" color={theme.colors.textOnAccent}>{item.unreadCount}</Text>
                </View>
              )}
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  tabRow: {
    flexDirection: 'row',
    marginTop: 12,
    padding: 3,
    gap: 2,
  },
  tabPill: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  badge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 7,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
