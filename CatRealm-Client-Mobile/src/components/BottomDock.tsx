import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Image, ScrollView, StyleSheet, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { Bell, Cat, Home, MessageCircle, Plus } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';
import axios from 'axios';
import { Pressable } from '@/components/Pressable';
import { DiscoverRailButton } from '@/components/DiscoverButton';
import { RailFolder } from '@/components/RailFolder';
import { ExpandingRail, RAIL_WIDTH, RailLabel } from '@/components/RailExpansion';
import { ServerIcon } from '@/components/ServerIcon';
import { buildServerListItems } from '@/lib/serverListItems';
import { Text } from '@/components/Text';
import { TourAnchor } from '@/components/TourAnchor';
import { useDeviceLayout } from '@/hooks/useDeviceLayout';
import { goToHubTab } from '@/lib/hubNavigation';
import { useAuthStore } from '@/stores/authStore';
import { useChannelStore } from '@/stores/channelStore';
import { useServerStore, type MobileServer } from '@/stores/serverStore';
import { useUIStore } from '@/stores/uiStore';
import { useDMStore } from '@/stores/dmStore';
import { useGroupChatStore } from '@/stores/groupChatStore';
import { useFriendStore } from '@/stores/friendStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { useRealmUnreadStore } from '@/lib/realmReadState';
import type { Category, Channel } from '@/types';
import { useTopBarPadding } from '@/hooks/useTopBarPadding';

type HubTabId = 'home' | 'servers' | 'chats' | 'discover' | 'me';

function activeHubTab(pathname: string): HubTabId {
  if (pathname.startsWith('/server') || pathname.includes('/servers')) return 'servers';
  if (pathname.startsWith('/dm/') || pathname.startsWith('/group/') || pathname.includes('/chats'))
    return 'chats';
  if (pathname.includes('/discover')) return 'discover';
  if (
    pathname.includes('/me') ||
    pathname.startsWith('/profile') ||
    pathname.startsWith('/settings')
  ) {
    return 'me';
  }
  return 'home';
}

function useNavBadges() {
  const home = useFriendStore((s) => s.incoming.length);
  const servers = useServerStore((s) =>
    s.servers.reduce((sum, server) => sum + (server.mention || 0), 0),
  );
  const chats =
    useDMStore((s) => s.conversations.reduce((sum, c) => sum + (c.unreadCount ?? 0), 0)) +
    useGroupChatStore((s) => s.groups.reduce((sum, g) => sum + (g.unreadCount ?? 0), 0));
  const discover = useNotificationStore((s) => s.summary?.totalUnread ?? 0);
  return { home, servers, chats, discover };
}

/**
 * Legacy BottomDock mount point in `(app)/_layout.tsx`.
 * Eliminated from the bottom of the screen so the chat composer (`MobileComposer`)
 * owns 100% of the bottom edge without accidental tab presses.
 * Navigation now lives in `TopHubBar`, `DrawerLeftRail`, and `DrawerHubFooter`.
 */
export function BottomDock() {
  return null;
}

/**
 * Top navigation header rendered on the main Hub screens (`chats`, `home`, `servers`, `discover`, `me`).
 * Keeps all 5 primary destinations at the top of the screen, far away from the keyboard & chat composer.
 */
