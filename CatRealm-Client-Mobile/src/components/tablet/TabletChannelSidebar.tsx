/**
 * Tablet realm sidebar (desktop: Sidebar). Lives in the persistent TabletShell,
 * so switching channels or realms only changes the content area; moved here
 * from the channel screen, which used to remount it on every navigation.
 * The server header swaps the channel list for the full server list.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Image, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { ChevronDown, HeadphoneOff, MicOff, X } from 'lucide-react-native';
import { useTheme } from '@/theme';
import { Avatar } from '@/components/Avatar';
import { ChannelIcon } from '@/components/ChannelIcon';
import { ChannelNsfwTag, ChannelUnreadBadge, VoiceRegionTag } from '@/components/ChannelRowBadges';
import { ConnectedChannelPulse, useConnectedChannelIds } from '@/components/ConnectedChannelPulse';
import { IconBtn } from '@/components/IconBtn';
import { Pressable } from '@/components/Pressable';
import { ServerListPanel } from '@/components/ServerDrawer';
import { Text } from '@/components/Text';
import { useOpenTheater } from '@/components/theater/TheaterJoinModal';
import { useOpenServer } from '@/hooks/useOpenServer';
import { debugTap } from '@/lib/debugLog';
import { getOrigin } from '@/lib/expressionCache';
import { useAuthStore } from '@/stores/authStore';
import { useServerStore, type MobileServer } from '@/stores/serverStore';
import { useTheaterStore, type TheaterParticipant } from '@/stores/theaterStore';
import { useUIStore } from '@/stores/uiStore';
import { useVoiceStore, type VoiceParticipant } from '@/stores/voiceStore';
import type { Category, Channel } from '@/types';

const EMPTY_CHANNELS: Channel[] = [];
const EMPTY_CATEGORIES: Category[] = [];
const EMPTY_VOICE_PARTICIPANTS: VoiceParticipant[] = [];
const EMPTY_THEATER_PARTICIPANTS: TheaterParticipant[] = [];

function formatRoomElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function TabletChannelSidebar({ serverId, channelId }: { serverId: string; channelId?: string }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const openTheater = useOpenTheater();
  const openServer = useOpenServer();
  const connectedChannels = useConnectedChannelIds(serverId);

  const server = useServerStore((s) => s.servers.find((entry) => entry.id === serverId));
  const channels = useServerStore((s) => s.channels[serverId] ?? EMPTY_CHANNELS);
  const categories = useServerStore((s) => s.categories[serverId] ?? EMPTY_CATEGORIES);
  const selfAccountType = useAuthStore((s) => s.user?.accountType);
  const authServerUrl = useAuthStore((s) => s.serverUrl);
  const voiceRoomUsers = useVoiceStore((s) => s.voiceRoomUsers);
  const voiceRoomStartedAt = useVoiceStore((s) => s.voiceRoomStartedAt);
  const theaterRoomUsers = useTheaterStore((s) => s.roomUsersByChannel);
  const theaterRoomStartedAt = useTheaterStore((s) => s.roomStartedAtByChannel);
  const theaterChannelId = useTheaterStore((s) => s.channelId);
  const theaterHostUserId = useTheaterStore((s) => s.hostUserId);
  const serverDrawerOpen = useUIStore((s) => s.serverDrawerOpen);
  const setServerDrawerOpen = useUIStore((s) => s.setServerDrawerOpen);

  const channelServerUrl =
    server?.url ?? (getOrigin(serverId) ? serverId : selfAccountType === 'local' ? authServerUrl : null);

  const groupedChannels = useMemo(() => {
    const ordered = [...channels].sort((a, b) => a.position - b.position);
    const groups: Array<{ key: string; label: string; channels: Channel[] }> = [];
    const uncategorized = ordered.filter((c) => !c.category_id);
    if (uncategorized.length > 0) groups.push({ key: '__uncat__', label: 'Channels', channels: uncategorized });
    for (const cat of categories.slice().sort((a, b) => a.position - b.position)) {
      const catChannels = ordered.filter((c) => c.category_id === cat.id);
      if (catChannels.length > 0) groups.push({ key: cat.id, label: cat.name, channels: catChannels });
    }
    return groups;
  }, [channels, categories]);

  const serverBannerUrl = useMemo(() => {
    if (!server?.bannerUrl) return null;
    if (/^https?:\/\//i.test(server.bannerUrl)) return server.bannerUrl;
    const base = server.url?.replace(/\/$/, '');
    return base ? `${base}${server.bannerUrl}` : null;
  }, [server?.bannerUrl, server?.url]);

  // Live room timers tick here, not in the channel screen.
  const [roomNowMs, setRoomNowMs] = useState(() => Date.now());
  useEffect(() => {
    const hasVoiceRooms = Object.keys(voiceRoomStartedAt).length > 0;
    const hasTheaterRooms = Object.values(theaterRoomStartedAt).some((startedAt) => startedAt != null);
    if (!hasVoiceRooms && !hasTheaterRooms) return;
    const timer = globalThis.setInterval(() => setRoomNowMs(Date.now()), 1000);
    return () => globalThis.clearInterval(timer);
  }, [voiceRoomStartedAt, theaterRoomStartedAt]);

  const leftPaneProgress = useSharedValue(serverDrawerOpen ? 1 : 0);
  useEffect(() => {
    leftPaneProgress.value = withTiming(serverDrawerOpen ? 1 : 0, { duration: 240 });
  }, [leftPaneProgress, serverDrawerOpen]);
  const channelsPaneStyle = useAnimatedStyle(() => ({
    opacity: 1 - leftPaneProgress.value,
    transform: [{ translateX: -16 * leftPaneProgress.value }],
  }));
  const serversPaneStyle = useAnimatedStyle(() => ({
    opacity: leftPaneProgress.value,
    transform: [{ translateX: 16 * (1 - leftPaneProgress.value) }],
  }));

  const handleTabletServerPress = useCallback((srv: MobileServer) => {
    setServerDrawerOpen(false);
    void openServer(srv);
  }, [openServer, setServerDrawerOpen]);

  const paneListStyle = styles.paneList;

  // Highlight a tapped channel straight away; the new channel screen takes a
  // moment to mount, and without this the tap looks ignored until it does.
  const [pendingChannelId, setPendingChannelId] = useState<string | null>(null);
  useEffect(() => setPendingChannelId(null), [serverId, channelId]);
  const selectedChannelId = pendingChannelId ?? channelId;

  return (
    <View style={[styles.paneStack, { marginTop: insets.top }]}>
        <Animated.View style={[styles.tabletPaneLayer, channelsPaneStyle]} pointerEvents={serverDrawerOpen ? 'none' : 'auto'}>
          <Pressable
            haptic
            onPress={() => setServerDrawerOpen(true)}
            style={[
              styles.tabletServerHeader,
              { borderBottomColor: theme.colors.lineSoft, backgroundColor: theme.colors.bgElev1 },
            ]}
          >
            {serverBannerUrl ? (
              <Image source={{ uri: serverBannerUrl }} style={styles.tabletServerBanner} resizeMode="cover" />
            ) : null}
            <View style={styles.tabletServerBannerScrim} />
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', zIndex: 1 }}>
              <Text variant="subtitle" style={[styles.tabletServerTitle, { flex: 1 }]} numberOfLines={1}>
                {server?.name ?? t('servers.defaultServerName')}
              </Text>
              <ChevronDown size={16} color="#ffffff" />
            </View>
          </Pressable>
          <Text variant="subtitle" style={styles.tabletPaneTitle}>{t('chat.channelsTab')}</Text>
          <FlatList
            data={groupedChannels}
            keyExtractor={(g) => g.key}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={paneListStyle}
            renderItem={({ item: group }) => (
              <View style={{ marginBottom: 10 }}>
                <Text
                  variant="caption"
                  color={theme.colors.text3}
                  style={{ textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 4 }}
                >
                  {group.label}
                </Text>
                {group.channels.map((ch) => {
                  const active = ch.id === selectedChannelId;
                  // Still in this call/theater while viewing another channel.
                  const connectedElsewhere = !active
                    && (ch.id === connectedChannels.voiceChannelId || ch.id === connectedChannels.theaterChannelId);
                  const voiceMembers = ch.type === 'voice'
                    ? (voiceRoomUsers[ch.id] ?? EMPTY_VOICE_PARTICIPANTS)
                    : EMPTY_VOICE_PARTICIPANTS;
                  const theaterMembers = ch.type === 'theater'
                    ? (theaterRoomUsers[ch.id] ?? EMPTY_THEATER_PARTICIPANTS)
                    : EMPTY_THEATER_PARTICIPANTS;
                  const voiceStartedAt = ch.type === 'voice' ? voiceRoomStartedAt[ch.id] : null;
                  const theaterStartedAt = ch.type === 'theater' ? theaterRoomStartedAt[ch.id] : null;
                  const elapsedStartedAt = typeof voiceStartedAt === 'number'
                    ? voiceStartedAt
                    : (typeof theaterStartedAt === 'number' ? theaterStartedAt : null);
                  return (
                    <View key={ch.id}>
                      <Pressable
                        haptic
                        onPress={() => {
                          debugTap('TabletChannelSidebar', 'channel-press', {
                            fromChannelId: channelId,
                            nextChannelId: ch.id,
                            type: ch.type,
                            serverId,
                          });
                          // Re-tapping the open channel does nothing, as on desktop.
                          if (ch.type !== 'theater' && ch.id === channelId) {
                            setServerDrawerOpen(false);
                            return;
                          }
                          if (ch.type !== 'theater') setPendingChannelId(ch.id);
                          if (ch.type === 'voice') {
                            router.replace({
                              pathname: '/server/[serverId]/channel/[channelId]',
                              params: { serverId, channelId: ch.id },
                            });
                          } else if (ch.type === 'theater') {
                            openTheater(serverId, ch.id, ch.name);
                          } else {
                            router.replace({
                              pathname: '/server/[serverId]/channel/[channelId]',
                              params: { serverId, channelId: ch.id },
                            });
                          }
                          setServerDrawerOpen(false);
                        }}
                        style={[
                          styles.tabletChannelRow,
                          {
                            backgroundColor: active ? theme.colors.accent + '22' : 'transparent',
                            borderRadius: theme.radius.md,
                          },
                        ]}
                      >
                        {connectedElsewhere && <ConnectedChannelPulse radius={theme.radius.md} />}
                        <ChannelIcon type={ch.type} size={14} color={active ? theme.colors.accent : connectedElsewhere ? theme.colors.statusColor.online : theme.colors.text3} />
                        <Text
                          variant="bodySmall"
                          numberOfLines={1}
                          style={{ flex: 1, color: active ? theme.colors.accent : connectedElsewhere ? theme.colors.statusColor.online : theme.colors.text2 }}
                        >
                          {ch.name}
                        </Text>
                        <ChannelNsfwTag nsfw={ch.nsfw} />
                        {ch.type === 'voice' ? <VoiceRegionTag channelId={ch.id} /> : null}
                        {elapsedStartedAt != null ? (
                          <Text variant="caption" style={[styles.tabletRoomElapsed, { color: theme.colors.accent }]}>
                            {formatRoomElapsed(Math.max(0, roomNowMs - elapsedStartedAt))}
                          </Text>
                        ) : null}
                        {!active ? <ChannelUnreadBadge channelId={ch.id} /> : null}
                      </Pressable>
                      {voiceMembers.map((member) => (
                        <View key={`${ch.id}:${member.userId}`} style={styles.tabletVoiceMemberRow}>
                          <Avatar
                            username={member.username}
                            uri={member.avatar ?? null}
                            baseUrl={channelServerUrl ?? undefined}
                            size={20}
                            showStatus={false}
                          />
                          <Text
                            variant="caption"
                            numberOfLines={1}
                            style={[styles.tabletVoiceMemberName, { color: theme.colors.text3 }]}
                          >
                            {member.username}
                          </Text>
                          {member.muted ? <MicOff size={13} color={theme.colors.danger} /> : null}
                          {member.deafened ? <HeadphoneOff size={13} color={theme.colors.warning} /> : null}
                        </View>
                      ))}
                      {theaterMembers.map((member) => (
                        <View key={`theater:${ch.id}:${member.userId}`} style={styles.tabletVoiceMemberRow}>
                          <Avatar
                            username={member.username}
                            uri={member.avatar ?? null}
                            baseUrl={member.accountType === 'local' ? (channelServerUrl ?? undefined) : undefined}
                            size={20}
                            showStatus={false}
                          />
                          <Text
                            variant="caption"
                            numberOfLines={1}
                            style={[styles.tabletVoiceMemberName, { color: theme.colors.text3 }]}
                          >
                            {theaterChannelId === ch.id && theaterHostUserId === member.userId ? '🎤 ' : ''}{member.username}
                          </Text>
                          {!member.micEnabled ? <MicOff size={13} color={theme.colors.danger} /> : null}
                          {member.deafened ? <HeadphoneOff size={13} color={theme.colors.warning} /> : null}
                        </View>
                      ))}
                    </View>
                  );
                })}
              </View>
            )}
          />
        </Animated.View>
        <Animated.View style={[styles.tabletPaneLayer, serversPaneStyle]} pointerEvents={serverDrawerOpen ? 'auto' : 'none'}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 8 }}>
            <Text variant="subtitle" style={styles.tabletPaneTitle}>{t('chat.serversTab')}</Text>
            <IconBtn icon={X} onPress={() => setServerDrawerOpen(false)} accessibilityLabel={t('call.closeServers')} />
          </View>
          {/* Same list as the phone drawer: folders, invites, realm re-approval, Add/Discover. */}
          <ServerListPanel onOpenServer={handleTabletServerPress} onLeave={() => setServerDrawerOpen(false)} />
        </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  paneStack: {
    flex: 1,
    position: 'relative',
    minWidth: 0,
  },
  paneList: {
    paddingBottom: 16,
  },
  tabletPaneLayer: {
    ...StyleSheet.absoluteFill,
    paddingHorizontal: 12,
  },
  tabletPaneTitle: {
    marginBottom: 8,
    marginTop: 10,
  },
  tabletServerHeader: {
    height: 120,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginHorizontal: -12,
    marginBottom: 2,
    overflow: 'hidden',
    justifyContent: 'flex-end',
    padding: 10,
  },
  tabletServerBanner: {
    ...StyleSheet.absoluteFill,
  },
  tabletServerBannerScrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.38)',
  },
  tabletServerTitle: {
    color: '#fff',
    fontWeight: '700',
  },
  tabletChannelRow: {
    minHeight: 34,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tabletVoiceMemberRow: {
    minHeight: 28,
    paddingLeft: 30,
    paddingRight: 8,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tabletVoiceMemberName: {
    flex: 1,
    fontSize: 13,
  },
  tabletRoomElapsed: {
    fontSize: 10,
    fontVariant: ['tabular-nums'],
  },
});
