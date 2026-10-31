/**
 * Profile response normalization + Central merge — mirrors the desktop client
 * (`ProfileViewerModal.normalizeProfileResponse` / `lib/profileMerge.ts`).
 *
 * Self-hosted realms serve profile fields in snake_case (`display_name`,
 * `activity_type`, …) while Central serves camelCase. Everything must be
 * normalized before rendering. For central-account members viewed in server
 * context, the realm profile is then enriched with the Central profile —
 * Central is the authority for presence/bio/activity.
 */

import type { AccountType, Profile, UserStatus } from '@/types';
import { normalizeNowPlaying } from '@/stores/nowPlayingStore';

export type RawProfile = Partial<Profile> & {
  display_name?: string | null;
  custom_status_text?: string | null;
  activity_type?: string | null;
  activity_text?: string | null;
  activity_started_at?: number | null;
  account_type?: AccountType;
  central_id?: string | null;
  central_join_date?: number;
  server_join_date?: number;
  is_owner?: boolean;
  is_bot?: boolean | number;
  bot_id?: string | null;
  bot_requested_scopes?: Profile['botRequestedScopes'];
  nowPlaying?: unknown;
};

export function normalizeProfileResponse(raw: RawProfile): Profile {
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
    isBot: raw.isBot ?? (raw.is_bot === 1 || raw.is_bot === true),
    botId: raw.botId ?? raw.bot_id ?? null,
    botRequestedScopes: Array.isArray(raw.botRequestedScopes)
      ? raw.botRequestedScopes
      : (Array.isArray(raw.bot_requested_scopes) ? raw.bot_requested_scopes : undefined),
    accountType: raw.accountType ?? raw.account_type ?? 'local',
    status: (raw.status ?? 'invisible') as UserStatus,
    displayName: raw.displayName ?? raw.display_name ?? null,
    customStatusText: raw.customStatusText ?? raw.custom_status_text ?? null,
    activityType: raw.activityType ?? raw.activity_type ?? null,
    activityText: raw.activityText ?? raw.activity_text ?? null,
    activityStartedAt: raw.activityStartedAt ?? raw.activity_started_at ?? null,
    verified: raw.verified ?? false,
    centralJoinDate: raw.centralJoinDate ?? raw.central_join_date,
    serverJoinDate: raw.serverJoinDate ?? raw.server_join_date,
    ongoingInfractions: raw.ongoingInfractions,
    roles: raw.roles,
    clients: raw.clients,
    nowPlaying: normalizeNowPlaying(raw.nowPlaying),
  };
}

export function mergeCentralProfileIntoProfile(loadedProfile: Profile, centralProfile: Profile | null): Profile {
  if (!centralProfile) return loadedProfile;
  return {
    ...loadedProfile,
    displayName: loadedProfile.displayName ?? centralProfile.displayName ?? null,
    customStatusText: centralProfile.customStatusText ?? null,
    activityType: centralProfile.activityType ?? null,
    activityText: centralProfile.activityText ?? null,
    activityStartedAt: centralProfile.activityStartedAt ?? null,
    bio: centralProfile.bio ?? loadedProfile.bio ?? null,
    pronouns: loadedProfile.pronouns ?? centralProfile.pronouns ?? null,
    verified: loadedProfile.verified || centralProfile.verified,
    centralJoinDate: centralProfile.centralJoinDate ?? loadedProfile.centralJoinDate,
    ongoingInfractions: centralProfile.ongoingInfractions ?? loadedProfile.ongoingInfractions,
    nowPlaying: centralProfile.nowPlaying ?? null,
  };
}
