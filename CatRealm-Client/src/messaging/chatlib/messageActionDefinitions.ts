import type { ReactNode } from 'react';
import type { MouseEvent } from 'react';
import type { MessageShortcutActionId } from './messageActions';

export type MessageActionId =
  | 'reply'
  | 'forward'
  | 'edit'
  | 'delete'
  | 'pin'
  | 'thread'
  | 'react'
  | 'copy'
  | 'copy_id'
  | 'speak'
  | 'mark_unread';

export type MessageActionCapabilities = {
  canEdit: boolean;
  canDelete: boolean;
  canPin: boolean;
  canThread: boolean;
  canReact: boolean;
  canReply: boolean;
  canForward: boolean;
  canSpeak: boolean;
  canCopy: boolean;
  canMarkUnread: boolean;
};

export type MessageActionDefinition = {
  id: MessageActionId;
  label: string;
  /** Which capability flag gates visibility */
  capability: keyof MessageActionCapabilities;
  /** Whether to show in the hover quick-action bar */
  showInQuickActions: boolean;
  /** Whether to show in the right-click context menu */
  showInContextMenu: boolean;
  /** If true, render with a danger/destructive style */
  isDanger?: boolean;
};

export type MessageQuickActionItem = {
  key: string;
  title: string;
  onClick: () => void | Promise<void>;
  className?: string;
  content: ReactNode;
  disabled?: boolean;
  visible?: boolean;
};

export type ContextMenuItem = {
  key: string;
  label: string;
  onClick: () => void | Promise<void>;
  isDanger?: boolean;
  /** Items sharing a section render under a small heading (e.g. bot "Apps"). */
  section?: string;
};

const ACTION_DEFINITIONS: MessageActionDefinition[] = [
  { id: 'react', label: 'Add Cat Reactions', capability: 'canReact', showInQuickActions: true, showInContextMenu: true },
  { id: 'reply', label: 'Reply', capability: 'canReply', showInQuickActions: true, showInContextMenu: true },
  { id: 'forward', label: 'Forward', capability: 'canForward', showInQuickActions: true, showInContextMenu: true },
  { id: 'pin', label: 'Pin', capability: 'canPin', showInQuickActions: true, showInContextMenu: true },
  { id: 'thread', label: 'Thread', capability: 'canThread', showInQuickActions: true, showInContextMenu: true },
  { id: 'edit', label: 'Edit', capability: 'canEdit', showInQuickActions: true, showInContextMenu: true },
  { id: 'copy', label: 'Copy Text', capability: 'canCopy', showInQuickActions: false, showInContextMenu: true },
  // Gated on canReply because both need a persisted (non-pending) message id; only realm rows wire a handler.
  { id: 'copy_id', label: 'Copy Message ID', capability: 'canReply', showInQuickActions: false, showInContextMenu: true },
  { id: 'speak', label: 'Speak', capability: 'canSpeak', showInQuickActions: false, showInContextMenu: true },
  { id: 'mark_unread', label: 'Mark Unread', capability: 'canMarkUnread', showInQuickActions: false, showInContextMenu: true },
  { id: 'delete', label: 'Delete', capability: 'canDelete', showInQuickActions: true, showInContextMenu: true, isDanger: true },
];

export function getMessageActionDefinitions(): MessageActionDefinition[] {
  return ACTION_DEFINITIONS;
}

export function resolveVisibleActions(
  definitions: MessageActionDefinition[],
  capabilities: MessageActionCapabilities,
  handlers: Partial<Record<MessageActionId, (event?: MouseEvent<HTMLButtonElement>) => void | Promise<void>>>,
  rendering: Partial<Record<MessageActionId, { title?: string; className?: string; content?: ReactNode }>>,
): MessageQuickActionItem[] {
  const items: MessageQuickActionItem[] = [];
  for (const def of definitions) {
    if (!def.showInQuickActions) continue;
    if (!capabilities[def.capability]) continue;
    const handler = handlers[def.id];
    if (!handler) continue;
    const render = rendering[def.id];
    items.push({
      key: def.id,
      title: render?.title ?? def.label,
      onClick: handler,
      className: render?.className,
      content: render?.content ?? def.label,
    });
  }
  return items;
}

export function resolveContextMenuActions(
  definitions: MessageActionDefinition[],
  capabilities: MessageActionCapabilities,
  handlers: Partial<Record<MessageActionId, (event?: MouseEvent<HTMLButtonElement>) => void | Promise<void>>>,
  overrides?: Partial<Record<MessageActionId, { label?: string }>>,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  for (const def of definitions) {
    if (!def.showInContextMenu) continue;
    if (!capabilities[def.capability]) continue;
    const handler = handlers[def.id];
    if (!handler) continue;
    items.push({
      key: def.id,
      label: overrides?.[def.id]?.label ?? def.label,
      onClick: handler,
      isDanger: def.isDanger,
    });
  }
  return items;
}

/** Map from keybind shortcut action IDs to unified MessageActionId */
export const SHORTCUT_TO_ACTION_MAP: Partial<Record<MessageShortcutActionId, MessageActionId>> = {
  msg_edit: 'edit',
  msg_delete: 'delete',
  msg_pin: 'pin',
  msg_add_reaction: 'react',
  msg_reply: 'reply',
  msg_forward: 'forward',
  msg_copy_text: 'copy',
  msg_mark_unread: 'mark_unread',
  msg_speak: 'speak',
};
