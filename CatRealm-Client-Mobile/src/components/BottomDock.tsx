import { useEffect, useRef, useState } from 'react';
import { Keyboard, StyleSheet, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import { Bell, Cat, Home, MessageCircle } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';
import { DOCK_HEIGHT, dockBottomInset } from '@/lib/dockLayout';
import { Avatar } from './Avatar';
import { Pressable } from './Pressable';
import { Text } from './Text';
import { TourAnchor } from './TourAnchor';
import { useChannelStore } from '@/stores/channelStore';
import { useAuthStore } from '@/stores/authStore';
import { useServerStore } from '@/stores/serverStore';
import { useUIStore } from '@/stores/uiStore';
import { useDeviceLayout } from '@/hooks/useDeviceLayout';
import { useTheaterStore } from '@/stores/theaterStore';
import { useDMStore } from '@/stores/dmStore';
import { useGroupChatStore } from '@/stores/groupChatStore';
import { useFriendStore } from '@/stores/friendStore';
import { useNotificationStore } from '@/stores/notificationStore';

type DockItem = {
  id: 'home' | 'servers' | 'chats' | 'discover' | 'me';
  labelKey: string;
  route: Href;
  Icon: typeof Home;
};

const ITEMS: DockItem[] = [
  { id: 'home', labelKey: 'tabs.home', route: '/(app)/(tabs)/home', Icon: Home },
  { id: 'servers', labelKey: 'tabs.servers', route: '/(app)/(tabs)/servers', Icon: Cat },
  { id: 'chats', labelKey: 'tabs.chats', route: '/(app)/(tabs)/chats', Icon: MessageCircle },
  { id: 'discover', labelKey: 'tabs.notifications', route: '/(app)/(tabs)/discover', Icon: Bell },
  { id: 'me', labelKey: 'tabs.you', route: '/(app)/(tabs)/me', Icon: Home },
];

function activeItem(pathname: string): DockItem['id'] {
  if (pathname.startsWith('/server/')) return 'servers';
  if (pathname.startsWith('/dm/') || pathname.startsWith('/group/')) return 'chats';
  if (pathname.startsWith('/discover')) return 'discover';
  if (pathname.startsWith('/me') || pathname.startsWith('/profile') || pathname.startsWith('/settings')) {
    return 'me';
  }
  return 'home';
}

export function BottomDock() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const { isTablet } = useDeviceLayout();
  const lastTap = useRef<Record<string, number>>({});
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const selfUser = useAuthStore((s) => s.user);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const lastChannelByServer = useChannelStore((s) => s.lastChannelByServer);
  const setServerDrawerOpen = useUIStore((s) => s.setServerDrawerOpen);
  const toggleServerDrawer = useUIStore((s) => s.toggleServerDrawer);
  const profileEditMode = useUIStore((s) => s.profileEditMode);
  const theaterFullscreen = useTheaterStore((s) => s.overlayMode === 'expanded' && s.focused);
  // Badge counts; selectors return numbers so unrelated store updates don't re-render the dock.
  const badges: Record<DockItem['id'], number> = {
    home: useFriendStore((s) => s.incoming.length),
    servers: useServerStore((s) => s.servers.reduce((sum, server) => sum + (server.mention || 0), 0)),
    chats: useDMStore((s) => s.conversations.reduce((sum, c) => sum + (c.unreadCount ?? 0), 0))
      + useGroupChatStore((s) => s.groups.reduce((sum, g) => sum + (g.unreadCount ?? 0), 0)),
    discover: useNotificationStore((s) => s.summary?.totalUnread ?? 0),
    me: 0,
  };

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  if (keyboardVisible || profileEditMode || (pathname.includes('/theater/') && theaterFullscreen)) return null;

  const active = activeItem(pathname);
  if (pathname.startsWith('/profile/') || pathname.startsWith('/settings')) return null;

  const handlePress = (item: DockItem) => {
    if (item.id === 'servers') {
      const inServerRoute = pathname.startsWith('/server/');
      const openServersSurface = () => {
        if (isTablet) {
          if (inServerRoute) {
            setServerDrawerOpen(true);
          } else {
            router.replace('/(app)/(tabs)/servers');
          }
          return;
        }
        setServerDrawerOpen(true);
      };

      const now = Date.now();
      const prev = lastTap.current.servers ?? 0;
      lastTap.current.servers = now;
      if (now - prev < 350) {
        if (!isTablet || inServerRoute) toggleServerDrawer();
        lastTap.current.servers = 0;
        return;
      }

      const lastChannelId = activeServerId ? lastChannelByServer[activeServerId] : null;
      if (activeServerId && lastChannelId) {
        // Already on this channel — toggle the drawer instead of re-mounting
        const alreadyHere = pathname.includes(activeServerId) && pathname.includes(lastChannelId);
        if (alreadyHere) {
          toggleServerDrawer();
          return;
        }
        router.replace({
          pathname: '/server/[serverId]/channel/[channelId]',
          params: { serverId: activeServerId, channelId: lastChannelId },
        });
        return;
      }

      openServersSurface();
      return;
    }
    router.replace(item.route);
  };

  return (
    <View
      testID="bottom-dock"
      style={[
        styles.dock,
        {
          backgroundColor: theme.colors.bgSidebar,
          borderTopColor: theme.colors.lineSoft,
          height: DOCK_HEIGHT + dockBottomInset(insets.bottom),
          paddingBottom: 8 + dockBottomInset(insets.bottom),
        },
      ]}
    >
      {ITEMS.map(({ id, labelKey, Icon, route }) => {
        const color = active === id ? theme.colors.accent : theme.colors.text3;
        return (
          <TourAnchor key={id} name={`dock-${id === 'discover' ? 'notifications' : id}`} style={styles.anchor}>
          <Pressable
            haptic
            onPress={() => handlePress({ id, labelKey, Icon, route })}
            style={styles.item}
          >
            {id === 'me' ? (
              <Avatar
                username={selfUser?.username ?? 'You'}
                uri={selfUser?.avatar ?? null}
                size={20}
                shape="square"
                showStatus={false}
              />
            ) : (
              <Icon color={color} size={22} />
            )}
            {badges[id] > 0 ? (
              <View style={[styles.badge, { backgroundColor: theme.colors.accent, borderColor: theme.colors.bgSidebar }]}>
                <Text style={styles.badgeText}>{badges[id] > 99 ? '99+' : badges[id]}</Text>
              </View>
            ) : null}
            <Text variant="caption" color={color} style={styles.label}>
              {t(labelKey)}
            </Text>
          </Pressable>
          </TourAnchor>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 64,
    borderTopWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  anchor: {
    flex: 1,
    alignSelf: 'stretch',
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
  },
  badge: {
    position: 'absolute',
    top: 6,
    left: '50%',
    marginLeft: 6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 12,
  },
});
