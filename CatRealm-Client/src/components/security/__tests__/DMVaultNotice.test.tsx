import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  status: { reason: 'Old plaintext DM key copies have unknown ownership.', issue: 'legacy' },
  diagnostics: { entries: 2, plausibleKeys: 1, accountMarker: 'different', deviceMarker: 'missing', sessionMarker: 'matches' },
}));
vi.mock('../../../lib/dmKeyVault', () => ({
  useDMVaultStatus: (select: (state: typeof h.status) => unknown) => select(h.status),
  getLegacyDMKeyDiagnostics: () => h.diagnostics,
}));
vi.mock('../../ui/Modal', () => ({ Modal: ({ open, title, children }: { open: boolean; title: string; children: ReactNode }) => open ? <div role="dialog" aria-label={title}>{children}</div> : null }));
import { DMVaultNotice } from '../DMVaultNotice';

afterEach(cleanup);

it('explains the unresolved old copies without routing to device trust settings', () => {
  render(<DMVaultNotice />);
  fireEvent.click(screen.getByRole('button', { name: 'Review old keys' }));
  expect(screen.getByRole('dialog', { name: 'Old DM key copies' })).toBeTruthy();
  expect(screen.getByText(/Old-key storage entries on this installation: 2/)).toBeTruthy();
  expect(screen.getByText(/Account marker: different. Device marker: missing. Saved session: matches/)).toBeTruthy();
  expect(screen.getByText(/Account & Security does not resolve ownership/)).toBeTruthy();
  expect(screen.getByText(/does not automatically move or delete these old copies/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Open Account & Security' })).toBeNull();
});
