import { PERMISSIONS } from './permissions';

// Discord permission bit flags
const DISCORD_PERMS = {
  CREATE_INSTANT_INVITE: 0x1,
  KICK_MEMBERS: 0x2,
  BAN_MEMBERS: 0x4,
  ADMINISTRATOR: 0x8,
  MANAGE_CHANNELS: 0x10,
  MANAGE_GUILD: 0x20,
  ADD_REACTIONS: 0x40,
  VIEW_AUDIT_LOG: 0x80,
  PRIORITY_SPEAKER: 0x100,
  STREAM: 0x200,
  VIEW_CHANNEL: 0x400,
  SEND_MESSAGES: 0x800,
  SEND_TTS_MESSAGES: 0x1000,
  MANAGE_MESSAGES: 0x2000,
  EMBED_LINKS: 0x4000,
  ATTACH_FILES: 0x8000,
  READ_MESSAGE_HISTORY: 0x10000,
  MENTION_EVERYONE: 0x20000,
  USE_EXTERNAL_EMOJIS: 0x40000,
  VIEW_GUILD_INSIGHTS: 0x80000,
  CONNECT: 0x100000,
  SPEAK: 0x200000,
  MUTE_MEMBERS: 0x400000,
  DEAFEN_MEMBERS: 0x800000,
  MOVE_MEMBERS: 0x1000000,
  USE_VAD: 0x2000000,
  CHANGE_NICKNAME: 0x4000000,
  MANAGE_NICKNAMES: 0x8000000,
  MANAGE_ROLES: 0x10000000,
  MANAGE_WEBHOOKS: 0x20000000,
  MANAGE_EMOJIS_AND_STICKERS: 0x40000000,
  USE_APPLICATION_COMMANDS: 0x80000000,
  REQUEST_TO_SPEAK: 0x100000000,
  MANAGE_EVENTS: 0x200000000,
  MANAGE_THREADS: 0x400000000,
  CREATE_PUBLIC_THREADS: 0x800000000,
  CREATE_PRIVATE_THREADS: 0x1000000000,
  USE_EXTERNAL_STICKERS: 0x2000000000,
  SEND_MESSAGES_IN_THREADS: 0x4000000000,
  USE_EMBEDDED_ACTIVITIES: 0x8000000000,
  MODERATE_MEMBERS: 0x10000000000,
};

const CATREALM_EXTERNAL_EMOTES = 0x40000;
const CATREALM_EXTERNAL_STICKERS = 0x2000000000;

function toPermissionBits(value: number | bigint): bigint {
  if (typeof value === 'bigint') return value;
  if (!Number.isFinite(value)) return 0n;
  const normalized = Math.trunc(value);
  // Legacy signed-32 values should be interpreted as unsigned masks.
  if (normalized < 0) return BigInt(normalized >>> 0);
  return BigInt(normalized);
}

function hasDiscordPermission(permissions: bigint, flag: number): boolean {
  const mask = BigInt(flag);
  return (permissions & mask) === mask;
}

export interface DiscordRole {
  id: string;
  name: string;
  permissions: string;
  color: number;
  hoist: boolean;
  mentionable: boolean;
  position: number;
}

export interface DiscordChannel {
  id: string;
  type: number; // 0=text, 2=voice, 4=category, 5=announcement
  name: string;
  position: number;
  parent_id?: string | null;
  topic?: string;
  nsfw?: boolean;
  permission_overwrites?: any[];
}

export interface DiscordTemplate {
  name: string;
  description?: string;
  roles: DiscordRole[];
  channels: DiscordChannel[];
}

export interface ParsedRole {
  name: string;
  color: string | null;
  permissions: number;
  position: number;
  mentionable: boolean;
  hoist: boolean;
}

export interface ParsedChannel {
  name: string;
  type: string;
  position: number;
  parentId: string | null;
  description?: string;
  nsfw?: boolean;
  permissionOverwrites?: any[];
}

export interface ParsedTemplate {
  name: string;
  description: string;
  roles: ParsedRole[];
  channels: ParsedChannel[];
  categories: Array<{ name: string; position: number }>;
  warnings: string[];
}

