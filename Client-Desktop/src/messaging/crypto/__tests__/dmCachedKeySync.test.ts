import { beforeEach, describe, expect, it, vi } from 'vitest';
import { x25519 } from '@noble/curves/ed25519.js';

const mock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  getAllConversations: vi.fn(),
}));

vi.mock('../../../lib/authApi', () => ({ createAuthenticatedApi: () => ({ get: mock.get, post: mock.post }) }));
vi.mock('../../../lib/deviceIdentity', () => ({
  getLocalDeviceId: () => 'device-1',
  getLocalDmPrivateKey: vi.fn(),
}));
vi.mock('../../persistence/dmStorage', () => ({ getAllConversations: mock.getAllConversations }));

import { canRequestPeerKeyRecovery, loadConversationSecretForCurrentDevice, needsProofToShareDMKey, reconcileConversationKeys, syncTrustedDeviceKeysForConversation, useDMKeyHealthStore, type DMKeyManifest } from '../dmKeyStore';

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mock.getAllConversations.mockResolvedValue([{ id: 'conversation' }]);
  mock.get.mockResolvedValue({ data: {
    conversationId: 'conversation',
    activeKeyVersion: 1,
    devices: [{ id: 'device-1', userId: 'alice', dmTrustState: 'trusted', dmPublicKey: 'key', hasWrappedKeyVersions: [1] }],
  } });
  useDMKeyHealthStore.getState().setAccountId('alice');
  useDMKeyHealthStore.setState({
    recentPasskeyApprovedDeviceId: null,
    reverifyForPasskeyApprovedDeviceId: null,
    proofRequired: false,
  });
});

describe('cached DM key reads', () => {
  it('does not fetch a manifest for every decrypted message, while reconciliation still checks peers', async () => {
    localStorage.setItem('catrealm.dm-conversation-secret.conversation.1', 'cached-secret');

    for (let index = 0; index < 50; index++) {
      await expect(loadConversationSecretForCurrentDevice('conversation', 1)).resolves.toBe('cached-secret');
    }
    expect(mock.get).not.toHaveBeenCalled();

    await reconcileConversationKeys();
    expect(mock.get).toHaveBeenCalledTimes(2);
    expect(mock.post).not.toHaveBeenCalled();
  });
});

describe('DM key sharing proof', () => {
  it('requires explicit peer recovery even if a stale device record still holds that person’s key', async () => {
    const manifest = {
      conversationId: 'conversation', activeKeyVersion: 1,
      devices: [
        { id: 'device-1', userId: 'alice', dmTrustState: 'trusted', dmPublicKey: 'source-key', hasWrappedKeyVersions: [1] },
        { id: 'bob-old', userId: 'bob', dmTrustState: 'trusted', dmPublicKey: 'old-key', hasWrappedKeyVersions: [1] },
        { id: 'bob-new', userId: 'bob', dmTrustState: 'trusted', dmPublicKey: 'new-key', hasWrappedKeyVersions: [] },
      ],
    } as DMKeyManifest;
    mock.get.mockResolvedValue({ data: manifest });
    await syncTrustedDeviceKeysForConversation('conversation', 1, 'cached-secret');
    expect(mock.post).not.toHaveBeenCalled();
    expect(canRequestPeerKeyRecovery(manifest, 'bob', 'bob-new')).toBe(true);
    expect(canRequestPeerKeyRecovery(manifest, 'bob', 'bob-old')).toBe(false);
  });

  it('requires fresh proof only when a trusted device is waiting for this key', () => {
    const manifest: DMKeyManifest = {
      conversationId: 'conversation',
      activeKeyVersion: 1,
      upgradedAt: 1,
      messageCount: 1,
      devices: [
        { id: 'device-1', userId: 'alice', deviceName: 'desktop', platform: 'desktop', dmPublicKey: 'key-1', notificationPublicKey: null, pushCapable: false, dmTrustState: 'trusted', keyShareBlocked: true, hasWrappedKeyVersions: [1] },
        { id: 'device-2', userId: 'alice', deviceName: 'browser', platform: 'web', dmPublicKey: 'key-2', notificationPublicKey: null, pushCapable: false, dmTrustState: 'trusted', hasWrappedKeyVersions: [] },
      ],
    };

    expect(needsProofToShareDMKey(manifest, 'device-1')).toBe(true);
    expect(needsProofToShareDMKey(manifest, 'device-2')).toBe(false);
    manifest.devices[1].dmTrustState = 'untrusted';
    expect(needsProofToShareDMKey(manifest, 'device-1')).toBe(false);
    manifest.devices[1].dmTrustState = 'trusted';
    manifest.devices[1].hasWrappedKeyVersions = [1];
    expect(needsProofToShareDMKey(manifest, 'device-1')).toBe(false);
  });

  it('prompts the existing key holder after passkey self-approval only when key upload needs fresh proof', async () => {
    const recipientPublicKey = x25519.getPublicKey(x25519.utils.randomSecretKey());
    const recipientPublicKeyBase64 = btoa(String.fromCharCode(...recipientPublicKey));
    const secret = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
    mock.get.mockResolvedValue({ data: {
      conversationId: 'conversation',
      activeKeyVersion: 1,
      devices: [
        { id: 'device-1', userId: 'alice', dmTrustState: 'trusted', dmPublicKey: 'source-key', hasWrappedKeyVersions: [1] },
        { id: 'device-2', userId: 'alice', dmTrustState: 'trusted', dmPublicKey: recipientPublicKeyBase64, trustedAt: Math.floor(Date.now() / 1000), trustedByDeviceId: 'device-2', hasWrappedKeyVersions: [] },
      ],
    } });
    mock.post.mockRejectedValueOnce({ response: { data: { proofRequired: true } } });

    await expect(syncTrustedDeviceKeysForConversation('conversation', 1, secret)).rejects.toBeDefined();
    expect(useDMKeyHealthStore.getState().reverifyForPasskeyApprovedDeviceId).toBe('device-2');

    mock.post.mockResolvedValueOnce({ data: { success: true } });
    await syncTrustedDeviceKeysForConversation('conversation', 1, secret);
    expect(useDMKeyHealthStore.getState().reverifyForPasskeyApprovedDeviceId).toBeNull();
  });
});
