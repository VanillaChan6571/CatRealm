import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  get: vi.fn(),
  decode: vi.fn(),
  getLocal: vi.fn(),
  fetchManifest: vi.fn(),
  deleteLocal: vi.fn(),
}));

vi.mock('../../../lib/authApi', () => ({ authApi: { get: mock.get } }));
vi.mock('../../../stores/authStore', () => ({ useAuthStore: { getState: () => ({ user: { id: 'alice' } }) } }));
vi.mock('../../persistence/dmStorage', () => ({
  getMessagesByConversation: mock.getLocal,
  saveMessage: vi.fn(),
  deleteMessage: mock.deleteLocal,
}));
vi.mock('../../crypto/dmKeyStore', () => ({
  fetchDMKeyManifest: mock.fetchManifest,
  getLocalConversationSecret: vi.fn(),
  syncTrustedDeviceKeysForConversation: vi.fn(),
}));
vi.mock('../../normalizers/dmNormalizers', () => ({
  decodeDmMessageText: mock.decode,
  normalizeDmMessageType: () => 'user',
  normalizeDmSystemType: () => null,
  normalizeDmSystemData: () => null,
  normalizeDmServerAttachments: () => null,
  normalizeDmNsfwTags: () => [],
  normalizeDmReactions: () => [],
}));
vi.mock('../../dm/dmHelpers', () => ({
  getAuthHeader: () => ({}),
  getSyncKey: () => 'sync-key',
  localReadFloorByConversation: new Map(),
}));
vi.mock('../../notifications/notificationStore', () => ({
  useNotificationStore: { getState: () => ({ hydrateDmPreviews: vi.fn() }) },
}));

import { createDMMessageSlice, resetMessageModuleState } from '../dmMessageSlice';

function encryptedMessage(index: number) {
  return {
    id: `message-${index}`,
    sender_id: 'bob',
    recipient_id: 'alice',
    encrypted_payload: JSON.stringify({ v: 2, kid: 1 }),
    created_at: index,
  };
}

function createStore() {
  let state: any;
  const get = () => state;
  const set = (update: any) => {
    state = { ...state, ...(typeof update === 'function' ? update(state) : update) };
  };
  state = {
    ...createDMMessageSlice(set, get),
    conversations: [{ id: 'conversation', otherUserId: 'bob' }],
  };
  return get;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetMessageModuleState();
  mock.getLocal.mockResolvedValue([]);
  mock.fetchManifest.mockResolvedValue({ activeKeyVersion: null });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('locked DM history', () => {
  it('reports missing messages and only requests a missing key once per page', async () => {
    const messages = Array.from({ length: 50 }, (_, index) => encryptedMessage(index + 100));
    mock.get.mockResolvedValue({ data: { conversationId: 'conversation', messages } });
    mock.decode.mockRejectedValue(new Error('No v2 DM key available for this device'));
    const get = createStore();

    await get().loadMessages('conversation');

    expect(mock.decode).toHaveBeenCalledTimes(1);
    expect(get().unavailableMessagesByConversation.conversation).toBe(50);
    expect(get().oldestFetchedAtByConversation.conversation).toBe(100_000);
    expect(get().hasOlderByConversation.conversation).toBe(true);
  });

  it('does not delete a locally cached message just because this device cannot decrypt the server copy', async () => {
    const message = encryptedMessage(100);
    mock.getLocal.mockResolvedValue([{ id: message.id, conversationId: 'conversation', createdAt: 100_000 }]);
    mock.get.mockResolvedValue({ data: { conversationId: 'conversation', messages: [message] } });
    mock.decode.mockRejectedValue(new Error('No v2 DM key available for this device'));
    const get = createStore();

    await get().loadMessages('conversation');

    expect(get().unavailableMessagesByConversation.conversation).toBe(1);
    expect(mock.deleteLocal).not.toHaveBeenCalled();
  });

  it('moves the history cursor past locked messages and restores the timeline after key sync', async () => {
    const latest = Array.from({ length: 50 }, (_, index) => encryptedMessage(index + 100));
    const older = [encryptedMessage(98), encryptedMessage(99)];
    mock.get
      .mockResolvedValueOnce({ data: { conversationId: 'conversation', messages: latest } })
      .mockResolvedValueOnce({ data: { conversationId: 'conversation', messages: older } })
      .mockResolvedValueOnce({ data: { conversationId: 'conversation', messages: latest } });
    mock.decode.mockRejectedValue(new Error('No v2 DM key available for this device'));
    const get = createStore();

    await get().loadMessages('conversation');
    await get().loadOlderMessages('conversation');

    expect(mock.get).toHaveBeenNthCalledWith(2, '/api/dms/bob/messages', expect.objectContaining({
      params: { limit: 50, before: 100_000 },
    }));
    expect(get().unavailableMessagesByConversation.conversation).toBe(52);
    expect(get().oldestFetchedAtByConversation.conversation).toBe(98_000);

    mock.decode.mockResolvedValue('restored message');
    await get().loadMessages('conversation');

    expect(get().messagesByConversation.conversation).toHaveLength(50);
    expect(get().unavailableMessagesByConversation.conversation).toBe(0);
  });
});