export function TopHubBar() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  // The shortcuts step clear of a side status area (the iPhone Duo's cover screen).
  const topBarPadding = useTopBarPadding(14);
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const selfUser = useAuthStore((s) => s.user);
  const setServerDrawerOpen = useUIStore((s) => s.setServerDrawerOpen);
  const profileEditMode = useUIStore((s) => s.profileEditMode);
  const { isTablet } = useDeviceLayout();
  const badges = useNavBadges();
  const brandOpacity = useRef(new Animated.Value(1)).current;
  const displayName = selfUser?.displayName?.trim() || selfUser?.username?.trim() || 'CatRealm';
  const username = selfUser?.username?.trim() ? `@${selfUser.username.trim()}` : 'CatRealm';
  const brandLabels = ['CatRealm', displayName, 'CatRealm', username, 'CatRealm'];
  const [brandLabelIndex, setBrandLabelIndex] = useState(0);

  useEffect(() => {
    let currentIndex = 0;
    let mounted = true;
    const timer = setInterval(() => {
      Animated.timing(brandOpacity, {
        toValue: 0,
        duration: 240,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (!finished || !mounted) return;
        currentIndex = currentIndex === brandLabels.length - 1 ? 1 : currentIndex + 1;
        setBrandLabelIndex(currentIndex);
        Animated.timing(brandOpacity, {
          toValue: 1,
          duration: 320,
          useNativeDriver: true,
        }).start();
      });
    }, 2800);

    return () => {
      mounted = false;
      clearInterval(timer);
      brandOpacity.stopAnimation();
    };
  }, [brandLabels.length, brandOpacity]);

  // Tablets navigate from the persistent left column (TabletShell) instead.
  if (profileEditMode || isTablet) return null;

  const active = activeHubTab(pathname);
  const onHome = active === 'home';

  // Home keeps Servers + Chats; every other hub tab swaps one for a way back Home.
  // On Chats, Home takes the right-hand slot Chats holds on Home.
  type ShortcutId = 'home' | 'servers' | 'chats';
  const shortcutOrder: ShortcutId[] = onHome
    ? ['servers', 'chats']
    : active === 'chats'
      ? ['servers', 'home']
      : ['home', 'chats'];
  const shortcutDefs: Record<ShortcutId, { label: string; badge: number; onPress: () => void }> = {
    home: {
      label: t('tabs.home'),
      badge: badges.home,
      onPress: () => router.replace('/(app)/(tabs)/home'),
    },
    servers: {
      label: t('tabs.servers'),
      badge: badges.servers,
      onPress: () => setServerDrawerOpen(true),
    },
    chats: {
      label: t('tabs.chats'),
      badge: badges.chats,
      onPress: () => router.replace('/(app)/(tabs)/chats'),
    },
  };
  const shortcuts = shortcutOrder.map((id) => ({ id, ...shortcutDefs[id] }));
  const shortcutIcon = { home: Home, servers: Cat, chats: MessageCircle };

  return (
    <View
      testID="top-hub-bar"
      style={[
        styles.homeHubContainer,
        {
          backgroundColor: theme.colors.bgSidebar,
          borderBottomColor: theme.colors.lineSoft,
          paddingTop: Math.max(insets.top, 8),
          ...topBarPadding,
        },
      ]}
    >
      {/* On Home there is no Home shortcut, so the brand carries the tour's Home anchor. */}
      <TourAnchor name={onHome ? 'dock-home' : 'hub-brand'} style={styles.homeBrandAnchor}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('tabs.home')}
          disabled={onHome}
          onPress={() => router.replace('/(app)/(tabs)/home')}
          style={styles.homeBrandRow}
        >
          <Image source={require('../../assets/icon.png')} style={styles.homeBrandIcon} />
          <Animated.View style={[styles.homeBrandLabel, { opacity: brandOpacity }]}>
            <Text numberOfLines={1} style={styles.homeBrandTitle}>
              {brandLabels[brandLabelIndex]}
            </Text>
          </Animated.View>
        </Pressable>
      </TourAnchor>
      <View style={styles.homeHubActions}>
        {shortcuts.map(({ id, label, badge, onPress }) => {
          const Icon = shortcutIcon[id];
          return (
            <TourAnchor key={id} name={`dock-${id}`}>
              <Pressable
                haptic
                accessibilityRole="button"
                accessibilityLabel={label}
                onPress={onPress}
                style={[
                  styles.homeHubBtn,
                  { backgroundColor: theme.colors.bgElev1, borderColor: theme.colors.lineSoft },
                ]}
              >
                <Icon size={15} color={theme.colors.accentText} />
                <Text variant="caption" style={styles.homeHubBtnText}>
                  {label}
                </Text>
                {badge > 0 ? (
                  <View style={[styles.inlineBadge, { backgroundColor: theme.colors.danger }]}>
                    <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
                  </View>
                ) : null}
              </Pressable>
            </TourAnchor>
          );
        })}
      </View>
    </View>
  );
}

