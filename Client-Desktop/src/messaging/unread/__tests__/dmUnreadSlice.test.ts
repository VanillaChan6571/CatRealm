import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  persistRead: vi.fn(),
  dismiss: vi.fn(),
  readFloor: new Map<string, number>(),
}));

vi.mock('../../../lib/authApi', () => ({ authApi: { post: mocks.post } }));
vi.mock('../../../stores/authStore', () => ({ useAuthStore: { getState: () => ({ token: 'token' }) } }));
vi.mock('../../persistence/dmStorage', () => ({
  markConversationAsRead: mocks.persistRead,
  saveConversation: vi.fn(),
  saveMessage: vi.fn(),
}));
vi.mock('../../dm/dmHelpers', () => ({
  getAuthHeader: () => ({}),
  localReadFloorByConversation: mocks.readFloor,
}));
vi.mock('../../../lib/desktopNotifications', () => ({ dismissDesktopNotifications: mocks.dismiss }));

import { createDMUnreadSlice, resetUnreadModuleState } from '../dmUnreadSlice';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readFloor.clear();
  resetUnreadModuleState();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('DM read acknowledgement', () => {
  function makeSlice() {
    let state = {
      conversations: [{ id: 'conversation-1', unreadCount: 2, requestState: 'accepted' }],
      messagesByConversation: { 'conversation-1': [{ id: 'message-1', read: false }] },
    };
    const set = (updater: (value: typeof state) => Partial<typeof state>) => {
      state = { ...state, ...updater(state) };
    };
    return { slice: createDMUnreadSlice(set, () => state), getState: () => state };
  }

  it('keeps the unread bubble when the server rejects the read', async () => {
    mocks.post.mockRejectedValue(new Error('offline'));
    const { slice, getState } = makeSlice();
    await slice.markAsRead('conversation-1');
    expect(getState().conversations[0].unreadCount).toBe(2);
    expect(getState().messagesByConversation['conversation-1'][0].read).toBe(false);
    expect(mocks.persistRead).not.toHaveBeenCalled();
    expect(mocks.dismiss).not.toHaveBeenCalled();
  });

  it('clears the unread bubble after the server accepts the read', async () => {
    mocks.post.mockResolvedValue({ data: { success: true } });
    mocks.persistRead.mockResolvedValue(undefined);
    const { slice, getState } = makeSlice();
    await slice.markAsRead('conversation-1');
    expect(getState().conversations[0].unreadCount).toBe(0);
    expect(getState().messagesByConversation['conversation-1'][0].read).toBe(true);
    expect(mocks.dismiss).toHaveBeenCalledWith('dm', 'conversation-1');
  });
});
