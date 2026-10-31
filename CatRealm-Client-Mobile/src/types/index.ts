/**
 * Domain types — kept in lockstep with `CatRealm-Client/src/types/index.ts`.
 *
 * If you change a shape here, change it there too (and ideally in a future
 * shared `@catrealm/types` package). The web and mobile clients talk to the
 * SAME backend, so types must agree.
 */

export interface ServerInfo {
  name: string;
  description: string;
  mode: 'central_only' | 'mixed' | 'decentral_only';
  registrationOpen: boolean;
  userCount: number;
  mentionAlias?: string;
  serverIcon?: string | null;
  serverBanner?: string | null;
  secureMode?: {
    enabled: boolean;
    locked: boolean;
  };
  welcomeBoardEnabled?: boolean;
  mediaMaxMb?: number;
  version: string;
}

export type AccountType = 'local' | 'central' | 'bot';
export type UserStatus = 'online' | 'away' | 'sleeping' | 'invisible';
export type ActivityType = 'Playing' | 'Listening' | 'Watching' | 'Custom';
export type PresenceClient = 'desktop' | 'mobile';

export interface Reaction {
  emoji: string;
  count: number;
  users: string[];
  reacted: boolean;
}

// Live Last.fm track exposed by Central (`nowPlaying` on profiles and the
// `presence:now-playing` socket event). startedAt is unix seconds.
export interface NowPlaying {
  title: string;
  artist: string;
  album: string | null;
  imageUrl: string | null;
  url: string | null;
  startedAt: number | null;
}

export interface User {
  id: string;
  serverUserId?: string | null;
  username: string;
  role?: string;
  isOwner?: boolean;
  permissions?: number;
  accountType: AccountType;
  avatar?: string | null;
  banner?: string | null;
  bio?: string | null;
  pronouns?: string | null;
  status?: UserStatus;
  displayName?: string | null;
  customStatusText?: string | null;
  activityType?: ActivityType | null;
  activityText?: string | null;
  activityStartedAt?: number | null;
  verified?: boolean;
  clients?: PresenceClient[];
  viewAsRole?: {
    roleId: string;
    roleName: string;
    startedAt?: number | null;
  } | null;
  onboardingCompleted?: boolean;
}

export interface Profile {
  id: string;
  centralId?: string | null;
  username: string;
  role: string;
  avatar: string | null;
  banner?: string | null;
  bio: string | null;
  pronouns?: string | null;
  isOwner?: boolean;
  isBot?: boolean;
  botId?: string | null;
  botRequestedScopes?: BotScope[];
  accountType: AccountType;
  status?: UserStatus;
  displayName?: string | null;
  customStatusText?: string | null;
  activityType?: string | null;
  activityText?: string | null;
  activityStartedAt?: number | null;
  verified?: boolean;
  centralJoinDate?: number;
  serverJoinDate?: number;
  // Active Central enforcement (e.g. Limited Account), publicly visible on the
  // profile with the expiration date.
  ongoingInfractions?: Array<{ type: string; label?: string; expiresAt: number }>;
  /** Live Last.fm track, Central-owned. */
  nowPlaying?: NowPlaying | null;
  roles?: Role[];
  clients?: PresenceClient[];
}

export type BotScope = 'interactions' | 'profile' | 'mentions' | 'private_messages';

export interface BotConsent {
  decision: 'allowed' | 'denied';
  scopes: Partial<Record<BotScope, boolean>>;
}

export interface BotCommand {
  botId: string;
  botUserId: string;
  botUsername: string;
  botDisplayName?: string | null;
  botAvatar?: string | null;
  name: string;
  description: string;
  options: Array<{
    name: string;
    description: string;
    type: 'string' | 'user' | 'channel' | 'integer' | 'boolean';
    required: boolean;
  }>;
}

export interface Role {
  id: string;
  name: string;
  color: string | null;
  permissions: number;
  position: number;
  is_default: number;
  mentionable?: number | boolean;
  hoist?: number | boolean;
  icon?: string | null;
  style_type?: string | null;
  style_colors?: string | null;
}

