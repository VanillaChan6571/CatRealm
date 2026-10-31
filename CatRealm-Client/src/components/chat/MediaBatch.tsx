import { memo, useRef, useState } from 'react';
import type { Message } from '../../types';
import { useAuthStore } from '../../stores/authStore';
import { useMessageStore } from '../../stores/messageStore';
import { useUIStore } from '../../stores/uiStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useContentSocialStore } from '../../stores/contentSocialStore';
import { formatMessageTime } from '../../utils/formatTime';
import { PERMISSIONS, hasChannelPermission } from '../../utils/permissions';
import { AvatarImage } from '../ui/AvatarImage';
import { resolveAvatarUrl } from '../../utils/avatar';
import { getNsfwSubtagLabels, shouldBlurAttachmentForNsfwTags } from '../../utils/nsfw';
import { useViewedChannels } from '../../hooks/useViewedChannels';
import { useViewedPermissions } from '../../hooks/useViewedPermissions';
import { Pin, PinOff } from 'lucide-react';

type MediaBatchProps = { messages: Message[]; showHeader: boolean; highlightedMessageId?: string | null };

// The list rebuilds each batch array on every render, so compare its members
// rather than the array identity.
function areMediaBatchPropsEqual(prev: MediaBatchProps, next: MediaBatchProps) {
  return prev.showHeader === next.showHeader
    && prev.highlightedMessageId === next.highlightedMessageId
    && prev.messages.length === next.messages.length
    && prev.messages.every((message, index) => message === next.messages[index]);
}