/**
 * Maps Discord permission bits to CatRealm permission bits
 */
export function mapDiscordPermissions(discordPerms: string | number): number {
  let perms = 0n;
  try {
    perms = typeof discordPerms === 'string'
      ? BigInt(discordPerms)
      : BigInt(Math.trunc(discordPerms));
  } catch {
    perms = 0n;
  }
  let catrealmPerms = 0n;
  const addPermission = (bit: number) => {
    catrealmPerms |= toPermissionBits(bit);
  };

  // Administrator grants all permissions (ADMINISTRATOR permission in CatRealm)
  if (hasDiscordPermission(perms, DISCORD_PERMS.ADMINISTRATOR)) {
    return PERMISSIONS.ADMINISTRATOR; // Grant Administrator flag
  }

  // ═══ User General Permissions ═══
  if (hasDiscordPermission(perms, DISCORD_PERMS.VIEW_CHANNEL)) addPermission(PERMISSIONS.VIEW_CHANNELS);
  if (hasDiscordPermission(perms, DISCORD_PERMS.READ_MESSAGE_HISTORY)) addPermission(PERMISSIONS.READ_CHAT_HISTORY);
  if (hasDiscordPermission(perms, DISCORD_PERMS.SEND_MESSAGES)) addPermission(PERMISSIONS.SEND_MESSAGES);
  if (hasDiscordPermission(perms, DISCORD_PERMS.SEND_MESSAGES_IN_THREADS)) addPermission(PERMISSIONS.SEND_MESSAGES_IN_THREADS);
  // SEND_MESSAGES_IN_POSTS - no direct Discord equivalent, use SEND_MESSAGES
  if (hasDiscordPermission(perms, DISCORD_PERMS.SEND_MESSAGES)) addPermission(PERMISSIONS.SEND_MESSAGES_IN_POSTS);
  // SEND_VOICE_MESSAGES - Discord doesn't have this specific perm, use SEND_MESSAGES
  if (hasDiscordPermission(perms, DISCORD_PERMS.SEND_MESSAGES)) addPermission(PERMISSIONS.SEND_VOICE_MESSAGES);
  if (hasDiscordPermission(perms, DISCORD_PERMS.CREATE_PUBLIC_THREADS)) addPermission(PERMISSIONS.CREATE_PUBLIC_THREADS);
  // CREATE_POST_IN_FORUMS - use CREATE_PUBLIC_THREADS as proxy
  if (hasDiscordPermission(perms, DISCORD_PERMS.CREATE_PUBLIC_THREADS)) addPermission(PERMISSIONS.CREATE_POST_IN_FORUMS);
  if (hasDiscordPermission(perms, DISCORD_PERMS.EMBED_LINKS)) addPermission(PERMISSIONS.EMBED_LINKS);
  if (hasDiscordPermission(perms, DISCORD_PERMS.ATTACH_FILES)) addPermission(PERMISSIONS.ATTACH_FILES);
  if (hasDiscordPermission(perms, DISCORD_PERMS.ADD_REACTIONS)) addPermission(PERMISSIONS.ADD_REACTIONS);
  // SCREENSHARE - Discord doesn't have separate perm, use STREAM
  if (hasDiscordPermission(perms, DISCORD_PERMS.STREAM)) addPermission(PERMISSIONS.SCREENSHARE);
  // CAMERA - Discord doesn't have separate perm, use STREAM
  if (hasDiscordPermission(perms, DISCORD_PERMS.STREAM)) addPermission(PERMISSIONS.CAMERA);
  if (hasDiscordPermission(perms, DISCORD_PERMS.CONNECT)) addPermission(PERMISSIONS.CONNECT_TO_VOICE);
  if (hasDiscordPermission(perms, DISCORD_PERMS.USE_VAD)) addPermission(PERMISSIONS.USE_VOICE_ACTIVITY);
  // USE_PUSH_TO_TALK - no direct Discord perm, grant if has CONNECT
  if (hasDiscordPermission(perms, DISCORD_PERMS.CONNECT)) addPermission(PERMISSIONS.USE_PUSH_TO_TALK);
  if (hasDiscordPermission(perms, DISCORD_PERMS.SEND_TTS_MESSAGES)) addPermission(PERMISSIONS.SEND_AUTO_TTS);
  if (hasDiscordPermission(perms, DISCORD_PERMS.CHANGE_NICKNAME)) addPermission(PERMISSIONS.CHANGE_SELF_NICKNAME);
  if (hasDiscordPermission(perms, DISCORD_PERMS.USE_EXTERNAL_EMOJIS)) addPermission(CATREALM_EXTERNAL_EMOTES);
  if (hasDiscordPermission(perms, DISCORD_PERMS.USE_EXTERNAL_STICKERS)) addPermission(CATREALM_EXTERNAL_STICKERS);
  if (hasDiscordPermission(perms, DISCORD_PERMS.CREATE_INSTANT_INVITE)) addPermission(PERMISSIONS.CREATE_INVITE);

  // ═══ Helper General Permissions ═══
  // BYPASS_SLOWMODE - grant to anyone with MANAGE_MESSAGES
  if (hasDiscordPermission(perms, DISCORD_PERMS.MANAGE_MESSAGES)) addPermission(PERMISSIONS.BYPASS_SLOWMODE);
  if (hasDiscordPermission(perms, DISCORD_PERMS.MANAGE_MESSAGES)) addPermission(PERMISSIONS.MANAGE_MESSAGES);
  if (hasDiscordPermission(perms, DISCORD_PERMS.MANAGE_MESSAGES)) addPermission(PERMISSIONS.PIN_MESSAGES);
  if (hasDiscordPermission(perms, DISCORD_PERMS.MODERATE_MEMBERS)) addPermission(PERMISSIONS.TIMEOUT_USER);
  if (hasDiscordPermission(perms, DISCORD_PERMS.MOVE_MEMBERS)) addPermission(PERMISSIONS.MOVE_VOICE_MEMBERS);
  if (hasDiscordPermission(perms, DISCORD_PERMS.DEAFEN_MEMBERS)) addPermission(PERMISSIONS.SERVER_DEAFEN_MEMBERS);
  if (hasDiscordPermission(perms, DISCORD_PERMS.MUTE_MEMBERS)) addPermission(PERMISSIONS.SERVER_MUTE_MEMBERS);
  // ACCEPT_OR_REJECT_MEMBER_APPLICATION - no direct Discord perm

  // ═══ Mod General Permissions ═══
  if (hasDiscordPermission(perms, DISCORD_PERMS.MANAGE_EVENTS)) addPermission(PERMISSIONS.CREATE_EVENTS);
  // CREATE_POLLS - no Discord equivalent
  if (hasDiscordPermission(perms, DISCORD_PERMS.CREATE_PRIVATE_THREADS)) addPermission(PERMISSIONS.CREATE_PRIVATE_THREADS);
  if (hasDiscordPermission(perms, DISCORD_PERMS.KICK_MEMBERS)) addPermission(PERMISSIONS.KICK_MEMBER);
  if (hasDiscordPermission(perms, DISCORD_PERMS.MENTION_EVERYONE)) addPermission(PERMISSIONS.MENTION_EVERYONE);
  if (hasDiscordPermission(perms, DISCORD_PERMS.MANAGE_NICKNAMES)) addPermission(PERMISSIONS.MANAGE_NICKNAMES);
  if (hasDiscordPermission(perms, DISCORD_PERMS.MANAGE_THREADS)) addPermission(PERMISSIONS.MANAGE_POSTS);
  if (hasDiscordPermission(perms, DISCORD_PERMS.MANAGE_EVENTS)) addPermission(PERMISSIONS.MANAGE_EVENTS);
  if (hasDiscordPermission(perms, DISCORD_PERMS.MANAGE_EMOJIS_AND_STICKERS)) addPermission(PERMISSIONS.MANAGE_CUSTOM_EMOTES);
  if (hasDiscordPermission(perms, DISCORD_PERMS.MANAGE_EMOJIS_AND_STICKERS)) addPermission(PERMISSIONS.MANAGE_CUSTOM_STICKERS);
  if (hasDiscordPermission(perms, DISCORD_PERMS.VIEW_AUDIT_LOG)) addPermission(PERMISSIONS.VIEW_AUDIT_LOG);

  // ═══ Admin General Permissions ═══
  if (hasDiscordPermission(perms, DISCORD_PERMS.BAN_MEMBERS)) addPermission(PERMISSIONS.BAN_MEMBER);
  // TOGGLE_LOCAL_REGISTERING - no Discord equivalent
  if (hasDiscordPermission(perms, DISCORD_PERMS.MANAGE_WEBHOOKS)) addPermission(PERMISSIONS.MANAGE_WEBHOOKS);
  if (hasDiscordPermission(perms, DISCORD_PERMS.MANAGE_CHANNELS)) addPermission(PERMISSIONS.MANAGE_CHANNELS);
  if (hasDiscordPermission(perms, DISCORD_PERMS.MANAGE_ROLES)) addPermission(PERMISSIONS.MANAGE_ROLES);

  // Note: Discord permissions not mapped (for template compatibility only):
  // - USE_APPLICATION_COMMANDS
  // - USE_EXTERNAL_APPS
  // - USE_EMBEDDED_ACTIVITIES
  // - USE_SOUNDBOARD
  // - USE_EXTERNAL_SOUNDS
  // - VIEW_GUILD_INSIGHTS
  // - PRIORITY_SPEAKER
  // - REQUEST_TO_SPEAK
  // These are accepted in templates but don't map to CatRealm features

  if (catrealmPerms > BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number.MAX_SAFE_INTEGER;
  }
  return Number(catrealmPerms);
}