export type ChannelType = 'basic' | 'media' | 'voice' | 'announcement' | 'forum' | 'theater' | 'rules';

export interface Channel {
  id: string;
  name: string;
  description: string | null;
  type: ChannelType;
  position: number;
  category_id?: string | null;
  created_at: number;
  slowmode?: number;
  defaultReaction?: string | null;
  nsfw?: boolean | number;
  effective_permissions?: number;
  forum_layout?: 'list' | 'gallery' | 'user_choice';
}

export interface Category {
  id: string;
  name: string;
  position: number;
  created_at: number;
}

export interface MessageAttachment {
  url: string;
  mime?: string | null;
  type?: string | null;
  size?: number | null;
  name?: string | null;
  thumbnailUrl?: string | null;
  thumbnail_url?: string | null;
}

export interface Message {
  id: string;
  channel_id: string;
  user_id: string;
  username: string;
  avatar: string | null;
  content: string;
  edited: number;
  is_owner?: number;
  is_bot?: number | boolean;
  role_color?: string | null;
  role_icon?: string | null;
  role_style_type?: string | null;
  role_style_colors?: string | null;
  attachment_url?: string | null;
  attachment_type?: string | null;
  attachment_size?: number | null;
  attachments?: MessageAttachment[] | null;
  nsfw_tags?: string[];
  message_type?: 'user' | 'system';
  system_type?: string | null;
  system_data?: Record<string, unknown> | null;
  thread_id?: string | null;
  created_at: number;
  display_name?: string | null;
  verified?: boolean;
  reply_to_id?: string | null;
  reply_to?: {
    id: string;
    user_id: string;
    content: string;
    username: string;
    channel_id: string;
  } | null;
  forward_from_id?: string | null;
  forward_from_user?: string | null;
  forward_from_channel?: string | null;
  forward_from_at?: number | null;
  embeds_enabled?: number;
  voice_expires_at?: number | null;
  scheduled_at?: number | null;
  reactions?: Reaction[];
  interaction?: {
    command: string;
    invokerId: string;
    invokerName: string;
  } | null;
  ephemeral?: boolean;
}

export interface OnlineUser {
  id: string;
  username: string;
  role: string;
  isOwner?: boolean;
  isBot?: boolean;
  roleColor?: string | null;
  roleHoist?: number | boolean;
  roleIcon?: string | null;
  roleName?: string | null;
  rolePosition?: number;
  roleStyleType?: string | null;
  roleStyleColors?: string | null;
  avatar?: string | null;
  status?: UserStatus;
  displayName?: string | null;
  customStatusText?: string | null;
  activityType?: string | null;
  activityText?: string | null;
  activityStartedAt?: number | null;
  accountType?: AccountType;
  verified?: boolean;
  clients?: PresenceClient[];
}

export interface Friend {
  id: string;
  username: string;
  avatar?: string | null;
  banner?: string | null;
  status?: UserStatus;
  customStatusText?: string | null;
  activityType?: ActivityType | null;
  activityText?: string | null;
  activityStartedAt?: number | null;
  clients?: PresenceClient[];
  created_at: number;
}

export interface FriendRequest {
  id: string;
  from_user_id: string;
  from_username: string;
  from_avatar?: string | null;
  to_user_id: string;
  to_username: string;
  to_avatar?: string | null;
  created_at: number;
}

export interface PersonalFriendRole {
  id: string;
  name: string;
  color?: string | null;
  position: number;
  friendCount: number;
  created_at?: number;
}

export interface FriendNickname {
  target_user_id: string;
  nickname: string;
}

export interface DMConversation {
  requestState?: 'pending' | 'accepted' | 'declined';
  outgoingRequestState?: 'pending' | 'accepted' | 'declined' | null;
  canSend?: boolean;
  isBlockedByThem?: boolean;
  id: string;
  otherUserId: string;
  otherUsername: string;
  otherDisplayName?: string | null;
  otherAvatar: string | null;
  otherStatus?: UserStatus;
  otherClients?: PresenceClient[];
  lastMessageAt: number;
  unreadCount: number;
  retentionDays?: number;
}

