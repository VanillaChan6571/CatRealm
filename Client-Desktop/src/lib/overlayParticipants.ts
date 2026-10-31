import { useMemo } from 'react';
import { useVoiceStore } from '../stores/voiceStore';
import { useCallStore } from '../stores/callStore';
import { useAuthStore } from '../stores/authStore';
import { useMediaStore } from '../stores/mediaStore';
import { resolveAvatarUrl } from '../utils/avatar';
import { AUTH_BASE } from './authApi';
import { getOverlayPersonKey } from './overlayPersonKey';

export { getOverlayPersonKey };

export type OverlayParticipant = {
  /** Id within the call context (local user id on self-hosted voice, central id in calls). */
  id: string;
  /** Stable person key for per-person settings; see getOverlayPersonKey. */
  key: string;
  username: string;
  avatarUrl: string | null;
  speaking: boolean;
  muted: boolean;
  deafened: boolean;
  /** The local user (their own pack applies when no per-person override exists). */
  isSelf: boolean;
};

/** Resolves a voice-channel avatar path against the voice server URL. */
function resolveVoiceAvatarUrl(avatar: string | null, serverUrl: string | null): string | null {
  if (!avatar) return null;
  if (/^https?:\/\//i.test(avatar)) return avatar;
  if (serverUrl) return serverUrl.replace(/\/$/, '') + (avatar.startsWith('/') ? avatar : '/' + avatar);
  return avatar;
}

/**
 * Everyone the OBS overlay should show right now. Priority: voice channel >
 * group call > DM call (where the local user is included alongside the peer).
 */
export function useOverlayParticipants(): { inVoice: boolean; users: OverlayParticipant[] } {
  const voiceUsers = useVoiceStore((s) => s.users);
  const speakingByUser = useVoiceStore((s) => s.speakingByUser);
  const activeChannelId = useVoiceStore((s) => s.activeChannelId);
  const voiceServerUrl = useVoiceStore((s) => s.voiceServerUrl);

  const activeDMCall = useCallStore((s) => s.activeDMCall);
  const activeGroupCall = useCallStore((s) => s.activeGroupCall);
  const callSpeakingByUser = useCallStore((s) => s.callSpeakingByUser);
  const callIsMuted = useCallStore((s) => s.isMuted);
  const callIsDeafened = useCallStore((s) => s.isDeafened);

  const authUser = useAuthStore((s) => s.user);
  // On self-hosted voice the LiveKit identity is this server's local user id.
  const selfVoiceIdentity = useMediaStore((s) => s.activeSession?.identity ?? null);

  return useMemo(() => {
    if (activeChannelId !== null) {
      // Server voice channel — avatars resolve against voiceServerUrl (local/self-hosted)
      return {
        inVoice: true,
        users: Object.values(voiceUsers).map((u) => ({
          id: u.id,
          key: getOverlayPersonKey(u.id, voiceServerUrl),
          username: u.username,
          avatarUrl: resolveVoiceAvatarUrl(u.avatar, voiceServerUrl),
          speaking: !!speakingByUser[u.id],
          muted: u.muted,
          deafened: u.deafened,
          isSelf: u.id === selfVoiceIdentity,
        })),
      };
    }
    if (activeGroupCall && activeGroupCall.status === 'active') {
      // Group call — avatars are central, resolve against AUTH_BASE
      return {
        inVoice: true,
        users: activeGroupCall.participants.map((p) => ({
          id: p.userId,
          key: getOverlayPersonKey(p.userId, null),
          username: p.displayName || p.username,
          avatarUrl: resolveAvatarUrl(p.avatar ?? undefined, AUTH_BASE, 'central'),
          speaking: !!callSpeakingByUser[p.userId],
          muted: p.muted ?? false,
          deafened: p.deafened ?? false,
          isSelf: p.userId === authUser?.id,
        })),
      };
    }
    if (activeDMCall && activeDMCall.status === 'active') {
      // DM call — central avatars, resolve against AUTH_BASE
      const remoteUser: OverlayParticipant = {
        id: activeDMCall.otherUserId,
        key: getOverlayPersonKey(activeDMCall.otherUserId, null),
        username: activeDMCall.otherUsername,
        avatarUrl: resolveAvatarUrl(activeDMCall.otherAvatar ?? undefined, AUTH_BASE, 'central'),
        speaking: !!callSpeakingByUser[activeDMCall.otherUserId],
        muted: activeDMCall.otherMuted ?? false,
        deafened: activeDMCall.otherDeafened ?? false,
        isSelf: false,
      };
      if (!authUser) return { inVoice: true, users: [remoteUser] };
      const localUser: OverlayParticipant = {
        id: authUser.id,
        key: getOverlayPersonKey(authUser.id, null),
        username: authUser.displayName || authUser.username,
        avatarUrl: resolveAvatarUrl(authUser.avatar ?? undefined, AUTH_BASE, authUser.accountType === 'central' ? 'central' : undefined),
        speaking: !!callSpeakingByUser[authUser.id],
        muted: callIsMuted,
        deafened: callIsDeafened,
        isSelf: true,
      };
      return { inVoice: true, users: [localUser, remoteUser] };
    }
    // Not in any voice/call context
    return { inVoice: false, users: [] };
  }, [
    voiceUsers, speakingByUser, activeChannelId, voiceServerUrl, selfVoiceIdentity,
    activeDMCall, activeGroupCall, callSpeakingByUser, callIsMuted, callIsDeafened,
    authUser,
  ]);
}
