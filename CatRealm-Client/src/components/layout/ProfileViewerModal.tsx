import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useUIStore } from '../../stores/uiStore';
import { useAuthStore } from '../../stores/authStore';
import { useServerStore } from '../../stores/serverStore';
import { createApi } from '../../lib/api';
import { AUTH_BASE, createAuthenticatedApi } from '../../lib/authApi';
import { writeClipboardText } from '../../lib/clipboard';
import type { PersonalFriendRole, Profile, ProfileBadge, Role } from '../../types';
import { PERMISSIONS, hasPermission } from '../../utils/permissions';
import { useBlockedUsersStore } from '../../stores/blockedUsersStore';
import { usePresenceStore } from '../../stores/presenceStore';
import { useFriendStore } from '../../stores/friendStore';
import { useDMStore } from '../../stores/dmStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { mergeCentralProfileIntoLoadedProfile } from '../../lib/profileMerge';
import { ProfileHeader } from '../profile/ProfileHeader';
import { ProfileActionButtons } from '../profile/ProfileActionButtons';
import { ProfileBioEditor } from '../profile/ProfileBioEditor';
import { ProfileGameActivityCard } from '../profile/ProfileGameActivityCard';
import { ProfileNowPlayingCard } from '../profile/ProfileNowPlayingCard';
import { normalizeNowPlaying, nowPlayingActivityText, useNowPlayingStore } from '../../stores/nowPlayingStore';
import { ProfileMemberSince } from '../profile/ProfileMemberSince';
import { ProfileMutualServers } from '../profile/ProfileMutualServers';
import { ProfileRoles } from '../profile/ProfileRoles';
import { ProfileNotes } from '../profile/ProfileNotes';
import { BotProfileSettings } from '../bots/BotProfileSettings';
import { ProfileNickname } from '../profile/ProfileNickname';

type RawProfile = Partial<Profile> & {
  display_name?: string | null;
  custom_status_text?: string | null;
  activity_type?: string | null;
  activity_text?: string | null;
  activity_started_at?: number | null;
  account_type?: 'local' | 'central' | 'bot';
  central_id?: string | null;
  central_join_date?: number;
  server_join_date?: number;
  social_profile_enabled?: boolean | number | null;
  social_profile_config?: unknown;
  is_owner?: boolean;
  is_bot?: boolean | number;
  badges?: unknown;
  nowPlaying?: unknown;
};

type InviteServerOption = {
  url: string;
  name: string;
  token: string;
};

