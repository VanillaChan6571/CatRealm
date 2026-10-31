import { useEffect, useState } from 'react';
import { ServerMentionProvider } from './mentions';
import type { Channel, ForumPost, Message } from '../../types';
import { useMessageStore } from '../../stores/messageStore';
import { useAuthStore } from '../../stores/authStore';
import { useServerStore } from '../../stores/serverStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useViewedPermissions } from '../../hooks/useViewedPermissions';
import { PERMISSIONS, hasChannelPermission } from '../../utils/permissions';
import { AvatarImage } from '../ui/AvatarImage';
import { resolveAvatarUrl } from '../../utils/avatar';
import { formatMessageTime } from '../../utils/formatTime';
import { MessageFormatter } from './MessageFormatter';
import { MessageItem } from './MessageItem';
import { shouldShowMessageHeader } from './messageGrouping';
import { MessageInput } from './MessageInput';
import { TypingIndicator } from './TypingIndicator';
import { X } from 'lucide-react';
import { getSocket } from '../../lib/socket';

const EMPTY_MESSAGES: Message[] = [];

interface Props {
  post: ForumPost;
  channel: Channel;
  onBack: () => void;
}

export function ForumPostView({ post, channel, onBack }: Props) {
  const messagesByThread = useMessageStore((s) => s.messagesByThread);
  const fetchThreadMessages = useMessageStore((s) => s.fetchThreadMessages);
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const activeServerUrl = useServerStore((s) => s.activeServerUrl);
  const timeFormat = useSettingsStore((s) => s.timeFormat);
  const viewed = useViewedPermissions();
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  const rawMessages = messagesByThread[post.id];
  const messages = Array.isArray(rawMessages) ? rawMessages : EMPTY_MESSAGES;

  const avatarSrc = resolveAvatarUrl(
    post.author_avatar,
    serverUrl || activeServerUrl,
    post.author_account_type
  );
  const displayName = post.author_display_name || post.author_username;
  const canReply = hasChannelPermission(
    viewed.permissions,
    channel.effective_permissions,
    PERMISSIONS.SEND_MESSAGES_IN_POSTS
  );

  const bodyAttachments = Array.isArray(post.body_attachments) ? post.body_attachments : [];
  const resolvedServerUrl = serverUrl || activeServerUrl;

  // Join the socket room for this forum post's thread directly,
  // without touching activeThread (which would open the ThreadPanel).
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const join = () => socket.emit('thread:join', post.id);
    join();
    // Re-join on reconnect
    socket.on('connect', join);
    return () => {
      socket.off('connect', join);
    };
  }, [post.id]);

  useEffect(() => {
    void fetchThreadMessages(post.id);
  }, [post.id, fetchThreadMessages]);

  const resolveUrl = (url: string) =>
    url.startsWith('http') ? url : `${(resolvedServerUrl ?? '').replace(/\/+$/, '')}${url}`;

  return (
    <ServerMentionProvider>
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="h-12 px-4 flex items-center gap-2 border-b border-border shadow-sm shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="text-text-muted hover:text-text-primary transition-colors mr-1 text-lg leading-none"
          title="Back to posts"
        >
          ←
        </button>
        <span className="text-text-muted">💬</span>
        <h3 className="font-semibold text-text-primary truncate">{post.name}</h3>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Original post body */}
        <div className="px-4 py-4 border-b border-border">
          <div className="flex items-center gap-2 mb-3">
            <AvatarImage
              src={avatarSrc}
              alt={displayName}
              size={32}
              className="w-8 h-8 rounded-full object-cover shrink-0"
              fallback={<span>{displayName.charAt(0).toUpperCase()}</span>}
            />
            <span className="font-medium text-text-primary text-sm">{displayName}</span>
            <span className="text-xs text-text-muted">{formatMessageTime(post.created_at, timeFormat)}</span>
          </div>
          <h2 className="text-lg font-bold text-text-primary mb-2">{post.name}</h2>
          <MessageFormatter
            text={post.preview_content}
            allowLinks={true}
            allowEmbeds={false}
            attachments={bodyAttachments.length > 0 ? bodyAttachments : null}
            serverUrl={resolvedServerUrl}
            className="text-text-secondary text-sm"
          />
          {bodyAttachments.length > 0 && (
            <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
              {bodyAttachments.map((att, idx) => {
                const url = resolveUrl(att.url);
                const isImage = (att.mime ?? att.type ?? '').startsWith('image/');
                return (
                  <div key={idx} className="shrink-0 relative">
                    {isImage ? (
                      <img
                        src={url}
                        alt={att.name ?? 'attachment'}
                        className="max-h-48 w-auto max-w-xs rounded-lg border border-border object-cover cursor-zoom-in"
                        onClick={() => setLightboxIdx(idx)}
                      />
                    ) : (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-bg-elevated text-sm text-text-primary hover:bg-bg-hover transition-colors"
                      >
                        <svg className="w-4 h-4 text-text-muted shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                        </svg>
                        <span className="truncate max-w-[160px]">{att.name ?? att.url.split('/').pop()}</span>
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Replies */}
        {messages.length > 0 && (
          <div className="px-4 py-2 text-xs text-text-muted border-b border-border">
            {messages.length} {messages.length === 1 ? 'reply' : 'replies'}
          </div>
        )}
        {messages.map((msg, i) => {
          const prev = messages[i - 1];
          const showHeader = shouldShowMessageHeader(msg, prev);
          return <MessageItem key={msg.id} message={msg} showHeader={showHeader} />;
        })}
        {messages.length === 0 && (
          <div className="text-center text-text-muted text-sm py-6">No replies yet.</div>
        )}
      </div>

      {/* Typing indicator + reply composer */}
      <TypingIndicator />
      {canReply && <MessageInput threadId={post.id} />}

      {/* Lightbox */}
      {lightboxIdx !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => setLightboxIdx(null)}
        >
          <button
            type="button"
            className="absolute top-4 right-4 text-white text-2xl hover:opacity-70"
            onClick={() => setLightboxIdx(null)}
          >
            <X className="h-6 w-6" />
          </button>
          {lightboxIdx > 0 && (
            <button
              type="button"
              className="absolute left-4 text-white text-3xl hover:opacity-70 px-2"
              onClick={(e) => { e.stopPropagation(); setLightboxIdx((i) => (i! > 0 ? i! - 1 : i)); }}
            >
              ‹
            </button>
          )}
          <img
            src={resolveUrl(bodyAttachments[lightboxIdx]?.url ?? '')}
            alt=""
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          {lightboxIdx < bodyAttachments.length - 1 && (
            <button
              type="button"
              className="absolute right-4 text-white text-3xl hover:opacity-70 px-2"
              onClick={(e) => { e.stopPropagation(); setLightboxIdx((i) => (i! < bodyAttachments.length - 1 ? i! + 1 : i)); }}
            >
              ›
            </button>
          )}
        </div>
      )}
    </div>
    </ServerMentionProvider>
  );
}
