import type { User } from '@/types';
import { hasChannelPermissionKey, hasPermissionKey } from '@/utils/permissions';

export type TheaterRealmUser = Pick<User, 'id' | 'role' | 'isOwner' | 'permissions' | 'permissionKeys'>;

/** UI eligibility only; the realm still authorizes every playback command. */
export function canControlTheater(
  user: TheaterRealmUser | null,
  channelPermissions: number | undefined,
  hostUserId: string | null,
  selfTheaterUserId: string | null,
  channelPermissionKeys?: readonly string[],
): boolean {
  return !!(
    user?.isOwner || user?.role === 'owner' ||
    hasPermissionKey(user?.permissionKeys, 'MANAGE_CHANNELS', user?.permissions) ||
    hasChannelPermissionKey(user?.permissionKeys, channelPermissionKeys, 'PLAY_IN_THEATER', user?.permissions, channelPermissions) ||
    (hostUserId && (selfTheaterUserId === hostUserId || user?.id === hostUserId))
  );
}
