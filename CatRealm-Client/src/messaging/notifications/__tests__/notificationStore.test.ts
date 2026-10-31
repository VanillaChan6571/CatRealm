import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  applyDm: vi.fn(),
  applyMentions: vi.fn(),
}));

vi.mock('../../../lib/authApi', () => ({ createAuthenticatedApi: () => ({ get: mocks.get }) }));
vi.mock('../../../lib/deviceIdentity', () => ({ getLocalDeviceId: () => 'device-1' }));
vi.mock('../../../stores/dmStore', () => ({
  useDMStore: { getState: () => ({ messagesByConversation: {}, applyUnreadSummary: mocks.applyDm }) },
}));
vi.mock('../../../stores/serverStore', () => ({
  useServerStore: { getState: () => ({ applyCentralMentionSummary: mocks.applyMentions }) },
}));
vi.mock('../../crypto/notificationPreviewCrypto', () => ({ decryptNotificationPreviewEnvelope: vi.fn() }));

import { useNotificationStore, type CentralNotification, type CentralNotificationSummary } from '../notificationStore';

const notification: CentralNotification = {
  id: 'notice-1', type: 'dm_message', sourceKind: 'dm', sourceId: 'conversation-1',
  subsourceId: null, messageId: 'message-1', actorName: 'Bob', createdAt: 1,
  readAt: null, payload: null,
};
const unreadSummary: CentralNotificationSummary = {
  totalUnread: 1, unreadDMs: 1, unreadMentions: 0,
  dmByConversation: { 'conversation-1': 1 }, mentionsByRealm: {}, mentionsByChannel: {},
};
const readSummary: CentralNotificationSummary = {
  ...unreadSummary, totalUnread: 0, unreadDMs: 0, dmByConversation: {},
};

beforeEach(() => {
  mocks.get.mockReset();
  mocks.applyDm.mockReset();
  mocks.applyMentions.mockReset();
  localStorage.clear();
  useNotificationStore.setState({ items: [], summary: null, loaded: false });
});

describe('notification read reconciliation', () => {
  it('does not restore an unread DM from a refresh started before its read summary', async () => {
    let resolveOldItems!: (value: { data: CentralNotification[] }) => void;
    let resolveOldSummary!: (value: { data: CentralNotificationSummary }) => void;
    const oldItems = new Promise<{ data: CentralNotification[] }>((resolve) => { resolveOldItems = resolve; });
    const oldSummary = new Promise<{ data: CentralNotificationSummary }>((resolve) => { resolveOldSummary = resolve; });
    let requests = 0;
    mocks.get.mockImplementation((url: string) => {
      requests += 1;
      if (requests <= 2) return url === '/api/notifications' ? oldItems : oldSummary;
      return Promise.resolve({ data: url === '/api/notifications' ? [{ ...notification, readAt: 2 }] : readSummary });
    });

    useNotificationStore.getState().prepend(notification);
    const firstRefresh = useNotificationStore.getState().refresh();
    useNotificationStore.getState().applySummary(readSummary);
    expect(useNotificationStore.getState().items[0].readAt).not.toBeNull();

    resolveOldItems({ data: [notification] });
    resolveOldSummary({ data: unreadSummary });
    await firstRefresh;
    await vi.waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(4));
    await vi.waitFor(() => expect(useNotificationStore.getState().loaded).toBe(true));
    expect(useNotificationStore.getState().summary?.totalUnread).toBe(0);
    expect(useNotificationStore.getState().items[0].readAt).not.toBeNull();
    expect(mocks.applyDm).toHaveBeenLastCalledWith({});
  });
});
