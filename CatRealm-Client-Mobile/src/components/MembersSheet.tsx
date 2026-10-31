import { useMemo } from 'react';
import { useEffect, useState } from 'react';
import { FlatList, Platform, View, StyleSheet } from 'react-native';
import { CachedImage } from './CachedImage';
import { realmScope } from '@/lib/imageCache';
import { useRouter } from 'expo-router';
import { Monitor, Smartphone } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { Avatar } from './Avatar';
import { BotBadge } from './BotBadge';
import { Pressable } from './Pressable';
import { Sheet } from './Sheet';
import { Text } from './Text';
import { useServerStore } from '@/stores/serverStore';
import { usePresenceStore } from '@/stores/presenceStore';
import { useUIStore } from '@/stores/uiStore';
import { RoleNameText } from '@/lib/roleStyles';
import { fetchIconByTitle } from '@/lib/gameLibraryIcons';
import { useListeningArt } from '@/lib/lastfmAlbumArt';
import type { OnlineUser } from '@/types';
import { useDeviceLayout } from '@/hooks/useDeviceLayout';
import { useVisibleChannelMemberIds, filterMembersByVisibleIds } from '@/hooks/useVisibleChannelMemberIds';


// ─── Types ────────────────────────────────────────────────────────────────────

interface MemberEntry extends OnlineUser {
  offline?: boolean;
}

