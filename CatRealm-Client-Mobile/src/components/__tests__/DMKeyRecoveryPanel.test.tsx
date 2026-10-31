import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockManifest = jest.fn();
const mockLocalSecret = jest.fn();
const mockSurvivorProof = jest.fn();
const mockShareDMKey = jest.fn();
const mockApproveSurvivingDevice = jest.fn();
jest.mock('@/components', () => {
  const { Text, Pressable } = require('react-native');
  return { Text, Pressable };
});
jest.mock('@/theme', () => ({ useTheme: () => ({ colors: {
  danger: '#ff0000', bgElev1: '#111111', bgElev3: '#333333', text: '#ffffff', text2: '#cccccc', text3: '#999999', textOnAccent: '#ffffff', lineSoft: '#555555',
} }) }));
jest.mock('@/lib/api', () => ({ AUTH_BASE: 'https://auth.invalid', createAuthenticatedApi: () => ({ get: mockGet, post: mockPost }) }));
jest.mock('@/lib/deviceIdentity', () => ({ getLocalDeviceId: async () => 'alice-device' }));
jest.mock('@/lib/socket', () => ({ getSocket: () => null }));
jest.mock('@/lib/verifyDeviceForKeySharing', () => ({ verifyCurrentDeviceForKeySharing: jest.fn() }));
jest.mock('@/lib/approveSurvivingDevice', () => ({ approveSurvivingDevice: (...args: unknown[]) => mockApproveSurvivingDevice(...args) }));
jest.mock('@/stores/authStore', () => {
  const state = { user: { id: 'alice' } };
  return { useAuthStore: Object.assign((selector: (value: typeof state) => unknown) => selector(state), { getState: () => state }) };
});
jest.mock('@/lib/dmKeyStore', () => ({
  fetchDMKeyManifest: (...args: unknown[]) => mockManifest(...args),
  getLocalConversationSecret: (...args: unknown[]) => mockLocalSecret(...args),
  canRequestPeerKeyRecovery: () => false,
  createSurvivorTrustProof: (...args: unknown[]) => mockSurvivorProof(...args),
  shareDMKeyForRecovery: (...args: unknown[]) => mockShareDMKey(...args),
  syncTrustedDeviceKeysForConversation: jest.fn().mockResolvedValue(undefined),
}));

import { DMKeyRecoveryPanel } from '../DMKeyRecoveryPanel';

beforeEach(() => { mockLocalSecret.mockResolvedValue(null); });

test('mobile key holder sees the warning and cannot continue before the timer', async () => {
  mockManifest.mockResolvedValue({ activeKeyVersion: 1, devices: [] });
  mockGet.mockResolvedValue({ data: {
    incoming: {
      id: 'request', conversationId: 'dm', keyVersion: 1, requesterUserId: 'bob', requesterDeviceId: 'bob-device',
      approverUserId: 'alice', status: 'reviewing', requestedAt: 1, reviewUntil: Math.floor(Date.now() / 1000) + 20, expiresAt: 9999999999,
    },
    outgoing: null,
  } });
  const onIncomingChange = jest.fn();
  const screen = await render(<DMKeyRecoveryPanel conversationId="dm" otherUsername="Bob" onIncomingChange={onIncomingChange} />);
  await waitFor(() => expect(screen.getByText('Final Notice')).toBeTruthy());
  expect(screen.getByText(/may not be who they say they are/)).toBeTruthy();
  expect(screen.getByRole('button', { name: /Continue in/ }).props.accessibilityState?.disabled).toBe(true);
  expect(onIncomingChange).toHaveBeenCalledWith(true);
});

