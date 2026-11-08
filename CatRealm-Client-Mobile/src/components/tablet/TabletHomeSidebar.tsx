/**
 * Tablet home sidebar (desktop: HomeNav). Primary destinations at the top, then
 * your direct messages or group chats, so a conversation is one tap away from
 * anywhere outside a realm.
 */

import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Bell, Cat, MessageCircle, NotebookPen, Users } from 'lucide-react-native';
import { useTheme } from '@/theme';
import { Avatar } from '@/components/Avatar';
import { Pressable } from '@/components/Pressable';
import { Text } from '@/components/Text';
import { TourAnchor } from '@/components/TourAnchor';
import { useAuthStore } from '@/stores/authStore';
import { useDMStore } from '@/stores/dmStore';
import { useDmPinStore } from '@/stores/dmPinStore';
import { useFriendStore } from '@/stores/friendStore';
import { useGroupChatStore } from '@/stores/groupChatStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { usePresenceStore } from '@/stores/presenceStore';
import { isIncomingRequest } from '@/lib/dmRequests';
import { goToHubTab, type HubTabHref } from '@/lib/hubNavigation';

type NavItem = {
  key: string;
  label: string;
  icon: ComponentType<{ size?: number; color?: string }>;
  href: '/(app)/(tabs)/home' | '/(app)/(tabs)/discover' | '/(app)/(tabs)/chats' | '/(app)/(tabs)/servers' | '/notes';
  active: boolean;
  badge?: number;
  anchor?: string;
  push?: boolean;
};

function Badge({ count }: { count: number }) {
  const theme = useTheme();
  if (count <= 0) return null;
  return (
    <View style={[styles.badge, { backgroundColor: theme.colors.danger }]}>
      <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
    </View>
  );
}