interface RoleGroup {
  key: string;
  label: string;
  roleIcon: string | null;
  offline: boolean;
  users: MemberEntry[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isOfflineLikeStatus(status: unknown): boolean {
  const normalized = typeof status === 'string' ? status.trim().toLowerCase() : '';
  return normalized === 'invisible' || normalized === 'offline';
}

function mergeMemberPresence(base: OnlineUser | undefined, live: OnlineUser): MemberEntry {
  const hasCustomStatusText = Object.prototype.hasOwnProperty.call(live, 'customStatusText');
  const hasActivityType = Object.prototype.hasOwnProperty.call(live, 'activityType');
  const hasActivityText = Object.prototype.hasOwnProperty.call(live, 'activityText');
  const hasActivityStartedAt = Object.prototype.hasOwnProperty.call(live, 'activityStartedAt');
  const hasStatus = Object.prototype.hasOwnProperty.call(live, 'status');
  const merged = {
    ...(base ?? {}),
    ...live,
    status: hasStatus ? (live.status ?? undefined) : undefined,
    customStatusText: hasCustomStatusText ? (live.customStatusText ?? null) : (base?.customStatusText ?? null),
    activityType: hasActivityType ? (live.activityType ?? null) : (base?.activityType ?? null),
    activityText: hasActivityText ? (live.activityText ?? null) : (base?.activityText ?? null),
    activityStartedAt: hasActivityStartedAt ? (live.activityStartedAt ?? null) : (base?.activityStartedAt ?? null),
  } as MemberEntry;

  const offline = isOfflineLikeStatus(merged.status);
  return {
    ...merged,
    offline,
    status: offline ? 'invisible' : merged.status,
  };
}

function groupMembers(members: MemberEntry[]): RoleGroup[] {
  const online = members.filter((u) => !u.offline);
  const offline = members.filter((u) => u.offline);

  const roleMap = new Map<string, RoleGroup>();

  for (const user of online) {
    if (user.roleHoist && user.roleName) {
      const key = user.roleName;
      if (!roleMap.has(key)) {
        roleMap.set(key, {
          key,
          label: user.roleName,
          roleIcon: user.roleIcon ?? null,
          offline: false,
          users: [],
        });
      }
      roleMap.get(key)!.users.push(user);
    } else {
      const key = '__members__';
      if (!roleMap.has(key)) {
        roleMap.set(key, { key, label: 'Members', roleIcon: null, offline: false, users: [] });
      }
      roleMap.get(key)!.users.push(user);
    }
  }

  // Sort hoisted groups by highest rolePosition (descending)
  const groups = Array.from(roleMap.values()).sort((a, b) => {
    const posA = a.users[0]?.rolePosition ?? 0;
    const posB = b.users[0]?.rolePosition ?? 0;
    return posB - posA;
  });

  if (offline.length > 0) {
    groups.push({ key: '__offline__', label: 'Offline', roleIcon: null, offline: true, users: offline });
  }

  return groups;
}

function resolveServerUrl(baseUrl?: string): string | null {
  if (!baseUrl) return null;
  return baseUrl.replace(/\/$/, '');
}

// ─── List item types ──────────────────────────────────────────────────────────

function resolveRoleIconUrl(roleIcon: string | null | undefined, serverUrl: string | null): string | null {
  if (!roleIcon) return null;
  if (roleIcon.startsWith('http://') || roleIcon.startsWith('https://')) return roleIcon;
  if (serverUrl) return `${serverUrl}${roleIcon.startsWith('/') ? roleIcon : '/' + roleIcon}`;
  return null;
}

type ListItem =
  | { kind: 'header'; group: RoleGroup }
  | { kind: 'member'; user: MemberEntry; serverUrl: string | null; offline: boolean };

// ─── Member row ───────────────────────────────────────────────────────────────

function MemberRow({
  user,
  serverUrl,
  offline,
  onPress,
}: {
  user: MemberEntry;
  serverUrl: string | null;
  offline: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const status = user.status ?? null;
  const customStatusText = user.customStatusText ?? null;
  const activityType = user.activityType ?? null;
  const activityText = user.activityText ?? null;
  const activityLabel = activityType === 'Listening' ? t('lastfm.listeningTo') : activityType;
  const isListening = activityType === 'Listening' && !!activityText;
  const listeningArtUrl = useListeningArt(activityType, activityText);

  const isOwner = user.isOwner || user.role === 'owner';
  const roleIconUrl = resolveRoleIconUrl(user.roleIcon, serverUrl);
  const activity = activityText
    ? `${activityLabel ? activityLabel + ' ' : ''}${activityText}`
    : customStatusText ?? null;
  const isPlaying = (activityType ?? '').toLowerCase() === 'playing' && !!activityText;
  const [gameIconUrl, setGameIconUrl] = useState<string | null>(null);
  // Client type badges — only shown when clients array is populated
  const hasDesktop = !!user.clients?.includes('desktop');
  const hasMobile = !!user.clients?.includes('mobile');
  const showDesktopDot = !offline && hasDesktop;
  const showPhoneIcon = !offline && hasMobile;

  useEffect(() => {
    if (!isPlaying || !activityText) {
      setGameIconUrl(null);
      return;
    }
    let cancelled = false;
    fetchIconByTitle(activityText).then((url) => {
      if (!cancelled) setGameIconUrl(url);
    }).catch(() => {
      if (!cancelled) setGameIconUrl(null);
    });
    return () => {
      cancelled = true;
    };
  }, [isPlaying, activityText]);

  return (
    <Pressable
      haptic
      onPress={onPress}
      style={[styles.row, offline && styles.rowOffline]}
    >
      <Avatar
        username={user.username}
        uri={user.avatar ?? null}
        baseUrl={serverUrl ?? undefined}
        status={offline ? null : (status ?? null)}
        size={36}
      />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.nameRow}>
          <RoleNameText
            color={offline ? theme.colors.text3 : user.roleColor}
            styleType={offline ? null : user.roleStyleType}
            styleColors={offline ? null : user.roleStyleColors}
            numberOfLines={1}
            style={{ flex: 1 }}
          >
            {`${isOwner ? '♛ ' : ''}${user.displayName ?? user.username}`}
          </RoleNameText>
          {(user.isBot || user.accountType === 'bot') ? <BotBadge /> : null}
          {roleIconUrl ? (
            <CachedImage uri={roleIconUrl} scope={realmScope(serverUrl ?? roleIconUrl)} style={styles.roleIcon} contentFit="contain" />
          ) : null}
          {showDesktopDot && (
            <Monitor
              size={11}
              color={
                status === 'away' ? theme.colors.warning
                : status === 'sleeping' ? '#eab308'
                : theme.colors.online
              }
            />
          )}
          {showPhoneIcon && (
            <Smartphone
              size={11}
              color={
                status === 'away' ? theme.colors.warning
                : status === 'sleeping' ? '#eab308'
                : theme.colors.online
              }
            />
          )}
        </View>
        {!offline && activity ? (
          <View style={styles.activityRow}>
            {isPlaying ? (
              gameIconUrl ? (
                <CachedImage uri={gameIconUrl} scope={realmScope(serverUrl ?? gameIconUrl)} style={styles.activityIcon} contentFit="cover" />
              ) : (
                <Text variant="caption">🎮</Text>
              )
            ) : isListening ? (
              listeningArtUrl ? (
                <CachedImage uri={listeningArtUrl} scope={realmScope(serverUrl ?? listeningArtUrl)} style={styles.activityIcon} contentFit="cover" />
              ) : (
                <Text variant="caption">🎵</Text>
              )
            ) : null}
            <Text variant="caption" color={theme.colors.text3} numberOfLines={1} style={{ flex: 1 }}>
              {activity}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

// ─── Main sheet ───────────────────────────────────────────────────────────────

export function MembersSheet() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { isTablet } = useDeviceLayout();
  const router = useRouter();
  const open = useUIStore((s) => s.membersSheetOpen);
  const setOpen = useUIStore((s) => s.setMembersSheetOpen);
  const server = useServerStore((s) =>
    s.activeServerId ? s.servers.find((e) => e.id === s.activeServerId) : undefined,
  );
  const onlineUsers = usePresenceStore((s) => s.onlineUsers);
  const allMembers = usePresenceStore((s) => s.allMembers);
  const activeChannelId = useUIStore((s) => s.activeChannelId);

  const serverUrl = resolveServerUrl(server?.url);

  // Private channels restrict who appears in the member list; the server applies
  // the real visibility check via /api/users?channelId=. null = show everyone.
  const visibleMemberIds = useVisibleChannelMemberIds(activeChannelId, allMembers.length);

  // Mirror desktop buildMemberList: offline = in allMembers but NOT in onlineUsers.
  // Never trust DB status field — only socket presence determines online/offline.
  const members: MemberEntry[] = useMemo(() => {
    const onlineIds = new Set(onlineUsers.map((u) => u.id));
    const allMembersById = new Map(allMembers.map((u) => [u.id, u]));
    const result: MemberEntry[] = [];
    for (const u of onlineUsers) {
      const base = allMembersById.get(u.id);
      result.push(mergeMemberPresence(base, u));
    }
    for (const u of allMembers) {
      if (!onlineIds.has(u.id)) {
        result.push({ ...u, status: undefined, offline: true });
      }
    }
    return filterMembersByVisibleIds(result, visibleMemberIds);
  }, [onlineUsers, allMembers, visibleMemberIds]);

  const groups = useMemo(() => groupMembers(members), [members]);

  const listItems: ListItem[] = useMemo(() => {
    const items: ListItem[] = [];
    for (const group of groups) {
      items.push({ kind: 'header', group });
      for (const user of group.users) {
        items.push({ kind: 'member', user, serverUrl, offline: group.offline });
      }
    }
    return items;
  }, [groups, serverUrl]);

  return (
    <Sheet open={open} onClose={() => setOpen(false)} maxHeightFraction={isTablet ? 0.92 : 0.8}>
      <View style={{ paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.sm }}>
        <Text variant="subtitle">{t('chat.members')}</Text>
        {members.length > 0 && (
          <Text variant="caption" color={theme.colors.text3}>
            {t('servers.membersOnline', { count: members.filter((m) => !m.offline).length })}
          </Text>
        )}
      </View>

      {listItems.length === 0 ? (
        <View style={{ padding: theme.spacing.lg }}>
          <Text variant="bodySmall" color={theme.colors.text3}>{t('chat.noMembersYet')}</Text>
        </View>
      ) : (
        <FlatList
          data={listItems}
          keyExtractor={(item) =>
            item.kind === 'header' ? `hdr-${item.group.key}` : `usr-${item.user.id}`
          }
          renderItem={({ item }) => {
            if (item.kind === 'header') {
              const iconUrl = resolveRoleIconUrl(item.group.roleIcon, serverUrl);
              return (
                <View style={[styles.groupHeader, { paddingHorizontal: theme.spacing.lg }]}>
                  {iconUrl ? (
                    <CachedImage uri={iconUrl} scope={realmScope(serverUrl ?? iconUrl)} style={styles.groupRoleIcon} contentFit="contain" />
                  ) : null}
                  <Text
                    variant="caption"
                    color={theme.colors.text3}
                    style={{ textTransform: 'uppercase', letterSpacing: 0.7 }}
                  >
                    {item.group.key === '__members__' ? t('chat.members') : item.group.key === '__offline__' ? t('status.invisible') : item.group.label} — {item.group.users.length}
                  </Text>
                </View>
              );
            }
            return (
              <MemberRow
                user={item.user}
                serverUrl={item.serverUrl}
                offline={item.offline}
                onPress={() => {
                  setOpen(false);
                  router.push({ pathname: '/profile/[userId]', params: { userId: item.user.id, context: 'server' } });
                }}
              />
            );
          }}
          contentContainerStyle={{ paddingBottom: 24 }}
          initialNumToRender={15}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews={Platform.OS === 'android'}
        />
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  rowOffline: {
    opacity: 0.5,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  activityIcon: {
    width: 12,
    height: 12,
    borderRadius: 2,
  },
  roleIcon: {
    width: 14,
    height: 14,
    borderRadius: 2,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 14,
    paddingBottom: 4,
  },
  groupRoleIcon: {
    width: 14,
    height: 14,
    borderRadius: 2,
  },
});
