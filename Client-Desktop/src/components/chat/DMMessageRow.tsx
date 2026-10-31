import type { MouseEvent, ReactNode, RefObject } from 'react';
import { reactionDisplayName } from '../../messaging/chatlib/messageTokenParser';
import { MessageFormatter } from './MessageFormatter';
import type { DMMessage } from '../../types';
import type { MessageActionId } from '../../messaging/chatlib/messageActionDefinitions';
import { MessageContextBlock } from './SharedMessageRowParts';
import { SharedMessageRow, type MessageRowAdapter } from './SharedMessageRow';
import { AnimatePresence, motion } from 'motion/react';
import { useMotionProfile } from '../../lib/motion';
import { Pin, PinOff } from 'lucide-react';
import { writeClipboardText } from '../../lib/clipboard';

type ParsedDmContext = {
  kind: 'reply' | 'forward';
  authorLabel: string;
  previewText: string;
  messageId?: string;
} | null;

type DMMessageRowProps = {
  msg: DMMessage;
  isOwn: boolean;
  isGrouped: boolean;
  showAvatar: boolean;
  isEditing: boolean;
  isHovered: boolean;
  authorName: string;
  authorAvatarUrl: string;
  authorAvatarAlt: string;
  profileUserId: string | null;
  timestampLabel: string;
  deliveredLabel?: string | null;
  parsedContext: ParsedDmContext;
  displayText: string;
  editDraft: string;
  editInputRef: RefObject<HTMLTextAreaElement | null>;
  onHoverStart: () => void;
  onHoverEnd: () => void;
  onOpenProfile: (userId: string) => void;
  onEditDraftChange: (value: string) => void;
  onSaveEdit: () => void | Promise<void>;
  onCancelEdit: () => void;
  renderAttachment: (msg: DMMessage) => ReactNode;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onOpenReactionPicker: (messageId: string, event?: MouseEvent<HTMLButtonElement>) => void;
  onReply: (msg: DMMessage) => void;
  onJumpToReply?: (msg: DMMessage, previewText: string, authorLabel: string, messageId?: string) => void;
  onForward: (msg: DMMessage) => void;
  onEdit: (msg: DMMessage) => void;
  onDelete: (messageId: string) => void;
  isPinned?: boolean;
  onPinToggle?: (msg: DMMessage) => void;
  isHighlighted?: boolean;
  /** Names a reactor for "View Cat Reactions"; DM reactions only ever come from the two participants. */
  resolveReactorName?: (userId: string) => string | null;
};

