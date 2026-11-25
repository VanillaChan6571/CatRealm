export interface ServerInfo {
  name: string;
  description: string;
  mode: 'central_only' | 'mixed' | 'decentral_only';
  registrationOpen: boolean;
  userCount: number;
  mentionAlias?: string;
  defaultRoleName?: string | null;
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
  permissionKeys?: string[];
  accountType: 'local' | 'central';
  avatar?: string | null;
  banner?: string | null;
  bio?: string | null;
  status?: 'online' | 'away' | 'sleeping' | 'invisible';
  displayName?: string | null;
  customStatusText?: string | null;
  socialProfileEnabled?: boolean;
  socialProfileConfig?: SocialProfileConfig | null;
  activityType?: 'Playing' | 'Listening' | 'Watching' | 'Custom' | null;
  activityText?: string | null;
  activityStartedAt?: number | null;
  verified?: boolean;
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
  accountType: 'local' | 'central' | 'bot';
  status?: 'online' | 'away' | 'sleeping' | 'invisible';
  displayName?: string | null;
  customStatusText?: string | null;
  socialProfileEnabled?: boolean;
  socialProfileConfig?: SocialProfileConfig | null;
  activityType?: string | null;
  activityText?: string | null;
  activityStartedAt?: number | null;
  verified?: boolean;
  isBot?: boolean;
  botId?: string | null;
  botRequestedScopes?: BotScope[];
  botEnabled?: boolean;
  centralJoinDate?: number;
  serverJoinDate?: number;
  /** Consecutive qualifying days, derived by Central. Realms cannot set it. */
  streakDays?: number;
  /** Live Last.fm track, Central-owned. */
  nowPlaying?: NowPlaying | null;
  clients?: ('desktop' | 'mobile')[];
  badges?: ProfileBadge[];
  // Active Central enforcement (e.g. Limited Account), publicly visible on the
  // profile under "Member Since" with the expiration date.
  ongoingInfractions?: Array<{ type: string; label?: string; expiresAt: number }>;
}

export interface SocialProfileConfig {
  favoriteRealm?: {
    name: string;
    url?: string | null;
    icon?: string | null;
    banner?: string | null;
  } | null;
  links?: Array<{
    type: 'youtube' | 'twitch';
    url: string;
    label?: string | null;
    image?: string | null;
    banner?: string | null;
    verified?: boolean | null;
  }>;
}

export interface ProfileBadge {
  id: string;
  label: string;
  description?: string | null;
  icon?: string | null;
  tone?: 'neutral' | 'accent' | 'gold' | 'blue' | 'green' | 'pink' | 'purple';
  awardedAt?: number | null;
}

export interface Role {
  id: string;
  name: string;
  color: string | null;
  permissions: number;
  permissionKeys?: string[];
  position: number;
  is_default: number;
  mentionable?: number | boolean;
  hoist?: number | boolean;
  icon?: string | null;
  style_type?: string | null;
  style_colors?: string | null;
}