/**
 * Validates a Discord template JSON structure
 */
export function validateTemplate(template: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!template || typeof template !== 'object') {
    errors.push('Template must be a valid JSON object');
    return { valid: false, errors };
  }

  if (typeof template.name !== 'string' || template.name.trim().length === 0) {
    errors.push('Template must have a valid name');
  }

  if (template.roles && !Array.isArray(template.roles)) {
    errors.push('Roles must be an array');
  }

  if (template.channels && !Array.isArray(template.channels)) {
    errors.push('Channels must be an array');
  }

  // Validate roles structure
  if (Array.isArray(template.roles)) {
    template.roles.forEach((role: any, index: number) => {
      if (!role.name || typeof role.name !== 'string') {
        errors.push(`Role at index ${index} is missing a valid name`);
      }
    });
  }

  // Validate channels structure
  if (Array.isArray(template.channels)) {
    template.channels.forEach((channel: any, index: number) => {
      if (!channel.name || typeof channel.name !== 'string') {
        errors.push(`Channel at index ${index} is missing a valid name`);
      }
      if (typeof channel.type !== 'number') {
        errors.push(`Channel at index ${index} is missing a valid type`);
      }
    });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Parses a Discord server template JSON into CatRealm format
 */
export function parseDiscordTemplate(json: string): ParsedTemplate {
  let template: DiscordTemplate;
  const warnings: string[] = [];

  try {
    template = JSON.parse(json);
  } catch (error) {
    throw new Error('Invalid JSON format');
  }

  const validation = validateTemplate(template);
  if (!validation.valid) {
    throw new Error(`Template validation failed: ${validation.errors.join(', ')}`);
  }

  const parsed: ParsedTemplate = {
    name: template.name || 'Imported Server',
    description: template.description || '',
    roles: [],
    channels: [],
    categories: [],
    warnings: [],
  };

  // Parse roles
  if (Array.isArray(template.roles)) {
    template.roles.forEach((role) => {
      // Skip @everyone role
      if (role.name === '@everyone') {
        return;
      }

      const permissions = mapDiscordPermissions(role.permissions || '0');
      const color = role.color
        ? `#${role.color.toString(16).padStart(6, '0')}`
        : null;

      parsed.roles.push({
        name: role.name,
        color,
        permissions,
        position: role.position || 0,
        mentionable: role.mentionable || false,
        hoist: role.hoist || false,
      });
    });
  }

  // Parse channels and categories
  if (Array.isArray(template.channels)) {
    const categoryMap = new Map<string, { name: string; position: number }>();

    // First pass: identify categories
    template.channels.forEach((channel) => {
      if (channel.type === 4) {
        categoryMap.set(channel.id, {
          name: channel.name,
          position: channel.position || 0,
        });
        parsed.categories.push({
          name: channel.name,
          position: channel.position || 0,
        });
      }
    });

    // Second pass: parse regular channels
    template.channels.forEach((channel) => {
      if (channel.type === 0 || channel.type === 2 || channel.type === 5) {
        // Text, Voice, or Announcement
        let type = 'basic';
        if (channel.type === 5) {
          warnings.push(`Channel "${channel.name}" is an announcement channel - importing as basic channel`);
        }
        if (channel.type === 2) {
          type = 'voice';
        }

        parsed.channels.push({
          name: channel.name,
          type,
          position: channel.position || 0,
          parentId: channel.parent_id || null,
          description: channel.topic,
          nsfw: channel.nsfw || false,
          permissionOverwrites: channel.permission_overwrites || [],
        });
      }
    });
  }

  // Add warnings for unmapped features
  const hasStageChannels = template.channels?.some((ch) => ch.type === 13);
  if (hasStageChannels) {
    warnings.push('Stage channels are not supported in CatRealm and will be skipped');
  }

  const hasForumChannels = template.channels?.some((ch) => ch.type === 15);
  if (hasForumChannels) {
    warnings.push('Forum channels are not supported in CatRealm and will be skipped');
  }

  parsed.warnings = warnings;

  return parsed;
}

/**
 * Generates a preview summary of what will be imported
 */
export function generateImportPreview(parsed: ParsedTemplate): string {
  const lines: string[] = [];

  lines.push(`**Server Name:** ${parsed.name}`);
  if (parsed.description) {
    lines.push(`**Description:** ${parsed.description}`);
  }
  lines.push('');

  lines.push(`**Roles to Import:** ${parsed.roles.length}`);
  const hoistedRoles = parsed.roles.filter(r => r.hoist);
  if (hoistedRoles.length > 0) {
    lines.push(`  (${hoistedRoles.length} hoisted roles)`);
  }
  parsed.roles.forEach((role) => {
    const colorBadge = role.color ? `[${role.color}]` : '[No color]';
    const hoistBadge = role.hoist ? ' 📌' : '';
    lines.push(`  • ${role.name} ${colorBadge}${hoistBadge}`);
  });
  lines.push('');

  lines.push(`**Categories to Import:** ${parsed.categories.length}`);
  parsed.categories.forEach((cat) => {
    lines.push(`  • ${cat.name}`);
  });
  lines.push('');

  lines.push(`**Channels to Import:** ${parsed.channels.length}`);
  const nsfwChannels = parsed.channels.filter((c: any) => c.nsfw);
  const channelsWithOverwrites = parsed.channels.filter((c: any) => c.permissionOverwrites?.length > 0);
  if (nsfwChannels.length > 0) {
    lines.push(`  (${nsfwChannels.length} NSFW channels)`);
  }
  if (channelsWithOverwrites.length > 0) {
    lines.push(`  (${channelsWithOverwrites.length} channels with permission overwrites)`);
  }
  parsed.channels.forEach((ch: any) => {
    const typeIcon = ch.type === 'voice' ? '🔊' : ch.type === 'announcement' ? '📢' : ch.type === 'forum' ? '💬' : '#';
    const nsfwBadge = ch.nsfw ? ' 🔞' : '';
    const overwriteBadge = ch.permissionOverwrites?.length > 0 ? ` [${ch.permissionOverwrites.length} overwrites]` : '';
    lines.push(`  • ${typeIcon}${ch.name}${nsfwBadge}${overwriteBadge}`);
  });

  if (parsed.warnings.length > 0) {
    lines.push('');
    lines.push('**⚠️ Warnings:**');
    parsed.warnings.forEach((warning) => {
      lines.push(`  • ${warning}`);
    });
  }

  return lines.join('\n');
}
