import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useBlockedUsersStore } from '../../stores/blockedUsersStore';
import { getRoleNameStyle } from '../../lib/roleStyles';
import type { MouseEvent, ReactNode, RefObject } from 'react';
import { AvatarImage } from '../ui/AvatarImage';
import {
  type ContextMenuItem,
  type MessageActionCapabilities,
  type MessageActionId,
  getMessageActionDefinitions,
  resolveVisibleActions,
  resolveContextMenuActions,
} from '../../messaging/chatlib/messageActionDefinitions';
import { executeMessageShortcutAction, getShortcutActionFromEvent } from '../../messaging/chatlib/messageActions';
import { MessageContextMenu } from './MessageContextMenu';
import {
  MessageInlineEditor,
  MessageQuickActions,
  MessageRowHeader,
  MessageTranslationNote,
  MessageReactionsDialog,
  type MessageReactionDetail,
} from './SharedMessageRowParts';
import { useAutoTranslation } from '../../lib/translation/useAutoTranslation';

export type MessageRowAdapter<TMessage = unknown> = {
  /** The underlying message object */
  message: TMessage;
  messageId: string;

  // Author display
  authorName: string;
  authorAvatarUrl: string;
  authorAvatarAlt?: string;
  profileUserId: string | null;
  authorNameColor?: string;
  authorRoleIcon?: string | null;
  authorRoleStyleType?: string | null;
  authorRoleStyleColors?: string | null;
  authorPrefix?: ReactNode;
  authorBadge?: ReactNode;

  // Timestamp / indicators
  timestampLabel: string;
  deliveryIndicator?: ReactNode;
  pinnedIndicator?: ReactNode;

  // Content blocks
  contextBlock: ReactNode | null;
  bodyContent: ReactNode | null;
  attachmentContent: ReactNode | null;
  reactionContent: ReactNode | null;

  // CatLab auto-translate: plain (already decrypted) message text plus a renderer that formats
  // any text the same way as bodyContent. Rows that omit these are never translated.
  translatableText?: string | null;
  renderBodyText?: (text: string) => ReactNode;

  // "View Cat Reactions": the reaction list plus how to draw an emoji and name a reactor.
  reactionDetails?: MessageReactionDetail[];
  renderReactionEmoji?: (emoji: string) => ReactNode;
  resolveReactorName?: (userId: string) => string | null;

  // Layout
  isGrouped: boolean;
  showAvatar: boolean;
  highlightClassName?: string;
  avatarSize?: number;

  // Edit mode
  isEditing: boolean;
  editContent?: string;
  editInputRef?: RefObject<HTMLTextAreaElement | null>;
  onEditChange?: (v: string) => void;
  onEditSave?: () => void | Promise<void>;
  onEditCancel?: () => void;
  editVariant?: 'compact-links' | 'buttons';

  // Actions
  capabilities: MessageActionCapabilities;
  actionHandlers: Partial<Record<MessageActionId, (event?: MouseEvent<HTMLButtonElement>) => void | Promise<void>>>;
  /** Quick action bar rendering config per action */
  quickActionRendering?: Partial<Record<MessageActionId, { title?: string; className?: string; content?: ReactNode }>>;
  /** Override labels for context menu items */
  contextMenuLabelOverrides?: Partial<Record<MessageActionId, { label?: string }>>;
  /** Extra context menu items (e.g. bot message actions), placed above destructive items */
  extraContextMenuItems?: ContextMenuItem[];

  // Callbacks
  onOpenProfile?: (userId: string) => void;

  // Message text for copy/speak shortcuts
  getText?: () => string | null | undefined;

  // Touch long-press handler (mobile action drawer)
  onLongPress?: () => void;

  // Styling variants
  containerClassName?: string;
  /** Optional one-shot entrance animation class (e.g. optimistic send ghost). */
  entranceClassName?: string;
  avatarColumnClassName?: string;
  contentColumnClassName?: string;
  headerClassName?: string;
  quickActionsContainerClassName?: string;
};

type SharedMessageRowProps<TMessage = unknown> = {
  adapter: MessageRowAdapter<TMessage>;
};

