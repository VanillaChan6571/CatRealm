/**
 * Profile modal — user card with avatar, bio, status, and actions.
 */

import { useState, useEffect, useRef } from 'react';
import { Alert, View, ScrollView, ActivityIndicator, StyleSheet, Image } from 'react-native';
import { SafeAreaView } from '@/components/SafeAreaView';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { X, MessageCircle, UserPlus, Clock4, Calendar, ShieldAlert } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { Text, IconBtn, Avatar, BotBadge, Pressable, StatusDot, Sheet, FadeInImage } from '@/components';
import { BotProfileSettings } from '@/components/BotProfileSettings';
import { useAuthStore } from '@/stores/authStore';
import { useDMStore } from '@/stores/dmStore';
import { usePresenceStore } from '@/stores/presenceStore';
import { useFriendStore } from '@/stores/friendStore';
import { useBlockedUsersStore } from '@/stores/blockedUsersStore';
import { AUTH_BASE, createApi, createAuthenticatedApi } from '@/lib/api';
import { mergeCentralProfileIntoProfile, normalizeProfileResponse, type RawProfile } from '@/lib/profileNormalize';
import { debugLog } from '@/lib/debugLog';
import { resolveMediaUrl } from '@/utils/mediaUrl';
import { RoleNameText } from '@/lib/roleStyles';
import { fetchIconByTitle } from '@/lib/gameLibraryIcons';
import { NowPlayingCard } from '@/components/NowPlayingCard';
import { nowPlayingActivityText, useNowPlayingStore } from '@/stores/nowPlayingStore';
import type { PersonalFriendRole, Profile, Role } from '@/types';
import type { MobileServer } from '@/stores/serverStore';
import { useServerStore } from '@/stores/serverStore';

function statusLabelKey(status?: string | null): string {
  const normalized = String(status || '').trim().toLowerCase();
  if (!normalized || normalized === 'offline' || normalized === 'invisible') return 'status.invisible';
  if (normalized === 'away') return 'status.away';
  if (normalized === 'sleeping') return 'status.sleeping';
  return 'status.online';
}