export interface Channel {
  id: string;
  name: string;
  description: string | null;
  type: 'basic' | 'media' | 'voice' | 'announcement' | 'forum' | 'theater' | 'rules' | 'tracker' | 'board';
  position: number;
  category_id?: string | null;
  created_at: number;
  slowmode?: number;
  defaultReaction?: string | null;
  nsfw?: boolean | number;
  effective_permissions?: number;
  effective_permission_keys?: string[];
  forum_layout?: 'list' | 'gallery' | 'user_choice';
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

export interface TheaterUser {
  id: string;
  username: string;
  avatar: string | null;
  accountType?: 'local' | 'central';
  clientType?: 'mobile' | 'desktop';
  voiceConnected?: boolean;
  roleColor: string | null;
  cameraEnabled: boolean;
  micEnabled: boolean;
  deafened: boolean;
  muted: boolean;
}

export interface TheaterSettings {
  theater_max_duration_seconds: number;
  theater_open_queuing: number;
  theater_auto_advance: number;
  theater_reactions_enabled: number;
  theater_skip_voting_enabled: number;
  theater_queue_voting_enabled: number;
  domains?: string[];
}

export interface Category {
  id: string;
  name: string;
  position: number;
  created_at: number;
}

export interface Webhook {
  id: string;
  name: string;
  scopeType: 'channel' | 'category';
  scopeId: string;
  authMode: 'secured' | 'simple';
  inboundEnabled: boolean;
  outboundEnabled: boolean;
  actionFlags: {
    allowMessageCreate?: boolean;
    allowConversationUpsert?: boolean;
  };
  ipLockEnabled: boolean;
  lockedIp: string | null;
  callbackUrl: string | null;
  enabled: boolean;
  secretPreview: string | null;
  inboundUrl: string | null;
  lastDeliveryAt: number | null;
  lastDeliveryStatus: 'pending' | 'delivered' | 'failed' | 'retrying' | null;
  lastDeliveryError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Thread {
  id: string;
  channel_id: string;
  parent_message_id: string;
  name: string;
  created_by: string;
  created_at: number;
  /** Messages in the thread; sent by realm servers that list threads with a count. */
  reply_count?: number;
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
  author_account_type: 'local' | 'central';
  author_display_name: string | null;
  preview_content: string;
  reply_count: number;
  /** Unread messages in this post, independent of other posts in the forum. */
  unread_count?: number;
  cover_image: string | null;
  body_attachments?: MessageAttachment[] | null;
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

export interface MessageReaction {
  emoji: string;
  count: number;
  users: string[];
  reacted: boolean;
}

export interface Message {
  id: string;
  channel_id: string;
  user_id: string;
  username: string;
  avatar: string | null;
  content: string;
  edited: number;
  reactions?: MessageReaction[];
  is_owner?: number;
  role_color?: string | null;
  role_icon?: string | null;
  role_style_type?: string | null;
  role_style_colors?: string | null;
  attachment_url?: string | null;
  attachment_type?: string | null;
  attachment_size?: number | null;
  attachments?: MessageAttachment[] | null;
  safety_artifacts?: SafetyArtifactVisibility[];
  nsfw_tags?: string[];
  message_type?: 'user' | 'system';
  system_type?: string | null;
  system_data?: Record<string, unknown> | null;
  thread_id?: string | null;
  created_at: number;
  display_name?: string | null;
  verified?: boolean;
  is_bot?: number;
  /** Present when this message is a bot's reply to a slash-command interaction. */
  interaction?: {
    command: string;
    invokerId: string;
    invokerName: string;
  } | null;
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
  /**
   * Client-side send lifecycle for optimistic ("ghost") messages. Absent on
   * confirmed messages from the server. 'sending' renders ghosted/gray,
   * 'failed' renders red with a retry affordance.
   */
  status?: 'sending' | 'failed';
  /** Idempotency token used to reconcile an optimistic message with its server echo. */
  client_nonce?: string | null;
}

export interface OnlineUser {
  id: string;
  username: string;
  role: string;
  isOwner?: boolean;
  roleColor?: string | null;
  roleHoist?: number | boolean;
  roleIcon?: string | null;
  roleName?: string | null;
  rolePosition?: number;
  roleStyleType?: string | null;
  roleStyleColors?: string | null;
  avatar?: string | null;
  status?: 'online' | 'away' | 'sleeping' | 'invisible';
  displayName?: string | null;
  customStatusText?: string | null;
  activityType?: string | null;
  activityText?: string | null;
  activityStartedAt?: number | null;
  accountType?: 'local' | 'central' | 'bot';
  verified?: boolean;
  isBot?: boolean;
  clients?: ('desktop' | 'mobile')[];
}

// ── Bots ─────────────────────────────────────────────────────────────────────

export type BotScope = 'interactions' | 'profile' | 'mentions' | 'private_messages';

export interface BotSummary {
  id: string;
  userId: string;
  username: string | null;
  displayName: string | null;
  avatar: string | null;
  banner?: string | null;
  bio?: string | null;
  kind: 'token' | 'plugin';
  pluginName?: string | null;
  tokenPreview?: string | null;
  requestedScopes: BotScope[];
  enabled: boolean;
  commandCount: number;
  online?: boolean;
  pluginStatus?: 'running' | 'restarting' | 'crashed' | 'stopped' | 'pending_install' | 'installing' | 'install_failed' | null;
  createdAt?: number;
}

export interface BotCommand {
  botId: string;
  botUserId: string;
  botUsername: string;
  botDisplayName?: string | null;
  botAvatar?: string | null;
  name: string;
  /** 'chat' = slash command; 'message' = message right-click "Apps" action */
  type?: 'chat' | 'message';
  label?: string | null;
  description: string;
  options: Array<{
    name: string;
    description: string;
    type: 'string' | 'user' | 'channel' | 'role' | 'integer' | 'boolean';
    required: boolean;
    choices?: Array<{ name: string; value: string | number }>;
  }>;
  defaultPermission?: string | null;
}

export interface BotConsent {
  decision: 'allowed' | 'denied';
  scopes: Partial<Record<BotScope, boolean>>;
}

export interface BotDmConversation {
  botId: string;
  botUserId: string;
  username: string;
  displayName?: string | null;
  avatar?: string | null;
  unread: number;
  lastMessageAt: number | null;
}

export interface BotDmMessage {
  id: string;
  botId: string;
  sender: 'bot' | 'user';
  content: string;
  created_at: number;
  read?: boolean;
}

export interface CentralRegPending {
  pendingId: string;
  qrCode: string;
  manualCode: string;
}

export interface Friend {
  id: string;
  username: string;
  avatar?: string | null;
  banner?: string | null;
  status?: 'online' | 'away' | 'sleeping' | 'invisible';
  customStatusText?: string | null;
  activityType?: 'Playing' | 'Listening' | 'Watching' | 'Custom' | null;
  activityText?: string | null;
  activityStartedAt?: number | null;
  clients?: ('desktop' | 'mobile')[];
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

export interface FriendNickname {
  target_user_id: string;
  nickname: string;
}

export interface DMConversation {
  id: string;
  otherUserId: string;
  otherUsername: string;
  otherDisplayName?: string | null;
  otherAvatar: string | null;
  otherStatus?: 'online' | 'away' | 'sleeping' | 'invisible';
  otherClients?: ('desktop' | 'mobile')[];
  lastMessageAt: number;
  unreadCount: number;
  retentionDays?: number;
  isBlockedByThem?: boolean;
  requestState?: 'pending' | 'accepted' | 'declined';
  outgoingRequestState?: 'pending' | 'accepted' | 'declined' | null;
  canSend?: boolean;
  conversationKind?: 'direct' | 'official_system';
  readOnly?: boolean;
  verified?: boolean;
}

export interface DMReaction {
  emoji: string;
  count: number;
  users: string[];
  reacted: boolean;
}

export interface SafetyArtifactVisibility {
  scopeKind?: 'dm' | 'group_dm';
  scopeId?: string;
  messageId?: string;
  artifactKey: string;
  state: 'visible' | 'reported' | 'quarantined' | 'removed' | 'cleared';
  distinctReporters?: number;
  hiddenForUser: boolean;
}

export interface DMMessage {
  id: string;
  conversationId: string;
  senderId: string;
  recipientId: string;
  text: string; // Decrypted plaintext
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
  safetyArtifacts?: SafetyArtifactVisibility[];
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
  status?: 'online' | 'away' | 'sleeping' | 'invisible';
  customStatusText?: string | null;
  activityType?: 'Playing' | 'Listening' | 'Watching' | 'Custom' | null;
  activityText?: string | null;
  activityStartedAt?: number | null;
  isOwner: boolean;
  joinedAt: number;
}

export interface GroupChatDetail extends GroupChatSummary {
  members: GroupChatMember[];
}

export interface GroupChatKeyVersion {
  keyVersion: number;
  keyMaterial: string;
  createdAt: number;
}

export interface GroupChatReaction {
  emoji: string;
  count: number;
  users: string[];
  reacted: boolean;
}

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
  safetyArtifacts?: SafetyArtifactVisibility[];
}

// ── Tracker issues and Board cards (channel types 'tracker' and 'board') ──────
export interface WorkItemUser {
  id: string;
  username: string;
  avatar: string | null;
  account_type: 'local' | 'central' | 'bot';
  display_name: string | null;
}

export interface WorkItemLabel {
  id: string;
  name: string;
  color: string;
}

interface WorkItemBase {
  id: string;
  channel_id: string;
  title: string;
  body: string;
  created_by: string | null;
  author: WorkItemUser | null;
  created_at: number;
  updated_at: number;
  label_ids: string[];
  assignees: WorkItemUser[];
  comment_count: number;
}

export interface TrackerIssue extends WorkItemBase {
  number: number;
  state: 'open' | 'in_progress' | 'blocked' | 'closed';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  due_at: number | null;
  closed_at: number | null;
  closed_by: string | null;
}

export interface BoardCard extends WorkItemBase {
  list_id: string;
  position: number;
  due_at: number | null;
  archived: boolean;
}

export interface BoardList {
  id: string;
  name: string;
  position: number;
  /** Optional banner shown above the list; a realm upload path or URL. */
  cover_image: string | null;
  /** Width the cover is drawn at, in px (height follows, up to a square); null fits the list's width. */
  cover_size: number | null;
  /** Optional small image shown beside the name. */
  icon: string | null;
  /** Hidden from everyone but board managers and the roles in role_ids. */
  staff_only: boolean;
  /** Extra roles that may see a staff-only list. Only sent to board managers. */
  role_ids?: string[];
}

export interface WorkItemComment {
  id: string;
  item_id: string;
  user_id: string | null;
  author: WorkItemUser | null;
  body: string;
  created_at: number;
  edited_at: number | null;
}

export interface WorkItemEvent {
  id: string;
  actor_id: string | null;
  type: 'renamed' | 'closed' | 'reopened' | 'labels' | 'assignees' | 'moved' | 'archived' | 'restored' | 'state' | 'priority' | 'due_date' | 'attachment_added' | 'attachment_removed';
  data: {
    from?: string | number | null;
    to?: string | number | null;
    name?: string;
    added?: string[];
    removed?: string[];
  } | null;
  created_at: number;
}

export interface WorkItemAttachment {
  id: string;
  name: string;
  url: string;
  mime: string;
  size: number;
  uploaded_by: string | null;
  created_at: number;
}

export interface WorkItemDetail {
  comments: WorkItemComment[];
  events: WorkItemEvent[];
  attachments?: WorkItemAttachment[];
  watching?: boolean;
  watcher_count?: number;
}

/** What is drawn behind a board's lists: a voice-call style colour pattern or an image. */
export type BoardBackground =
  | { kind: 'pattern'; colors: string[]; pattern: 'radial' | 'linear' | 'diagonal' | 'stripes' | 'mesh'; animated: boolean; scene?: 'rings' | 'orbit' | 'particles' | 'pixels' | null }
  | { kind: 'image'; image: string; fit?: boolean; stretch?: boolean; positionX?: number; positionY?: number };

export interface WorkChannelSettings {
  /** Shown at the top of the board; null = the channel's name. */
  title: string | null;
  background: BoardBackground | null;
}

export type BoardSettings = WorkChannelSettings;
export type TrackerSettings = WorkChannelSettings;