test('decrypt failure shows a recovery explanation when the device already has a server key copy', async () => {
  mockManifest.mockResolvedValue({
    activeKeyVersion: 1,
    devices: [{ id: 'alice-device', userId: 'alice', dmTrustState: 'trusted', dmPublicKey: 'public-key', hasWrappedKeyVersions: [1] }],
  });
  mockGet.mockResolvedValue({ data: { incoming: null, outgoing: null } });
  const screen = await render(<DMKeyRecoveryPanel conversationId="dm" otherUsername="Bob" onIncomingChange={jest.fn()} decryptFailure={2} />);
  await waitFor(() => expect(screen.getByText('Unable to decrypt this DM')).toBeTruthy());
  expect(screen.getByText(/server has a key copy for this device/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Retry key sync' })).toBeTruthy();
});

test('older decrypt failure stays visible without offering an ineffective peer key request', async () => {
  mockManifest.mockResolvedValue({ activeKeyVersion: null, devices: [] });
  mockGet.mockResolvedValue({ data: { incoming: null, outgoing: null } });
  const screen = await render(<DMKeyRecoveryPanel conversationId="dm" otherUsername="Bob" onIncomingChange={jest.fn()} decryptFailure={1} />);
  await waitFor(() => expect(screen.getByText('Older message cannot be decrypted')).toBeTruthy());
  expect(screen.queryByText('Request decrypt')).toBeNull();
});

test('rate-limited key sync shows a wait instead of a peer recovery request', async () => {
  mockManifest.mockRejectedValue({ response: { status: 429 } });
  mockGet.mockResolvedValue({ data: { incoming: null, outgoing: null } });
  const screen = await render(<DMKeyRecoveryPanel conversationId="dm" otherUsername="Bob" onIncomingChange={jest.fn()} decryptFailure="rate_limited" keySyncRetryAt={Date.now() + 60_000} />);
  await waitFor(() => expect(screen.getByText('Key sync is temporarily busy')).toBeTruthy());
  expect(screen.getByRole('button', { name: /Retry in/ }).props.accessibilityState?.disabled).toBe(true);
  expect(screen.queryByText('Request decrypt')).toBeNull();
});

test('a missing recovery endpoint reports its HTTP status without blaming Central connectivity', async () => {
  mockManifest.mockResolvedValue({ activeKeyVersion: 1, devices: [
    { id: 'alice-device', userId: 'alice', dmTrustState: 'trusted', dmPublicKey: 'public-key', hasWrappedKeyVersions: [] },
    { id: 'bob-device', userId: 'bob', dmTrustState: 'trusted', dmPublicKey: 'public-key', hasWrappedKeyVersions: [1] },
  ] });
  mockGet.mockRejectedValue({ response: { status: 404 } });
  const screen = await render(<DMKeyRecoveryPanel conversationId="dm" otherUsername="Bob" onIncomingChange={jest.fn()} decryptFailure={2} />);
  await waitFor(() => expect(screen.getByText(/Central returned HTTP 404/)).toBeTruthy());
  expect(screen.getByRole('button', { name: 'Retry Central check' })).toBeTruthy();
  expect(screen.queryByText(/Check your connection/)).toBeNull();
});

test('a key holding tablet that lost trust sees device approval even though its messages decrypt', async () => {
  mockManifest.mockResolvedValue({ activeKeyVersion: 1, devices: [
    { id: 'alice-device', userId: 'alice', dmTrustState: 'untrusted', dmPublicKey: 'public-key', hasWrappedKeyVersions: [1] },
  ] });
  mockLocalSecret.mockResolvedValue('local-conversation-key');
  mockGet.mockResolvedValue({ data: { incoming: null, outgoing: null } });
  const openSettings = jest.fn();
  const onNeedsTrust = jest.fn();
  const screen = await render(<DMKeyRecoveryPanel conversationId="dm" otherUsername="Bob" onIncomingChange={jest.fn()} onLocalKeyNeedsTrustChange={onNeedsTrust} onOpenDeviceSettings={openSettings} />);
  await waitFor(() => expect(screen.getByText('This device still has the DM key')).toBeTruthy());
  expect(screen.getByText(/authenticator code/)).toBeTruthy();
  fireEvent.changeText(screen.getByLabelText('2FA code to verify this device'), '123456');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Verify this device with 2FA' }).props.accessibilityState?.disabled).toBe(false));
  fireEvent.press(screen.getByRole('button', { name: 'Verify this device with 2FA' }));
  await waitFor(() => expect(mockApproveSurvivingDevice).toHaveBeenCalledWith('123456'));
  expect(screen.getByRole('button', { name: 'Open device approval' })).toBeTruthy();
  expect(onNeedsTrust).toHaveBeenCalledWith(true);
  expect(mockLocalSecret).toHaveBeenCalledWith('dm', 1);
});

test('a survivor can ask the key holding peer to compare DM key proofs', async () => {
  mockManifest.mockResolvedValue({ activeKeyVersion: 1, devices: [
    { id: 'alice-device', userId: 'alice', dmTrustState: 'untrusted', dmPublicKey: 'public-key', hasWrappedKeyVersions: [] },
    { id: 'bob-device', userId: 'bob', dmTrustState: 'trusted', dmPublicKey: 'public-key', hasWrappedKeyVersions: [1] },
  ] });
  mockLocalSecret.mockResolvedValue('local-conversation-key');
  mockGet.mockResolvedValue({ data: { incoming: null, outgoing: null } });
  const request = { id: 'survivor-request', conversationId: 'dm', keyVersion: 1, requesterUserId: 'alice', requesterDeviceId: 'alice-device', approverUserId: 'bob', mode: 'survivor-trust' };
  mockPost.mockImplementation(async (url: string) => url.endsWith('/key-recovery') ? { data: { request } } : { data: {} });
  mockSurvivorProof.mockResolvedValue('matching-proof');
  const screen = await render(<DMKeyRecoveryPanel conversationId="dm" otherUsername="Bob" onIncomingChange={jest.fn()} />);
  await waitFor(() => expect(screen.getByText('This device still has the DM key')).toBeTruthy());
  fireEvent.changeText(screen.getByLabelText('2FA code to verify this device'), '123456');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Ask Bob to verify this DM key' }).props.accessibilityState?.disabled).toBe(false));
  fireEvent.press(screen.getByRole('button', { name: 'Ask Bob to verify this DM key' }));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/api/dms/conversations/dm/key-recovery/survivor-request/survivor-proof', { proof: 'matching-proof' }));
  expect(mockPost).toHaveBeenCalledWith('/api/dms/conversations/dm/key-recovery', { deviceId: 'alice-device', mode: 'survivor-trust' });
});

test('the peer verifies key equality after the warning without sending a key copy', async () => {
  const request = { id: 'survivor-request', conversationId: 'dm', keyVersion: 1, requesterUserId: 'bob', requesterDeviceId: 'bob-device', approverUserId: 'alice', mode: 'survivor-trust', status: 'reviewing', reviewUntil: Math.floor(Date.now() / 1000) - 1, expiresAt: 9999999999 };
  mockManifest.mockResolvedValue({ activeKeyVersion: 1, devices: [] });
  mockGet.mockResolvedValue({ data: { incoming: request, outgoing: null } });
  mockSurvivorProof.mockResolvedValue('matching-proof');
  mockPost.mockResolvedValue({ data: {} });
  const screen = await render(<DMKeyRecoveryPanel conversationId="dm" otherUsername="Bob" onIncomingChange={jest.fn()} />);
  await waitFor(() => expect(screen.getByText('Final Notice')).toBeTruthy());
  expect(screen.getByText(/restore trust to the other account/)).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/api/dms/conversations/dm/key-recovery/survivor-request/approve', { proof: 'matching-proof' }));
  expect(mockShareDMKey).not.toHaveBeenCalled();
});