/**
 * Makes a realm the active one and loads its channels if they aren't cached.
 * Shared by the rail and the server drawer's realm picker.
 */
export async function loadRealmChannels(server: MobileServer): Promise<Channel[]> {
  const store = useServerStore.getState();
  void store.setActiveServer(server.id);
  const cached = store.channels[server.id] ?? [];
  if (cached.length > 0) return cached;
  try {
    const base = server.url.replace(/\/$/, '');
    const headers: Record<string, string> = { 'X-CatRealm-Client': 'mobile' };
    if (server.token) headers.Authorization = `Bearer ${server.token}`;
    const [channelsRes, categoriesRes] = await Promise.all([
      axios.get<Channel[]>(`${base}/api/channels`, { headers, timeout: 10000 }),
      axios.get<Category[]>(`${base}/api/categories`, { headers, timeout: 10000 }),
    ]);
    const channels = channelsRes.data ?? [];
    useServerStore.getState().setChannels(server.id, channels);
    useServerStore.getState().setCategories(server.id, categoriesRes.data ?? []);
    return channels;
  } catch {
    // Channel fetch error is handled by the main server view
    return [];
  }
}

/** One rail entry: its icon stays put, its label shows when the rail is widened. */
function RailRow({
  icon,
  label,
  labelColor,
  inset,
  accessibilityLabel,
  onPress,
}: {
  icon: ReactNode;
  label: string;
  labelColor?: string;
  /** Left padding that centres the icon in the collapsed column. */
  inset: number;
  accessibilityLabel?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      haptic
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      style={[styles.railRow, { paddingLeft: inset }]}
    >
      {icon}
      <RailLabel>
        <Text variant="body" numberOfLines={1} color={labelColor} style={styles.railRowLabel}>
          {label}
        </Text>
      </RailLabel>
    </Pressable>
  );
}

/**
 * Vertical icon rail inside the left sliding drawers. Lets the user reach
 * Notifications, Add Server, Discover and every realm/folder without a bottom
 * dock. In the server drawer (`expandable`) it widens to show labels, and a
 * realm tap goes to `onExpandedSelect` instead of navigating.
 */
