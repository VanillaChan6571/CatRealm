const bit = (position: number) => 2 ** position;

const USER_GENERAL = {
  VIEW_CHANNELS: bit(0),
  READ_CHAT_HISTORY: bit(1),
  SEND_MESSAGES: bit(2),
  SEND_MESSAGES_IN_THREADS: bit(3),
  SEND_MESSAGES_IN_POSTS: bit(4),
  SEND_VOICE_MESSAGES: bit(5),
  CREATE_PUBLIC_THREADS: bit(6),
  CREATE_POST_IN_FORUMS: bit(7),
  EMBED_LINKS: bit(8),
  ATTACH_FILES: bit(9),
  ADD_REACTIONS: bit(10),
  SCREENSHARE: bit(11),
  CAMERA: bit(12),
  CONNECT_TO_VOICE: bit(13),
  USE_VOICE_ACTIVITY: bit(14),
  USE_PUSH_TO_TALK: bit(15),
  SEND_AUTO_TTS: bit(16),
  CHANGE_SELF_NICKNAME: bit(17),
} as const;

const HELPER_GENERAL = {
  BYPASS_SLOWMODE: bit(18),
  MANAGE_MESSAGES: bit(19),
  PIN_MESSAGES: bit(20),
  TIMEOUT_USER: bit(21),
  MOVE_VOICE_MEMBERS: bit(22),
  SERVER_DEAFEN_MEMBERS: bit(23),
  SERVER_MUTE_MEMBERS: bit(24),
  ACCEPT_OR_REJECT_MEMBER_APPLICATION: bit(25),
} as const;

const MOD_GENERAL = {
  CREATE_EVENTS: bit(26),
  CREATE_POLLS: bit(27),
  CREATE_PRIVATE_THREADS: bit(28),
  KICK_MEMBER: bit(29),
  MENTION_EVERYONE: bit(30),
  MANAGE_NICKNAMES: bit(31),
  MANAGE_POSTS: bit(32),
  MANAGE_EVENTS: bit(33),
  MANAGE_CUSTOM_EMOTES: bit(34),
  MANAGE_CUSTOM_STICKERS: bit(35),
  VIEW_AUDIT_LOG: bit(36),
} as const;

const ADMIN_GENERAL = {
  BAN_MEMBER: bit(37),
  TOGGLE_LOCAL_REGISTERING: bit(38),
  MANAGE_WEBHOOKS: bit(39),
  MANAGE_CHANNELS: bit(40),
  MANAGE_ROLES: bit(41),
  CREATE_INVITE: bit(42),
} as const;

const CO_OWNER = {
  ADMINISTRATOR: bit(43),
} as const;

const FLAT_PERMISSIONS = {
  ...USER_GENERAL,
  ...HELPER_GENERAL,
  ...MOD_GENERAL,
  ...ADMIN_GENERAL,
  ...CO_OWNER,
} as const;

export const PERMISSIONS = {
  USER: USER_GENERAL,
  HELPER: HELPER_GENERAL,
  MOD: MOD_GENERAL,
  ADMIN: ADMIN_GENERAL,
  CO_OWNER: CO_OWNER,
  ...FLAT_PERMISSIONS,
  // Backward-compatible aliases used by parts of the app.
  SEND_MEDIA: USER_GENERAL.ATTACH_FILES,
  MANAGE_SERVER: ADMIN_GENERAL.MANAGE_ROLES,
  ASSIGN_ROLES: ADMIN_GENERAL.MANAGE_ROLES,
  EDIT_MESSAGES: HELPER_GENERAL.MANAGE_MESSAGES,
  DELETE_MESSAGES: HELPER_GENERAL.MANAGE_MESSAGES,
  CREATE_THREADS: USER_GENERAL.CREATE_PUBLIC_THREADS,
  CREATE_INVITES: ADMIN_GENERAL.CREATE_INVITE,
  USE_EXTERNAL_EMOTES: bit(44),
  USE_EXTERNAL_EMOJIS: bit(44),
  USE_EXTERNAL_STICKERS: bit(45),
  SCHEDULE_MESSAGES: bit(46),
  PLAY_IN_THEATER: bit(47),
  MANAGE_BOTS: bit(48),
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

export function hasChannelPermission(
  userPermissions: number | undefined,
  channelPermissions: number | undefined,
  permission: number
) {
  const effective = typeof channelPermissions === 'number' ? channelPermissions : userPermissions;
  return hasPermission(effective, permission);
}
