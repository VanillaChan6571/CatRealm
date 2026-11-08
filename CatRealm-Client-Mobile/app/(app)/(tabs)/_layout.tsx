/**
 * Tab bar — five-up mobile navigation. Server/channel navigation should
 * preserve desktop hierarchy while using mobile-appropriate presentation.
 * TLDR, This is Homebar Layout.
 */

import { useMemo, useRef } from 'react';
import { Easing } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  DarkTheme,
  Tabs,
  ThemeProvider as NavigationThemeProvider,
  usePathname,
  useRouter,
} from 'expo-router';
import { Home, Cat, MessageCircle, Bell } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Avatar, TopHubBar, SwipeSidebarContainer } from '@/components';
import { useTheme } from '@/theme';
import { useChannelStore } from '@/stores/channelStore';
import { useAuthStore } from '@/stores/authStore';
import { useServerStore } from '@/stores/serverStore';
import { useUIStore } from '@/stores/uiStore';
import { useDMStore } from '@/stores/dmStore';
import { useFriendStore } from '@/stores/friendStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { useDeviceLayout } from '@/hooks/useDeviceLayout';

export default function TabsLayout() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useTranslation();
  const lastTap = useRef<Record<string, number>>({});
  const selfUser = useAuthStore((s) => s.user);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const lastChannelByServer = useChannelStore((s) => s.lastChannelByServer);
  const setServerDrawerOpen = useUIStore((s) => s.setServerDrawerOpen);
  const profileEditMode = useUIStore((s) => s.profileEditMode);
  const { isTablet } = useDeviceLayout();
  const conversations = useDMStore((s) => s.conversations);
  const incomingRequests = useFriendStore((s) => s.incoming);
  const notificationSummary = useNotificationStore((s) => s.summary);
  const totalUnreadDMs = conversations.reduce((sum, c) => sum + (c.unreadCount ?? 0), 0);
  const chatsBadge = totalUnreadDMs || undefined;
  const homeBadge = incomingRequests.length || undefined;
  const notifBadge = notificationSummary?.totalUnread || undefined;
  // The tab container paints the navigation theme's background behind the scenes. Left at
  // DefaultTheme's light #F2F2F2 it shows through mid cross-fade as a bright flash.
  const navigationTheme = useMemo(
    () => ({ ...DarkTheme, colors: { ...DarkTheme.colors, background: theme.colors.bgApp } }),
    [theme.colors.bgApp],
  );

  const handleServersTabPress = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    const now = Date.now();
    const prev = lastTap.current.servers ?? 0;
    lastTap.current.servers = now;
    if (now - prev < 350) {
      setServerDrawerOpen(true);
      lastTap.current.servers = 0;
      return;
    }

    const lastChannelId = activeServerId ? lastChannelByServer[activeServerId] : null;
    if (activeServerId && lastChannelId) {
      router.replace({
        pathname: '/server/[serverId]/channel/[channelId]',
        params: { serverId: activeServerId, channelId: lastChannelId },
      });
      return;
    }

    setServerDrawerOpen(true);
  };

  return (
    <SwipeSidebarContainer
      style={{ backgroundColor: theme.colors.bgApp }}
      // On tablets the server rail and chats are always on screen; no swipe drawers.
      onOpenSidebar={
        !isTablet && pathname.includes('/home') ? () => setServerDrawerOpen(true) : undefined
      }
      onSwipeLeft={
        !isTablet && pathname.includes('/home')
          ? () => router.replace('/(app)/(tabs)/chats')
          : undefined
      }
    >
      <TopHubBar />
      {/* TopHubBar owns the top inset, except while profile edit mode or a tablet hides it. */}
      <SafeAreaInsetsContext.Provider
        value={{ ...insets, top: profileEditMode || isTablet ? insets.top : 0 }}
      >
        <NavigationThemeProvider value={navigationTheme}>
          <Tabs
            tabBar={() => null}
            screenOptions={
              isTablet
                ? {
                    headerShown: false,
                    // Tablets switch tabs from the always-visible sidebar, as desktop does: no fade.
                    // Rapid taps there kept restarting the fade and left the content blank meanwhile.
                    animation: 'none',
                  }
                : {
                    headerShown: false,
                    // Cross-fade between hub tabs instead of swapping content in a single frame.
                    animation: 'fade',
                    transitionSpec: {
                      animation: 'timing',
                      config: { duration: 220, easing: Easing.inOut(Easing.ease) },
                    },
                  }
            }
          >
            <Tabs.Screen
              name="home"
              options={{
                title: t('tabs.home'),
                tabBarIcon: ({ color, size }) => <Home color={color} size={size} />,
                tabBarBadge: homeBadge,
              }}
            />
            <Tabs.Screen
              name="servers"
              options={{
                title: t('tabs.servers'),
                tabBarIcon: ({ color, size }) => <Cat color={color} size={size} />,
              }}
              listeners={{
                tabPress: handleServersTabPress,
              }}
            />
            <Tabs.Screen
              name="chats"
              options={{
                title: t('tabs.directChats'),
                tabBarIcon: ({ color, size }) => <MessageCircle color={color} size={size} />,
                tabBarBadge: chatsBadge,
              }}
            />
            <Tabs.Screen
              name="discover"
              options={{
                title: t('tabs.notifications'),
                tabBarIcon: ({ color, size }) => <Bell color={color} size={size} />,
                tabBarBadge: notifBadge,
              }}
            />
            <Tabs.Screen
              name="me"
              options={{
                title: t('tabs.you'),
                tabBarIcon: () => (
                  <Avatar
                    username={selfUser?.username ?? t('tabs.you')}
                    uri={selfUser?.avatar ?? null}
                    size={24}
                    shape="square"
                    showStatus={false}
                  />
                ),
              }}
            />
          </Tabs>
        </NavigationThemeProvider>
      </SafeAreaInsetsContext.Provider>
    </SwipeSidebarContainer>
  );
}