export function DrawerLeftRail({
  onClose,
  onActiveServerPress,
  navigateOnSelect = false,
  embedded = false,
  expandable = false,
  expanded = false,
  expandedWidth = RAIL_WIDTH,
  onExpandedSelect,
  showHome = false,
}: {
  onClose: () => void;
  onActiveServerPress?: () => void;
  navigateOnSelect?: boolean;
  embedded?: boolean;
  expandable?: boolean;
  expanded?: boolean;
  expandedWidth?: number;
  onExpandedSelect?: (server: MobileServer) => void;
  /** Tablet layout: a Home button above the hub buttons, as on the desktop server bar. */
  showHome?: boolean;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { t } = useTranslation();
  const router = useRouter();
  const servers = useServerStore((s) => s.servers);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const serverSyncMessage = useServerStore((s) => s.serverSyncMessage);
  const unreadByServer = useRealmUnreadStore((s) => s.byServer);
  const serverLayout = useServerStore((s) => s.serverLayout);
  const serverFolders = useServerStore((s) => s.serverFolders);
  const toggleFolder = useServerStore((s) => s.toggleFolder);
  const badges = useNavBadges();

  // Same order and folders as the desktop server bar.
  const railItems = useMemo(
    () => buildServerListItems(servers, serverLayout, serverFolders),
    [servers, serverLayout, serverFolders],
  );

  const renderRailServer = (srv: MobileServer, inFolder: boolean) => {
    const isAct = srv.id === activeServerId;
    const hasUnread = !isAct && (unreadByServer[srv.url] ?? 0) > 0;
    return (
      <RailRow
        key={srv.id}
        label={srv.name}
        // Folder pills are narrower than the rail; inset by the same centring.
        inset={inFolder ? 7 : 11}
        onPress={() => {
          if (isAct && onActiveServerPress) {
            onActiveServerPress();
          } else if (expandable && onExpandedSelect) {
            onExpandedSelect(srv);
          } else {
            void handleSelectServer(srv);
          }
        }}
        icon={
          <>
            {isAct && !inFolder ? (
              <View style={[styles.activeServerPill, { backgroundColor: theme.colors.text }]} />
            ) : null}
            <ServerIcon
              server={srv}
              size={inFolder ? 40 : 44}
              active={isAct}
              badge={srv.mention}
              unread={hasUnread}
              square
            />
          </>
        }
      />
    );
  };

  const handleSelectServer = async (server: MobileServer) => {
    const wasAlreadyActive = activeServerId === server.id;
    const srvChannels = await loadRealmChannels(server);

    if (navigateOnSelect || wasAlreadyActive) {
      const rememberedChannelId = useChannelStore.getState().lastChannelByServer[server.id] ?? null;
      const firstChannelId =
        srvChannels
          .slice()
          .sort((a, b) => a.position - b.position)
          .find((c) => c.type !== 'voice')?.id ??
        srvChannels[0]?.id ??
        null;
      const targetChannelId = rememberedChannelId || firstChannelId;
      if (targetChannelId) {
        onClose();
        router.replace({
          pathname: '/server/[serverId]/channel/[channelId]',
          params: { serverId: server.id, channelId: targetChannelId },
        });
      }
    }
  };

  const hubInset = (RAIL_WIDTH - 46) / 2;

  return (
    <ExpandingRail
      labels={expandable}
      expanded={expanded}
      expandedWidth={expandedWidth}
      style={[
        styles.rail,
        {
          backgroundColor: theme.colors.bgDeepest,
          borderRightColor: theme.colors.lineSoft,
          paddingTop: embedded ? 10 : Math.max(insets.top + 8, 14),
        },
      ]}
    >
      {showHome ? (
        <TourAnchor name="dock-home">
          <RailRow
            label={t('tabs.home')}
            inset={hubInset}
            onPress={() => {
              onClose();
              // Switch to Home, going back to the existing tabs screen rather than stacking one.
              goToHubTab(router, pathname, '/(app)/(tabs)/home');
            }}
            icon={(() => {
              const homeActive = !pathname.startsWith('/server/');
              const homeBadge = badges.home + badges.chats;
              return (
                <View
                  style={[
                    styles.railHubBtn,
                    styles.railBrandBtn,
                    { borderColor: homeActive ? theme.colors.accent : 'transparent' },
                  ]}
                >
                  <Image source={require('../../assets/icon.png')} style={styles.railBrandIcon} />
                  {homeBadge > 0 ? (
                    <View
                      style={[
                        styles.railCornerBadge,
                        { backgroundColor: theme.colors.danger, borderColor: theme.colors.bgDeepest },
                      ]}
                    >
                      <Text style={styles.badgeText}>{homeBadge > 99 ? '99+' : homeBadge}</Text>
                    </View>
                  ) : null}
                </View>
              );
            })()}
          />
        </TourAnchor>
      ) : null}

      {/* Notifications; the tablet sidebar has its own Notifications row. */}
      {showHome ? null : <RailRow
        label={t('tabs.notifications')}
        inset={hubInset}
        onPress={() => {
          onClose();
          router.replace('/(app)/(tabs)/discover');
        }}
        icon={
          <View style={[styles.railHubBtn, { backgroundColor: theme.colors.bgElev2, borderColor: theme.colors.line }]}>
            <Bell size={19} color={theme.colors.text} />
            {badges.discover > 0 ? (
              <View
                style={[
                  styles.railCornerBadge,
                  { backgroundColor: theme.colors.danger, borderColor: theme.colors.bgDeepest },
                ]}
              >
                <Text style={styles.badgeText}>{badges.discover > 99 ? '99+' : badges.discover}</Text>
              </View>
            ) : null}
          </View>
        }
      />}

      {/* Add realm */}
      <RailRow
        label={t('server.addServer')}
        labelColor={theme.colors.online}
        inset={hubInset}
        onPress={() => {
          onClose();
          router.push('/(app)/add-server');
        }}
        icon={
          <View style={[styles.railHubBtn, { backgroundColor: theme.colors.online + '22', borderColor: theme.colors.online }]}>
            <Plus size={22} color={theme.colors.online} />
          </View>
        }
      />

      {/* Discover servers; managing realms lives on the footer's Manage button. */}
      <RailRow
        label={t('joinServers.discoverTitle')}
        inset={hubInset}
        onPress={() => {
          onClose();
          router.push('/(app)/discover-servers');
        }}
        icon={
          // The row takes the press; the button inside is only the animated tile.
          <View pointerEvents="none">
            <DiscoverRailButton label={t('joinServers.discoverTitle')} onPress={() => {}} />
          </View>
        }
      />

      <View style={[styles.railDivider, { backgroundColor: theme.colors.line }]} />

      {/* Scrollable Server Icons; on tablet the tour points here for Servers. */}
      <TourAnchor name={showHome ? 'dock-servers' : 'rail-servers'} style={styles.railServerAnchor}>
        <ScrollView
          style={{ flex: 1, width: '100%' }}
          contentContainerStyle={styles.railServerList}
          showsVerticalScrollIndicator={false}
        >
          {expandable && servers.length === 0 ? (
            <RailLabel style={styles.railEmpty}>
              <Text variant="caption" color={theme.colors.text3}>
                {serverSyncMessage ?? t('server.noServersLoaded')}
              </Text>
            </RailLabel>
          ) : null}
          {railItems.map((item) =>
            item.type === 'folder' ? (
              <RailFolder
                key={`folder:${item.folder.id}`}
                folder={item.folder}
                servers={item.servers}
                activeServerId={activeServerId}
                unreadByServer={unreadByServer}
                onToggle={() => toggleFolder(item.folder.id)}
                renderServer={(srv) => renderRailServer(srv, true)}
              />
            ) : (
              renderRailServer(item.server, false)
            ),
          )}
        </ScrollView>
      </TourAnchor>
    </ExpandingRail>
  );
}

/**
 * Persistent user & navigation footer rendered at the bottom of `ChannelsSheet`,
 * `ServerDrawer`, and the tablet sidebar so `You` (Profile/Settings) and
 * `Notifications` are always accessible in 1 tap without a global BottomDock.
 */
export function DrawerHubFooter({
  onClose,
  showHubShortcuts: _showHubShortcuts = false,
}: {
  onClose?: () => void;
  showHubShortcuts?: boolean;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const router = useRouter();
  const badges = useNavBadges();

  const go = (route: '/(app)/(tabs)/servers' | '/(app)/(tabs)/chats' | '/(app)/(tabs)/home') => {
    onClose?.();
    router.replace(route);
  };

  return (
    <View
      style={[
        styles.drawerFooterWrap,
        {
          backgroundColor: theme.colors.bgElev1,
          borderTopColor: theme.colors.line,
          paddingBottom: Math.max(insets.bottom, 10),
        },
      ]}
    >
      <View style={styles.footerNavRow}>
        <Pressable
          haptic
          accessibilityRole="button"
          accessibilityLabel={t('tabs.managingServers')}
          onPress={() => go('/(app)/(tabs)/servers')}
          style={[styles.footerNavBtn, { backgroundColor: theme.colors.bgElev2 }]}
        >
          <Cat size={15} color={theme.colors.accentText} />
          <Text variant="caption" style={styles.footerNavText} numberOfLines={1}>
            {t('tabs.manage')}
          </Text>
        </Pressable>
        <Pressable
          haptic
          onPress={() => go('/(app)/(tabs)/home')}
          style={[styles.footerNavBtn, { backgroundColor: theme.colors.bgElev2 }]}
        >
          <Home size={15} color={theme.colors.accentText} />
          <Text variant="caption" style={styles.footerNavText}>
            {t('tabs.home')}
          </Text>
          {badges.home > 0 ? (
            <View style={[styles.inlineBadge, { backgroundColor: theme.colors.danger }]}>
              <Text style={styles.badgeText}>{badges.home}</Text>
            </View>
          ) : null}
        </Pressable>
        <Pressable
          haptic
          onPress={() => go('/(app)/(tabs)/chats')}
          style={[styles.footerNavBtn, { backgroundColor: theme.colors.bgElev2 }]}
        >
          <MessageCircle size={15} color={theme.colors.accentText} />
          <Text variant="caption" style={styles.footerNavText}>
            {t('tabs.chats')}
          </Text>
          {badges.chats > 0 ? (
            <View style={[styles.inlineBadge, { backgroundColor: theme.colors.danger }]}>
              <Text style={styles.badgeText}>{badges.chats > 99 ? '99+' : badges.chats}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  homeHubContainer: {
    minHeight: 68,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  // Lets the brand keep shrinking for the shortcuts now that it sits inside a TourAnchor.
  homeBrandAnchor: {
    flexShrink: 1,
  },
  homeBrandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    flexShrink: 1,
  },
  homeBrandIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
  },
  homeBrandLabel: {
    flexShrink: 1,
  },
  homeBrandTitle: {
    fontSize: 25,
    lineHeight: 30,
    fontWeight: '800',
  },
  homeHubActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  homeHubBtn: {
    height: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    borderRadius: 10,
    borderWidth: 1,
  },
  homeHubBtnText: {
    fontWeight: '700',
  },
  inlineBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 12,
  },
  // Width comes from ExpandingRail; rows stretch so labels can follow the icons.
  rail: {
    borderRightWidth: 1,
    alignItems: 'stretch',
    paddingBottom: 10,
    gap: 8,
  },
  railRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 12,
    paddingRight: 12,
  },
  railRowLabel: {
    fontWeight: '600',
  },
  railEmpty: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  railHubBtn: {
    width: 46,
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  railBtnLabel: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '700',
  },
  railCornerBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  railBrandBtn: {
    borderWidth: 2,
  },
  railBrandIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
  },
  railServerAnchor: {
    flex: 1,
    width: '100%',
    minHeight: 0,
  },
  railDivider: {
    width: 32,
    height: 1,
    marginVertical: 2,
    marginLeft: (66 - 32) / 2,
  },
  railServerList: {
    alignItems: 'stretch',
    gap: 10,
    paddingBottom: 16,
  },
  activeServerPill: {
    position: 'absolute',
    left: 0,
    width: 4,
    height: 28,
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
  },
  railActionCircle: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawerFooterWrap: {
    borderTopWidth: 1,
    paddingTop: 8,
    paddingHorizontal: 10,
    gap: 8,
  },
  footerNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  footerNavBtn: {
    flex: 1,
    minWidth: 0,
    height: 38,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 6,
  },
  footerNavText: {
    fontWeight: '700',
  },
  footerQuickStrip: {
    flexDirection: 'row',
    gap: 6,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  footerQuickBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 9,
  },
  drawerFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  footerProfileBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  footerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  footerIconBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 34,
    paddingHorizontal: 10,
    borderRadius: 10,
    justifyContent: 'center',
  },
});
