import type { MouseEvent, ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react';
import { Modal } from '../ui/Modal';
import type { MessageTranslation } from '../../lib/translation';

type InlineEditorVariant = 'compact-links' | 'buttons';

type MessageInlineEditorProps = {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void | Promise<void>;
  onCancel: () => void;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  maxLength?: number;
  minRows?: number;
  maxRows?: number;
  dynamicRows?: boolean;
  textareaClassName?: string;
  containerClassName?: string;
  helperClassName?: string;
  variant?: InlineEditorVariant;
};

export function MessageInlineEditor({
  value,
  onChange,
  onSave,
  onCancel,
  textareaRef,
  maxLength = 2000,
  minRows = 2,
  maxRows = 8,
  dynamicRows = false,
  textareaClassName = '',
  containerClassName = '',
  helperClassName = '',
  variant = 'buttons',
}: MessageInlineEditorProps) {
  const rows = dynamicRows
    ? Math.min(maxRows, Math.max(minRows, value.split('\n').length))
    : minRows;

  return (
    <div className={containerClassName || 'space-y-2'}>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
            return;
          }
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void onSave();
          }
        }}
        rows={rows}
        maxLength={maxLength}
        className={textareaClassName}
      />
      {variant === 'compact-links' ? (
        <div className={helperClassName || 'flex gap-2 text-xs'}>
          <span className="text-text-muted">
            escape to{' '}
            <button type="button" onClick={onCancel} className="text-accent hover:underline">
              cancel
            </button>
            {' '}&middot; enter to{' '}
            <button type="button" onClick={() => void onSave()} className="text-accent hover:underline">
              save
            </button>
          </span>
        </div>
      ) : (
        <div className={helperClassName || 'flex items-center gap-2 text-xs'}>
          <button
            type="button"
            onClick={() => void onSave()}
            className="px-2 py-1 rounded bg-accent text-white hover:opacity-90"
          >
            Save
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-2 py-1 rounded bg-bg-elevated text-text-secondary hover:text-text-primary"
          >
            Cancel
          </button>
          <span className="text-text-muted">Enter to save • Shift+Enter for newline • Esc to cancel</span>
        </div>
      )}
    </div>
  );
}

type MessageHoverActionBarProps = {
  className?: string;
  children: ReactNode;
};

export function MessageHoverActionBar({
  className = 'flex items-start gap-1 flex-shrink-0',
  children,
}: MessageHoverActionBarProps) {
  return <div className={className}>{children}</div>;
}

type MessageHoverActionButtonProps = {
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  title: string;
  className?: string;
  children: ReactNode;
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
};

export function MessageHoverActionButton({
  onClick,
  title,
  className = '',
  children,
  type = 'button',
  disabled = false,
}: MessageHoverActionButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={className}
      title={title}
    >
      {children}
    </button>
  );
}

export type MessageQuickActionItem = {
  key: string;
  title: string;
  onClick: (event?: MouseEvent<HTMLButtonElement>) => void | Promise<void>;
  className?: string;
  content: ReactNode;
  disabled?: boolean;
  visible?: boolean;
};

type CommonMessageQuickActionConfig<TMessage> = {
  message: TMessage;
  reply?: Omit<MessageQuickActionItem, 'key' | 'onClick'> & { onClick: (message: TMessage) => void | Promise<void> };
  forward?: Omit<MessageQuickActionItem, 'key' | 'onClick'> & { onClick: (message: TMessage) => void | Promise<void> };
  edit?: Omit<MessageQuickActionItem, 'key' | 'onClick'> & { onClick: (message: TMessage) => void | Promise<void> };
  delete?: Omit<MessageQuickActionItem, 'key' | 'onClick'> & { onClick: (message: TMessage) => void | Promise<void> };
};

export function buildCommonMessageQuickActions<TMessage>({
  message,
  reply,
  forward,
  edit,
  delete: deleteAction,
}: CommonMessageQuickActionConfig<TMessage>): MessageQuickActionItem[] {
  const items: MessageQuickActionItem[] = [];

  if (reply) {
    items.push({
      ...reply,
      key: 'reply',
      onClick: () => reply.onClick(message),
    });
  }
  if (forward) {
    items.push({
      ...forward,
      key: 'forward',
      onClick: () => forward.onClick(message),
    });
  }
  if (edit) {
    items.push({
      ...edit,
      key: 'edit',
      onClick: () => edit.onClick(message),
    });
  }
  if (deleteAction) {
    items.push({
      ...deleteAction,
      key: 'delete',
      onClick: () => deleteAction.onClick(message),
    });
  }

  return items;
}

type MessageQuickActionsProps = {
  actions: MessageQuickActionItem[];
  containerClassName?: string;
};

export function MessageQuickActions({
  actions,
  containerClassName,
}: MessageQuickActionsProps) {
  const visibleActions = actions.filter((action) => action.visible !== false);
  if (visibleActions.length === 0) return null;

  return (
    <MessageHoverActionBar className={containerClassName}>
      {visibleActions.map((action) => (
        <MessageHoverActionButton
          key={action.key}
          onClick={(event) => void action.onClick(event)}
          className={action.className}
          title={action.title}
          disabled={action.disabled}
        >
          {action.content}
        </MessageHoverActionButton>
      ))}
    </MessageHoverActionBar>
  );
}

