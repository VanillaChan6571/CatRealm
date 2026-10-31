import { memo, useState, useRef, useEffect, useMemo } from 'react';
import { reactionDisplayName } from '../../messaging/chatlib/messageTokenParser';
import type { Message } from '../../types';
import { useAuthStore } from '../../stores/authStore';
import { useMessageStore } from '../../stores/messageStore';
import { useUIStore } from '../../stores/uiStore';
import { formatMessageTime } from '../../utils/formatTime';
import { PERMISSIONS, hasChannelPermission } from '../../utils/permissions';
import { useThreadStore } from '../../stores/threadStore';
import { useChannelStore } from '../../stores/channelStore';
import { useServerStore } from '../../stores/serverStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useContentSocialStore } from '../../stores/contentSocialStore';
import { usePresenceStore } from '../../stores/presenceStore';
import { writeClipboardText } from '../../lib/clipboard';
import { resolveAvatarUrl, resolveRoleIconUrl } from '../../utils/avatar';
import { resolveDisplayName } from '../../utils/displayName';
import { decodeToken } from '../../utils/token';
import { VerifiedBadge } from '../ui/VerifiedBadge';
import { MessageFormatter } from './MessageFormatter';
import { getNsfwSubtagLabels, shouldBlurAttachmentForNsfwTags } from '../../utils/nsfw';
import { dispatchMessageForward, dispatchMessageReact, dispatchMessageReply } from '../../messaging/chatlib/messageActions';
import type { ContextMenuItem, MessageActionId } from '../../messaging/chatlib/messageActionDefinitions';
import { useBotStore } from '../../stores/botStore';
import { MessageContextBlock } from './SharedMessageRowParts';
import { requestChatMessageJump } from './messageJump';
import { SharedMessageRow, type MessageRowAdapter } from './SharedMessageRow';
import { SystemMessageRow } from './SystemMessageRow';
import { AudioPlayer } from './AudioPlayer';
import { useViewedChannels } from '../../hooks/useViewedChannels';
import { useViewedPermissions } from '../../hooks/useViewedPermissions';
import { CornerUpRight, Crown, Edit3, Forward, MessageSquareMore, Pin, PinOff, Reply, Trash2 } from 'lucide-react';
import { BotBadge } from '../ui/BotBadge';
import { getRolePrimaryColor } from '../../lib/roleStyles';
import { isArchiveMime } from '../../lib/archiveFiles';
import { formatDmAttachmentSize } from './DMAttachmentPreview';
import { AutoSizingChatImage } from './AutoSizingChatImage';

function formatExpiryLabel(expiresAt: number): string {
  const diff = expiresAt - Date.now();
  if (diff <= 0) return 'Expiring soon';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `Deletes in ${mins}m`;
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `Deletes in ${hours}h`;
  const days = Math.floor(diff / 86400000);
  return `Deletes in ${days}d`;
}

function VoiceExpiryBadge({ expiresAt }: { expiresAt: number }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div className="relative flex items-center" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-yellow-400 cursor-default shrink-0">
        <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z" />
      </svg>
      {hovered && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 whitespace-nowrap rounded bg-bg-tooltip px-2 py-1 text-xs text-text-primary shadow-md pointer-events-none z-20">
          {formatExpiryLabel(expiresAt)}
        </div>
      )}
    </div>
  );
}

function ForwardedMediaBadge({ serverName, timestamp }: { serverName: string; timestamp: number | null }) {
  const timeFormat = useSettingsStore((s) => s.timeFormat);
  const timeLabel = timestamp ? formatMessageTime(timestamp, timeFormat) : null;
  return (
    <div className="mb-2 pl-3 border-l-2 border-blue-500/50 bg-bg-elevated/30 rounded p-2 text-xs text-text-muted select-none">
      ↗ Forwarded from <span className="text-blue-400 font-medium">{serverName}</span>
      {timeLabel && <span> • {timeLabel}</span>}
    </div>
  );
}

interface MessageItemProps {
  message: Message;
  showHeader: boolean;
  isHighlighted?: boolean;
  isScheduled?: boolean;
}

