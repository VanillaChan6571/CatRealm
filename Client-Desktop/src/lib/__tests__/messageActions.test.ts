import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  executeMessageShortcutAction,
  copyMessageText,
  speakMessageText,
} from '../../messaging/chatlib/messageActions';

describe('executeMessageShortcutAction', () => {
  it('calls onEdit when action is msg_edit and canEdit is true', () => {
    const onEdit = vi.fn();
    const message = { id: '1', content: 'hello' };
    const result = executeMessageShortcutAction({
      action: 'msg_edit',
      message,
      getText: (m) => m.content,
      canEdit: true,
      onEdit,
    });
    expect(result).toBe(true);
    expect(onEdit).toHaveBeenCalledWith(message);
  });

  it('returns false when action is msg_edit and canEdit is false', () => {
    const onEdit = vi.fn();
    const result = executeMessageShortcutAction({
      action: 'msg_edit',
      message: { id: '1' },
      getText: () => null,
      canEdit: false,
      onEdit,
    });
    expect(result).toBe(false);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('calls onDelete when action is msg_delete', () => {
    const onDelete = vi.fn();
    const message = { id: '2' };
    executeMessageShortcutAction({
      action: 'msg_delete',
      message,
      getText: () => null,
      canDelete: true,
      onDelete,
    });
    expect(onDelete).toHaveBeenCalledWith(message);
  });

  it('calls onReply when action is msg_reply', () => {
    const onReply = vi.fn();
    const message = { id: '3' };
    const result = executeMessageShortcutAction({
      action: 'msg_reply',
      message,
      getText: () => null,
      onReply,
    });
    expect(result).toBe(true);
    expect(onReply).toHaveBeenCalledWith(message);
  });

  it('calls onForward when action is msg_forward', () => {
    const onForward = vi.fn();
    const message = { id: '4' };
    executeMessageShortcutAction({
      action: 'msg_forward',
      message,
      getText: () => null,
      onForward,
    });
    expect(onForward).toHaveBeenCalledWith(message);
  });

  it('calls onMarkUnread when action is msg_mark_unread', () => {
    const onMarkUnread = vi.fn();
    const message = { id: '5' };
    executeMessageShortcutAction({
      action: 'msg_mark_unread',
      message,
      getText: () => null,
      onMarkUnread,
    });
    expect(onMarkUnread).toHaveBeenCalledWith(message);
  });

  it('returns false for unrecognized action', () => {
    const result = executeMessageShortcutAction({
      action: 'unknown_action' as any,
      message: {},
      getText: () => null,
    });
    expect(result).toBe(false);
  });
});

describe('copyMessageText', () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it('returns false for empty text', () => {
    expect(copyMessageText('')).toBe(false);
    expect(copyMessageText(null)).toBe(false);
  });

  it('returns true and calls clipboard for valid text', () => {
    expect(copyMessageText('hello')).toBe(true);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hello');
  });
});

describe('speakMessageText', () => {
  it('returns false for empty text', () => {
    expect(speakMessageText('')).toBe(false);
    expect(speakMessageText(null)).toBe(false);
  });
});