export function TabletHomeSidebar() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const [listTab, setListTab] = useState<'dms' | 'groups'>('dms');

  const serverUrl = useAuthStore((s) => s.serverUrl);
  const conversations = useDMStore((s) => s.conversations);
  const fetchConversations = useDMStore((s) => s.fetchConversations);
  const groups = useGroupChatStore((s) => s.groups);
  const fetchGroups = useGroupChatStore((s) => s.fetchGroups);
  const presence = usePresenceStore((s) => s.centralByUserId);
  const pinnedDms = useDmPinStore((s) => s.pinnedDms);
  const pinnedIds = useDmPinStore((s) => s.pinnedIds);
  const hydratePins = useDmPinStore((s) => s.hydrate);
  const incomingFriendRequests = useFriendStore((s) => s.incoming.length);
  const unreadNotifications = useNotificationStore((s) => s.summary?.totalUnread ?? 0);

  useEffect(() => {
    void fetchConversations();
    void fetchGroups();
    void hydratePins();
  }, [fetchConversations, fetchGroups, hydratePins]);

  // Same order as the Chats tab: pins first, then recency. Requests stay on Chats.
  const directMessages = useMemo(() => {
    const accepted = conversations.filter((c) => !isIncomingRequest(c));
    if (pinnedIds.size === 0) return accepted;
    const pinRank = new Map(pinnedDms.map((p, i) => [p.otherUserId, i]));
    const pinned = accepted
      .filter((c) => pinnedIds.has(c.otherUserId))
      .sort((a, b) => (pinRank.get(a.otherUserId) ?? 0) - (pinRank.get(b.otherUserId) ?? 0));
    return [...pinned, ...accepted.filter((c) => !pinnedIds.has(c.otherUserId))];
  }, [conversations, pinnedDms, pinnedIds]);

  const unreadDMs = conversations.reduce((sum, c) => sum + (c.unreadCount ?? 0), 0);
  const unreadGroups = groups.reduce((sum, g) => sum + (g.unreadCount ?? 0), 0);

  const navItems: NavItem[] = [
    {
      key: 'friends',
      label: t('tablet.friends'),
      icon: Users,
      href: '/(app)/(tabs)/home',
      active: pathname === '/home' || pathname === '/',
      badge: incomingFriendRequests,
    },
    {
      key: 'notifications',
      label: t('tabs.notifications'),
      icon: Bell,
      href: '/(app)/(tabs)/discover',
      active: pathname.startsWith('/discover'),
      badge: unreadNotifications,
    },
    {
      key: 'chats',
      label: t('tabs.chats'),
      icon: MessageCircle,
      href: '/(app)/(tabs)/chats',
      active: pathname.startsWith('/chats'),
      badge: unreadDMs + unreadGroups,
      anchor: 'dock-chats',
    },
    {
      key: 'notes',
      label: t('tablet.notes'),
      icon: NotebookPen,
      href: '/notes',
      active: pathname.startsWith('/notes'),
      push: true,
    },
    {
      key: 'realms',
      label: t('tablet.manageRealms'),
      icon: Cat,
      href: '/(app)/(tabs)/servers',
      active: pathname.startsWith('/servers'),
    },
  ];

  const resolveGroupAvatar = (path?: string | null) => {
    if (!path) return undefined;
    if (path.startsWith('http')) return path;
    const base = serverUrl?.replace(/\/$/, '') ?? '';
    return base + (path.startsWith('/') ? path : '/' + path);
  };

  // Switching between conversations replaces the open one, as picking a DM does on
  // desktop, so Back doesn't walk through every conversation you looked at.
  const inConversation = pathname.startsWith('/dm/') || pathname.startsWith('/group/');
  // A conversation takes a moment to mount; ignore further taps until the route
  // changes, or a second tap pushes a duplicate screen on top.
  const [opening, setOpening] = useState(false);
  useEffect(() => setOpening(false), [pathname]);
  useEffect(() => {
    if (!opening) return;
    const timer = setTimeout(() => setOpening(false), 3000);
    return () => clearTimeout(timer);
  }, [opening]);
  const openConversation = (href: Parameters<typeof router.push>[0]) => {
    if (opening) return;
    setOpening(true);
    if (inConversation) router.replace(href);
    else router.push(href);
  };

  const rowStyle = (active: boolean) => [
    styles.row,
    { borderRadius: theme.radius.md },
    active && { backgroundColor: theme.colors.accentSoft },
  ];

  return (
    <View style={[styles.root, { paddingTop: Math.max(insets.top, 10) }]}>
      <View style={styles.nav}>
        {navItems.map((item) => {
          const Icon = item.icon;
          const color = item.active ? theme.colors.text : theme.colors.text2;
          const row = (
            <Pressable
              key={item.key}
              haptic
              accessibilityRole="button"
              accessibilityState={{ selected: item.active }}
              // Tab screens switch tabs, or go back to the existing tabs screen from a DM.
              onPress={() => (item.push ? router.push(item.href) : goToHubTab(router, pathname, item.href as HubTabHref))}
              style={rowStyle(item.active)}
            >
              <Icon size={18} color={color} />
              <Text variant="bodySmall" weight={item.active ? '600' : '500'} color={color} style={{ flex: 1 }}>
                {item.label}
              </Text>
              <Badge count={item.badge ?? 0} />
            </Pressable>
          );
          return item.anchor ? (
            <TourAnchor key={item.key} name={item.anchor}>
              {row}
            </TourAnchor>
          ) : (
            row
          );
        })}
      </View>

      <View style={[styles.segment, { backgroundColor: theme.colors.bgElev1, borderRadius: theme.radius.md }]}>
        {(['dms', 'groups'] as const).map((tab) => {
          const selected = listTab === tab;
          return (
            <Pressable
              key={tab}
              haptic
              minHit={30}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => setListTab(tab)}
              style={[
                styles.segmentItem,
                { borderRadius: theme.radius.sm },
                selected && { backgroundColor: theme.colors.bgElev3 },
              ]}
            >
              <Text variant="caption" weight="600" color={selected ? theme.colors.text : theme.colors.text3}>
                {tab === 'dms' ? t('chats.directMessages') : t('chats.groups')}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {listTab === 'dms' ? (
        <FlatList
          data={directMessages}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <Text variant="caption" color={theme.colors.text3} style={styles.empty}>
              {t('tablet.noDirectMessages')}
            </Text>
          }
          renderItem={({ item }) => {
            const active = pathname === `/dm/${item.id}`;
            const status = presence[item.otherUserId]?.status ?? item.otherStatus ?? null;
            const unread = item.unreadCount ?? 0;
            return (
              <Pressable
                haptic
                onPress={() => {
                  if (active) return;
                  openConversation({ pathname: '/dm/[conversationId]', params: { conversationId: item.id } });
                }}
                style={rowStyle(active)}
              >
                <Avatar username={item.otherUsername} uri={item.otherAvatar} size={32} status={status} />
                <Text
                  variant="bodySmall"
                  weight={unread > 0 || active ? '600' : '400'}
                  color={unread > 0 || active ? theme.colors.text : theme.colors.text2}
                  numberOfLines={1}
                  style={{ flex: 1 }}
                >
                  {item.otherDisplayName ?? item.otherUsername}
                </Text>
                <Badge count={unread} />
              </Pressable>
            );
          }}
        />
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(g) => g.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <Text variant="caption" color={theme.colors.text3} style={styles.empty}>
              {t('chat.noGroupChats')}
            </Text>
          }
          renderItem={({ item }) => {
            const active = pathname === `/group/${item.id}`;
            const unread = item.unreadCount ?? 0;
            return (
              <Pressable
                haptic
                onPress={() => {
                  if (active) return;
                  openConversation({ pathname: '/group/[groupChatId]', params: { groupChatId: item.id } });
                }}
                style={rowStyle(active)}
              >
                <Avatar username={item.name} uri={resolveGroupAvatar(item.avatar)} size={32} />
                <Text
                  variant="bodySmall"
                  weight={unread > 0 || active ? '600' : '400'}
                  color={unread > 0 || active ? theme.colors.text : theme.colors.text2}
                  numberOfLines={1}
                  style={{ flex: 1 }}
                >
                  {item.name}
                </Text>
                <Badge count={unread} />
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: 8,
  },
  nav: {
    gap: 2,
    paddingBottom: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 10,
    minHeight: 40,
    paddingHorizontal: 10,
  },
  segment: {
    flexDirection: 'row',
    padding: 3,
    gap: 2,
    marginBottom: 6,
  },
  segmentItem: {
    flex: 1,
    paddingVertical: 5,
  },
  list: {
    gap: 2,
    paddingBottom: 12,
  },
  empty: {
    paddingHorizontal: 10,
    paddingVertical: 12,
  },
  badge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
});