function formatGameElapsedClock(startedAt?: number | null, nowMs?: number): string | null {
  if (!startedAt || !nowMs) return null;
  const totalSeconds = Math.max(0, Math.floor(nowMs / 1000) - startedAt);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function roleAccentColor(role: Pick<Role, 'color' | 'style_type' | 'style_colors'>): string | null {
  if (role.style_type === 'gradient' || role.style_type === 'rgb_flow') {
    try {
      const colors = JSON.parse(role.style_colors ?? '[]');
      if (Array.isArray(colors) && typeof colors[0] === 'string') return colors[0];
    } catch {
      // ignore malformed role style payloads
    }
  }
  return role.color ?? null;
}

function resolveRoleIconUrl(roleIcon: string | null | undefined, serverUrl: string | null | undefined): string | null {
  if (!roleIcon) return null;
  if (roleIcon.startsWith('http://') || roleIcon.startsWith('https://')) return roleIcon;
  if (!serverUrl) return null;
  return `${serverUrl.replace(/\/$/, '')}${roleIcon.startsWith('/') ? roleIcon : '/' + roleIcon}`;
}

export default function ProfileScreen() {
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { userId, context } = useLocalSearchParams<{ userId: string; context?: 'central' | 'server' }>();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [privateRoles, setPrivateRoles] = useState<PersonalFriendRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [profileRefreshing, setProfileRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [requestSending, setRequestSending] = useState(false);
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [gameIconUrl, setGameIconUrl] = useState<string | null>(null);
  const [visibleBanner, setVisibleBanner] = useState<{ key: string | null; url: string | null }>({ key: null, url: null });
  const [viewContext, setViewContext] = useState<'server' | 'central'>(() => context === 'central' ? 'central' : 'server');
  const [relatedRealms, setRelatedRealms] = useState<Array<{ server: MobileServer; localUserId: string }>>([]);
  const [relatedRealmsLoading, setRelatedRealmsLoading] = useState(false);
  const profileRef = useRef<Profile | null>(null);
  const profileRouteUserIdRef = useRef<string | null>(null);

  const selfUser = useAuthStore((s) => s.user);
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const servers = useServerStore((s) => s.servers);
  const activeServer = useServerStore((s) => (s.activeServerId ? s.byId(s.activeServerId) : undefined));
  const setActiveServer = useServerStore((s) => s.setActiveServer);
  const conversations = useDMStore((s) => s.conversations);
  const fetchConversations = useDMStore((s) => s.fetchConversations);
  const friends = useFriendStore((s) => s.friends);
  const outgoing = useFriendStore((s) => s.outgoing);
  const removeFriend = useFriendStore((s) => s.removeFriend);
  const fetchFriends = useFriendStore((s) => s.fetchFriends);
  const fetchRequests = useFriendStore((s) => s.fetchRequests);
  // Central view reads Central presence (friends/DMs); server view reads the realm's.
  const presence = usePresenceStore((s) =>
    viewContext === 'central' ? s.centralByUserId[profile?.centralId || userId || ''] : s.byUserId[userId ?? ''],
  );
  const nowPlayingByUser = useNowPlayingStore((s) => s.byUserId);
  const canUseCentralView = selfUser?.accountType === 'central';
  const canUseServerView = !!activeServer?.url;
  const viewingCentralIdentity = viewContext === 'central' && !!profile && profile.id === userId;
  const showProfileContextToggle = canUseCentralView && canUseServerView && profile?.accountType === 'central' && !viewingCentralIdentity;
  const isFriend = !!userId && friends.some((f) => f.id === userId);
  const activeServerUrl = activeServer?.url;
  const activeServerToken = activeServer?.token || undefined;
  const createActiveServerApi = () => createApi(activeServerUrl, activeServerToken);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  useEffect(() => {
    const centralId = profile?.centralId || (profile?.accountType === 'central' ? profile.id : null);
    if (!viewingCentralIdentity || !centralId || servers.length === 0) {
      setRelatedRealms([]);
      setRelatedRealmsLoading(false);
      return;
    }
    let cancelled = false;
    setRelatedRealmsLoading(true);
    void Promise.all(servers.map(async (server) => {
      if (!server.url || !server.token) return null;
      try {
        const res = await createApi(server.url, server.token).get<Profile>(`/api/profile/${centralId}`);
        return res.data?.id ? { server, localUserId: res.data.id } : null;
      } catch {
        return null;
      }
    })).then((matches) => {
      if (!cancelled) setRelatedRealms(matches.filter((entry): entry is { server: MobileServer; localUserId: string } => !!entry));
    }).finally(() => {
      if (!cancelled) setRelatedRealmsLoading(false);
    });
    return () => { cancelled = true; };
  }, [profile?.accountType, profile?.centralId, profile?.id, servers, viewingCentralIdentity]);

  useEffect(() => {
    if (context === 'central' && canUseCentralView) {
      setViewContext('central');
      return;
    }
    if (context === 'server' && canUseServerView) {
      setViewContext('server');
      return;
    }
    if (canUseCentralView && canUseServerView) {
      setViewContext('server');
      return;
    }
    setViewContext('central');
  }, [canUseCentralView, canUseServerView, context, userId]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const existingProfile = profileRef.current;
    const canReuseCurrentProfile = !!existingProfile && (
      profileRouteUserIdRef.current === userId ||
      existingProfile.id === userId || existingProfile.centralId === userId
    );
    const currentProfile = canReuseCurrentProfile ? existingProfile : null;
    if (!canReuseCurrentProfile) {
      profileRouteUserIdRef.current = null;
      setProfile(null);
      setRoles([]);
      setPrivateRoles([]);
    }
    setLoading(!canReuseCurrentProfile);
    setProfileRefreshing(canReuseCurrentProfile);
    setLoadError(null);
    const inCentralContext = viewContext === 'central' || !canUseServerView;

    const loadProfile = async (): Promise<RawProfile> => {
      if (inCentralContext && canUseCentralView) {
        let lookupId = currentProfile?.centralId || userId;
        try {
          const primaryRes = await createAuthenticatedApi().get<RawProfile>('/api/profile/' + lookupId);
          return primaryRes.data;
        } catch (primaryErr: unknown) {
          const status = primaryErr && typeof primaryErr === 'object' && 'response' in primaryErr
            ? (primaryErr as { response?: { status?: number } }).response?.status
            : undefined;
          if (status !== 404) throw primaryErr;

          const serverRes = await createActiveServerApi().get<RawProfile>('/api/profile/' + userId);
          const mappedCentralId = serverRes.data?.centralId ?? null;
          if (!mappedCentralId || mappedCentralId === lookupId) {
            // Central doesn't know this user (e.g. a realm bot or local account),
            // but the realm does — show the realm profile instead of failing.
            if (serverRes.data?.id) {
              if (!cancelled) setViewContext('server');
              return serverRes.data;
            }
            throw primaryErr;
          }

          lookupId = mappedCentralId;
          const retryRes = await createAuthenticatedApi().get<RawProfile>('/api/profile/' + lookupId);
          return retryRes.data;
        }
      }
      try {
        const serverRes = await createActiveServerApi().get<RawProfile>('/api/profile/' + userId);
        return serverRes.data;
      } catch (serverErr: unknown) {
        const status = serverErr && typeof serverErr === 'object' && 'response' in serverErr
          ? (serverErr as { response?: { status?: number } }).response?.status
          : undefined;
        // Fall back to Central on a 404 (unknown to the realm) and also when the
        // realm is unreachable (network error → no status): non-SSL, down, DNS.
        const realmUnreachable = status === undefined;
        if ((status !== 404 && !realmUnreachable) || !canUseCentralView) throw serverErr;
        const centralRes = await createAuthenticatedApi().get<RawProfile>('/api/profile/' + userId);
        if (!cancelled) setViewContext('central');
        return centralRes.data;
      }
    };
    void (async () => {
      try {
        let loadedProfile = normalizeProfileResponse(await loadProfile());
        if (cancelled) return;
        // Server context, central member: enrich the realm profile with the
        // Central one (bio/activity/display name) — mirrors desktop's merge.
        if (!inCentralContext && canUseCentralView && loadedProfile.accountType === 'central' && loadedProfile.centralId) {
          try {
            const centralRes = await createAuthenticatedApi().get<RawProfile>('/api/profile/' + loadedProfile.centralId);
            const centralProfile = normalizeProfileResponse(centralRes.data);
            loadedProfile = mergeCentralProfileIntoProfile(loadedProfile, centralProfile);
            // Desktop parity: no realm banner → fall back to the Central one,
            // resolved absolute here since render-time bases point at the realm.
            if (!loadedProfile.banner && centralProfile.banner) {
              loadedProfile = { ...loadedProfile, banner: resolveMediaUrl(centralProfile.banner, AUTH_BASE) };
            }
          } catch {
            // Central unreachable or unknown — the realm-served profile stands.
          }
          if (cancelled) return;
        }
        profileRouteUserIdRef.current = userId;
        setProfile(loadedProfile);

        if (inCentralContext && canUseCentralView) {
          const res = await createAuthenticatedApi()
            .get<{ roles?: PersonalFriendRole[]; assignments?: Record<string, string[]> }>('/api/friends/personal-roles');
          if (cancelled) return;
          const allPrivateRoles = res.data?.roles ?? [];
          const assignments = res.data?.assignments ?? {};
          const assignedIds = new Set<string>();
          const targetIds = new Set<string>([
            userId,
            loadedProfile?.id ?? '',
            loadedProfile?.centralId ?? '',
          ].filter(Boolean));
          for (const targetId of targetIds) {
            for (const roleId of assignments[targetId] ?? []) assignedIds.add(roleId);
          }
          setPrivateRoles(allPrivateRoles.filter((role) => assignedIds.has(role.id)));
          setRoles([]);
        } else {
          const roleTargetIds = Array.from(new Set([
            userId,
            loadedProfile?.id ?? '',
          ].filter(Boolean)));
          let loadedRoles: Role[] = [];
          for (const targetId of roleTargetIds) {
            try {
              const res = await createActiveServerApi().get<{ roles: Role[] }>(`/api/profile/${targetId}/roles`);
              loadedRoles = res.data?.roles ?? [];
              break;
            } catch {
              // Central/server profile IDs can differ; try the next candidate.
            }
          }
          if (cancelled) return;
          setRoles(loadedRoles);
          setPrivateRoles([]);
        }
      } catch (err: unknown) {
        if (cancelled) return;
        const status = err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { status?: number } }).response?.status
          : undefined;
        const message = err instanceof Error ? err.message : String(err);
        debugLog('ProfileScreen', 'load-failed', {
          userId,
          viewContext,
          canUseCentralView,
          canUseServerView,
          status,
          message,
        });
        setLoadError(status ? `HTTP ${status}` : message);
        if (!currentProfile) {
          setProfile(null);
          setRoles([]);
          setPrivateRoles([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setProfileRefreshing(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeServerToken, activeServerUrl, canUseCentralView, canUseServerView, userId, viewContext]);

  const isSelf = selfUser?.id === userId || selfUser?.serverUserId === userId;
  const isBlocked = useBlockedUsersStore((s) => !!userId && s.blockedUsers.has(userId));
  const [blockBusy, setBlockBusy] = useState(false);
  const toggleBlock = async () => {
    if (!userId || blockBusy) return;
    setBlockBusy(true);
    try {
      const store = useBlockedUsersStore.getState();
      if (isBlocked) await store.unblockUser(userId);
      else await store.blockUser(userId);
      await fetchConversations();
    } catch { Alert.alert('Block user', 'Could not save this change. Please try again.'); }
    finally { setBlockBusy(false); }
  };
  const isPendingOutgoing = outgoing.some((req) =>
    (userId && req.to_user_id === userId) || (profile?.username && req.to_username === profile.username),
  );
  const canUseCentralSocialActions = profile?.accountType === 'central' && !profile.isBot;

  const handleSendMessage = () => {
    void (async () => {
      if (!userId) return;

      let convo = conversations.find((c) => c.otherUserId === userId);
      if (!convo) {
        try {
          // This endpoint creates the conversation if it doesn't exist yet.
          await createAuthenticatedApi().get(`/api/dms/${userId}/messages`, {
            params: { limit: 1 },
          });
          await fetchConversations();
          convo = useDMStore.getState().conversations.find((c) => c.otherUserId === userId);
        } catch {
          return;
        }
      }

      if (!convo) return;
      router.replace({ pathname: '/dm/[conversationId]', params: { conversationId: convo.id } });
    })();
  };

  const handleAddFriend = async () => {
    const username = profile?.username?.trim();
    if (!username) return;
    setRequestSending(true);
    try {
      await createAuthenticatedApi().post('/api/friends/request', { username });
      await fetchRequests();
      await fetchFriends();
    } catch {
      // ignore
    } finally {
      setRequestSending(false);
    }
  };

  const handleRemoveFriend = async () => {
    if (!userId) return;
    try {
      await removeFriend(userId);
    } catch {
      // ignore
    }
  };

  const status = presence?.status ?? profile?.status;
  const bannerUrl = resolveMediaUrl(
    profile?.banner ?? null,
    viewContext === 'central'
      ? AUTH_BASE
      : (activeServer?.url ?? (selfUser?.accountType === 'local' ? serverUrl : undefined)),
  );
  const bannerKey = profile?.banner ?? null;
  const customStatusText = presence?.customStatusText ?? profile?.customStatusText;
  const activityType = presence?.activityType ?? profile?.activityType ?? null;
  const activityTextRaw = presence?.activityText ?? profile?.activityText ?? null;
  const activityStartedAt = presence?.activityStartedAt ?? profile?.activityStartedAt ?? null;
  // Live socket updates (self + friends) win over the snapshot from the fetch.
  const nowPlayingId = profile ? (profile.centralId || (profile.accountType === 'central' ? profile.id : null)) : null;
  const nowPlaying = nowPlayingId && Object.prototype.hasOwnProperty.call(nowPlayingByUser, nowPlayingId)
    ? nowPlayingByUser[nowPlayingId]
    : (profile?.nowPlaying ?? null);
  // The realm mirror of the Last.fm track duplicates the card; hide it.
  const activityIsNowPlayingMirror = !!nowPlaying
    && activityType === 'Listening'
    && activityTextRaw === nowPlayingActivityText(nowPlaying);
  const activityLabel = activityType === 'Listening' ? t('lastfm.listeningTo') : activityType;
  const activityText =
    activityType && activityTextRaw && !activityIsNowPlayingMirror
      ? `${activityLabel} ${activityTextRaw}`
      : null;
  const isGameActivity = activityType === 'Playing' && !!activityTextRaw;
  const gameElapsed = formatGameElapsedClock(activityStartedAt, nowMs);

  useEffect(() => {
    if (!isGameActivity || !activityStartedAt) return;
    const timer = globalThis.setInterval(() => setNowMs(Date.now()), 1000);
    return () => globalThis.clearInterval(timer);
  }, [isGameActivity, activityStartedAt]);

  useEffect(() => {
    if (bannerKey === visibleBanner.key && visibleBanner.url) return;
    if (!bannerUrl) {
      setVisibleBanner({ key: bannerKey, url: null });
      return;
    }
    if (!visibleBanner.url) {
      setVisibleBanner({ key: bannerKey, url: bannerUrl });
      return;
    }

    let cancelled = false;
    void Image.prefetch(bannerUrl)
      .catch(() => false)
      .then(() => {
        if (!cancelled) setVisibleBanner({ key: bannerKey, url: bannerUrl });
      });
    return () => {
      cancelled = true;
    };
  }, [bannerKey, bannerUrl, visibleBanner.key, visibleBanner.url]);

  useEffect(() => {
    if (!isGameActivity || !activityTextRaw) {
      setGameIconUrl(null);
      return;
    }
    let cancelled = false;
    fetchIconByTitle(activityTextRaw)
      .then((url) => {
        if (!cancelled) setGameIconUrl(url);
      })
      .catch(() => {
        if (!cancelled) setGameIconUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isGameActivity, activityTextRaw]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.colors.bgApp }]}>
      <View style={styles.topBar}>
        <IconBtn icon={X} onPress={() => router.back()} accessibilityLabel={t('common.close')} />
      </View>

      {loading && !profile ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.colors.accent} />
        </View>
      ) : profile ? (
        <ScrollView contentContainerStyle={{ paddingBottom: theme.spacing.xxl }}>
          <View style={[styles.hero, { backgroundColor: theme.colors.bgElev1 }]}>
            {visibleBanner.url ? (
              <FadeInImage uri={visibleBanner.url} style={StyleSheet.absoluteFill} />
            ) : (
              <View
                style={[
                  StyleSheet.absoluteFill,
                  {
                    backgroundColor: theme.colors.bgSidebar,
                    borderBottomColor: theme.colors.line,
                    borderBottomWidth: 1,
                  },
                ]}
              />
            )}
          </View>

          <View style={{ paddingHorizontal: theme.spacing.lg }}>
            <View style={styles.profileHeader}>
              <Avatar
                username={profile.username}
                uri={profile.avatar}
                baseUrl={viewContext === 'central' ? AUTH_BASE : (activeServer?.url ?? serverUrl)}
                accountType={profile.accountType}
                size={96}
                status={status ?? null}
                style={{
                  borderWidth: 4,
                  borderColor: theme.colors.bgApp,
                  backgroundColor: theme.colors.bgElev2,
                }}
              />
              <View style={styles.nameBlock}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  <Text variant="title" numberOfLines={1} style={{ flexShrink: 1 }}>
                    {profile.displayName ?? profile.username}
                  </Text>
                  {profile.isBot ? <BotBadge size="md" /> : null}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                  <Text variant="bodySmall" color={theme.colors.text3}>
                    @{profile.username}
                  </Text>
                  {profile.pronouns ? (
                    <Text variant="bodySmall" color={theme.colors.text3}>
                      {profile.pronouns}
                    </Text>
                  ) : null}
                </View>
                {status ? (
                  <View style={styles.statusLine}>
                    <StatusDot status={status} size={8} />
                    <Text variant="caption" color={theme.colors.text3}>
                      {t(statusLabelKey(status))}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>

            {showProfileContextToggle ? (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: theme.spacing.sm }}>
                <Pressable
                  haptic
                  onPress={() => setViewContext('central')}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 7,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: viewContext === 'central' ? theme.colors.accent : theme.colors.lineSoft,
                    backgroundColor: viewContext === 'central' ? theme.colors.accent + '1f' : 'transparent',
                  }}
                >
                  <Text variant="caption" color={viewContext === 'central' ? theme.colors.accent : theme.colors.text3}>
                    Main Profile
                  </Text>
                </Pressable>
                <Pressable
                  haptic
                  onPress={() => setViewContext('server')}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 7,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: viewContext === 'server' ? theme.colors.accent : theme.colors.lineSoft,
                    backgroundColor: viewContext === 'server' ? theme.colors.accent + '1f' : 'transparent',
                  }}
                >
                  <Text variant="caption" color={viewContext === 'server' ? theme.colors.accent : theme.colors.text3}>
                    Server Profile
                  </Text>
                </Pressable>
                {profileRefreshing ? (
                  <View style={styles.contextLoading}>
                    <ActivityIndicator size="small" color={theme.colors.accent} />
                  </View>
                ) : null}
              </View>
            ) : null}

            {viewingCentralIdentity ? (
              <View style={{ marginTop: theme.spacing.lg }}>
                <Text variant="caption" color={theme.colors.text3} style={{ textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 }}>
                  Related Realms
                </Text>
                {relatedRealmsLoading ? (
                  <View style={styles.contextLoading}><ActivityIndicator size="small" color={theme.colors.accent} /></View>
                ) : relatedRealms.length > 0 ? (
                  <View style={{ gap: 8 }}>
                    {relatedRealms.map(({ server, localUserId }) => (
                      <Pressable
                        key={server.id}
                        haptic
                        onPress={() => {
                          void setActiveServer(server.id);
                          router.replace({ pathname: '/profile/[userId]', params: { userId: localUserId } });
                        }}
                        style={[styles.relatedRealmRow, { backgroundColor: theme.colors.bgElev1, borderColor: theme.colors.lineSoft }]}
                      >
                        <Avatar username={server.name} uri={server.iconUrl ?? null} size={28} />
                        <Text variant="subtitle" numberOfLines={1} style={{ flex: 1 }}>{server.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : (
                  <Text variant="bodySmall" color={theme.colors.text3}>{t('chat.noSharedRealms')}</Text>
                )}
              </View>
            ) : null}

            {customStatusText ? (
              <Text variant="bodySmall" color={theme.colors.text2} style={{ marginTop: theme.spacing.sm }}>
                {customStatusText}
              </Text>
            ) : null}
            {activityText && !isGameActivity ? (
              <Text variant="caption" color={theme.colors.text3} style={{ marginTop: 4 }}>
                {activityText}
              </Text>
            ) : null}

            {isGameActivity && activityTextRaw ? (
              <View
                style={{
                  marginTop: theme.spacing.md,
                  borderRadius: theme.radius.xl,
                  borderWidth: 1,
                  borderColor: theme.colors.accent + '55',
                  backgroundColor: theme.colors.bgElev1,
                  padding: theme.spacing.md,
                  shadowColor: theme.colors.accent,
                  shadowOpacity: 0.28,
                  shadowRadius: 18,
                  shadowOffset: { width: 0, height: 10 },
                  elevation: 10,
                }}
              >
                <View style={{ marginBottom: 10 }}>
                  <Text variant="caption" style={{ color: theme.colors.accent, fontWeight: '700', letterSpacing: 1.2 }}>
                    {t('profile.catLabExperimental')}
                  </Text>
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View
                    style={{
                      width: 72,
                      height: 72,
                      borderRadius: 14,
                      overflow: 'hidden',
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: theme.colors.bgElev2,
                    }}
                  >
                    {gameIconUrl ? (
                      <Image
                        source={{ uri: gameIconUrl }}
                        style={{ width: 72, height: 72 }}
                        resizeMode="cover"
                        onError={() => setGameIconUrl(null)}
                      />
                    ) : (
                      <Text variant="title">🎮</Text>
                    )}
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text variant="subtitle" numberOfLines={1}>
                      {activityTextRaw}
                    </Text>
                    <Text variant="caption" style={{ marginTop: 4, color: theme.colors.accent }}>
                      {gameElapsed ?? t('profile.activeNow')}
                    </Text>
                  </View>
                </View>
              </View>
            ) : null}

            {nowPlaying ? <NowPlayingCard track={nowPlaying} /> : null}

            {profile.bio ? (
              <View
                style={[
                  styles.bioCard,
                  {
                    backgroundColor: theme.colors.bgElev1,
                    borderRadius: theme.radius.lg,
                    padding: theme.spacing.md,
                    marginTop: theme.spacing.lg,
                    marginBottom: theme.spacing.lg,
                  },
                ]}
              >
                <Text variant="body" color={theme.colors.text2}>
                  {profile.bio}
                </Text>
              </View>
            ) : null}

            {!isSelf && canUseCentralSocialActions && (
              <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.md }}>
                {selfUser?.accountType === 'central' && viewContext === 'central' && <Pressable disabled={blockBusy} onPress={() => void toggleBlock()} style={[styles.actionBtn, { backgroundColor: theme.colors.bgElev1 }]}>
                  <Text color={theme.colors.danger}>{isBlocked ? 'Unblock user' : 'Block user'}</Text>
                </Pressable>}
                <Pressable
                  haptic
                  onPress={handleSendMessage}
                  style={[
                    styles.actionBtn,
                    {
                      backgroundColor: theme.colors.accent,
                      borderRadius: theme.radius.lg,
                    },
                  ]}
                >
                  <MessageCircle size={18} color={theme.colors.textOnAccent} />
                  <Text variant="subtitle" color={theme.colors.textOnAccent}>
                    {t('profile.sendMessage')}
                  </Text>
                </Pressable>

                {selfUser?.accountType === 'central' && (
                  <Pressable
                    haptic
                    onPress={() => {
                      if (isPendingOutgoing || requestSending) return;
                      if (isFriend) {
                        setConfirmRemoveOpen(true);
                      } else {
                        void handleAddFriend();
                      }
                    }}
                    style={[
                      styles.actionBtn,
                      {
                        backgroundColor: theme.colors.bgElev2,
                        borderRadius: theme.radius.lg,
                        borderWidth: isPendingOutgoing || requestSending ? 1 : 0,
                        borderColor: isPendingOutgoing || requestSending ? '#FACC15' : 'transparent',
                        opacity: isPendingOutgoing || requestSending ? 0.7 : 1,
                      },
                    ]}
                  >
                    {isPendingOutgoing || requestSending ? (
                      <Clock4 size={18} color="#FACC15" />
                    ) : (
                      <UserPlus size={18} color={isFriend ? theme.colors.danger : theme.colors.text} />
                    )}
                    <Text
                      variant="subtitle"
                      color={isPendingOutgoing || requestSending ? '#FACC15' : theme.colors.text}
                    >
                      {isFriend ? t('home.removeFriend') : (isPendingOutgoing || requestSending ? t('home.pending') : t('home.addFriend'))}
                    </Text>
                  </Pressable>
                )}
              </View>
            )}

            {/* Roles */}
            {(roles.length > 0 || privateRoles.length > 0) && (
              <View style={{ marginTop: theme.spacing.lg }}>
                <Text variant="caption" color={theme.colors.text3} style={{ textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 }}>
                  {viewContext === 'central' ? t('profile.rolesPrivate') : t('profile.roles')}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {viewContext === 'central'
                    ? privateRoles.map((r) => (
                      <View
                        key={r.id}
                        style={{
                          borderWidth: 1,
                          borderColor: r.color ?? theme.colors.lineSoft,
                          borderRadius: 4,
                          paddingHorizontal: 8,
                          paddingVertical: 3,
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 5,
                        }}
                      >
                        {r.color ? (
                          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: r.color }} />
                        ) : null}
                        <Text variant="caption" style={{ color: r.color ?? theme.colors.text2 }}>
                          {r.name}
                        </Text>
                      </View>
                    ))
                    : roles.map((r) => {
                      const accent = roleAccentColor(r);
                      const roleIconUrl = resolveRoleIconUrl(r.icon, activeServer?.url ?? serverUrl);
                      return (
                        <View
                          key={r.id}
                          style={{
                            borderWidth: 1,
                            borderColor: accent ?? theme.colors.lineSoft,
                            borderRadius: 4,
                            paddingHorizontal: 8,
                            paddingVertical: 3,
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 5,
                          }}
                        >
                          {roleIconUrl ? (
                            <Image source={{ uri: roleIconUrl }} style={styles.roleIcon} resizeMode="contain" />
                          ) : null}
                          {!roleIconUrl && accent && (
                            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: accent }} />
                          )}
                          <RoleNameText
                            color={r.color}
                            styleType={r.style_type}
                            styleColors={r.style_colors}
                            style={{ fontSize: 11, fontWeight: '500' }}
                          >
                            {r.name}
                          </RoleNameText>
                        </View>
                      );
                    })}
                </View>
              </View>
            )}

            {profile.isBot && profile.botId && !isSelf && viewContext === 'server' && activeServer?.url ? (
              <BotProfileSettings
                botId={profile.botId}
                requestedScopes={profile.botRequestedScopes}
                serverUrl={activeServer.url}
                token={activeServer.token || undefined}
              />
            ) : null}

            {/* Member since / Join dates */}
            <View style={{ marginTop: theme.spacing.lg, gap: 6 }}>
              {profile.serverJoinDate != null && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Calendar size={14} color={theme.colors.text3} />
                  <Text variant="caption" color={theme.colors.text3}>
                    {t('profile.memberSince', { date: new Date((profile.serverJoinDate ?? 0) * 1000).toLocaleDateString(i18n.language, { year: 'numeric', month: 'long', day: 'numeric' }) })}
                  </Text>
                </View>
              )}
              {profile.centralJoinDate != null && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Calendar size={14} color={theme.colors.text3} />
                  <Text variant="caption" color={theme.colors.text3}>
                    {t('profile.centralSince', { date: new Date((profile.centralJoinDate ?? 0) * 1000).toLocaleDateString(i18n.language, { year: 'numeric', month: 'long', day: 'numeric' }) })}
                  </Text>
                </View>
              )}
            </View>

            {/* Ongoing Central infractions (e.g. Limited Account), with expiry */}
            {(() => {
              const infractions = (profile.ongoingInfractions ?? []).filter(
                (infraction) => infraction && typeof infraction.expiresAt === 'number' && infraction.expiresAt * 1000 > Date.now(),
              );
              if (!infractions.length) return null;
              return (
                <View style={styles.infractionsCard}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <ShieldAlert size={14} color="#fbbf24" />
                    <Text variant="caption" style={{ color: '#fbbf24', fontWeight: '700' }}>
                      {t('profile.ongoingInfractions')}
                    </Text>
                  </View>
                  {infractions.map((infraction) => (
                    <Text key={`${infraction.type}-${infraction.expiresAt}`} variant="caption" color={theme.colors.text2}>
                      <Text variant="caption" style={{ color: '#fbbf24', fontWeight: '600' }}>
                        {infraction.label || 'Limited Account'}
                      </Text>
                      {` — ${t('profile.infractionExpires', { date: new Date(infraction.expiresAt * 1000).toLocaleDateString(i18n.language, { year: 'numeric', month: 'long', day: 'numeric' }) })}`}
                    </Text>
                  ))}
                </View>
              );
            })()}
          </View>
        </ScrollView>
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.spacing.xl }}>
          <Text variant="body" color={theme.colors.text3}>
            {t('profile.notFound')}
          </Text>
          {loadError ? (
            <Text variant="caption" color={theme.colors.text3} style={{ marginTop: 6, textAlign: 'center' }}>
              {loadError}
            </Text>
          ) : null}
        </View>
      )}

      <Sheet open={confirmRemoveOpen} onClose={() => setConfirmRemoveOpen(false)} maxHeightFraction={0.34}>
        <View style={{ paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.xl }}>
          <Text variant="subtitle" style={{ marginBottom: 10 }}>{t('home.removeFriend')}</Text>
          <Text variant="body" color={theme.colors.text2} style={{ marginBottom: 16 }}>
            {profile?.displayName || profile?.username
              ? t('home.removeFriendConfirm', { username: profile.displayName ?? profile.username })
              : t('profile.removeFriendConfirmFallback')}
          </Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable
              haptic
              onPress={() => setConfirmRemoveOpen(false)}
              style={[styles.confirmBtn, { backgroundColor: theme.colors.bgElev2, borderRadius: theme.radius.md }]}
            >
              <Text variant="body" color={theme.colors.text}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable
              haptic
              onPress={async () => {
                await handleRemoveFriend();
                setConfirmRemoveOpen(false);
              }}
              style={[styles.confirmBtn, { backgroundColor: theme.colors.danger, borderRadius: theme.radius.md }]}
            >
              <Text variant="body" color={theme.colors.textOnAccent} style={{ fontWeight: '700' }}>{t('common.remove')}</Text>
            </Pressable>
          </View>
        </View>
      </Sheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    padding: 1,
  },
  hero: {
    height: 200,
    overflow: 'hidden',
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 14,
    marginTop: -28,
  },
  nameBlock: {
    flex: 1,
    paddingBottom: 6,
  },
  statusLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  contextLoading: {
    minWidth: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  relatedRealmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  roleIcon: {
    width: 14,
    height: 14,
    borderRadius: 3,
  },
  bioCard: {},
  infractionsCard: {
    marginTop: 12,
    gap: 2,
    padding: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(251,191,36,0.45)',
    backgroundColor: 'rgba(251,191,36,0.08)',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    gap: 8,
  },
  confirmBtn: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
