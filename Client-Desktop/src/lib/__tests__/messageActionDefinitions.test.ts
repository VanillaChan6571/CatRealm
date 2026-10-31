import { describe, it, expect, vi } from 'vitest';
import {
  getMessageActionDefinitions,
  resolveVisibleActions,
  resolveContextMenuActions,
  SHORTCUT_TO_ACTION_MAP,
  type MessageActionCapabilities,
  type MessageActionId,
} from '../../messaging/chatlib/messageActionDefinitions';

const ALL_DISABLED: MessageActionCapabilities = {
  canEdit: false,
  canDelete: false,
  canPin: false,
  canThread: false,
  canReact: false,
  canReply: false,
  canForward: false,
  canSpeak: false,
  canCopy: false,
  canMarkUnread: false,
};

describe('getMessageActionDefinitions', () => {
  it('returns a non-empty array', () => {
    const defs = getMessageActionDefinitions();
    expect(defs.length).toBeGreaterThan(0);
  });

  it('includes reply, forward, edit, delete', () => {
    const defs = getMessageActionDefinitions();
    const ids = defs.map((d) => d.id);
    expect(ids).toContain('reply');
    expect(ids).toContain('forward');
    expect(ids).toContain('edit');
    expect(ids).toContain('delete');
  });
});

describe('resolveVisibleActions', () => {
  it('returns empty when all capabilities disabled', () => {
    const defs = getMessageActionDefinitions();
    const handlers: Partial<Record<MessageActionId, () => void>> = {
      reply: vi.fn(),
      edit: vi.fn(),
    };
    const result = resolveVisibleActions(defs, ALL_DISABLED, handlers, {});
    expect(result).toHaveLength(0);
  });

  it('returns actions matching enabled capabilities and provided handlers', () => {
    const defs = getMessageActionDefinitions();
    const replyFn = vi.fn();
    const handlers: Partial<Record<MessageActionId, () => void>> = {
      reply: replyFn,
    };
    const capabilities: MessageActionCapabilities = { ...ALL_DISABLED, canReply: true };
    const result = resolveVisibleActions(defs, capabilities, handlers, {});
    expect(result.length).toBe(1);
    expect(result[0].key).toBe('reply');
    result[0].onClick();
    expect(replyFn).toHaveBeenCalledOnce();
  });

  it('applies rendering overrides', () => {
    const defs = getMessageActionDefinitions();
    const handlers: Partial<Record<MessageActionId, () => void>> = { reply: vi.fn() };
    const capabilities: MessageActionCapabilities = { ...ALL_DISABLED, canReply: true };
    const result = resolveVisibleActions(defs, capabilities, handlers, {
      reply: { title: 'Custom Reply', className: 'custom-class' },
    });
    expect(result[0].title).toBe('Custom Reply');
    expect(result[0].className).toBe('custom-class');
  });
});

describe('resolveContextMenuActions', () => {
  it('returns empty when all capabilities disabled', () => {
    const defs = getMessageActionDefinitions();
    const result = resolveContextMenuActions(defs, ALL_DISABLED, {});
    expect(result).toHaveLength(0);
  });

  it('returns context menu items for enabled capabilities', () => {
    const defs = getMessageActionDefinitions();
    const deleteFn = vi.fn();
    const handlers: Partial<Record<MessageActionId, () => void>> = { delete: deleteFn };
    const capabilities: MessageActionCapabilities = { ...ALL_DISABLED, canDelete: true };
    const result = resolveContextMenuActions(defs, capabilities, handlers);
    expect(result.length).toBe(1);
    expect(result[0].key).toBe('delete');
    expect(result[0].isDanger).toBe(true);
  });

  it('applies label overrides', () => {
    const defs = getMessageActionDefinitions();
    const handlers: Partial<Record<MessageActionId, () => void>> = { pin: vi.fn() };
    const capabilities: MessageActionCapabilities = { ...ALL_DISABLED, canPin: true };
    const result = resolveContextMenuActions(defs, capabilities, handlers, { pin: { label: 'Unpin' } });
    expect(result[0].label).toBe('Unpin');
  });
});

describe('SHORTCUT_TO_ACTION_MAP', () => {
  it('maps msg_edit to edit', () => {
    expect(SHORTCUT_TO_ACTION_MAP.msg_edit).toBe('edit');
  });
  it('maps msg_reply to reply', () => {
    expect(SHORTCUT_TO_ACTION_MAP.msg_reply).toBe('reply');
  });
});
