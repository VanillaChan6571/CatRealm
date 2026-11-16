const bit = (position: number) => 2 ** position;

export const PERMISSIONS = {
  READ_CHAT_HISTORY: bit(1),
  SEND_MESSAGES: bit(2),
  SEND_MESSAGES_IN_THREADS: bit(3),
  SEND_MESSAGES_IN_POSTS: bit(4),
  CREATE_POST_IN_FORUMS: bit(7),
  ATTACH_FILES: bit(9),
  ADD_REACTIONS: bit(10),
  MANAGE_CHANNELS: bit(40),
  PLAY_IN_THEATER: bit(47),
  MANAGE_MESSAGES: bit(19),
  PIN_MESSAGES: bit(20),
  MANAGE_POSTS: bit(32),
  ADMINISTRATOR: bit(43),
  USE_EXTERNAL_EMOTES: bit(44),
  USE_EXTERNAL_STICKERS: bit(45),
} as const;

function toPermissionBits(value: number | undefined): bigint {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0n;
  const normalized = Math.trunc(value);
  if (normalized < 0) return BigInt(normalized >>> 0);
  return BigInt(normalized);
}

export function hasPermission(permissions: number | undefined, permission: number) {
  const userBits = toPermissionBits(permissions);
  if (userBits === 0n) return false;
  const permissionBits = toPermissionBits(permission);
  const adminBits = toPermissionBits(PERMISSIONS.ADMINISTRATOR);
  if ((userBits & adminBits) === adminBits) return true;
  return (userBits & permissionBits) === permissionBits;
}

export function hasPermissionKey(permissionKeys: readonly string[] | undefined, key: string, legacyPermissions?: number) {
  if (Array.isArray(permissionKeys)) {
    return permissionKeys.includes('ADMINISTRATOR') || permissionKeys.includes(key);
  }
  const legacyBit = (PERMISSIONS as Record<string, number>)[key];
  return typeof legacyBit === 'number' && hasPermission(legacyPermissions, legacyBit);
}

export function hasChannelPermissionKey(
  userPermissionKeys: readonly string[] | undefined,
  channelPermissionKeys: readonly string[] | undefined,
  key: string,
  userPermissions?: number,
  channelPermissions?: number,
) {
  if (Array.isArray(channelPermissionKeys)) return hasPermissionKey(channelPermissionKeys, key);
  if (typeof channelPermissions === 'number') {
    const legacyBit = (PERMISSIONS as Record<string, number>)[key];
    return typeof legacyBit === 'number' && hasPermission(channelPermissions, legacyBit);
  }
  return hasPermissionKey(userPermissionKeys, key, userPermissions);
}

export function hasChannelPermission(
  userPermissions: number | undefined,
  channelPermissions: number | undefined,
  permission: number,
) {
  const effective = typeof channelPermissions === 'number' ? channelPermissions : userPermissions;
  return hasPermission(effective, permission);
}
