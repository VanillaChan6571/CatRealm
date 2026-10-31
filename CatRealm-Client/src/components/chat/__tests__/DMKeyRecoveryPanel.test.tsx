import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), manifest: vi.fn(), share: vi.fn(), survivorProof: vi.fn(), localSecret: vi.fn(), selfApprove: vi.fn() }));
vi.mock('../../../lib/authApi', () => ({ AUTH_BASE: 'https://auth.invalid', createAuthenticatedApi: () => ({ get: mock.get, post: mock.post }) }));
vi.mock('../../../lib/deviceIdentity', () => ({ getLocalDeviceId: () => 'alice-device' }));
vi.mock('../../../lib/socket', () => ({ getSocket: () => null }));
vi.mock('../../../lib/verifyDeviceForKeySharing', () => ({ verifyCurrentDeviceForKeySharing: vi.fn() }));
vi.mock('../../../lib/approveSurvivingDevice', () => ({ approveSurvivingDevice: mock.selfApprove }));
vi.mock('../../../stores/authStore', () => {
  const state = { user: { id: 'alice' } };
  return { useAuthStore: Object.assign((selector: (value: typeof state) => unknown) => selector(state), { getState: () => state }) };
});
vi.mock('../../../messaging/crypto/dmKeyStore', () => ({
  fetchDMKeyManifest: mock.manifest,
  canRequestPeerKeyRecovery: vi.fn(() => false),
  createSurvivorTrustProof: mock.survivorProof,
  getLocalConversationSecret: mock.localSecret,
  syncKnownConversationKeys: vi.fn(),
  shareDMKeyForRecovery: mock.share,
}));

import { DMKeyRecoveryPanel } from '../DMKeyRecoveryPanel';

beforeEach(() => {
  vi.clearAllMocks();
  mock.manifest.mockResolvedValue({ activeKeyVersion: 1, devices: [] });
  mock.localSecret.mockReturnValue(null);
});
afterEach(cleanup);

it('shows the red recovery warning and keeps Continue disabled during the review delay', async () => {
  const onIncomingChange = vi.fn();
  mock.get.mockResolvedValue({ data: {
    incoming: {
      id: 'request', conversationId: 'dm', keyVersion: 1, requesterUserId: 'bob', requesterDeviceId: 'bob-device',
      approverUserId: 'alice', status: 'reviewing', requestedAt: 1, reviewUntil: Math.floor(Date.now() / 1000) + 20, expiresAt: 9999999999,
    },
    outgoing: null,
  } });
  render(<DMKeyRecoveryPanel conversationId="dm" otherUsername="Bob" onIncomingChange={onIncomingChange} />);
  await waitFor(() => expect(screen.getByText('Final Notice')).toBeTruthy());
  expect(screen.getByText(/may not be who they say they are/)).toBeTruthy();
  expect((screen.getByRole('button', { name: /Continue in/ }) as HTMLButtonElement).disabled).toBe(true);
  await waitFor(() => expect(onIncomingChange).toHaveBeenCalledWith(true));
});

it('shows a request action when this device has no key but the peer does', async () => {
  const { canRequestPeerKeyRecovery } = await import('../../../messaging/crypto/dmKeyStore');
  vi.mocked(canRequestPeerKeyRecovery).mockReturnValueOnce(true);
  mock.get.mockResolvedValue({ data: { incoming: null, outgoing: null } });
  render(<DMKeyRecoveryPanel conversationId="dm" otherUsername="Bob" onIncomingChange={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Request decrypt with 2FA' })).toBeTruthy());
});

it('compares key proofs after the warning without sending a key copy', async () => {
  mock.get.mockResolvedValue({ data: { incoming: {
    id: 'survivor', conversationId: 'dm', keyVersion: 1, requesterUserId: 'bob', requesterDeviceId: 'bob-device',
    approverUserId: 'alice', mode: 'survivor-trust', status: 'reviewing', reviewUntil: Math.floor(Date.now() / 1000) - 1,
    expiresAt: 9999999999,
  }, outgoing: null } });
  mock.survivorProof.mockResolvedValue('matching-proof');
  mock.post.mockResolvedValue({ data: {} });
  render(<DMKeyRecoveryPanel conversationId="dm" otherUsername="Bob" onIncomingChange={vi.fn()} />);
  await waitFor(() => expect(screen.getByText('Final Notice')).toBeTruthy());
  expect(screen.getByText(/restore trust to the other account/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() => expect(mock.post).toHaveBeenCalledWith('/api/dms/conversations/dm/key-recovery/survivor/approve', { proof: 'matching-proof' }));
  expect(mock.share).not.toHaveBeenCalled();
});

it('lets an untrusted device holding the DM key request peer verification', async () => {
  mock.manifest.mockResolvedValue({ activeKeyVersion: 1, devices: [
    { id: 'alice-device', userId: 'alice', dmTrustState: 'untrusted', hasWrappedKeyVersions: [] },
    { id: 'bob-device', userId: 'bob', dmTrustState: 'trusted', hasWrappedKeyVersions: [1] },
  ] });
  mock.localSecret.mockReturnValue('local-secret');
  mock.get.mockResolvedValue({ data: { incoming: null, outgoing: null } });
  const request = { id: 'survivor', conversationId: 'dm', keyVersion: 1, requesterUserId: 'alice', requesterDeviceId: 'alice-device' };
  mock.post.mockImplementation(async (url: string) => url === '/api/dms/conversations/dm/key-recovery'
    ? { data: { request } } : { data: {} });
  mock.survivorProof.mockResolvedValue('key-proof');
  render(<DMKeyRecoveryPanel conversationId="dm" otherUsername="Bob" onIncomingChange={vi.fn()} />);
  await waitFor(() => expect(screen.getByText('This device still has the DM key')).toBeTruthy());
  fireEvent.change(screen.getByRole('textbox', { name: '2FA code to verify this device' }), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ask Bob to verify this DM key' }));
  await waitFor(() => expect(mock.post).toHaveBeenCalledWith('/api/dms/conversations/dm/key-recovery/survivor/survivor-proof', { proof: 'key-proof' }));
  expect(mock.post).toHaveBeenCalledWith('/api/security/step-up', { totpCode: '123456' });
  expect(mock.post).toHaveBeenCalledWith('/api/dms/conversations/dm/key-recovery', { deviceId: 'alice-device', mode: 'survivor-trust' });
  expect(mock.survivorProof).toHaveBeenCalledWith(request);
  expect(mock.share).not.toHaveBeenCalled();
});