export type DMReaction = Reaction;

export interface DMMessage {
  id: string;
  conversationId: string;
  senderId: string;
  recipientId: string;
  text: string;
  messageType?: 'user' | 'system';
  systemType?: string | null;
  systemData?: Record<string, unknown> | null;
  attachmentUrl?: string | null;
  attachmentType?: string | null;
  attachmentSize?: number | null;
  attachmentName?: string | null;
  attachments?: MessageAttachment[] | null;
  nsfwTags?: string[];
  reactions?: DMReaction[];
  createdAt: number;
  delivered: boolean;
  read: boolean;
  voiceExpiresAt?: number | null;
  scheduledAt?: number | null;
  /** Milliseconds; set when the sender edits the message. */
  editedAt?: number | null;
}

export interface GroupChatSummary {
  id: string;
  name: string;
  avatar?: string | null;
  ownerId: string;
  ownerUsername: string;
  ownerDisplayName?: string | null;
  ownerAvatar?: string | null;
  retentionDays: number;
  activeKeyVersion: number;
  memberCount: number;
  unreadCount: number;
  isOwner: boolean;
  lastMessageAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface GroupChatMember {
  id: string;
  username: string;
  displayName?: string | null;
  avatar?: string | null;
  status?: UserStatus;
  customStatusText?: string | null;
  activityType?: ActivityType | null;
  activityText?: string | null;
  activityStartedAt?: number | null;
  isOwner: boolean;
  joinedAt: number;
}

export interface GroupChatDetail extends GroupChatSummary {
  members: GroupChatMember[];
}

export type GroupChatReaction = Reaction;

export interface GroupChatMessage {
  id: string;
  groupChatId: string;
  senderId: string;
  senderUsername: string;
  senderDisplayName?: string | null;
  senderAvatar?: string | null;
  senderIsOwner?: boolean;
  text: string;
  messageType?: 'user' | 'system';
  systemType?: string | null;
  systemData?: Record<string, unknown> | null;
  keyVersion: number;
  attachmentUrl?: string | null;
  attachmentType?: string | null;
  attachmentSize?: number | null;
  attachmentName?: string | null;
  attachments?: MessageAttachment[] | null;
  nsfwTags?: string[];
  reactions?: GroupChatReaction[];
  createdAt: number;
  scheduledAt?: number | null;
}

export interface Thread {
  id: string;
  channel_id: string;
  parent_message_id: string;
  name: string;
  created_by: string;
  created_at: number;
}

export interface ForumPost {
  id: string;
  channel_id: string;
  parent_message_id: string;
  name: string;
  created_by: string;
  created_at: number;
  archived: 0 | 1 | null;
  last_message_at: number | null;
  author_username: string;
  author_avatar: string | null;
  author_account_type: AccountType;
  author_display_name: string | null;
  preview_content: string;
  reply_count: number;
  cover_image: string | null;
  body_attachments?: MessageAttachment[] | null;
}

export interface TheaterQueueItem {
  id: string;
  channel_id: string;
  added_by: string;
  added_by_username?: string;
  title: string;
  source_url: string;
  source_type: 'url' | 'upload';
  cached_path?: string | null;
  cache_status: 'pending' | 'downloading' | 'ready' | 'error' | 'played';
  cache_progress: number;
  duration_seconds?: number | null;
  thumbnail_url?: string | null;
  votes: number;
  position: number;
  created_at: number;
  videoUrl?: string | null;
  myVote?: boolean;
}

export interface TheaterPlaybackState {
  channel_id: string;
  current_item_id: string | null;
  position_ms: number;
  duration_ms?: number;
  playing: boolean;
  updated_at: number;
  host_user_id?: string | null;
  videoUrl?: string | null;
  pendingAutoAdvance?: {
    currentItemId: string | null;
    nextItemId: string;
    nextTitle: string;
    nextAddedByUsername: string | null;
    startedAt: number;
    endsAt: number;
  } | null;
}

export interface CentralRegPending {
  pendingId: string;
  qrCode: string;
  manualCode: string;
}
