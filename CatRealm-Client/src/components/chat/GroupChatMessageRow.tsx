import type { MouseEvent, ReactNode } from 'react';
import { reactionDisplayName } from '../../messaging/chatlib/messageTokenParser';
import { MessageFormatter } from './MessageFormatter';
import type { GroupChatMessage } from '../../types';
import type { MessageActionId } from '../../messaging/chatlib/messageActionDefinitions';
import { SharedMessageRow, type MessageRowAdapter } from './SharedMessageRow';
import { Crown } from 'lucide-react';
import { writeClipboardText } from '../../lib/clipboard';

type GroupChatMessageRowProps = {
  msg: GroupChatMessage;
  isOwn: boolean;
  isGrouped: boolean;
  showAvatar: boolean;
  authorName: string;
  authorAvatarUrl: string;
  authorAvatarAlt: string;
  profileUserId: string | null;
  timestampLabel: string;
  renderAttachment: (msg: GroupChatMessage) => ReactNode;
  onOpenProfile: (userId: string) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onOpenReactionPicker: (messageId: string, event?: MouseEvent<HTMLButtonElement>) => void;
  onEdit: (msg: GroupChatMessage) => void;
  onDelete: (messageId: string) => void;
  /** Names a reactor for "View Cat Reactions" (from the group's member list). */
  resolveReactorName?: (userId: string) => string | null;
};

export function GroupChatMessageRow({
  msg,
  isOwn,
  isGrouped,
  showAvatar,
  authorName,
  authorAvatarUrl,
  authorAvatarAlt,
  profileUserId,
  timestampLabel,
  renderAttachment,
  onOpenProfile,
  onToggleReaction,
  onOpenReactionPicker,
  onEdit,
  onDelete,
  resolveReactorName,
}: GroupChatMessageRowProps) {
  const renderReactionEmoji = (emoji: string) => (
    <MessageFormatter text={emoji} className="inline text-sm leading-none" allowLinks={false} allowEmbeds={false} inlineEmoteSizePxOverride={20} />
  );
  const hasReactions = (msg.reactions?.length ?? 0) > 0;

  const renderBodyText = (text: string) => (
    <MessageFormatter
      text={text}
      className="text-text-primary text-base break-words leading-relaxed"
      allowLinks
      allowEmbeds
      senderAuthor={authorName}
      senderAvatarUrl={authorAvatarUrl}
      senderCreatedAt={msg.createdAt}
    />
  );
  const bodyContentNode = msg.text ? renderBodyText(msg.text) : null;

  const reactionContentNode = hasReactions ? (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {(msg.reactions || []).map((reaction) => (
        <button
          key={`${msg.id}-${reaction.emoji}`}
          onClick={() => onToggleReaction(msg.id, reaction.emoji)}
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

  const quickActionRendering: Partial<Record<MessageActionId, { title?: string; className?: string; content?: React.ReactNode }>> = {
    react: {
      title: 'Add reaction',
      className: 'invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-opacity text-zinc-400 hover:text-indigo-300',
      content: <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-zinc-600 text-xs">+</span>,
    },
    edit: {
      title: 'Edit message',
      className: 'invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-opacity text-zinc-400 hover:text-emerald-300',
      content: (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path d="M14.69 2.86a1.5 1.5 0 0 1 2.12 2.12l-8.4 8.4-3.3.94.94-3.3 8.63-8.16ZM4 15.5h12a.75.75 0 0 1 0 1.5H4a.75.75 0 0 1 0-1.5Z" />
        </svg>
      ),
    },
    delete: {
      title: 'Delete message',
      className: 'invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-opacity text-zinc-400 hover:text-red-400',
      content: (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
        </svg>
      ),
    },
  };

  const adapter: MessageRowAdapter<GroupChatMessage> = {
    message: msg,
    messageId: msg.id,
    authorName,
    authorAvatarUrl,
    authorAvatarAlt,
    profileUserId,
    authorPrefix: msg.senderIsOwner ? <Crown className="h-3.5 w-3.5 shrink-0 text-yellow-300" aria-label="Owner" /> : undefined,
    timestampLabel: `${timestampLabel} · KV${msg.keyVersion}`,
    contextBlock: null,
    bodyContent: bodyContentNode,
    translatableText: msg.text,
    renderBodyText,
    attachmentContent: renderAttachment(msg),
    reactionContent: reactionContentNode,
    isGrouped,
    showAvatar,
    avatarSize: 40,
    isEditing: false,
    capabilities: {
      canEdit: isOwn && !!msg.text?.trim(),
      canDelete: isOwn,
      canPin: false,
      canThread: false,
      canReact: true,
      canReply: false,
      canForward: false,
      canSpeak: false,
      canCopy: !!msg.text,
      canMarkUnread: false,
    },
    actionHandlers: {
      react: (event) => onOpenReactionPicker(msg.id, event),
      copy: () => { void writeClipboardText(msg.text ?? ''); },
      edit: () => onEdit(msg),
      delete: () => onDelete(msg.id),
    },
    quickActionRendering,
    reactionDetails: msg.reactions,
    renderReactionEmoji,
    resolveReactorName,
    onOpenProfile,
    getText: () => msg.text ?? null,
    containerClassName: `flex gap-4 ${isGrouped ? '-mt-1' : 'mt-3'} hover:bg-bg-hover/40 px-4 ${isGrouped ? 'py-0.5' : 'py-2'} group`,
    avatarColumnClassName: 'w-10 flex-shrink-0',
    headerClassName: 'flex items-baseline gap-3 mb-2',
  };

  return <SharedMessageRow adapter={adapter} />;
}
