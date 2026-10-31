import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ verify: vi.fn(), sync: vi.fn() }));

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: (state: { user: { id: string } }) => unknown) => selector({ user: { id: 'alice' } }),
}));
vi.mock('../../../lib/verifyDeviceForKeySharing', () => ({ verifyCurrentDeviceForKeySharing: mock.verify }));
vi.mock('../../../messaging/crypto/dmKeyStore', async () => {
  const { create } = await import('zustand');
  return {
    useDMKeyHealthStore: create(() => ({ accountId: 'alice', reverifyForPasskeyApprovedDeviceId: null })),
    syncKnownConversationKeys: mock.sync,
  };
});

import { useDMKeyHealthStore } from '../../../messaging/crypto/dmKeyStore';
import { DMKeyReverificationBanner } from '../DMKeyReverificationBanner';

beforeEach(() => {
  vi.clearAllMocks();
  mock.verify.mockResolvedValue({ id: 'source-device' });
  mock.sync.mockResolvedValue(undefined);
  useDMKeyHealthStore.setState({ accountId: 'alice', reverifyForPasskeyApprovedDeviceId: null });
});

afterEach(cleanup);

describe('DM key reverification banner', () => {
  it('appears for the old session and verifies before retrying key sync', async () => {
    render(<DMKeyReverificationBanner />);
    expect(screen.queryByRole('button', { name: 'Verify' })).toBeNull();

    act(() => useDMKeyHealthStore.setState({ reverifyForPasskeyApprovedDeviceId: 'new-device' }));
    expect(screen.getByText(/trusted it with a passkey/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => {
      expect(mock.verify).toHaveBeenCalledTimes(1);
      expect(mock.sync).toHaveBeenCalledTimes(1);
    });

    act(() => useDMKeyHealthStore.setState({ reverifyForPasskeyApprovedDeviceId: null }));
    expect(screen.queryByRole('button', { name: 'Verify' })).toBeNull();
  });
});
