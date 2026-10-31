import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ get: vi.fn(), openModal: vi.fn(), user: { id: 'alice', accountType: 'central' } }));
vi.mock('../../../lib/authApi', () => ({ createAuthenticatedApi: () => ({ get: mock.get }) }));
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: Object.assign((selector: (state: { user: typeof mock.user }) => unknown) => selector({ user: mock.user }),
    { getState: () => ({ user: mock.user }) }),
}));
vi.mock('../../../stores/uiStore', () => ({ useUIStore: (selector: (state: { openModal: typeof mock.openModal }) => unknown) => selector({ openModal: mock.openModal }) }));

import { PasskeyRecommendationBanner } from '../PasskeyRecommendationBanner';

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

it('recommends a passkey only when Central confirms the account has none', async () => {
  mock.get.mockResolvedValueOnce({ data: { credentials: [] } });
  render(<PasskeyRecommendationBanner />);
  const addButton = await screen.findByRole('button', { name: 'Add passkey' });
  fireEvent.click(addButton);
  expect(mock.openModal).toHaveBeenCalledWith('profileSettings', { initialTab: 'account-security' });

  mock.get.mockResolvedValueOnce({ data: { credentials: [{ id: 'key-1' }] } });
  fireEvent(window, new Event('catrealm:passkeys-changed'));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Add passkey' })).toBeNull());
});

it('does not warn when credential status cannot be checked', async () => {
  mock.get.mockRejectedValueOnce(new Error('offline'));
  render(<PasskeyRecommendationBanner />);
  await waitFor(() => expect(mock.get).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('button', { name: 'Add passkey' })).toBeNull();
});
