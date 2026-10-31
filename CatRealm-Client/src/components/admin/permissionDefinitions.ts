import { PERMISSIONS } from '../../utils/permissions';

export const PERMISSION_CATEGORIES = {
  userGeneral: {
    title: 'User General Permissions',
    permissions: [
      {
        key: 'VIEW_CHANNELS',
        label: 'View Channels',
        description: 'See channels in the server',
        bit: PERMISSIONS.VIEW_CHANNELS,
      },
      {
        key: 'READ_CHAT_HISTORY',
        label: 'Read Chat History',
        description: 'View message history in channels',
        bit: PERMISSIONS.READ_CHAT_HISTORY,
      },
      {
        key: 'SEND_MESSAGES',
        label: 'Send Messages in Chat',
        description: 'Send messages in text channels',
        bit: PERMISSIONS.SEND_MESSAGES,
      },
      {
        key: 'SEND_MESSAGES_IN_THREADS',
        label: 'Send Messages in Threads',
        description: 'Send messages in thread discussions',
        bit: PERMISSIONS.SEND_MESSAGES_IN_THREADS,
      },
      {
        key: 'SEND_MESSAGES_IN_POSTS',
        label: 'Send Messages in Posts',
        description: 'Send messages in forum posts',
        bit: PERMISSIONS.SEND_MESSAGES_IN_POSTS,
      },
      {
        key: 'SEND_VOICE_MESSAGES',
        label: 'Send Voice Messages in Chat',
        description: 'Send voice message attachments',
        bit: PERMISSIONS.SEND_VOICE_MESSAGES,
      },
      {
        key: 'CREATE_PUBLIC_THREADS',
        label: 'Create Public Threads',
        description: 'Create public thread discussions',
        bit: PERMISSIONS.CREATE_PUBLIC_THREADS,
      },
      {
        key: 'CREATE_POST_IN_FORUMS',
        label: 'Create Post in Forums',
        description: 'Create new forum posts',
        bit: PERMISSIONS.CREATE_POST_IN_FORUMS,
      },
      {
        key: 'EMBED_LINKS',
        label: 'Embed Links',
        description: 'Post links with embeds/previews',
        bit: PERMISSIONS.EMBED_LINKS,
      },
      {
        key: 'ATTACH_FILES',
        label: 'Attach Files',
        description: 'Upload and attach files to messages',
        bit: PERMISSIONS.ATTACH_FILES,
      },
      {
        key: 'ADD_REACTIONS',
        label: 'Add Reactions',
        description: 'React to messages with emoji',
        bit: PERMISSIONS.ADD_REACTIONS,
      },
      {
        key: 'SCREENSHARE',
        label: 'Screenshare',
        description: 'Share screen in voice channels',
        bit: PERMISSIONS.SCREENSHARE,
      },
      {
        key: 'CAMERA',
        label: 'Camera',
        description: 'Use camera in voice channels',
        bit: PERMISSIONS.CAMERA,
      },
      {
        key: 'CONNECT_TO_VOICE',
        label: 'Connect to Voice',
        description: 'Join voice channels',
        bit: PERMISSIONS.CONNECT_TO_VOICE,
      },
      {
        key: 'USE_VOICE_ACTIVITY',
        label: 'Use Voice Activity',
        description: 'Use voice activation detection',
        bit: PERMISSIONS.USE_VOICE_ACTIVITY,
      },
      {
        key: 'USE_PUSH_TO_TALK',
        label: 'Use Push-To-Talk',
        description: 'Use push-to-talk in voice',
        bit: PERMISSIONS.USE_PUSH_TO_TALK,
      },
      {
        key: 'SEND_AUTO_TTS',
        label: 'Send Auto TTS in Chat',
        description: 'Send text-to-speech messages',
        bit: PERMISSIONS.SEND_AUTO_TTS,
      },
      {
        key: 'CHANGE_SELF_NICKNAME',
        label: 'Change Self Nickname',
        description: 'Change own nickname',
        bit: PERMISSIONS.CHANGE_SELF_NICKNAME,
      },
      {
        key: 'USE_EXTERNAL_EMOTES',
        label: 'Use External Emotes',
        description: 'Use emotes from other servers',
        bit: PERMISSIONS.USE_EXTERNAL_EMOTES,
      },
      {
        key: 'USE_EXTERNAL_STICKERS',
        label: 'Use External Stickers',
        description: 'Use stickers from other servers',
        bit: PERMISSIONS.USE_EXTERNAL_STICKERS,
      },
      {
        key: 'SCHEDULE_MESSAGES',
        label: 'Schedule Messages',
        description: 'Schedule messages to be sent at a future time',
        bit: PERMISSIONS.SCHEDULE_MESSAGES,
      },
      {
        key: 'CREATE_INVITE',
        label: 'Create Invite',
        description: 'Create invite links for channels and servers',
        bit: PERMISSIONS.CREATE_INVITE,
      },
    ],
  },
  helperGeneral: {
    title: 'Helper General Permissions',
    permissions: [
      {
        key: 'BYPASS_SLOWMODE',
        label: 'Bypass Slowmode',
        description: 'Send messages without slowmode restrictions',
        bit: PERMISSIONS.BYPASS_SLOWMODE,
      },
      {
        key: 'MANAGE_MESSAGES',
        label: 'Manage Messages',
        description: 'Edit and delete any messages',
        bit: PERMISSIONS.MANAGE_MESSAGES,
      },
      {
        key: 'PIN_MESSAGES',
        label: 'Pin Messages',
        description: 'Pin and unpin messages in channels',
        bit: PERMISSIONS.PIN_MESSAGES,
      },
      {
        key: 'TIMEOUT_USER',
        label: 'Timeout User',
        description: 'Temporarily restrict users from messaging',
        bit: PERMISSIONS.TIMEOUT_USER,
      },
      {
        key: 'MOVE_VOICE_MEMBERS',
        label: 'Move Voice Members',
        description: 'Move members between voice channels',
        bit: PERMISSIONS.MOVE_VOICE_MEMBERS,
      },
      {
        key: 'SERVER_DEAFEN_MEMBERS',
        label: 'Server Deafen Members',
        description: 'Server-deafen members in voice',
        bit: PERMISSIONS.SERVER_DEAFEN_MEMBERS,
      },
      {
        key: 'SERVER_MUTE_MEMBERS',
        label: 'Server Mute Members',
        description: 'Server-mute members in voice',
        bit: PERMISSIONS.SERVER_MUTE_MEMBERS,
      },
      {
        key: 'ACCEPT_OR_REJECT_MEMBER_APPLICATION',
        label: 'Accept or Reject Member Application',
        description: 'Process membership applications',
        bit: PERMISSIONS.ACCEPT_OR_REJECT_MEMBER_APPLICATION,
      },
    ],
  },
  modGeneral: {
    title: 'Mod General Permissions',
    permissions: [
      {
        key: 'CREATE_EVENTS',
        label: 'Create Events',
        description: 'Create and schedule server events',
        bit: PERMISSIONS.CREATE_EVENTS,
      },
      {
        key: 'CREATE_POLLS',
        label: 'Create Polls',
        description: 'Create polls for members to vote on',
        bit: PERMISSIONS.CREATE_POLLS,
      },
      {
        key: 'CREATE_PRIVATE_THREADS',
        label: 'Create Private Threads',
        description: 'Create private thread discussions',
        bit: PERMISSIONS.CREATE_PRIVATE_THREADS,
      },
      {
        key: 'KICK_MEMBER',
        label: 'Kick Member',
        description: 'Remove members (they can rejoin)',
        bit: PERMISSIONS.KICK_MEMBER,
      },
      {
        key: 'MENTION_EVERYONE',
        label: 'Mention @everyone, @here, and All Roles',
        description: 'Use @everyone, @here, and mention all roles',
        bit: PERMISSIONS.MENTION_EVERYONE,
      },
      {
        key: 'MANAGE_NICKNAMES',
        label: 'Manage Nicknames',
        description: 'Change other members\' nicknames',
        bit: PERMISSIONS.MANAGE_NICKNAMES,
      },
      {
        key: 'MANAGE_POSTS',
        label: 'Manage Posts',
        description: 'Manage forum posts and threads',
        bit: PERMISSIONS.MANAGE_POSTS,
      },
      {
        key: 'MANAGE_EVENTS',
        label: 'Manage Events',
        description: 'Edit and delete server events',
        bit: PERMISSIONS.MANAGE_EVENTS,
      },
      {
        key: 'MANAGE_CUSTOM_EMOTES',
        label: 'Manage Custom Emotes',
        description: 'Add, edit, and delete custom emoji',
        bit: PERMISSIONS.MANAGE_CUSTOM_EMOTES,
      },
      {
        key: 'MANAGE_CUSTOM_STICKERS',
        label: 'Manage Custom Stickers',
        description: 'Add, edit, and delete custom stickers',
        bit: PERMISSIONS.MANAGE_CUSTOM_STICKERS,
      },
      {
        key: 'VIEW_AUDIT_LOG',
        label: 'View Audit Log',
        description: 'View server audit logs and moderation history',
        bit: PERMISSIONS.VIEW_AUDIT_LOG,
      },
    ],
  },
  adminGeneral: {
    title: 'Admin General Permissions',
    permissions: [
      {
        key: 'BAN_MEMBER',
        label: 'Ban Member',
        description: 'Permanently ban members from the server',
        bit: PERMISSIONS.BAN_MEMBER,
      },
      {
        key: 'TOGGLE_LOCAL_REGISTERING',
        label: 'Toggle Local Registering',
        description: 'Enable/disable new user registration',
        bit: PERMISSIONS.TOGGLE_LOCAL_REGISTERING,
      },
      {
        key: 'MANAGE_WEBHOOKS',
        label: 'Manage Webhooks',
        description: 'Create and manage webhooks',
        bit: PERMISSIONS.MANAGE_WEBHOOKS,
      },
      {
        key: 'MANAGE_BOTS',
        label: 'Manage Bots',
        description: 'Create bot accounts, manage their tokens and profiles',
        bit: PERMISSIONS.MANAGE_BOTS,
      },
      {
        key: 'MANAGE_CHANNELS',
        label: 'Manage Channels',
        description: 'Create, edit, and delete channels',
        bit: PERMISSIONS.MANAGE_CHANNELS,
      },
      {
        key: 'MANAGE_ROLES',
        label: 'Manage Roles',
        description: 'Create, edit, and delete roles',
        bit: PERMISSIONS.MANAGE_ROLES,
      },
    ],
  },
  coOwner: {
    title: 'Co-Owner Permissions',
    permissions: [
      {
        key: 'ADMINISTRATOR',
        label: 'Administrator',
        description: 'Grants all permissions except ownership transfer. Can be revoked by owner.',
        bit: PERMISSIONS.ADMINISTRATOR,
      },
    ],
  },
  discordImportOnly: {
    title: 'Discord Import Only (Display Only - No Function)',
    description: 'These permissions are recognized during Discord template imports but do not have any functionality in CatRealm at this time.',
    permissions: [
      {
        key: 'USE_ACTIVITIES',
        label: 'Use Activities',
        description: 'Discord-only: Use embedded activities in voice channels',
        bit: 0, // No actual permission bit
      },
      {
        key: 'USE_EXTERNAL_APPS',
        label: 'Use External Apps',
        description: 'Discord-only: Use external apps in the server',
        bit: 0,
      },
      {
        key: 'USE_APPLICATION_COMMANDS',
        label: 'Use Application Commands',
        description: 'Discord-only: Use application commands (slash commands)',
        bit: 0,
      },
      {
        key: 'USE_SOUNDBOARD',
        label: 'Use Soundboard',
        description: 'Discord-only: Use soundboard in voice channels',
        bit: 0,
      },
      {
        key: 'USE_EXTERNAL_SOUNDS',
        label: 'Use External Sounds',
        description: 'Discord-only: Use sounds from other servers',
        bit: 0,
      },
      {
        key: 'VIEW_SERVER_INSIGHTS',
        label: 'View Server Insights',
        description: 'Discord-only: View server analytics and insights',
        bit: 0,
      },
      {
        key: 'PRIORITY_SPEAKER',
        label: 'Priority Speaker',
        description: 'Discord-only: Be heard over others in voice channels',
        bit: 0,
      },
      {
        key: 'REQUEST_TO_SPEAK',
        label: 'Request to Speak',
        description: 'Discord-only: Request to speak in stage channels',
        bit: 0,
      },
      {
        key: 'SET_VOICE_CHANNEL_STATUS',
        label: 'Set Voice Channel Status',
        description: 'Discord-only: Set custom status in voice channels',
        bit: 0,
      },
    ],
  },
};

export const CHANNEL_OVERWRITE_CATEGORY_KEYS: Array<keyof typeof PERMISSION_CATEGORIES> = [
  'userGeneral',
  'helperGeneral',
  'modGeneral',
  'adminGeneral',
  'coOwner',
];
