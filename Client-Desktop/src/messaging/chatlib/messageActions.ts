import { writeClipboardText } from '../../lib/clipboard';

export type MessageShortcutActionId =
  | 'msg_edit'
  | 'msg_delete'
  | 'msg_pin'
  | 'msg_add_reaction'
  | 'msg_reply'
  | 'msg_forward'
  | 'msg_copy_text'
  | 'msg_mark_unread'
  | 'msg_speak';

type MessageShortcutEventDetail = { action?: string };
type MessageEditEventDetail = { messageId: string };
type MessageComposerEventDetail<TMessage> = { message: TMessage };

export function dispatchHoveredMessageShortcut(action: MessageShortcutActionId) {
  window.dispatchEvent(new CustomEvent<MessageShortcutEventDetail>('catrealm:keybind:message', { detail: { action } }));
}

export function dispatchMessageEditRequest(messageId: string) {
  window.dispatchEvent(new CustomEvent<MessageEditEventDetail>('message:edit', { detail: { messageId } }));
}

export function dispatchMessageReply<TMessage>(message: TMessage) {
  window.dispatchEvent(new CustomEvent<MessageComposerEventDetail<TMessage>>('message:reply', { detail: { message } }));
}

export function dispatchMessageForward<TMessage>(message: TMessage) {
  window.dispatchEvent(new CustomEvent<MessageComposerEventDetail<TMessage>>('message:forward', { detail: { message } }));
}

// Opens the composer's expression picker in reaction mode for the given message
// (server channels; DMs manage their own picker state in DMView).
export function dispatchMessageReact(messageId: string) {
  window.dispatchEvent(new CustomEvent<MessageEditEventDetail>('message:react-picker', { detail: { messageId } }));
}

export function getShortcutActionFromEvent(event: Event): MessageShortcutActionId | null {
  const action = (event as CustomEvent<MessageShortcutEventDetail>).detail?.action;
  if (!action) return null;
  switch (action) {
    case 'msg_edit':
    case 'msg_delete':
    case 'msg_pin':
    case 'msg_add_reaction':
    case 'msg_reply':
    case 'msg_forward':
    case 'msg_copy_text':
    case 'msg_mark_unread':
    case 'msg_speak':
      return action;
    default:
      return null;
  }
}

export function copyMessageText(text: string | null | undefined) {
  const value = String(text || '').trim();
  if (!value) return false;
  void writeClipboardText(value);
  return true;
}

export function speakMessageText(text: string | null | undefined) {
  const value = String(text || '').trim();
  if (!value || typeof window.speechSynthesis === 'undefined') return false;
  try {
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(value));
    return true;
  } catch {
    return false;
  }
}

type MaybePromise<T> = T | Promise<T>;

export type MessageShortcutExecutorOptions<TMessage> = {
  action: MessageShortcutActionId;
  message: TMessage;
  getText: (message: TMessage) => string | null | undefined;
  canEdit?: boolean;
  canDelete?: boolean;
  canPin?: boolean;
  onEdit?: (message: TMessage) => MaybePromise<void>;
  onDelete?: (message: TMessage) => MaybePromise<void>;
  onPinToggle?: (message: TMessage) => MaybePromise<void>;
  onAddReaction?: (message: TMessage) => MaybePromise<void>;
  onReply?: (message: TMessage) => MaybePromise<void>;
  onForward?: (message: TMessage) => MaybePromise<void>;
  onMarkUnread?: (message: TMessage) => MaybePromise<void>;
};

export function executeMessageShortcutAction<TMessage>(opts: MessageShortcutExecutorOptions<TMessage>): boolean {
  const {
    action,
    message,
    getText,
    canEdit = true,
    canDelete = true,
    canPin = true,
    onEdit,
    onDelete,
    onPinToggle,
    onAddReaction,
    onReply,
    onForward,
    onMarkUnread,
  } = opts;

  switch (action) {
    case 'msg_edit':
      if (!canEdit || !onEdit) return false;
      void onEdit(message);
      return true;
    case 'msg_delete':
      if (!canDelete || !onDelete) return false;
      void onDelete(message);
      return true;
    case 'msg_pin':
      if (!canPin || !onPinToggle) return false;
      void onPinToggle(message);
      return true;
    case 'msg_add_reaction':
      if (!onAddReaction) return false;
      void onAddReaction(message);
      return true;
    case 'msg_reply':
      if (!onReply) return false;
      void onReply(message);
      return true;
    case 'msg_forward':
      if (!onForward) return false;
      void onForward(message);
      return true;
    case 'msg_mark_unread':
      if (!onMarkUnread) return false;
      void onMarkUnread(message);
      return true;
    case 'msg_copy_text':
      return copyMessageText(getText(message));
    case 'msg_speak':
      return speakMessageText(getText(message));
    default:
      return false;
  }
}
