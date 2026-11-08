import { useEffect, useMemo } from 'react';
import type { ReactNode, RefObject } from 'react';
import type { MouseEvent } from 'react';
import type { DMMessage } from '../../types';
import { defaultAvatarUrl, resolveAvatarUrl } from '../../utils/avatar';
import { parseDmContextText } from '../../lib/dmContext';
import { DMMessageRow } from './DMMessageRow';
import { DMTypingIndicator } from './DMTypingIndicator';
import { DMMessageListStatus } from './DMViewStates';
import { SystemMessageRow } from './SystemMessageRow';
import { CallSystemMessageRow } from './CallSystemMessageRow';
import { AnimatePresence } from 'motion/react';
import { hiddenSafetyArtifactKeys, hideSafetyAttachments, hideSafetyLinks, reportableSafetyArtifacts } from '../../lib/safetyReporting';

type DMMessageListProps = {
  authBase: string;
  messages: DMMessage[];
  loadingOlderMessages: boolean;
  hasOlderMessages: boolean;
  otherUserTyping: boolean;
  messagesScrollRef: RefObject<HTMLDivElement | null>;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  editInputRef: RefObject<HTMLTextAreaElement | null>;
  onScroll: () => void;
  onMediaLayout: () => void;
  activeConversation: {
    otherUserId: string;
    otherUsername: string;
    otherDisplayName?: string | null;
    otherAvatar?: string | null;
  };
  user: {
    id: string;
    serverUserId?: string | null;
    avatar?: string | null;
    username?: string | null;
    displayName?: string | null;
  } | null;
  hoveredMessageId: string | null;
  setHoveredMessageId: (value: string | null | ((prev: string | null) => string | null)) => void;
  editingMessageId: string | null;
  editDraft: string;
  setEditDraft: (value: string) => void;
  formatTime: (timestamp: number) => string;
  renderAttachment: (msg: DMMessage) => ReactNode;
  onOpenProfile: (userId: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onOpenReactionPicker: (messageId: string, event?: MouseEvent<HTMLButtonElement>) => void;
  onReply: (msg: DMMessage) => void;
  onJumpToMessage?: (messageId: string) => void;
  onForward: (msg: DMMessage) => void;
  onEdit: (msg: DMMessage) => void;
  onDelete: (messageId: string) => void;
  pinnedMessageIds?: Set<string>;
  onPinToggle?: (msg: DMMessage) => void;
  highlightedMessageId?: string | null;
  activeCallId?: string | null;
  onJoinCall?: () => void;
  onReport?: (msg: DMMessage) => void;
};

export function DMMessageList({
  authBase,
  messages,
  loadingOlderMessages,
  hasOlderMessages,
  otherUserTyping,
  messagesScrollRef,
  messagesEndRef,
  editInputRef,
  onScroll,
  onMediaLayout,
  activeConversation,
  user,
  hoveredMessageId,
  setHoveredMessageId,
  editingMessageId,
  editDraft,
  setEditDraft,
  formatTime,
  renderAttachment,
  onOpenProfile,
  onSaveEdit,
  onCancelEdit,
  onToggleReaction,
  onOpenReactionPicker,
  onReply,
  onJumpToMessage,
  onForward,
  onEdit,
  onDelete,
  pinnedMessageIds,
  onPinToggle,
  highlightedMessageId,
  activeCallId,
  onJoinCall,
  onReport,
}: DMMessageListProps) {
  const selfIds = new Set<string>(
    [user?.id, user?.serverUserId].filter((value): value is string => typeof value === 'string' && value.length > 0)
  );
  const hiddenConversationLinks = useMemo(() => new Set(messages.flatMap((message) => [...hiddenSafetyArtifactKeys(message.safetyArtifacts)].filter((key) => key.startsWith('link:')))), [messages]);

  useEffect(() => {
    if (!highlightedMessageId) return;
    const el = document.getElementById(`msg-${highlightedMessageId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightedMessageId]);

  return (
    <div
      ref={messagesScrollRef}
      onScroll={onScroll}
      onLoadCapture={(event) => {
        if (event.target instanceof HTMLImageElement || event.target instanceof HTMLVideoElement) {
          onMediaLayout();
        }
      }}
      onLoadedMetadataCapture={(event) => {
        if (event.target instanceof HTMLVideoElement) onMediaLayout();
      }}
      className="flex-1 min-h-0 overflow-y-auto py-4"
    >
      <DMMessageListStatus
        loadingOlderMessages={loadingOlderMessages}
        hasOlderMessages={hasOlderMessages}
        hasMessages={messages.length > 0}
      />

      {messages.map((msg: DMMessage, index: number) => {
        const isOfficialAnnouncement = msg.systemType === 'official_announcement';
        if (msg.messageType === 'system' && !isOfficialAnnouncement) {
          const isCallType = /^call_/.test(msg.systemType ?? '');
          if (isCallType) {
            return (
              <CallSystemMessageRow
                key={msg.id}
                systemType={msg.systemType ?? ''}
                systemData={msg.systemData ?? null}
                timestampLabel={formatTime(msg.createdAt)}
                activeCallId={activeCallId ?? null}
                onJoinCall={onJoinCall}
                className="py-1"
              />
            );
          }
          const isE2EEUpgrade = msg.systemType === 'dm_e2ee_upgraded';
          return (
            <SystemMessageRow
              key={msg.id}
              messageType={msg.messageType}
              systemType={msg.systemType ?? null}
              systemData={msg.systemData ?? null}
              text={msg.text}
              timestampLabel={formatTime(msg.createdAt)}
              icon={isE2EEUpgrade ? '🔒' : '🛠'}
              tone={isE2EEUpgrade ? 'success' : 'muted'}
              className="px-6 py-2"
            />
          );
        }

        const isOwn = selfIds.has(msg.senderId);
        const selfUserId = isOwn ? msg.senderId : msg.recipientId;
        const prevMsg = index > 0 ? messages[index - 1] : null;
        const isGrouped = !!prevMsg &&
          prevMsg.messageType !== 'system' &&
          prevMsg.senderId === msg.senderId &&
          msg.createdAt >= prevMsg.createdAt &&
          (msg.createdAt - prevMsg.createdAt) < 300000;
        const showAvatar = !isGrouped;
        const isEditing = editingMessageId === msg.id;
        const parsedLegacyContext = !isEditing && msg.text ? parseDmContextText(msg.text) : null;
        const hiddenSafetyKeys = new Set([...hiddenConversationLinks, ...hiddenSafetyArtifactKeys(msg.safetyArtifacts)]);
        const safetyVisibleMessage = hiddenSafetyKeys.size ? {
          ...msg,
          text: hideSafetyLinks(msg.text, hiddenSafetyKeys),
          attachments: hideSafetyAttachments(msg.attachments, hiddenSafetyKeys),
        } : msg;
        const displayText = hideSafetyLinks(parsedLegacyContext ? parsedLegacyContext.bodyText : (msg.text || ''), hiddenSafetyKeys);
        const authorAvatarUrl = isOwn
          ? (resolveAvatarUrl(user?.avatar ?? undefined, authBase, 'central') ?? defaultAvatarUrl())
          : (resolveAvatarUrl(activeConversation.otherAvatar ?? undefined, authBase, 'central') ?? defaultAvatarUrl());
        const authorAvatarAlt = isOwn ? (user?.username || 'You') : activeConversation.otherUsername;
        const authorName = isOwn
          ? (user?.displayName || user?.username || 'You')
          : (activeConversation.otherDisplayName || activeConversation.otherUsername);
        const profileUserId = isOfficialAnnouncement ? null : (isOwn ? selfUserId : activeConversation.otherUserId);
        const officialTitle = typeof msg.systemData?.title === 'string' ? msg.systemData.title : 'Official announcement';
        const officialLink = typeof msg.systemData?.linkUrl === 'string' ? msg.systemData.linkUrl : null;
        const formattedDisplayText = isOfficialAnnouncement
          ? `# ${officialTitle}\n\n${displayText}${officialLink ? `\n\n[Open official link](${officialLink})` : ''}`
          : displayText;

        return (
          <DMMessageRow
            key={msg.id}
            msg={safetyVisibleMessage}
            isOwn={isOwn}
            isGrouped={isGrouped}
            showAvatar={showAvatar}
            isEditing={isEditing}
            isHovered={hoveredMessageId === msg.id}
            authorName={isOfficialAnnouncement ? 'Official CatRealm ✓' : authorName}
            authorAvatarUrl={authorAvatarUrl}
            authorAvatarAlt={authorAvatarAlt}
            profileUserId={profileUserId}
            timestampLabel={formatTime(msg.createdAt)}
            deliveredLabel={isOwn ? (msg.delivered ? '✓✓' : '✓') : null}
            parsedContext={parsedLegacyContext ? {
              kind: parsedLegacyContext.kind,
              authorLabel: parsedLegacyContext.authorLabel,
              previewText: parsedLegacyContext.previewText,
              messageId: parsedLegacyContext.messageId,
            } : null}
            displayText={formattedDisplayText}
            editDraft={editDraft}
            editInputRef={editInputRef}
            onHoverStart={() => setHoveredMessageId(msg.id)}
            onHoverEnd={() => setHoveredMessageId((prev) => (prev === msg.id ? null : prev))}
            onOpenProfile={(userId) => onOpenProfile(userId)}
            onEditDraftChange={setEditDraft}
            onSaveEdit={onSaveEdit}
            onCancelEdit={onCancelEdit}
            renderAttachment={renderAttachment}
            onToggleReaction={onToggleReaction}
            onOpenReactionPicker={onOpenReactionPicker}
            onReply={onReply}
            onJumpToReply={onJumpToMessage ? (reply, previewText, authorLabel, messageId) => {
              if (messageId) {
                if (messages.some((candidate) => candidate.id === messageId)) onJumpToMessage(messageId);
                return;
              }
              const normalizedPreview = previewText.replace(/\s+/g, ' ').trim();
              const candidates = messages.filter((candidate) => candidate.messageType !== 'system' && candidate.createdAt <= reply.createdAt);
              const target = candidates.reverse().find((candidate) => {
                const parsed = parseDmContextText(candidate.text);
                const body = (parsed ? parsed.bodyText : candidate.text).replace(/\s+/g, ' ').trim();
                if (!body.startsWith(normalizedPreview.slice(0, 60))) return false;
                const fromSelf = selfIds.has(candidate.senderId);
                const labels = fromSelf
                  ? [user?.displayName, user?.username]
                  : [activeConversation.otherDisplayName, activeConversation.otherUsername];
                return labels.some((label) => label && (label === authorLabel || label.startsWith(authorLabel) || authorLabel.startsWith(label)));
              });
              if (target) onJumpToMessage(target.id);
            } : undefined}
            onForward={onForward}
            onEdit={onEdit}
            onDelete={onDelete}
            isPinned={pinnedMessageIds?.has(msg.id) ?? false}
            onPinToggle={onPinToggle}
            isHighlighted={highlightedMessageId === msg.id}
            resolveReactorName={(userId) => {
              if (selfIds.has(userId)) return user?.displayName || user?.username || null;
              if (userId === activeConversation.otherUserId) return activeConversation.otherDisplayName || activeConversation.otherUsername;
              return null;
            }}
            onReport={!isOfficialAnnouncement && !isOwn && reportableSafetyArtifacts(msg.text, msg.attachments).length ? onReport : undefined}
            readOnly={isOfficialAnnouncement}
          />
        );
      })}

      <AnimatePresence>
        {otherUserTyping && (
          <DMTypingIndicator
            key="dm-typing"
            avatarUrl={resolveAvatarUrl(activeConversation.otherAvatar ?? undefined, authBase, 'central') ?? defaultAvatarUrl()}
            avatarAlt={activeConversation.otherUsername}
            displayName={activeConversation.otherDisplayName || activeConversation.otherUsername}
          />
        )}
      </AnimatePresence>

      <div ref={messagesEndRef} />
    </div>
  );
}
