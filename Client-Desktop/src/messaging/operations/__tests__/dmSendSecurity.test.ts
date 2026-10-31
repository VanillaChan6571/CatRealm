import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  post: vi.fn(), patch: vi.fn(), key: vi.fn(), manifest: vi.fn(), legacy: vi.fn(), v2: vi.fn(),
}));
vi.mock('../../../lib/authApi', () => ({ authApi: { post: h.post, patch: h.patch } }));
vi.mock('../../../stores/authStore', () => ({ useAuthStore: { getState: () => ({ user: { id: 'alice', username: 'alice' } }) } }));
vi.mock('../../persistence/dmStorage', () => ({ saveMessage: vi.fn(), saveConversation: vi.fn() }));
vi.mock('../../crypto/dmKeyStore', () => ({ getConversationSecretForSend: h.key, fetchDMKeyManifest: h.manifest }));
vi.mock('../../crypto/dmCrypto', () => ({ encryptDM: h.legacy, encryptDMV2: h.v2 }));
vi.mock('../../crypto/notificationPreviewCrypto', () => ({ encryptNotificationPreviewForDevice: vi.fn() }));
vi.mock('../../dm/dmHelpers', () => ({ getSyncKey: () => 'fixture-sync-key', getAuthHeader: () => ({}) }));
import { createDMOperationsSlice } from '../dmOperationsSlice';

beforeEach(() => {
  vi.clearAllMocks(); h.key.mockResolvedValue(null);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
describe('DM encryption send boundary', () => {
  const state = () => ({ conversations: [{ id: 'conversation', otherUserId: 'bob' }],
    messagesByConversation: { conversation: [{ id: 'message', conversationId: 'conversation' }] } });
  it('waits for secure setup without encrypting or uploading a new message/attachment', async () => {
    const set = vi.fn(); const operations = createDMOperationsSlice(set, state);
    await expect(operations.sendMessage('bob', 'private', new File(['private'], 'file.txt'))).rejects.toThrow('approved device');
    expect(h.legacy).not.toHaveBeenCalled(); expect(h.v2).not.toHaveBeenCalled();
    expect(h.post).not.toHaveBeenCalled(); expect(h.manifest).not.toHaveBeenCalled();
    expect(set).toHaveBeenLastCalledWith(expect.objectContaining({ loading: false }));
  });
  it('never falls back to legacy encryption when editing existing messages', async () => {
    const operations = createDMOperationsSlice(vi.fn(), state);
    await expect(operations.editMessage('message', 'private edit')).rejects.toThrow('approved device');
    expect(h.legacy).not.toHaveBeenCalled(); expect(h.patch).not.toHaveBeenCalled();
  });
});
