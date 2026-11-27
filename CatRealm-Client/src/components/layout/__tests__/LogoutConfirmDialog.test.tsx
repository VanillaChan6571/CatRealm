import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  post: vi.fn(),
  forgetDMVault: vi.fn(),
  logout: vi.fn(),
  closeModal: vi.fn(),
  auth: {
    user: { id: 'alice', username: 'Alice', accountType: 'central' },
    token: 'alice-session',
    logout: vi.fn(),
    switchCentralAccount: vi.fn(),
  },
}));
vi.mock('../../../lib/authApi', () => ({ AUTH_BASE: 'https://auth.example', createAuthenticatedApi: () => ({ post: mock.post }) }));
vi.mock('../../../lib/dmKeyVault', () => ({ forgetDMVault: mock.forgetDMVault }));
vi.mock('../../../lib/deviceIdentity', () => ({ getLocalDeviceId: () => 'alice-device' }));
vi.mock('../../../lib/knownAccounts', () => ({ loadKnownAccounts: () => [], forgetKnownAccount: vi.fn() }));
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: Object.assign((selector: (state: typeof mock.auth) => unknown) => selector(mock.auth), { getState: () => mock.auth }),
}));
vi.mock('../../../stores/uiStore', () => ({
  useUIStore: (selector: (state: { activeModal: string; modalData: null; closeModal: typeof mock.closeModal }) => unknown) =>
    selector({ activeModal: 'confirmLogout', modalData: null, closeModal: mock.closeModal }),
}));
vi.mock('../../auth/CentralLoginForm', () => ({ CentralLoginForm: () => null }));
vi.mock('../../ui/Modal', () => ({
  Modal: ({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) =>
    <div><h2>{title}</h2><button onClick={onClose}>Close modal</button>{children}</div>,
}));

import { LogoutConfirmDialog } from '../LogoutConfirmDialog';

beforeEach(() => {
  vi.clearAllMocks();
  mock.auth.user = { id: 'alice', username: 'Alice', accountType: 'central' };
  mock.auth.token = 'alice-session';
  mock.auth.logout = mock.logout;
  mock.post.mockResolvedValue({ data: { success: true } });
  mock.forgetDMVault.mockResolvedValue(undefined);
});
afterEach(cleanup);

it('keeps ordinary logout available without a 2FA code', () => {
  render(<LogoutConfirmDialog />);
  fireEvent.click(screen.getByRole('button', { name: 'Log Out' }));
  expect(mock.logout).toHaveBeenCalledOnce();
  expect(mock.post).not.toHaveBeenCalled();
  expect(mock.forgetDMVault).not.toHaveBeenCalled();
});

it('requires a fresh valid authenticator code before forgetting the local vault', async () => {
  render(<LogoutConfirmDialog />);
  fireEvent.click(screen.getByRole('button', { name: /Log out and forget encrypted DM keys/ }));
  const confirm = screen.getByRole('button', { name: 'Verify and forget keys' });
  expect(confirm.hasAttribute('disabled')).toBe(true);
  fireEvent.change(screen.getByLabelText('Current authenticator code'), { target: { value: '123456' } });
  mock.post.mockRejectedValueOnce({ response: { data: { error: 'Invalid 2FA code' } } });
  fireEvent.click(confirm);
  await screen.findByRole('alert');
  expect(mock.forgetDMVault).not.toHaveBeenCalled();
  expect(mock.logout).not.toHaveBeenCalled();

  fireEvent.click(confirm);
  await waitFor(() => expect(mock.forgetDMVault).toHaveBeenCalledWith('alice', 'alice-device'));
  expect(mock.post).toHaveBeenCalledWith('/api/security/step-up', { totpCode: '123456' });
  expect(mock.logout).toHaveBeenCalledOnce();
});

it('does not forget keys if the dialog closes before 2FA verification finishes', async () => {
  let release!: (value: { data: { success: boolean } }) => void;
  mock.post.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  render(<LogoutConfirmDialog />);
  fireEvent.click(screen.getByRole('button', { name: /Log out and forget encrypted DM keys/ }));
  fireEvent.change(screen.getByLabelText('Current authenticator code'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Verify and forget keys' }));
  await waitFor(() => expect(release).toBeTypeOf('function'));
  fireEvent.click(screen.getByRole('button', { name: 'Close modal' }));
  release({ data: { success: true } });
  await waitFor(() => expect(mock.closeModal).toHaveBeenCalledOnce());
  expect(mock.forgetDMVault).not.toHaveBeenCalled();
  expect(mock.logout).not.toHaveBeenCalled();
});