// Memoized: the list re-renders on every store update (older-page fetches,
// loading flags), and re-parsing every message on each one stalls scrolling.
export const MessageItem = memo(function MessageItem({ message, showHeader, isHighlighted, isScheduled }: MessageItemProps) {
  if (message.message_type === 'system') {
    return (
      <SystemMessageRow
        messageType="system"
        systemType={message.system_type ?? null}
        systemData={message.system_data ?? null}
        text={message.content}
        icon="🛠"
        actionLabel={message.attachment_url ? 'Jump' : undefined}
        onAction={message.attachment_url ? (() => requestChatMessageJump({
          channelId: message.channel_id,
          messageId: message.attachment_url!,
        })) : undefined}
      />
    );
  }

  const user = useAuthStore((s) => s.user);
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const requestEdit = useMessageStore((s) => s.requestEdit);
  const pinMessage = useMessageStore((s) => s.pinMessage);
  const unpinMessage = useMessageStore((s) => s.unpinMessage);
  const toggleReaction = useMessageStore((s) => s.toggleReaction);
  const retryMessage = useMessageStore((s) => s.retryMessage);
  const dismissFailedMessage = useMessageStore((s) => s.dismissFailedMessage);
  // Select the boolean, not the whole map: pins are refetched on every channel
  // switch, and depending on the map re-rendered every row each time.
  const isPinned = useMessageStore((s) => !!s.pinnedByChannel[message.channel_id]?.has(message.id));
  const openModal = useUIStore((s) => s.openModal);
  const activeServerToken = useServerStore((s) => {
    if (!s.activeServerUrl) return null;
    return s.servers.find((entry) => entry.url === s.activeServerUrl)?.token ?? null;
  });
  // Use live role data from presence store so role style changes apply to
  // existing messages without a page reload (messages embed stale role data).
  const liveUser = usePresenceStore((s) =>
    s.onlineUsers.find((u) => u.id === message.user_id) ?? null
  );
  const [pinError, setPinError] = useState<string | null>(null);
  const createThread = useThreadStore((s) => s.createThread);
  const activeChannelId = useChannelStore((s) => s.activeChannelId);
  const timeFormat = useSettingsStore((s) => s.timeFormat);
  const enableImageThumbnailing = useSettingsStore((s) => s.enableImageThumbnailing);
  const channels = useViewedChannels();
  const viewed = useViewedPermissions();
  const activeChannel = channels.find((c) => c.id === activeChannelId);
  const channelPermissions = activeChannel?.effective_permissions;

  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [mediaRevealed, setMediaRevealed] = useState(false);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const allowNsfw = useContentSocialStore((s) => s.allowNsfw);
  const nsfwLewds = useContentSocialStore((s) => s.nsfwLewds);
  const nsfwBlood = useContentSocialStore((s) => s.nsfwBlood);
  const nsfwGore = useContentSocialStore((s) => s.nsfwGore);

  const serverScopedUserIdFromToken = useMemo(() => {
    if (!activeServerToken) return null;
    const payload = decodeToken(activeServerToken);
    return payload && typeof payload.id === 'string' ? payload.id : null;
  }, [activeServerToken]);
  const actorUserId = user?.accountType === 'central'
    ? (user.serverUserId ?? serverScopedUserIdFromToken ?? user.id)
    : user?.id;
  const isOwner = !!actorUserId && actorUserId === message.user_id;
  const isAdmin = !viewed.isRoleView && !!(user?.role === 'admin' || user?.role === 'owner' || user?.isOwner);
  const canEdit =
    isOwner &&
    activeChannel?.type !== 'media';
  const canDelete = isOwner || isAdmin || hasChannelPermission(viewed.permissions, channelPermissions, PERMISSIONS.MANAGE_MESSAGES);
  const canPin = isAdmin || hasChannelPermission(viewed.permissions, channelPermissions, PERMISSIONS.PIN_MESSAGES);
  const canThread = isAdmin || hasChannelPermission(viewed.permissions, channelPermissions, PERMISSIONS.CREATE_PUBLIC_THREADS);
  const canReact = isAdmin || hasChannelPermission(viewed.permissions, channelPermissions, PERMISSIONS.ADD_REACTIONS);
  const mentionAlias = useAuthStore((s) => s.serverInfo?.mentionAlias ?? '@everyone');
  const alias = mentionAlias.startsWith('@') ? mentionAlias : `@${mentionAlias}`;
  const content = message.content ?? '';
  const allowEmbeds = message.embeds_enabled === 1;
  const isMention =
    !!user &&
    (new RegExp(`(^|\\s)@${user.username}(\\b|$)`, 'i').test(content) ||
      new RegExp(`(^|\\s)@${user.id}(\\b|$)`, 'i').test(content) ||
      content.includes(`<@${user.id}>`) ||
      new RegExp(`(^|\\s)${alias}(\\b|$)`, 'i').test(content));

  useEffect(() => {
    if (editing && editRef.current) {
      editRef.current.focus();
      editRef.current.selectionStart = editRef.current.value.length;
    }
  }, [editing]);

  useEffect(() => {
    setMediaRevealed(false);
  }, [message.id]);

  // Listen for the edit event dispatched from the mobile action drawer
  useEffect(() => {
    const handler = (e: Event) => {
      const { messageId } = (e as CustomEvent<{ messageId: string }>).detail;
      if (messageId === message.id) {
        setEditContent(message.content);
        setEditing(true);
      }
    };
    window.addEventListener('message:edit', handler);
    return () => window.removeEventListener('message:edit', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.id]);

  const handleEdit = () => {
    setEditContent(message.content);
    setEditing(true);
  };

  const handleSaveEdit = () => {
    if (editContent.trim() && editContent.trim() !== message.content) {
      requestEdit(message.id, editContent.trim());
    }
    setEditing(false);
  };

  const handleCancelEdit = () => {
    setEditing(false);
    setEditContent('');
  };

  const handleDelete = () => {
    openModal('deleteMessage', message);
  };

  const shouldBlurAttachment = !!message.attachment_url && !mediaRevealed && shouldBlurAttachmentForNsfwTags(
    message.nsfw_tags,
    { allowNsfw, nsfwLewds, nsfwBlood, nsfwGore }
  );
  const nsfwSubtagLabels = getNsfwSubtagLabels(message.nsfw_tags);
  const isSpoilerOnly = !mediaRevealed && !!(message.nsfw_tags?.includes('spoiler')) && (message.nsfw_tags?.length ?? 0) === 1;

  const handlePinToggle = () => {
    if (!canPin) return;
    setPinError(null);
    if (isPinned) {
      unpinMessage(message.channel_id, message.id).catch(() => setPinError('Failed to unpin'));
    } else {
      pinMessage(message.channel_id, message.id).catch(() => setPinError('Failed to pin'));
    }
  };

  // Optimistic send lifecycle — ghost (gray) while sending, red + retry on fail.
  const isSending = message.status === 'sending';
  const isFailed = message.status === 'failed';
  const isPending = isSending || isFailed;
  const pendingNonce = message.client_nonce ?? null;

  // --- Build context block ---
  const contextBlockContent = (
    <>
      {message.interaction && (
        <div className="mb-0.5 flex items-center gap-1 text-xs text-text-muted">
          <CornerUpRight className="h-3 w-3 shrink-0" />
          <span className="truncate">
            <span className="text-text-secondary">{message.interaction.invokerName}</span>
            {' used '}
            <span className="text-indigo-400 font-medium">/{message.interaction.command}</span>
          </span>
        </div>
      )}
      {message.reply_to && (
        <MessageContextBlock
          kind="reply"
          authorLabel={message.reply_to.username}
          onJump={() => requestChatMessageJump({
            channelId: message.reply_to!.channel_id,
            messageId: message.reply_to!.id,
          })}
          previewText={message.reply_to.content}
          headerClassName="text-text-muted mb-0.5"
          renderPreview={(text) => (
            <p className="text-text-secondary truncate text-xs">
              <MessageFormatter text={text} allowLinks={false} allowEmbeds={false} />
            </p>
          )}
        />
      )}
      {(message.forward_from_user || message.forward_from_channel) && (
        message.forward_from_user ? (
          // Original message forward: attributed to a user + channel
          <MessageContextBlock
            kind="forward"
            authorLabel={message.forward_from_user}
            channelLabel={message.forward_from_channel ? `#${message.forward_from_channel}` : null}
          />
        ) : (
          // Media-only forward: server name + original timestamp
          <ForwardedMediaBadge
            serverName={message.forward_from_channel!}
            timestamp={message.forward_from_at ?? null}
          />
        )
      )}
    </>
  );

  // Compute which attachment indices are referenced inline via <?imgN>
  const inlineAttachmentIndices = useMemo(() => {
    const indices = new Set<number>();
    if (message.attachments && message.attachments.length > 0 && message.content) {
      for (const m of message.content.matchAll(/<\?img(\d+)>/gi)) {
        const idx = parseInt(m[1], 10) - 1;
        if (idx >= 0 && idx < (message.attachments?.length ?? 0)) indices.add(idx);
      }
    }
    return indices;
  }, [message.id, message.content, message.attachments]);

  // Effective attachment list: prefer new attachments[], fall back to legacy single field
  const effectiveAttachments = useMemo(() => {
    if (message.attachments && message.attachments.length > 0) return message.attachments;
    if (message.attachment_url) {
      return [{ url: message.attachment_url, mime: message.attachment_type, type: message.attachment_type, size: message.attachment_size, name: null }];
    }
    return [];
  }, [message.id, message.attachments, message.attachment_url, message.attachment_type, message.attachment_size]);

  // Grid attachments: those not rendered inline
  const gridAttachments = useMemo(
    () => effectiveAttachments.filter((_, idx) => !inlineAttachmentIndices.has(idx)),
    [effectiveAttachments, inlineAttachmentIndices]
  );

  // --- Build body content ---
  const renderBodyText = (text: string) => (
    <div className="text-sm text-text-primary break-words whitespace-pre-wrap">
      <MessageFormatter
        text={text}
        allowLinks={allowEmbeds}
        allowEmbeds={allowEmbeds}
        attachments={message.attachments ?? undefined}
        serverUrl={serverUrl}
        senderAuthor={resolveDisplayName(message.user_id, message.username, message.display_name)}
        senderAvatarUrl={resolveAvatarUrl(message.avatar, serverUrl)}
        senderCreatedAt={message.created_at}
      />
      {message.edited === 1 && (
        <span className="text-xs text-text-muted ml-1">(edited)</span>
      )}
    </div>
  );
  const bodyContentNode = message.content ? renderBodyText(message.content) : null;

  // --- Build attachment content (horizontal gallery row for non-inline attachments) ---
  const attachmentContentNode = gridAttachments.length > 0 && serverUrl ? (
    <div className="flex gap-2 mt-1 overflow-x-auto pb-1">
      {gridAttachments.map((att, idx) => {
        const fullUrl = att.url.startsWith('http') ? att.url : `${serverUrl}${att.url}`;
        const thumbnailUrl = att.thumbnailUrl ?? att.thumbnail_url ?? null;
        const displayUrl = enableImageThumbnailing && thumbnailUrl
          ? (thumbnailUrl.startsWith('http') ? thumbnailUrl : `${serverUrl}${thumbnailUrl}`)
          : fullUrl;
        const mimeType = att.mime || att.type || '';
        const isAudio = mimeType.startsWith('audio/');
        const isVideo = mimeType.startsWith('video/');

        if (isAudio) {
          const isExpired = typeof message.voice_expires_at === 'number' && message.voice_expires_at > 0 && Date.now() > message.voice_expires_at;
          if (isExpired) {
            return (
              <div key={idx} className="mt-1 flex items-center gap-2 text-xs text-text-muted italic shrink-0">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="opacity-50">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z" />
                </svg>
                Voice message expired
              </div>
            );
          }
          return (
            <div key={idx} className="mt-1 inline-flex items-center gap-1.5 shrink-0">
              <AudioPlayer src={fullUrl} />
              {typeof message.voice_expires_at === 'number' && message.voice_expires_at > 0 && (
                <VoiceExpiryBadge expiresAt={message.voice_expires_at} />
              )}
            </div>
          );
        }

        if (isArchiveMime(mimeType)) {
          const sizeLabel = formatDmAttachmentSize(att.size);
          return (
            <a
              key={idx}
              href={fullUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-3 self-start shrink-0 rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary hover:bg-bg-hover"
            >
              <span>📦 {att.name ?? 'archive'}</span>
              {sizeLabel ? <span className="text-text-muted">({sizeLabel})</span> : null}
            </a>
          );
        }

        // The viewer pages through media only; archives open as downloads.
        const viewerAttachments = gridAttachments.filter((a) => !isArchiveMime(a.mime || a.type));
        const handleOpen = () => {
          if (shouldBlurAttachment) { setMediaRevealed(true); return; }
          openModal('mediaViewer', {
            url: fullUrl,
            type: mimeType || null,
            author: message.username ?? null,
            avatarUrl: resolveAvatarUrl(message.avatar, serverUrl),
            createdAt: message.created_at ?? null,
            size: att.size ?? null,
            items: viewerAttachments.map((a, i) => ({
              id: `${i}`,
              url: a.url.startsWith('http') ? a.url : `${serverUrl}${a.url}`,
              type: a.mime || a.type || 'image/*',
              name: a.name ?? `attachment-${i + 1}`,
              author: message.username ?? null,
              avatarUrl: resolveAvatarUrl(message.avatar, serverUrl),
              createdAt: message.created_at ?? null,
              size: a.size ?? null,
            })),
            index: Math.max(0, viewerAttachments.indexOf(att)),
          });
        };
        return (
          <div key={idx} className="relative shrink-0">
            {isVideo ? (
              <video
                src={fullUrl}
                controls
                className={`max-h-48 max-w-xs rounded border border-border cursor-zoom-in transition-all ${shouldBlurAttachment ? 'blur-md brightness-50' : ''}`}
                onClick={handleOpen}
              />
            ) : (
              <AutoSizingChatImage
                src={displayUrl}
                alt={att.name ?? 'attachment'}
                maxWidth={320}
                maxHeight={192}
                placeholderWidth={208}
                placeholderHeight={144}
                className={`object-contain rounded border border-border bg-bg-input cursor-zoom-in transition-all ${shouldBlurAttachment ? 'blur-md brightness-50' : ''}`}
                loading="lazy"
                onClick={handleOpen}
              />
            )}
            {shouldBlurAttachment && (
              <button
                type="button"
                onClick={() => setMediaRevealed(true)}
                className="absolute inset-0 flex flex-col items-center justify-center rounded bg-black/45 text-white text-xs font-medium px-2 text-center"
              >
                {idx === 0 ? (
                  <>
                    <span>{isSpoilerOnly ? 'Spoiler - Click to reveal' : 'NSFW Media - Click to reveal'}</span>
                    {!isSpoilerOnly && (
                      <span className="mt-1 text-[11px] font-normal text-white/90">
                        Subtags: [{nsfwSubtagLabels.length > 0 ? nsfwSubtagLabels.join(', ') : 'Tagged'}]
                      </span>
                    )}
                  </>
                ) : (
                  <span>{isSpoilerOnly ? '🙈' : '🔞'}</span>
                )}
              </button>
            )}
          </div>
        );
      })}
    </div>
  ) : null;

  // --- Reaction chips (mirrors DMMessageRow) ---
  const reactionContentNode = (message.reactions?.length ?? 0) > 0 ? (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {(message.reactions || []).map((reaction) => (
        <button
          key={`${message.id}-${reaction.emoji}`}
          onClick={() => { if (canReact) toggleReaction(message.id, reaction.emoji); }}
          className={`rounded-full border px-2 py-1 text-xs transition-colors ${
            reaction.reacted
              ? 'border-indigo-500 bg-indigo-500/20 text-indigo-200'
              : 'border-border bg-bg-elevated text-text-secondary hover:bg-bg-hover'
          }`}
          title={reactionDisplayName(reaction.emoji)}
        >
          <span className="inline-flex items-center gap-1 align-middle">
            <span className="inline-block align-middle [&>div]:inline [&>div>div]:inline">
              <MessageFormatter
                text={reaction.emoji}
                className="inline text-xs leading-none"
                allowLinks={false}
                allowEmbeds={false}
                inlineEmoteSizePxOverride={18}
              />
            </span>
            <span>{reaction.count}</span>
          </span>
        </button>
      ))}
    </div>
  ) : null;

  // --- Build action handlers ---
  const actionHandlers: Partial<Record<MessageActionId, () => void | Promise<void>>> = {
    react: () => dispatchMessageReact(message.id),
    reply: () => dispatchMessageReply(message),
    forward: () => dispatchMessageForward(message),
    pin: handlePinToggle,
    thread: () => { void createThread(message.channel_id, message.id, `Thread: ${message.username}`); },
    edit: handleEdit,
    delete: handleDelete,
    copy: () => { void writeClipboardText(message.content ?? ''); },
    copy_id: () => { void writeClipboardText(message.id); },
  };

  // --- Bot message actions (right-click → Apps) ---
  const botCommands = useBotStore((s) => s.commands);
  const appMenuItems = useMemo<ContextMenuItem[]>(() => {
    if (isPending) return [];
    return botCommands
      .filter((command) => command.type === 'message')
      .map((command) => ({
        key: `app:${command.botId}:${command.name}`,
        label: command.label || command.name,
        section: 'Apps',
        onClick: async () => {
          const result = await useBotStore.getState().invokeCommand({
            botId: command.botId,
            command: command.name,
            channelId: message.channel_id,
            threadId: message.thread_id ?? null,
            targetMessageId: message.id,
          });
          if (result.status === 'ok' || result.status === 'consent_required') return;
          // No toast system here — surface failures as a local notice from the bot.
          const botName = command.botDisplayName || command.botUsername;
          useBotStore.getState().addEphemeral({
            channelId: message.channel_id,
            threadId: message.thread_id ?? null,
            botUserId: command.botUserId,
            username: command.botUsername,
            displayName: command.botDisplayName,
            avatar: command.botAvatar,
            content: result.status === 'bot_offline' ? `${botName} is offline right now.`
              : result.status === 'missing_permission' ? 'You do not have permission to use that action.'
                : ('error' in result && result.error) || 'That action failed.',
            created_at: Math.floor(Date.now() / 1000),
          });
        },
      }));
  }, [botCommands, isPending, message.channel_id, message.thread_id, message.id]);

  // --- "View Cat Reactions" (names come from the realm member list) ---
  const renderReactionEmoji = (emoji: string) => (
    <MessageFormatter text={emoji} className="inline text-sm leading-none" allowLinks={false} allowEmbeds={false} inlineEmoteSizePxOverride={20} />
  );
  const resolveReactorName = (userId: string) => {
    const { allMembers, onlineUsers } = usePresenceStore.getState();
    const member = allMembers.find((m) => m.id === userId) ?? onlineUsers.find((m) => m.id === userId);
    if (member) return member.displayName || member.username;
    return userId === message.user_id ? resolveDisplayName(message.user_id, message.username, message.display_name) : null;
  };

  const quickActionRendering: Partial<Record<MessageActionId, { title?: string; className?: string; content?: React.ReactNode }>> = {
    react: {
      title: 'Add reaction',
      className: 'px-2 py-1 text-xs text-text-muted hover:text-accent hover:bg-bg-hover transition-colors',
      content: <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-current text-[10px] leading-none">+</span>,
    },
    pin: {
      title: isPinned ? 'Unpin' : 'Pin',
      className: 'px-2 py-1 text-xs text-text-muted hover:text-accent hover:bg-bg-hover transition-colors',
      content: isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />,
    },
    thread: {
      title: 'Start Thread',
      className: 'px-2 py-1 text-xs text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors',
      content: <MessageSquareMore className="h-3.5 w-3.5" />,
    },
    reply: {
      title: 'Reply',
      className: 'px-2 py-1 text-xs text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors',
      content: <Reply className="h-3.5 w-3.5" />,
    },
    forward: {
      title: 'Forward',
      className: 'px-2 py-1 text-xs text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors',
      content: <Forward className="h-3.5 w-3.5" />,
    },
    edit: {
      title: 'Edit',
      className: 'px-2 py-1 text-xs text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors',
      content: <Edit3 className="h-3.5 w-3.5" />,
    },
    delete: {
      title: 'Delete',
      className: 'px-2 py-1 text-xs text-fuchsia-300 hover:text-fuchsia-200 hover:bg-bg-hover transition-colors',
      content: <Trash2 className="h-3.5 w-3.5" />,
    },
  };

  const adapter: MessageRowAdapter<Message> = {
    message,
    messageId: message.id,
    authorName: resolveDisplayName(message.user_id, message.username, message.display_name),
    authorAvatarUrl: resolveAvatarUrl(message.avatar, serverUrl) ?? '',
    profileUserId: message.user_id,
    authorNameColor: (liveUser?.roleColor ?? message.role_color) || undefined,
    authorRoleIcon: resolveRoleIconUrl(liveUser?.roleIcon ?? message.role_icon, serverUrl),
    authorRoleStyleType: liveUser?.roleStyleType ?? message.role_style_type ?? null,
    authorRoleStyleColors: liveUser?.roleStyleColors ?? message.role_style_colors ?? null,
    authorPrefix: message.is_owner ? <Crown className="h-3.5 w-3.5 shrink-0" style={{ color: getRolePrimaryColor(liveUser?.roleColor ?? message.role_color, liveUser?.roleStyleType ?? message.role_style_type, liveUser?.roleStyleColors ?? message.role_style_colors) }} /> : undefined,
    authorBadge: message.is_bot
      ? <BotBadge isBot />
      : <VerifiedBadge verified={message.verified} />,
    timestampLabel: formatMessageTime(message.created_at, timeFormat),
    deliveryIndicator: isSending ? (
      <svg
        className="ml-1 inline h-3 w-3 animate-spin text-text-muted align-[-1px]"
        viewBox="0 0 24 24"
        fill="none"
        aria-label="Sending"
      >
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
        <path className="opacity-90" d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    ) : isFailed ? (
      <span className="ml-1 inline-flex items-center align-[-1px] text-danger" title="Failed to send">
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-label="Failed to send">
          <path d="M12 2 1 21h22L12 2zm1 14h-2v2h2v-2zm0-6h-2v4h2v-4z" />
        </svg>
      </span>
    ) : undefined,
    pinnedIndicator: isPinned ? <Pin className="ml-1 inline h-3.5 w-3.5" /> : undefined,
    contextBlock: contextBlockContent,
    bodyContent: bodyContentNode,
    translatableText: message.content,
    renderBodyText,
    attachmentContent: attachmentContentNode,
    reactionContent: reactionContentNode,
    isGrouped: !showHeader,
    showAvatar: showHeader,
    highlightClassName: `${isPinned ? 'bg-bg-hover/40' : ''} ${isMention ? 'bg-pink-500/10' : ''} ${isHighlighted ? 'chat-jump-highlight' : ''} ${isScheduled ? 'ring-1 ring-yellow-400/30 bg-yellow-400/5 rounded-md' : ''} ${isFailed ? 'opacity-80' : ''}`,
    entranceClassName: isSending ? 'message-ghost-in' : undefined,
    isEditing: editing,
    editContent,
    editInputRef: editRef,
    onEditChange: setEditContent,
    onEditSave: handleSaveEdit,
    onEditCancel: handleCancelEdit,
    editVariant: 'compact-links',
    capabilities: {
      canEdit: canEdit && !isPending,
      canDelete: canDelete && !isPending,
      canPin: canPin && !isPending,
      canThread: canThread && !isPending,
      canReact: canReact && !isPending,
      canReply: !isPending,
      canForward: !isPending,
      canSpeak: false,
      canCopy: !!message.content,
      canMarkUnread: false,
    },
    actionHandlers,
    quickActionRendering,
    contextMenuLabelOverrides: { pin: { label: isPinned ? 'Unpin' : 'Pin' } },
    extraContextMenuItems: appMenuItems,
    reactionDetails: message.reactions ?? undefined,
    renderReactionEmoji,
    resolveReactorName,
    onOpenProfile: (userId) => openModal('profileView', { userId }),
    getText: () => message.content,
    onLongPress: () => openModal('messageActions', { message, canEdit, canDelete, canPin, canThread, isPinned }),
  };

  return (
    <>
      <SharedMessageRow adapter={adapter} />
      {isScheduled && message.scheduled_at && (
        <div className="flex items-center gap-1 ml-12 mb-1 text-xs text-yellow-400/80">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
            <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
          </svg>
          Scheduled for {formatMessageTime(message.scheduled_at, timeFormat)}
        </div>
      )}
      {pinError && (
        <div className="text-xs text-danger mt-1 ml-12">{pinError}</div>
      )}
      {isFailed && (
        <div className="flex items-center gap-2 ml-12 mb-1 text-xs text-danger">
          <span>Couldn't send.</span>
          {pendingNonce && (
            <>
              <button
                type="button"
                onClick={() => retryMessage(pendingNonce)}
                className="font-medium underline underline-offset-2 hover:text-danger/80 transition-colors"
              >
                Retry
              </button>
              <span className="text-text-muted">·</span>
              <button
                type="button"
                onClick={() => dismissFailedMessage(pendingNonce)}
                className="text-text-muted hover:text-text-primary transition-colors"
              >
                Delete
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
});