export function DMMessageRow({
  msg,
  isOwn,
  isGrouped,
  showAvatar,
  isEditing,
  isHovered: _isHovered,
  authorName,
  authorAvatarUrl,
  authorAvatarAlt,
  profileUserId,
  timestampLabel,
  deliveredLabel = null,
  parsedContext,
  displayText,
  editDraft,
  editInputRef,
  onHoverStart: _onHoverStart,
  onHoverEnd: _onHoverEnd,
  onOpenProfile,
  onEditDraftChange,
  onSaveEdit,
  onCancelEdit,
  renderAttachment,
  onToggleReaction,
  onOpenReactionPicker,
  onReply,
  onJumpToReply,
  onForward,
  onEdit,
  onDelete,
  isPinned = false,
  onPinToggle,
  isHighlighted = false,
  resolveReactorName,
}: DMMessageRowProps) {
  const motionProfile = useMotionProfile();
  const hasReactions = (msg.reactions?.length ?? 0) > 0;
  const renderReactionEmoji = (emoji: string) => (
    <MessageFormatter text={emoji} className="inline text-sm leading-none" allowLinks={false} allowEmbeds={false} inlineEmoteSizePxOverride={20} />
  );

  // --- Context block ---
  const contextBlockContent = parsedContext ? (
    <MessageContextBlock
      kind={parsedContext.kind}
      authorLabel={parsedContext.authorLabel}
      previewText={parsedContext.previewText}
      onJump={parsedContext.kind === 'reply' && onJumpToReply
        ? () => onJumpToReply(msg, parsedContext.previewText, parsedContext.authorLabel, parsedContext.messageId)
        : undefined}
      containerClassName="mb-2 rounded-lg border border-border/70 bg-bg-elevated/70 px-3 py-2"
      headerClassName="text-xs font-medium text-text-muted"
      authorClassName="text-text-primary"
      renderPreview={(text) => (
        <div className="mt-1 text-sm text-text-secondary break-words">
          <MessageFormatter
            text={text}
            className="text-text-secondary text-sm break-words leading-relaxed"
            allowLinks={false}
            allowEmbeds={false}
          />
        </div>
      )}
    />
  ) : null;

  // --- Body content ---
  const renderBodyText = (text: string) => (
    <>
      <MessageFormatter
        text={text}
        className="text-text-primary text-base break-words leading-relaxed"
        allowLinks
        allowEmbeds
        senderAuthor={authorName}
        senderAvatarUrl={authorAvatarUrl}
        senderCreatedAt={msg.createdAt}
      />
      {msg.editedAt != null && (
        <span className="text-xs text-text-muted ml-1">(edited)</span>
      )}
    </>
  );
  const bodyContentNode = displayText ? renderBodyText(displayText) : null;

  // --- Reaction content ---
  const reactionContentNode = hasReactions ? (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <AnimatePresence initial={false}>
        {(msg.reactions || []).map((reaction) => (
          <motion.button
            key={`${msg.id}-${reaction.emoji}`}
            variants={motionProfile.popVariants}
            initial="initial"
            animate="animate"
            exit="exit"
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
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  ) : null;

  // --- Quick action rendering ---
  const quickActionRendering: Partial<Record<MessageActionId, { title?: string; className?: string; content?: React.ReactNode }>> = {
    react: {
      title: 'Add reaction',
      className: 'invisible opacity-0 group-hover:visible group-hover:opacity-100 group-data-[show-actions]:visible group-data-[show-actions]:opacity-100 transition-opacity text-zinc-400 hover:text-indigo-300',
      content: <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-zinc-600 text-xs">+</span>,
    },
    reply: {
      title: 'Reply',
      className: 'invisible opacity-0 group-hover:visible group-hover:opacity-100 group-data-[show-actions]:visible group-data-[show-actions]:opacity-100 transition-opacity text-zinc-400 hover:text-accent',
      content: <span className="text-base leading-none">↩</span>,
    },
    pin: {
      title: isPinned ? 'Unpin' : 'Pin',
      className: 'invisible opacity-0 group-hover:visible group-hover:opacity-100 group-data-[show-actions]:visible group-data-[show-actions]:opacity-100 transition-opacity text-zinc-400 hover:text-accent',
      content: isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />,
    },
    forward: {
      title: 'Forward',
      className: 'invisible opacity-0 group-hover:visible group-hover:opacity-100 group-data-[show-actions]:visible group-data-[show-actions]:opacity-100 transition-opacity text-zinc-400 hover:text-blue-400',
      content: <span className="text-base leading-none">↪</span>,
    },
    edit: {
      title: 'Edit message',
      className: 'invisible opacity-0 group-hover:visible group-hover:opacity-100 group-data-[show-actions]:visible group-data-[show-actions]:opacity-100 transition-opacity text-zinc-400 hover:text-emerald-300',
      content: (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path d="M14.69 2.86a1.5 1.5 0 0 1 2.12 2.12l-8.4 8.4-3.3.94.94-3.3 8.63-8.16ZM4 15.5h12a.75.75 0 0 1 0 1.5H4a.75.75 0 0 1 0-1.5Z" />
        </svg>
      ),
    },
    delete: {
      title: 'Delete message',
      className: 'invisible opacity-0 group-hover:visible group-hover:opacity-100 group-data-[show-actions]:visible group-data-[show-actions]:opacity-100 transition-opacity text-zinc-400 hover:text-red-400',
      content: (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
        </svg>
      ),
    },
  };

  const adapter: MessageRowAdapter<DMMessage> = {
    message: msg,
    messageId: msg.id,
    authorName,
    authorAvatarUrl,
    authorAvatarAlt,
    profileUserId,
    timestampLabel,
    deliveryIndicator: deliveredLabel ? <span className="text-sm text-text-muted ml-2">{deliveredLabel}</span> : undefined,
    pinnedIndicator: isPinned ? <Pin className="ml-1 inline h-3.5 w-3.5" /> : undefined,
    contextBlock: contextBlockContent,
    bodyContent: bodyContentNode,
    translatableText: displayText,
    renderBodyText,
    attachmentContent: renderAttachment(msg),
    reactionContent: reactionContentNode,
    isGrouped,
    showAvatar,
    avatarSize: 48,
    isEditing,
    editContent: editDraft,
    editInputRef,
    onEditChange: onEditDraftChange,
    onEditSave: onSaveEdit,
    onEditCancel: onCancelEdit,
    editVariant: 'buttons',
    capabilities: {
      canEdit: isOwn && !isEditing,
      canDelete: isOwn && !isEditing,
      canPin: !!onPinToggle && !isEditing,
      canThread: false,
      canReact: true,
      canReply: true,
      canForward: true,
      canSpeak: false,
      canCopy: !!displayText,
      canMarkUnread: false,
    },
    actionHandlers: {
      react: (event) => onOpenReactionPicker(msg.id, event),
      copy: () => { void writeClipboardText(displayText); },
      reply: () => onReply(msg),
      forward: () => onForward(msg),
      pin: onPinToggle ? () => onPinToggle(msg) : undefined,
      edit: () => onEdit(msg),
      delete: () => onDelete(msg.id),
    },
    contextMenuLabelOverrides: { pin: { label: isPinned ? 'Unpin' : 'Pin' } },
    quickActionRendering,
    reactionDetails: msg.reactions,
    renderReactionEmoji,
    resolveReactorName,
    onOpenProfile,
    getText: () => msg.text ?? null,
    highlightClassName: isHighlighted ? 'chat-jump-highlight' : undefined,
    containerClassName: `flex gap-2 sm:gap-4 ${isGrouped ? '-mt-1' : 'mt-3'} hover:bg-bg-hover/40 px-3 sm:px-6 ${isGrouped ? 'py-0.5' : 'py-2'} group`,
    avatarColumnClassName: 'w-12 flex-shrink-0',
    headerClassName: 'flex items-baseline gap-3 mb-2',
    quickActionsContainerClassName: undefined,
  };

  return <SharedMessageRow adapter={adapter} />;
}
