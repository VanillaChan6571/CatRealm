import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), logout: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../../../lib/authApi', () => ({ AUTH_BASE: 'https://auth.example', createAuthenticatedApi: () => ({ get: mock.get, post: mock.post }) }));
vi.mock('../../../../lib/deviceIdentity', () => ({ getLocalDeviceId: () => 'current-device', clearLocalDeviceIdentity: vi.fn() }));
vi.mock('../../../../stores/authStore', () => ({
  useAuthStore: Object.assign((selector: (state: { logout: typeof mock.logout; user: { id: string } }) => unknown) =>
    selector({ logout: mock.logout, user: { id: 'alice' } }), { getState: () => ({ user: { id: 'alice' } }) }),
}));
vi.mock('../../../../stores/settingsStore', () => ({
  useSettingsStore: (selector: (state: { autoTryHttpRealmGateway: boolean; setAutoTryHttpRealmGateway: () => void }) => unknown) =>
    selector({ autoTryHttpRealmGateway: false, setAutoTryHttpRealmGateway: vi.fn() }),
}));
vi.mock('../../../../lib/httpRealmGateway', () => ({ httpRealmGatewayEnabled: () => false }));
vi.mock('../../../../lib/dmKeyVault', () => ({ forgetDMVault: vi.fn(), auditCurrentDMVault: vi.fn() }));
vi.mock('../../../ui/ConfirmDialog', () => ({ ConfirmDialog: () => null }));

import { AccountSecuritySection } from '../AccountSecuritySection';

const device = (id: string, deviceName: string, revokedAt: number | null = null) => ({
  id, deviceName, platform: 'desktop', browserName: null,
  dmTrustState: revokedAt ? 'revoked' : 'trusted', deviceSecurity: 'software_protected',
  boundWebAuthnCredentialId: null, lastProofAt: null, proofRequiredOnLaunch: false,
  trustedAt: 1, trustedByDeviceId: null, pushCapable: false,
  firstSeenAt: 1, lastSeenAt: 1, revokedAt,
});

beforeEach(() => {
  vi.clearAllMocks();
  mock.get.mockImplementation((path: string) => {
    if (path === '/api/devices') return Promise.resolve({ data: { devices: [
      device('old-device', 'Old laptop'), device('current-device', 'Current laptop'),
      ...Array.from({ length: 12 }, (_, index) => device(`other-${index}`, `Other ${index}`)),
    ] } });
    if (path === '/api/security/webauthn/credentials') return Promise.resolve({ data: { credentials: [] } });
    if (path === '/api/security/backup-codes/status') return Promise.resolve({ data: { generated: false } });
    return Promise.reject(new Error(`Unexpected GET ${path}`));
  });
  mock.post.mockResolvedValue({ data: { success: true } });
});
afterEach(cleanup);

it('opens removal beside the selected device and hides it after successful revocation', async () => {
  render(<AccountSecuritySection />);
  const oldName = await screen.findByText('Old laptop');
  const oldCard = oldName.closest('.rounded') as HTMLElement;
  expect(oldCard).toBeTruthy();
  fireEvent.click(within(oldCard).getByRole('button', { name: 'security.removeDevice' }));
  expect(within(oldCard).getByText('security.removeTotpPrompt')).toBeTruthy();
  expect(screen.getAllByText('security.removeTotpPrompt')).toHaveLength(1);

  const code = within(oldCard).getByPlaceholderText('000000');
  fireEvent.change(code, { target: { value: '123456' } });
  fireEvent.click(within(oldCard).getByRole('button', { name: 'security.confirm' }));
  await waitFor(() => expect(mock.post).toHaveBeenCalledWith('/api/devices/old-device/revoke', {
    totpCode: '123456', actorDeviceId: 'current-device',
  }));
  await waitFor(() => expect(screen.queryByText('Old laptop')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'security.showRemovedDevices' }));
  expect(screen.getByText('Old laptop')).toBeTruthy();
});