export const MediaBatch = memo(function MediaBatch({ messages, showHeader, highlightedMessageId }: MediaBatchProps) {
  const user = useAuthStore((s) => s.user);
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const openModal = useUIStore((s) => s.openModal);
  const timeFormat = useSettingsStore((s) => s.timeFormat);
  const enableImageThumbnailing = useSettingsStore((s) => s.enableImageThumbnailing);
  const pinMessage = useMessageStore((s) => s.pinMessage);
  const unpinMessage = useMessageStore((s) => s.unpinMessage);
  // A batch is always one channel; select just its pin set, not the whole map.
  const pinnedIds = useMessageStore((s) => s.pinnedByChannel[messages[0]?.channel_id ?? '']);
  const [pinError, setPinError] = useState<string | null>(null);
  const [revealedByMessageId, setRevealedByMessageId] = useState<Record<string, boolean>>({});
  const scrollerRef = useRef<HTMLDivElement>(null);
  const allowNsfw = useContentSocialStore((s) => s.allowNsfw);
  const nsfwLewds = useContentSocialStore((s) => s.nsfwLewds);
  const nsfwBlood = useContentSocialStore((s) => s.nsfwBlood);
  const nsfwGore = useContentSocialStore((s) => s.nsfwGore);

  const first = messages[0];
  const channels = useViewedChannels();
  const viewed = useViewedPermissions();
  const batchChannel = channels.find((channel) => channel.id === first?.channel_id);
  const channelPermissions = batchChannel?.effective_permissions;
  const isAdmin = !viewed.isRoleView && !!(user?.role === 'admin' || user?.role === 'owner' || user?.isOwner);
  const canPin = isAdmin || hasChannelPermission(viewed.permissions, channelPermissions, PERMISSIONS.PIN_MESSAGES);
  const canDelete = isAdmin || hasChannelPermission(viewed.permissions, channelPermissions, PERMISSIONS.MANAGE_MESSAGES);
  const items = messages
    .filter((m) => m.attachment_url)
    .map((m) => ({
      id: m.id,
      url: serverUrl ? `${serverUrl}${m.attachment_url}` : '',
      type: m.attachment_type ?? null,
      author: m.username ?? null,
      avatarUrl: resolveAvatarUrl(m.avatar, serverUrl),
      createdAt: m.created_at ?? null,
      size: m.attachment_size ?? null,
    }))
    .filter((m) => !!m.url);

  const scrollBy = (delta: number) => {
    if (!scrollerRef.current) return;
    scrollerRef.current.scrollBy({ left: delta, behavior: 'smooth' });
  };

  return (
    <div
      className={`group relative px-4 hover:bg-bg-hover/30 transition-colors ${
        showHeader ? 'pt-3' : 'pt-0.5'
      }`}
    >
      {canDelete && (
        <button
          className="absolute right-4 top-2 text-[11px] px-2 py-1 rounded bg-bg-elevated/90 border border-border text-text-muted hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={() => {
            openModal('deleteBatch', messages);
          }}
          title="Delete all media in this batch"
        >
          &#128465; Delete batch
        </button>
      )}
      <div className="flex gap-3">
        {showHeader ? (
          <div className="w-10 h-10 rounded-full avatar-bg-muted flex items-center justify-center text-white text-sm font-semibold shrink-0 mt-0.5 overflow-hidden">
            <AvatarImage
              src={resolveAvatarUrl(first.avatar, serverUrl)}
              alt={first.username}
              size={40}
              className="w-10 h-10 object-cover"
              fallback={<span>{first.username.charAt(0).toUpperCase()}</span>}
            />
          </div>
        ) : (
          <div className="w-10 shrink-0" />
        )}

        <div className="flex-1 min-w-0">
          {showHeader && (
            <div className="flex items-baseline gap-2 mb-2">
              <span
                className="font-medium text-sm hover:underline cursor-default"
                style={{ color: first.role_color || undefined }}
              >
                {first.is_owner ? '♛ ' : ''}
                {first.username}
              </span>
              <span className="text-xs text-text-muted">
                {formatMessageTime(first.created_at, timeFormat)}
              </span>
            </div>
          )}

          <div className="relative">
            <button
              className="absolute -left-3 top-1/2 -translate-y-1/2 z-10 bg-bg-elevated/90 border border-border rounded-full w-6 h-6 text-xs text-text-muted hover:text-text-primary"
              onClick={() => scrollBy(-200)}
              title="Scroll left"
            >
              ‹
            </button>
            <button
              className="absolute -right-3 top-1/2 -translate-y-1/2 z-10 bg-bg-elevated/90 border border-border rounded-full w-6 h-6 text-xs text-text-muted hover:text-text-primary"
              onClick={() => scrollBy(200)}
              title="Scroll right"
            >
              ›
            </button>
            <div
              ref={scrollerRef}
              className="flex flex-nowrap gap-2 overflow-x-auto pb-2 pr-6 scrollbar-thin"
            >
              {messages.map((msg) => {
                const thumbnailUrl = msg.attachments?.find((att) => att.url === msg.attachment_url)?.thumbnailUrl
                  ?? msg.attachments?.find((att) => att.url === msg.attachment_url)?.thumbnail_url
                  ?? msg.attachments?.[0]?.thumbnailUrl
                  ?? msg.attachments?.[0]?.thumbnail_url
                  ?? null;
                const imageSrc = enableImageThumbnailing && thumbnailUrl && serverUrl
                  ? (thumbnailUrl.startsWith('http') ? thumbnailUrl : `${serverUrl}${thumbnailUrl}`)
                  : `${serverUrl}${msg.attachment_url}`;
                const isPinned = !!pinnedIds?.has(msg.id);
                const shouldBlurAttachment = !revealedByMessageId[msg.id] && shouldBlurAttachmentForNsfwTags(
                  msg.nsfw_tags,
                  {
                    allowNsfw,
                    nsfwLewds,
                    nsfwBlood,
                    nsfwGore,
                  }
                );
                const nsfwSubtagLabels = getNsfwSubtagLabels(msg.nsfw_tags);
                const isMsgSpoilerOnly = !revealedByMessageId[msg.id] && !!(msg.nsfw_tags?.includes('spoiler')) && (msg.nsfw_tags?.length ?? 0) === 1;
                return (
                  <div key={msg.id} id={`msg-${msg.id}`} className={`relative group/item shrink-0 ${msg.id === highlightedMessageId ? 'chat-jump-highlight' : ''}`}>
                    {msg.attachment_url && serverUrl && (
                      <div className="relative">
                        {msg.attachment_type?.startsWith('video/') ? (
                          <video
                            src={`${serverUrl}${msg.attachment_url}`}
                            className={`h-36 w-52 object-cover rounded border border-border cursor-zoom-in shrink-0 transition-all ${shouldBlurAttachment ? 'blur-md brightness-50' : ''}`}
                            onClick={() => {
                              if (shouldBlurAttachment) {
                                setRevealedByMessageId((prev) => ({ ...prev, [msg.id]: true }));
                                return;
                              }
                              const index = items.findIndex((item) => item.id === msg.id);
                              openModal('mediaViewer', {
                                url: `${serverUrl}${msg.attachment_url}`,
                                type: msg.attachment_type ?? null,
                                author: msg.username ?? null,
                                avatarUrl: resolveAvatarUrl(msg.avatar, serverUrl),
                                createdAt: msg.created_at ?? null,
                                size: msg.attachment_size ?? null,
                                items,
                                index: index >= 0 ? index : 0,
                              });
                            }}
                          />
                        ) : (
                          <img
                            src={imageSrc}
                            alt="attachment"
                            className={`chat-image-placeholder h-36 w-52 object-cover rounded border border-border cursor-zoom-in shrink-0 transition-all ${shouldBlurAttachment ? 'blur-md brightness-50' : ''}`}
                            loading="lazy"
                            decoding="async"
                            // Drop the cat placeholder once the image has painted.
                            onLoad={(event) => { event.currentTarget.dataset.loaded = ''; }}
                            onError={(event) => { event.currentTarget.dataset.failed = ''; }}
                            onClick={() => {
                              if (shouldBlurAttachment) {
                                setRevealedByMessageId((prev) => ({ ...prev, [msg.id]: true }));
                                return;
                              }
                              const index = items.findIndex((item) => item.id === msg.id);
                              openModal('mediaViewer', {
                                url: `${serverUrl}${msg.attachment_url}`,
                                type: msg.attachment_type ?? null,
                                author: msg.username ?? null,
                                avatarUrl: resolveAvatarUrl(msg.avatar, serverUrl),
                                createdAt: msg.created_at ?? null,
                                size: msg.attachment_size ?? null,
                                items,
                                index: index >= 0 ? index : 0,
                              });
                            }}
                          />
                        )}
                        {shouldBlurAttachment && (
                          <button
                            type="button"
                            onClick={() => setRevealedByMessageId((prev) => ({ ...prev, [msg.id]: true }))}
                            className="absolute inset-0 flex flex-col items-center justify-center rounded bg-black/45 text-white text-xs font-medium px-2 text-center"
                          >
                            <span>{isMsgSpoilerOnly ? 'Spoiler - Click to reveal' : 'NSFW Media - Click to reveal'}</span>
                            {!isMsgSpoilerOnly && (
                              <span className="mt-1 text-[11px] font-normal text-white/90">
                                Subtags: [{nsfwSubtagLabels.length > 0 ? nsfwSubtagLabels.join(', ') : 'Tagged'}]
                              </span>
                            )}
                          </button>
                        )}
                      </div>
                    )}
                    {isPinned && (
                      <div className="absolute top-1 right-1 text-[10px] bg-bg-elevated/90 border border-border rounded px-1">
                        <Pin className="h-3 w-3" />
                      </div>
                    )}
                    {(canPin || canDelete) && (
                      <div className="absolute bottom-1 right-1 opacity-0 group-hover/item:opacity-100 transition-opacity flex gap-1">
                        {canPin && (
                          <button
                            className="text-[10px] bg-bg-elevated/90 border border-border rounded px-1 text-text-muted hover:text-accent"
                            onClick={() => {
                              if (!canPin) return;
                              setPinError(null);
                              if (isPinned) {
                                unpinMessage(msg.channel_id, msg.id).catch(() => setPinError('Failed to unpin'));
                              } else {
                                pinMessage(msg.channel_id, msg.id).catch(() => setPinError('Failed to pin'));
                              }
                            }}
                            title={isPinned ? 'Unpin' : 'Pin'}
                          >
                            {isPinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                          </button>
                        )}
                        {canDelete && (
                          <button
                            className="text-[10px] bg-bg-elevated/90 border border-border rounded px-1 text-text-muted hover:text-danger"
                            onClick={() => openModal('deleteMessage', msg)}
                            title="Delete"
                          >
                            &#128465;
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {pinError && (
            <div className="text-xs text-danger mt-1">{pinError}</div>
          )}
        </div>
      </div>
    </div>
  );
}, areMediaBatchPropsEqual);
