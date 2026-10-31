import type { User } from '@/types';
import { hasChannelPermission, hasPermission, PERMISSIONS } from '@/utils/permissions';

export type TheaterRealmUser = Pick<User, 'id' | 'role' | 'isOwner' | 'permissions'>;

/** UI eligibility only; the realm still authorizes every playback command. */
export function canControlTheater(
  user: TheaterRealmUser | null,
  channelPermissions: number | undefined,
  hostUserId: string | null,
  selfTheaterUserId: string | null,
): boolean {
  return !!(
    user?.isOwner || user?.role === 'owner' ||
    hasPermission(user?.permissions, PERMISSIONS.MANAGE_CHANNELS) ||
    hasChannelPermission(user?.permissions, channelPermissions, PERMISSIONS.PLAY_IN_THEATER) ||
    (hostUserId && (selfTheaterUserId === hostUserId || user?.id === hostUserId))
  );
}