export function SharedMessageRow<TMessage = unknown>({ adapter }: SharedMessageRowProps<TMessage>) {
  const blockedUsers = useBlockedUsersStore((s) => s.blockedUsers);

  const [showActions, setShowActions] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const touchStartTimeRef = useRef<number | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [reactionsOpen, setReactionsOpen] = useState(false);

  const {
    messageId,
    authorName,
    authorAvatarUrl,
    authorAvatarAlt,
    profileUserId,
    authorNameColor,
    authorRoleIcon,
    authorRoleStyleType,
    authorRoleStyleColors,
    authorPrefix,
    authorBadge,
    timestampLabel,
    deliveryIndicator,
    pinnedIndicator,
    contextBlock,
    bodyContent,
    attachmentContent,
    reactionContent,
    isGrouped,
    showAvatar,
    highlightClassName,
    avatarSize = 40,
    isEditing,
    editContent,
    editInputRef,
    onEditChange,
    onEditSave,
    onEditCancel,
    editVariant = 'compact-links',
    capabilities,
    actionHandlers,
    quickActionRendering,
    contextMenuLabelOverrides,
    extraContextMenuItems,
    onOpenProfile,
    getText,
    containerClassName,
    entranceClassName,
    avatarColumnClassName,
    contentColumnClassName,
    headerClassName,
    quickActionsContainerClassName,
    translatableText,
    renderBodyText,
    reactionDetails,
    renderReactionEmoji,
    resolveReactorName,
  } = adapter;
  const canViewReactions = !!reactionDetails?.length && !!renderReactionEmoji && !!resolveReactorName;

  const { t } = useTranslation();
  const { translation, target: translationTarget, requestTranslation } = useAutoTranslation(
    messageId,
    renderBodyText ? translatableText : null,
    rowRef,
  );

  const hasAnyAction = Object.values(capabilities).some(Boolean);

  // Close context menu on click/escape/another menu opening
  useEffect(() => {
    if (!contextMenu) return;
    const onClose = () => setContextMenu(null);
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('click', onClose);
    window.addEventListener('keydown', onEsc);
    window.addEventListener('closeContextMenus', onClose);
    return () => {
      window.removeEventListener('click', onClose);
      window.removeEventListener('keydown', onEsc);
      window.removeEventListener('closeContextMenus', onClose);
    };
  }, [contextMenu]);

  // Dismiss quick actions on outside tap (touch)
  useEffect(() => {
    if (!showActions || contextMenu) return;
    const onOutsideTap = () => setShowActions(false);
    window.addEventListener('touchstart', onOutsideTap);
    return () => window.removeEventListener('touchstart', onOutsideTap);
  }, [showActions, contextMenu]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: Event) => {
      if (!showActions || isEditing) return;
      const action = getShortcutActionFromEvent(e);
      if (!action) return;
      executeMessageShortcutAction({
        action,
        message: adapter.message,
        getText: () => getText?.() ?? null,
        canEdit: capabilities.canEdit,
        canDelete: capabilities.canDelete,
        canPin: capabilities.canPin,
        onEdit: actionHandlers.edit ? () => actionHandlers.edit!() : undefined,
        onDelete: actionHandlers.delete ? () => actionHandlers.delete!() : undefined,
        onPinToggle: actionHandlers.pin ? () => actionHandlers.pin!() : undefined,
        onAddReaction: actionHandlers.react ? () => actionHandlers.react!() : undefined,
        onReply: actionHandlers.reply ? () => actionHandlers.reply!() : undefined,
        onForward: actionHandlers.forward ? () => actionHandlers.forward!() : undefined,
        onMarkUnread: actionHandlers.mark_unread ? () => actionHandlers.mark_unread!() : undefined,
      });
    };
    window.addEventListener('catrealm:keybind:message', handler);
    return () => window.removeEventListener('catrealm:keybind:message', handler);
  }, [showActions, isEditing, capabilities, actionHandlers, getText, adapter.message]);

  // Cleanup long-press timer
  useEffect(() => {
    return () => {
      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current);
      }
    };
  }, []);

  if (adapter.profileUserId && blockedUsers.has(adapter.profileUserId)) return null;

  const clearLongPress = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    touchStartRef.current = null;
    touchStartTimeRef.current = null;
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    // Stop propagation so the window-level "outside tap" dismiss handler doesn't fire on this message
    e.stopPropagation();
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    touchStartTimeRef.current = Date.now();

    if (hasAnyAction) {
      longPressTimerRef.current = window.setTimeout(() => {
        longPressTimerRef.current = null;
        touchStartRef.current = null;
        touchStartTimeRef.current = null;
        window.dispatchEvent(new CustomEvent('closeContextMenus'));
        setContextMenu({ x: touch.clientX, y: touch.clientY - 60 });
      }, 500);
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const startTime = touchStartTimeRef.current;
    const startPos = touchStartRef.current;
    clearLongPress();

    if (hasAnyAction && startPos && startTime !== null && Date.now() - startTime < 300) {
      const touch = e.changedTouches[0];
      const dx = Math.abs(touch.clientX - startPos.x);
      const dy = Math.abs(touch.clientY - startPos.y);
      if (dx < 10 && dy < 10) {
        setShowActions((prev) => !prev);
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStartRef.current || e.touches.length !== 1) {
      clearLongPress();
      return;
    }
    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - touchStartRef.current.x);
    const dy = Math.abs(touch.clientY - touchStartRef.current.y);
    if (dx > 10 || dy > 10) clearLongPress();
  };

  // Build quick actions
  const definitions = getMessageActionDefinitions();
  const quickActions = resolveVisibleActions(
    definitions,
    capabilities,
    actionHandlers,
    quickActionRendering ?? {},
  );

  // Build context menu items
  const contextMenuItems = resolveContextMenuActions(
    definitions,
    capabilities,
    actionHandlers,
    contextMenuLabelOverrides,
  );
  if (canViewReactions) {
    const reactIndex = contextMenuItems.findIndex((item) => item.key === 'react');
    contextMenuItems.splice(reactIndex + 1, 0, {
      key: 'view_reactions',
      label: t('chat.viewCatReactions'),
      onClick: () => setReactionsOpen(true),
    });
  }

  if (extraContextMenuItems?.length) {
    const dangerIndex = contextMenuItems.findIndex((item) => item.isDanger);
    contextMenuItems.splice(dangerIndex === -1 ? contextMenuItems.length : dangerIndex, 0, ...extraContextMenuItems);
  }

  // CatLab: translate a message auto-translate skipped, or flip an existing translation
  // (inserted above destructive items so it isn't the last thing in the menu).
  if (translationTarget) {
    const dangerIndex = contextMenuItems.findIndex((item) => item.isDanger);
    contextMenuItems.splice(dangerIndex === -1 ? contextMenuItems.length : dangerIndex, 0, translation
      ? {
          key: 'translate',
          label: showOriginal ? t('chat.showTranslation') : t('chat.showOriginal'),
          onClick: () => setShowOriginal((value) => !value),
        }
      : {
          key: 'translate',
          label: t('chat.translateTo', { language: t(`chat.languageName_${translationTarget}`) }),
          onClick: () => {
            setShowOriginal(false);
            requestTranslation();
          },
        });
  }

  const defaultContainerClassName = `px-4 hover:bg-bg-hover/30 transition-colors ${isGrouped ? 'pt-0.5' : 'pt-3'}`;
  // Always enforce required positioning/hover scope classes for quick-action and context-menu UI.
  const resolvedContainerClassName = `group relative ${containerClassName ?? defaultContainerClassName} ${highlightClassName ?? ''} ${entranceClassName ?? ''}`;

  const avatarSizePx = avatarSize;
  const avatarClass = avatarColumnClassName ?? `w-${Math.round(avatarSizePx / 4)} h-${Math.round(avatarSizePx / 4)} rounded-full avatar-bg-muted flex items-center justify-center text-white text-sm font-semibold shrink-0 mt-0.5 overflow-hidden`;

  return (
    <div
      ref={rowRef}
      id={`msg-${messageId}`}
      data-message-shortcut-hovered={showActions ? '1' : undefined}
      data-show-actions={showActions ? '' : undefined}
      className={resolvedContainerClassName}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
      onContextMenu={(e) => {
        if (!hasAnyAction) return;
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('closeContextMenus'));
        setContextMenu({ x: e.clientX, y: e.clientY });
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={clearLongPress}
    >
      <div className="flex gap-3">
        {/* Avatar column */}
        {showAvatar ? (
          <div
            className={`${avatarClass} ${profileUserId && onOpenProfile ? 'cursor-pointer' : ''}`}
            style={{ width: avatarSizePx, height: avatarSizePx }}
            onClick={() => { if (profileUserId && onOpenProfile) onOpenProfile(profileUserId); }}
          >
            <AvatarImage
              src={authorAvatarUrl}
              alt={authorAvatarAlt ?? authorName}
              size={avatarSizePx}
              className={`w-full h-full object-cover`}
              fallback={<span>{authorName.charAt(0).toUpperCase()}</span>}
            />
          </div>
        ) : (
          <div className={avatarColumnClassName ?? 'shrink-0'} style={{ width: avatarSizePx }} />
        )}

        {/* Content column */}
        <div className={contentColumnClassName ?? 'flex-1 min-w-0'}>
          {showAvatar && (
            <MessageRowHeader
              className={headerClassName}
              left={(
                <span
                  className="font-medium text-sm hover:underline cursor-pointer inline-flex min-w-0 items-center gap-1"
                  style={getRoleNameStyle(authorNameColor, authorRoleStyleType, authorRoleStyleColors)}
                  onClick={() => {
                    if (profileUserId && onOpenProfile) onOpenProfile(profileUserId);
                  }}
                >
                  {authorPrefix}
                  <span className="truncate">{authorName}</span>
                  {authorRoleIcon && (
                    <img src={authorRoleIcon} alt="" className="inline-block w-4 h-4 object-contain align-middle ml-0.5 shrink-0" />
                  )}
                  {authorBadge}
                </span>
              )}
              right={(
                <span className="text-xs text-text-muted">
                  {timestampLabel}
                  {pinnedIndicator}
                  {deliveryIndicator}
                </span>
              )}
            />
          )}

          {isEditing && onEditChange && onEditSave && onEditCancel ? (
            <MessageInlineEditor
              variant={editVariant}
              value={editContent ?? ''}
              onChange={onEditChange}
              onSave={onEditSave}
              onCancel={onEditCancel}
              textareaRef={editInputRef}
              minRows={2}
              dynamicRows={editVariant === 'buttons'}
              maxRows={editVariant === 'buttons' ? 8 : undefined}
              containerClassName={editVariant === 'compact-links' ? 'space-y-1' : undefined}
              textareaClassName={
                editVariant === 'compact-links'
                  ? 'w-full bg-bg-input border border-border rounded px-2 py-1 text-sm text-text-primary resize-none focus:outline-none focus:border-accent'
                  : 'w-full rounded-lg border border-border bg-bg-input px-3 py-2 text-sm text-text-primary resize-y focus:outline-none focus:border-accent'
              }
            />
          ) : (
            <div className="space-y-2">
              {contextBlock}
              {translation && renderBodyText ? (
                <div>
                  {showOriginal ? bodyContent : renderBodyText(translation.text)}
                  <MessageTranslationNote
                    translation={translation}
                    showingOriginal={showOriginal}
                    onToggle={() => setShowOriginal((value) => !value)}
                  />
                </div>
              ) : bodyContent}
              {attachmentContent}
              {reactionContent}
            </div>
          )}
        </div>
      </div>

      {/* Quick action bar */}
      {hasAnyAction && showActions && !isEditing && quickActions.length > 0 && (
        <MessageQuickActions
          containerClassName={quickActionsContainerClassName ?? 'absolute top-1 right-4 z-20 flex bg-bg-elevated border border-border rounded shadow-lg'}
          actions={quickActions}
        />
      )}

      {canViewReactions && reactionsOpen && (
        <MessageReactionsDialog
          open
          onClose={() => setReactionsOpen(false)}
          reactions={reactionDetails!}
          renderEmoji={renderReactionEmoji!}
          resolveName={resolveReactorName!}
        />
      )}

      {/* Context menu */}
      {contextMenu && contextMenuItems.length > 0 && (
        <MessageContextMenu
          items={contextMenuItems}
          position={contextMenu}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