type MessageRowHeaderProps = {
  left: ReactNode;
  right?: ReactNode;
  className?: string;
};

export function MessageRowHeader({
  left,
  right = null,
  className = 'flex items-baseline gap-2 mb-0.5',
}: MessageRowHeaderProps) {
  return (
    <div className={className}>
      {left}
      {right}
    </div>
  );
}

type MessageContextBlockProps = {
  kind: 'reply' | 'forward';
  authorLabel: string;
  onJump?: () => void;
  previewText?: string | null;
  channelLabel?: string | null;
  authorClassName?: string;
  containerClassName?: string;
  headerClassName?: string;
  previewClassName?: string;
  renderPreview?: (text: string) => ReactNode;
};

export function MessageContextBlock({
  kind,
  authorLabel,
  onJump,
  previewText = null,
  channelLabel = null,
  authorClassName,
  containerClassName,
  headerClassName,
  previewClassName,
  renderPreview,
}: MessageContextBlockProps) {
  const isReply = kind === 'reply';
  const resolvedContainerClassName = containerClassName ?? (
    isReply
      ? 'mb-2 pl-3 border-l-2 border-accent/50 bg-bg-elevated/30 rounded p-2 text-xs'
      : 'mb-2 pl-3 border-l-2 border-blue-500/50 bg-bg-elevated/30 rounded p-2 text-xs'
  );
  const resolvedHeaderClassName = headerClassName ?? 'text-text-muted';
  const resolvedAuthorClassName = authorClassName ?? (isReply ? 'text-accent' : 'text-blue-400');

  return (
    <div
      className={`${resolvedContainerClassName} ${onJump ? 'cursor-pointer hover:bg-bg-hover/60' : ''}`}
      role={onJump ? 'button' : undefined}
      tabIndex={onJump ? 0 : undefined}
      aria-label={onJump ? `Jump to message from ${authorLabel}` : undefined}
      onClick={onJump}
      onKeyDown={onJump ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onJump();
        }
      } : undefined}
    >
      <div className={resolvedHeaderClassName}>
        {isReply ? 'Replying to' : 'Forwarded from'}{' '}
        <span className={resolvedAuthorClassName}>{authorLabel}</span>
        {!isReply && channelLabel ? <span> in {channelLabel}</span> : null}
      </div>
      {previewText ? (
        renderPreview ? (
          renderPreview(previewText)
        ) : (
          <p className={previewClassName ?? 'text-text-secondary truncate'}>{previewText}</p>
        )
      ) : null}
    </div>
  );
}

/** CatLab auto-translate footer: "Translated from Spanish · 94% confidence · Show original". */
export function MessageTranslationNote({
  translation,
  showingOriginal,
  onToggle,
}: {
  translation: MessageTranslation;
  showingOriginal: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-text-muted">
      <Languages className="h-3 w-3 shrink-0" aria-hidden />
      <span>{t('chat.translatedFrom', { language: t(`chat.languageName_${translation.from}`) })}</span>
      {translation.confidence !== null && (
        <>
          <span aria-hidden>·</span>
          <span>{t('chat.translationConfidence', { percent: Math.round(translation.confidence * 100) })}</span>
        </>
      )}
      <span aria-hidden>·</span>
      <button type="button" className="hover:underline hover:text-text-secondary" onClick={onToggle}>
        {showingOriginal ? t('chat.showTranslation') : t('chat.showOriginal')}
      </button>
    </div>
  );
}

export type MessageReactionDetail = { emoji: string; count: number; users?: string[] };

/** "View Cat Reactions": who reacted with what, grouped by reaction. */
export function MessageReactionsDialog({
  open,
  onClose,
  reactions,
  renderEmoji,
  resolveName,
}: {
  open: boolean;
  onClose: () => void;
  reactions: MessageReactionDetail[];
  renderEmoji: (emoji: string) => ReactNode;
  resolveName: (userId: string) => string | null;
}) {
  const { t } = useTranslation();
  return createPortal(
    <Modal open={open} onClose={onClose} title={t('chat.catReactionsTitle')}>
      <div className="max-h-[60vh] space-y-3 overflow-y-auto">
        {reactions.map((reaction) => (
          <div key={reaction.emoji} className="rounded-lg border border-border bg-bg-input/40 px-3 py-2">
            <div className="flex items-center gap-2 text-sm text-text-primary">
              <span className="inline-flex items-center">{renderEmoji(reaction.emoji)}</span>
              <span className="text-xs text-text-muted">{reaction.count}</span>
            </div>
            {reaction.users && reaction.users.length > 0 && (
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {reaction.users.map((userId) => (
                  <li key={userId} className="rounded-full bg-bg-hover/60 px-2 py-0.5 text-xs text-text-secondary">
                    {resolveName(userId) ?? t('chat.reactorUnknown')}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </Modal>,
    document.body,
  );
}