function resolveProfileAssetUrl(
  asset: string | null | undefined,
  baseUrl: string | null
) {
  if (!asset) return null;
  if (/^https?:\/\//i.test(asset)) return asset;
  if (!baseUrl) return null;
  return `${baseUrl}${asset}`;
}

function normalizeProfileResponse(raw: RawProfile): Profile {
  const badges = Array.isArray(raw.badges)
    ? raw.badges
      .map((badge): ProfileBadge | null => {
        if (!badge || typeof badge !== 'object') return null;
        const data = badge as unknown as Record<string, unknown>;
        const id = typeof data.id === 'string' ? data.id : null;
        const label = typeof data.label === 'string' ? data.label : null;
        if (!id || !label) return null;
        return {
          id,
          label,
          description: typeof data.description === 'string' ? data.description : null,
          icon: typeof data.icon === 'string' ? data.icon : null,
          tone: typeof data.tone === 'string' ? data.tone as ProfileBadge['tone'] : undefined,
          awardedAt: typeof data.awardedAt === 'number'
            ? data.awardedAt
            : typeof data.awarded_at === 'number'
              ? data.awarded_at
              : null,
        };
      })
      .filter(Boolean) as ProfileBadge[]
    : undefined;

  return {
    id: raw.id || '',
    centralId: raw.centralId ?? raw.central_id ?? null,
    username: raw.username || '',
    role: raw.role || 'member',
    avatar: raw.avatar ?? null,
    banner: raw.banner ?? null,
    bio: raw.bio ?? null,
    pronouns: raw.pronouns ?? null,
    isOwner: raw.isOwner ?? raw.is_owner ?? false,
    accountType: raw.accountType ?? raw.account_type ?? 'local',
    status: raw.status ?? 'invisible',
    displayName: raw.displayName ?? raw.display_name ?? null,
    customStatusText: raw.customStatusText ?? raw.custom_status_text ?? null,
    socialProfileEnabled: raw.socialProfileEnabled
      ?? (raw.social_profile_enabled === true || raw.social_profile_enabled === 1),
    socialProfileConfig: normalizeSocialProfileConfig(raw.socialProfileConfig ?? raw.social_profile_config),
    activityType: raw.activityType ?? raw.activity_type ?? null,
    activityText: raw.activityText ?? raw.activity_text ?? null,
    activityStartedAt: raw.activityStartedAt ?? raw.activity_started_at ?? null,
    verified: raw.verified ?? false,
    isBot: raw.isBot ?? (raw.is_bot === 1 || raw.is_bot === true) ?? false,
    botId: raw.botId ?? null,
    botRequestedScopes: Array.isArray(raw.botRequestedScopes) ? raw.botRequestedScopes : undefined,
    centralJoinDate: raw.centralJoinDate ?? raw.central_join_date,
    serverJoinDate: raw.serverJoinDate ?? raw.server_join_date,
    clients: raw.clients,
    badges,
    nowPlaying: normalizeNowPlaying(raw.nowPlaying),
  };
}

function normalizeSocialProfileConfig(value: unknown): Profile['socialProfileConfig'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  const favoriteData = data.favoriteRealm && typeof data.favoriteRealm === 'object' && !Array.isArray(data.favoriteRealm)
    ? data.favoriteRealm as Record<string, unknown>
    : null;
  const favoriteRealm = favoriteData && typeof favoriteData.name === 'string' && favoriteData.name.trim()
    ? {
      name: favoriteData.name.trim(),
      url: typeof favoriteData.url === 'string' ? favoriteData.url : null,
      icon: typeof favoriteData.icon === 'string' ? favoriteData.icon : null,
      banner: typeof favoriteData.banner === 'string' ? favoriteData.banner : null,
    }
    : null;
  const links = Array.isArray(data.links)
    ? data.links
      .map((link) => {
        if (!link || typeof link !== 'object') return null;
        const row = link as Record<string, unknown>;
        if (row.type !== 'youtube' && row.type !== 'twitch') return null;
        if (typeof row.url !== 'string' || !row.url.trim()) return null;
        return {
          type: row.type,
          url: row.url.trim(),
          label: typeof row.label === 'string' ? row.label.trim() || null : null,
          image: typeof row.image === 'string' ? row.image.trim() || null : null,
          banner: typeof row.banner === 'string' ? row.banner.trim() || null : null,
          verified: row.verified === true,
        };
      })
      .filter(Boolean) as NonNullable<NonNullable<Profile['socialProfileConfig']>['links']>
    : [];

  return favoriteRealm || links.length > 0 ? { favoriteRealm, links } : null;
}

function hasEnabledFullSocialProfile(profile: Profile | null): boolean {
  return profile?.accountType === 'central' && profile.socialProfileEnabled === true;
}

export function ProfileViewerModal() {
  const { t } = useTranslation();
  const activeModal = useUIStore((s) => s.activeModal);
  const closeModal = useUIStore((s) => s.closeModal);
  const openModal = useUIStore((s) => s.openModal);
  const openFullscreenView = useUIStore((s) => s.openFullscreenView);
  const modalData = useUIStore((s) => s.modalData) as { userId: string } | null;
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const token = useAuthStore((s) => s.token);
  const viewer = useAuthStore((s) => s.user);
  const activeServerUrl = useServerStore((s) => s.activeServerUrl);
  const servers = useServerStore((s) => s.servers);
  const onlineUsers = usePresenceStore((s) => s.onlineUsers);
  const allMembers = usePresenceStore((s) => s.allMembers);
  const friends = useFriendStore((s) => s.friends);
  const nowPlayingByUser = useNowPlayingStore((s) => s.byUserId);
  const dmConversations = useDMStore((s) => s.conversations);
  const catLabFullProfileButton = useSettingsStore((s) => s.catLabFullProfileButton);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assignedRoles, setAssignedRoles] = useState<Role[]>([]);
  const [privateAssignedRoles, setPrivateAssignedRoles] = useState<PersonalFriendRole[]>([]);
  const [allRoles, setAllRoles] = useState<Role[]>([]);
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [savingRoles, setSavingRoles] = useState(false);
  const [resolvedBanner, setResolvedBanner] = useState<string | null>(null);
  const [fallbackBanner, setFallbackBanner] = useState<string | null>(null);
  const [bannerFailed, setBannerFailed] = useState(false);
  const [viewContext, setViewContext] = useState<'server' | 'central'>('server');
  const [isFriend, setIsFriend] = useState(false);
  const [hasPendingRequest, setHasPendingRequest] = useState(false);
  const [invitePanelOpen, setInvitePanelOpen] = useState(false);
  const [inviteServerUrl, setInviteServerUrl] = useState('');
  const [inviteMaxUses, setInviteMaxUses] = useState(0);
  const [inviteExpiresIn, setInviteExpiresIn] = useState(7 * 24 * 60 * 60);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [fullProfileUnavailableOpen, setFullProfileUnavailableOpen] = useState(false);

  const { isBlocked, blockUser, unblockUser } = useBlockedUsersStore();

  const isOwnProfile = !!viewer && (
    viewer.id === modalData?.userId ||
    viewer.id === profile?.id ||
    viewer.id === profile?.centralId
  );
  const inCentralContext = viewContext === 'central' || !activeServerUrl;
  const activeServerName = activeServerUrl
    ? (servers.find((entry) => entry.url === activeServerUrl)?.name ?? null)
    : null;
  const inviteServerOptions: InviteServerOption[] = viewer?.accountType === 'central'
    ? servers
      .filter((entry) => typeof entry.token === 'string' && entry.token.trim().length > 0)
      .map((entry) => ({
        url: entry.url,
        name: entry.name || entry.info?.name || new URL(entry.url).hostname,
        token: entry.token,
      }))
    : (serverUrl && token
      ? [{
        url: serverUrl,
        name: activeServerName || 'Current Server',
        token,
      }]
      : []);

  useEffect(() => {
    if (activeModal !== 'profileView' || !modalData?.userId) return;
    // Reset context when opening a profile or when the active server changes.
    setViewContext(activeServerUrl ? 'server' : 'central');
    setFullProfileUnavailableOpen(false);
  }, [activeModal, modalData?.userId, activeServerUrl]);

  useEffect(() => {
    if (activeModal !== 'profileView' || !modalData?.userId) return;
    let cancelled = false;

    setLoading(true);
    setError(null);
    setProfile(null);
    setResolvedBanner(null);
    setFallbackBanner(null);
    setBannerFailed(false);
    setAssignedRoles([]);
    setPrivateAssignedRoles([]);
    setRoleIds([]);
    setIsFriend(false);
    setHasPendingRequest(false);
    setInvitePanelOpen(false);
    setInviteServerUrl('');
    setInviteMaxUses(0);
    setInviteExpiresIn(7 * 24 * 60 * 60);
    setCreatingInvite(false);
    setInviteError(null);
    setInviteLink(null);
    setInviteCopied(false);

    const canUseCentralApi = viewer?.accountType === 'central' && !!token;
    const currentlyInServerContext = viewContext === 'server' && !!activeServerUrl;
    const useCentralAuthApi = canUseCentralApi && !currentlyInServerContext;
    const primaryApi = useCentralAuthApi ? createAuthenticatedApi() : createApi();

    (async () => {
      let loadedProfile: Profile | null = null;
      let centralProfile: Profile | null = null;
      const profileAssetBase = useCentralAuthApi ? AUTH_BASE : serverUrl;

      if (useCentralAuthApi) {
        // In central view, map server-local IDs to central IDs before querying auth.
        let lookupId = profile?.centralId || modalData.userId;
        try {
          const primaryRes = await primaryApi.get(`/api/profile/${lookupId}`);
          loadedProfile = normalizeProfileResponse(primaryRes.data as RawProfile);
        } catch (primaryErr) {
          const status = axios.isAxiosError(primaryErr) ? primaryErr.response?.status : undefined;
          if (status !== 404) throw primaryErr;

          const serverRes = await createApi().get(`/api/profile/${modalData.userId}`);
          const mappedCentralId: string | null = serverRes.data?.centralId ?? null;
          if (!mappedCentralId || mappedCentralId === lookupId) {
            throw primaryErr;
          }

          lookupId = mappedCentralId;
          const retryRes = await primaryApi.get(`/api/profile/${lookupId}`);
          loadedProfile = normalizeProfileResponse(retryRes.data as RawProfile);
        }
      } else {
        const primaryRes = await primaryApi.get(`/api/profile/${modalData.userId}`);
        loadedProfile = normalizeProfileResponse(primaryRes.data as RawProfile);
      }

      if (cancelled || !loadedProfile) return;

      if (loadedProfile.accountType === 'central' && canUseCentralApi) {
        const centralLookupId = loadedProfile.centralId || (useCentralAuthApi ? loadedProfile.id : null);
        if (centralLookupId) {
          try {
            const centralRes = await createAuthenticatedApi().get(`/api/profile/${centralLookupId}`);
            centralProfile = normalizeProfileResponse(centralRes.data as RawProfile);
          } catch {
            centralProfile = null;
          }
        }
      }

      loadedProfile = mergeCentralProfileIntoLoadedProfile(loadedProfile, centralProfile);

      setProfile(loadedProfile);

      const serverBanner = loadedProfile.banner ?? null;
      if (serverBanner) {
        setResolvedBanner(resolveProfileAssetUrl(serverBanner, profileAssetBase));
      } else if (centralProfile?.banner) {
        setResolvedBanner(resolveProfileAssetUrl(centralProfile.banner, AUTH_BASE));
      } else {
        setResolvedBanner(null);
      }

      setFallbackBanner(resolveProfileAssetUrl(centralProfile?.banner ?? null, AUTH_BASE));

      const friendTargetId = loadedProfile.centralId || (loadedProfile.accountType === 'central' ? loadedProfile.id : null);
      if (canUseCentralApi && friendTargetId && viewer?.id !== friendTargetId) {
        const authApi = createAuthenticatedApi();

        authApi
          .get('/api/friends')
          .then((res) => {
            if (cancelled) return;
            const centralFriends: { id: string }[] = res.data ?? [];
            setIsFriend(centralFriends.some((friend) => friend.id === friendTargetId));
          })
          .catch(() => {});

        authApi
          .get('/api/friends/requests')
          .then((res) => {
            if (cancelled) return;
            const outgoing: { to_user_id: string }[] = res.data.outgoing ?? [];
            setHasPendingRequest(outgoing.some((req) => req.to_user_id === friendTargetId));
          })
          .catch(() => {});
      }
    })()
      .catch((err) => {
        if (cancelled) return;
        const msg = axios.isAxiosError(err) ? err.response?.data?.error : 'Failed to load profile';
        setError(msg || 'Failed to load profile');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    if (!useCentralAuthApi) {
      const api = createApi();
      api
        .get(`/api/profile/${modalData.userId}/roles`)
        .then((res) => {
          setAssignedRoles(res.data.roles ?? []);
          setRoleIds(res.data.roleIds ?? []);
        })
        .catch(() => {});

      if (viewer && hasPermission(viewer.permissions, PERMISSIONS.MANAGE_ROLES)) {
        api
          .get('/api/admin/roles')
          .then((res) => setAllRoles(res.data ?? []))
          .catch(() => {});
      } else {
        setAllRoles([]);
      }
    } else {
      setAllRoles([]);
      const authApi = createAuthenticatedApi();
      authApi
        .get('/api/friends/personal-roles')
        .then((res) => {
          const roles: PersonalFriendRole[] = res.data.roles ?? [];
          const assignments: Record<string, string[]> = res.data.assignments ?? {};
          const assignedIds = new Set(assignments[modalData.userId] || []);
          setPrivateAssignedRoles(roles.filter((role) => assignedIds.has(role.id)));
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
    };
  }, [activeModal, modalData?.userId, serverUrl, activeServerUrl, viewContext, viewer?.accountType, viewer?.permissions, viewer?.id, token]);

  const canManageRoles = viewer && hasPermission(viewer.permissions, PERMISSIONS.MANAGE_ROLES);
  const isPrivateRolesContext = viewer?.accountType === 'central' && inCentralContext;
  const canViewServerProfile = !!activeServerUrl;
  const centralActionUserId = profile?.accountType === 'central'
    ? (profile.centralId || profile.id)
    : null;
  const showFullProfileButton = !!catLabFullProfileButton
    && !inCentralContext
    && !!centralActionUserId;
  const showMainSocialProfileButton = isOwnProfile && profile?.accountType === 'central';

  const handleSetRoles = async (nextRoleIds: string[]) => {
    if (!modalData?.userId || !canManageRoles) return;
    const prevRoleIds = roleIds;
    const prevAssignedRoles = assignedRoles;
    const roleMap = new Map<string, Role>();
    assignedRoles.forEach((role) => roleMap.set(role.id, role));
    allRoles.forEach((role) => roleMap.set(role.id, role));
    const optimisticRoles = nextRoleIds
      .map((id) => roleMap.get(id))
      .filter(Boolean) as Role[];

    setRoleIds(nextRoleIds);
    setAssignedRoles(optimisticRoles);
    setSavingRoles(true);
    try {
      const api = createApi();
      const res = await api.put(`/api/admin/users/${modalData.userId}/roles`, { roleIds: nextRoleIds });
      const updatedIds = res.data.roleIds ?? nextRoleIds;
      setRoleIds(updatedIds);
      const rolesMap = new Map<string, Role>();
      allRoles.forEach((role) => rolesMap.set(role.id, role));
      assignedRoles.forEach((role) => rolesMap.set(role.id, role));
      setAssignedRoles(updatedIds.map((id: string) => rolesMap.get(id)).filter(Boolean) as Role[]);
    } catch {
      setRoleIds(prevRoleIds);
      setAssignedRoles(prevAssignedRoles);
    } finally {
      setSavingRoles(false);
    }
  };

  const handleBannerError = () => {
    setBannerFailed(true);
    if (fallbackBanner && fallbackBanner !== resolvedBanner) {
      setResolvedBanner(fallbackBanner);
    } else {
      setResolvedBanner(null);
    }
  };

  const handleViewMainProfile = () => {
    // Switch to central context (keep modal open)
    setViewContext('central');
  };

  const handleViewFullProfile = () => {
    if (!hasEnabledFullSocialProfile(profile)) {
      setFullProfileUnavailableOpen(true);
      return;
    }

    handleViewMainProfile();
  };

  const handleViewServerProfile = () => {
    if (!activeServerUrl) return;
    setViewContext('server');
  };

  const handleEditMainSocialProfile = () => {
    openFullscreenView('socialProfileEditor');
  };

  const handleCloseProfileModal = () => {
    if (fullProfileUnavailableOpen) {
      setFullProfileUnavailableOpen(false);
      return;
    }

    closeModal();
  };

  const handleMessage = () => {
    const targetUserId = centralActionUserId || profile?.id;
    if (!targetUserId) return;
    openModal('dm', { userId: targetUserId, username: profile?.username || targetUserId, avatar: profile?.avatar });
  };

  const handleFriendRequest = () => {
    if (!profile) return;
    const authApi = createAuthenticatedApi();
    authApi
      .post('/api/friends/request', { username: profile.username })
      .then(() => {
        setHasPendingRequest(true);
      })
      .catch(() => {});
  };

  const handleRemoveFriend = () => {
    if (!centralActionUserId) return;
    const authApi = createAuthenticatedApi();
    authApi
      .delete(`/api/friends/${centralActionUserId}`)
      .then(() => {
        setIsFriend(false);
      })
      .catch(() => {});
  };

  const handleBlock = () => {
    if (!centralActionUserId) return;
    const api = createAuthenticatedApi(); // Blocking is always stored in central auth
    api
      .post(`/api/profile/block/${centralActionUserId}`)
      .then(() => {
        blockUser(centralActionUserId);
      })
      .catch(() => {});
  };

  const handleUnblock = () => {
    if (!centralActionUserId) return;
    const api = createAuthenticatedApi(); // Blocking is always stored in central auth
    api
      .delete(`/api/profile/block/${centralActionUserId}`)
      .then(() => {
        unblockUser(centralActionUserId);
      })
      .catch(() => {});
  };

  const handleInviteToServer = () => {
    if (profile?.isBot) return;
    setInvitePanelOpen(true);
    setInviteError(null);
    setInviteLink(null);
    setInviteCopied(false);
    if (inviteServerOptions.length === 0) {
      setInviteError('No available servers found for invite creation.');
      return;
    }
    if (!inviteServerOptions.some((option) => option.url === inviteServerUrl)) {
      setInviteServerUrl(inviteServerOptions[0].url);
    }
  };

  const handleCreateInvite = async () => {
    const selected = inviteServerOptions.find((option) => option.url === inviteServerUrl);
    if (!selected) {
      setInviteError('Select a server first.');
      return;
    }

    setCreatingInvite(true);
    setInviteError(null);
    setInviteCopied(false);
    try {
      const inviteApi = createApi(selected.url, selected.token);
      const response = await inviteApi.post('/api/invites', {
        channelId: null,
        maxUses: inviteMaxUses || 0,
        expiresIn: inviteExpiresIn || null,
      });

      const payload = response.data || {};
      const nextLink: string | null = payload.centralUrl
        || payload.directUrl
        || (payload.code ? `${window.location.origin}/invite/${payload.code}` : null);

      if (!nextLink) {
        setInviteError('Invite created but no URL was returned by the server.');
        return;
      }

      setInviteLink(nextLink);

      if (await writeClipboardText(nextLink)) {
        setInviteCopied(true);
      }
    } catch (err) {
      const message = axios.isAxiosError(err) ? err.response?.data?.error : null;
      setInviteError(message || 'Failed to create invite on the selected server.');
    } finally {
      setCreatingInvite(false);
    }
  };

  const handleCopyInviteLink = async () => {
    if (!inviteLink) return;
    if (!await writeClipboardText(inviteLink)) return;
    setInviteCopied(true);
  };

  const handleCopyUserId = () => {
    if (!profile) return;
    void writeClipboardText(profile.id);
    // Show success feedback
  };

  const handleBioUpdate = (newBio: string) => {
    if (profile) {
      setProfile({ ...profile, bio: newBio });
    }
  };

  const resolvedAvatar = profile
    ? resolveProfileAssetUrl(profile.avatar, inCentralContext ? AUTH_BASE : serverUrl)
    : null;
  const headerProfile = useMemo(() => {
    if (!profile) return null;
    const lookupIds = new Set([profile.id, profile.centralId, modalData?.userId].filter(Boolean));
    const onlineMatch = onlineUsers.find((entry) => lookupIds.has(entry.id));
    const allMembersMatch = allMembers.find((entry) => lookupIds.has(entry.id));
    const friendMatch = friends.find((entry) => lookupIds.has(entry.id));
    const dmMatch = dmConversations.find((entry) => lookupIds.has(entry.otherUserId));

    let nextStatus = profile.status;
    let nextCustomStatusText = profile.customStatusText ?? null;
    let nextActivityType = profile.activityType;
    let nextActivityText = profile.activityText;
    let nextActivityStartedAt = profile.activityStartedAt;
    let nextClients = profile.clients;
    // On the Central profile, live friend/DM presence beats the active realm's
    // roster, which can hold a stale or forced-offline entry for the same id.
    const useRealmPresence = !inCentralContext || (!friendMatch && !dmMatch?.otherStatus);

    if (useRealmPresence && onlineMatch) {
      nextStatus = onlineMatch.status ?? 'online';
      nextClients = onlineMatch.clients;
      if (Object.prototype.hasOwnProperty.call(onlineMatch, 'customStatusText')) nextCustomStatusText = onlineMatch.customStatusText ?? null;
      if (Object.prototype.hasOwnProperty.call(onlineMatch, 'activityType')) nextActivityType = onlineMatch.activityType ?? null;
      if (Object.prototype.hasOwnProperty.call(onlineMatch, 'activityText')) nextActivityText = onlineMatch.activityText ?? null;
      if (Object.prototype.hasOwnProperty.call(onlineMatch, 'activityStartedAt')) nextActivityStartedAt = onlineMatch.activityStartedAt ?? null;
    } else if (useRealmPresence && allMembersMatch) {
      // Member list entries are roster data, not authoritative live presence.
      nextStatus = 'invisible';
      nextCustomStatusText = null;
      nextActivityType = null;
      nextActivityText = null;
      nextActivityStartedAt = null;
    } else if (friendMatch) {
      nextStatus = friendMatch.status ?? nextStatus ?? 'invisible';
      nextClients = friendMatch.clients ?? nextClients;
      if (Object.prototype.hasOwnProperty.call(friendMatch, 'customStatusText')) nextCustomStatusText = friendMatch.customStatusText ?? null;
      if (Object.prototype.hasOwnProperty.call(friendMatch, 'activityType')) nextActivityType = friendMatch.activityType ?? null;
      if (Object.prototype.hasOwnProperty.call(friendMatch, 'activityText')) nextActivityText = friendMatch.activityText ?? null;
      if (Object.prototype.hasOwnProperty.call(friendMatch, 'activityStartedAt')) nextActivityStartedAt = friendMatch.activityStartedAt ?? null;
    } else if (dmMatch?.otherStatus) {
      nextStatus = dmMatch.otherStatus;
      nextClients = dmMatch.otherClients ?? nextClients;
    } else if (!nextStatus) {
      nextStatus = 'invisible';
    }

    return {
      ...profile,
      status: nextStatus,
      customStatusText: nextCustomStatusText,
      activityType: nextActivityType,
      activityText: nextActivityText,
      activityStartedAt: nextActivityStartedAt,
      clients: nextClients,
    };
  }, [profile, modalData?.userId, onlineUsers, allMembers, friends, dmConversations, inCentralContext]);

  const userIsBlocked = profile
    ? isBlocked(profile.id) || (profile.centralId ? isBlocked(profile.centralId) : false)
    : false;
  const gameActivity = headerProfile?.activityType === 'Playing' && headerProfile?.activityText
    ? {
      title: headerProfile.activityText,
      startedAt: headerProfile.activityStartedAt ?? null,
    }
    : null;
  // Live socket updates (self + friends) win over the snapshot from the fetch.
  const nowPlayingId = profile ? (profile.centralId || (profile.accountType === 'central' ? profile.id : null)) : null;
  const nowPlaying = nowPlayingId && Object.prototype.hasOwnProperty.call(nowPlayingByUser, nowPlayingId)
    ? nowPlayingByUser[nowPlayingId]
    : (profile?.nowPlaying ?? null);
  // The realm mirror of the Last.fm track duplicates the card; hide it.
  const activityIsNowPlayingMirror = !!nowPlaying
    && headerProfile?.activityType === 'Listening'
    && headerProfile.activityText === nowPlayingActivityText(nowPlaying);
  const headerSummaryProfile = headerProfile && (gameActivity || activityIsNowPlayingMirror)
    ? {
      ...headerProfile,
      activityType: null,
      activityText: null,
      activityStartedAt: null,
    }
    : headerProfile;
  const profileModalTitle = inCentralContext
    ? 'Main Profile'
    : activeServerName
      ? `Server Profile - ${activeServerName}`
      : 'Server Profile';

  return (
    <Modal
      open={activeModal === 'profileView'}
      onClose={handleCloseProfileModal}
      title={profileModalTitle}
      className="w-full max-w-5xl h-[min(92vh,980px)]"
    >
      <div className="space-y-4">
        {loading && <p className="text-sm text-text-muted">{t('profile.loading')}</p>}
        {error && <p className="text-sm text-danger">{error}</p>}
        {!loading && !error && profile && (
          <>
            {/* Profile Header */}
            <ProfileHeader
              inCentralContext={inCentralContext}
              profile={headerSummaryProfile || profile}
              resolvedAvatar={resolvedAvatar}
              resolvedBanner={resolvedBanner}
              bannerFailed={bannerFailed}
              onBannerError={handleBannerError}
            />

            {/* Action Buttons */}
            <ProfileActionButtons
              profile={profile}
              isOwnProfile={isOwnProfile}
              isBlocked={userIsBlocked}
              isFriend={isFriend}
              hasPendingRequest={hasPendingRequest}
              inCentralContext={inCentralContext}
              canViewServerProfile={canViewServerProfile}
              showFullProfileButton={showFullProfileButton}
              showMainSocialProfileButton={showMainSocialProfileButton}
              onMessage={handleMessage}
              onViewFullProfile={handleViewFullProfile}
              onEditMainSocialProfile={handleEditMainSocialProfile}
              onFriendRequest={handleFriendRequest}
              onRemoveFriend={handleRemoveFriend}
              onBlock={handleBlock}
              onUnblock={handleUnblock}
              onViewMainProfile={handleViewMainProfile}
              onViewServerProfile={handleViewServerProfile}
              onInviteToServer={handleInviteToServer}
              onCopyUserId={handleCopyUserId}
            />

            {gameActivity && (
              <ProfileGameActivityCard
                title={gameActivity.title}
                startedAt={gameActivity.startedAt}
              />
            )}

            {nowPlaying && <ProfileNowPlayingCard track={nowPlaying} />}

            {invitePanelOpen && !profile.isBot && (
              <div className="rounded-lg border border-border bg-bg-input p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-text-primary">{t('profile.inviteToServer')}</p>
                  <button
                    type="button"
                    onClick={() => setInvitePanelOpen(false)}
                    className="text-xs text-text-muted hover:text-text-primary"
                  >
                    {t('common.close')}
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <select
                    value={inviteServerUrl}
                    onChange={(e) => setInviteServerUrl(e.target.value)}
                    className="w-full bg-bg-chat border border-border rounded px-2 py-1.5 text-sm text-text-primary"
                  >
                    {inviteServerOptions.map((option) => (
                      <option key={option.url} value={option.url}>
                        {option.name}
                      </option>
                    ))}
                  </select>

                  <select
                    value={inviteMaxUses}
                    onChange={(e) => setInviteMaxUses(Number(e.target.value))}
                    className="w-full bg-bg-chat border border-border rounded px-2 py-1.5 text-sm text-text-primary"
                  >
                    <option value={0}>{t('profile.unlimitedUses')}</option>
                    <option value={1}>{t('profile.oneUse')}</option>
                    <option value={5}>{t('profile.uses', { count: 5 })}</option>
                    <option value={10}>{t('profile.uses', { count: 10 })}</option>
                    <option value={25}>{t('profile.uses', { count: 25 })}</option>
                    <option value={50}>{t('profile.uses', { count: 50 })}</option>
                  </select>

                  <select
                    value={inviteExpiresIn}
                    onChange={(e) => setInviteExpiresIn(Number(e.target.value))}
                    className="w-full bg-bg-chat border border-border rounded px-2 py-1.5 text-sm text-text-primary"
                  >
                    <option value={0}>{t('profile.untilRevoked')}</option>
                    <option value={7 * 24 * 60 * 60}>{t('profile.days', { count: 7 })}</option>
                    <option value={14 * 24 * 60 * 60}>{t('profile.days', { count: 14 })}</option>
                    <option value={30 * 24 * 60 * 60}>{t('profile.days', { count: 30 })}</option>
                    <option value={90 * 24 * 60 * 60}>{t('profile.days', { count: 90 })}</option>
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => { void handleCreateInvite(); }}
                    disabled={creatingInvite || inviteServerOptions.length === 0}
                    className="px-3 py-1.5 rounded bg-accent text-white text-sm disabled:opacity-50"
                  >
                    {creatingInvite ? t('profile.creatingInvite') : t('profile.createInvite')}
                  </button>
                  {inviteLink && (
                    <button
                      type="button"
                      onClick={() => { void handleCopyInviteLink(); }}
                      className="px-3 py-1.5 rounded border border-border text-sm text-text-primary hover:bg-bg-hover"
                    >
                      {inviteCopied ? t('profile.copied') : t('profile.copyLink')}
                    </button>
                  )}
                </div>

                {inviteError && <p className="text-xs text-danger">{inviteError}</p>}
                {inviteLink && (
                  <input
                    readOnly
                    value={inviteLink}
                    className="w-full bg-bg-chat border border-border rounded px-2 py-1.5 text-xs text-text-secondary"
                  />
                )}
              </div>
            )}

            {/* Bio Section */}
            <ProfileBioEditor
              bio={profile.bio}
              isOwnProfile={isOwnProfile}
              inCentralContext={inCentralContext || profile.accountType === 'central'}
              onUpdate={handleBioUpdate}
            />

            {/* Member Since */}
            <ProfileMemberSince
              profile={profile}
              serverName={activeServerName ?? undefined}
              activeServerUrl={activeServerUrl}
            />

            {/* Mutual servers (Central profiles only) */}
            {inCentralContext && viewer?.accountType === 'central' && profile.accountType === 'central' && !isOwnProfile && (
              <ProfileMutualServers centralId={profile.centralId || profile.id} />
            )}

            {/* Roles */}
            <ProfileRoles
              assignedRoles={assignedRoles}
              privateAssignedRoles={privateAssignedRoles}
              allRoles={allRoles}
              roleIds={roleIds}
              isPrivateRolesContext={isPrivateRolesContext}
              canManageRoles={!!canManageRoles}
              onRoleIdsChange={handleSetRoles}
              savingRoles={savingRoles}
            />

            {/* Bot consent settings (what this bot may do to the viewer) */}
            {profile.isBot && profile.botId && !isOwnProfile && (
              <BotProfileSettings botId={profile.botId} requestedScopes={profile.botRequestedScopes} />
            )}

            {/* Notes (only visible to viewer, not on own profile) */}
            <ProfileNotes
              userId={centralActionUserId}
              isOwnProfile={isOwnProfile}
            />

            {/* Nickname (only visible to viewer, not on own profile) */}
            <ProfileNickname userId={profile.id} inCentralContext={inCentralContext} isOwnProfile={isOwnProfile} />
          </>
        )}
      </div>

      <Modal
        open={fullProfileUnavailableOpen}
        onClose={() => setFullProfileUnavailableOpen(false)}
        title="Full Profile Unavailable"
        className="max-w-md"
      >
        <div className="space-y-4">
          <p className="text-sm leading-6 text-text-secondary">
            This user has not enabled or customized their Main Social Profile yet.
          </p>
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => setFullProfileUnavailableOpen(false)}
            >
              OK
            </Button>
          </div>
        </div>
      </Modal>
    </Modal>
  );
}
