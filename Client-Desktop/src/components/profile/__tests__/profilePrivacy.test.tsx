import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  central: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
  realm: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock('../../../lib/authApi', () => ({ createAuthenticatedApi: () => mocks.central }));
vi.mock('../../../lib/api', () => ({ createApi: () => mocks.realm }));
vi.mock('../../../stores/authStore', async () => {
  const { create } = await import('zustand');
  return { useAuthStore: create(() => ({ user: { id: 'alice', accountType: 'central' }, serverUrl: null })) };
});
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../../stores/contentSocialStore', () => ({ useContentSocialStore: (selector: any) => selector({ customAllowedDomains: [] }) }));
vi.mock('../../../stores/uiStore', () => ({ useUIStore: (selector: any) => selector({ openModal: vi.fn() }) }));
vi.mock('../../../utils/externalLinks', () => ({ isAllowedExternalUrl: () => true, openProtectedExternalUrl: vi.fn() }));

import { useAuthStore } from '../../../stores/authStore';
import { nicknameScope, useNicknamesStore } from '../../../stores/nicknamesStore';
import { ProfileNotes } from '../ProfileNotes';
import { ProfileNickname } from '../ProfileNickname';
import { ProfileBioEditor } from '../ProfileBioEditor';

beforeEach(() => {
  vi.resetAllMocks();
  useAuthStore.setState({ user: { id: 'alice', accountType: 'central' } as any, serverUrl: null });
  useNicknamesStore.getState().reset();
  mocks.central.get.mockResolvedValue({ data: { note: null } });
  mocks.central.put.mockResolvedValue({ data: {} });
  mocks.central.delete.mockResolvedValue({ data: {} });
  localStorage.clear();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('private profile notes', () => {
  it('ignores the shared legacy cache and clears a null note across account changes', async () => {
    localStorage.setItem('catrealm-notes', JSON.stringify({ state: { notes: { bob: 'Legacy private note' } } }));
    mocks.central.get.mockResolvedValueOnce({ data: { note: 'Alice private note' } });
    render(<ProfileNotes userId="bob" isOwnProfile={false} />);
    await screen.findByDisplayValue('Alice private note');
    await act(async () => useAuthStore.setState({ user: { id: 'carol', accountType: 'central' } as any }));
    await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(false));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
    expect(screen.queryByDisplayValue('Legacy private note')).toBeNull();
  });

  it('ignores a late response from the previous profile', async () => {
    let resolve!: (value: any) => void;
    mocks.central.get.mockReturnValueOnce(new Promise(r => { resolve = r; }));
    const view = render(<ProfileNotes userId="bob" isOwnProfile={false} />);
    view.rerender(<ProfileNotes userId="carol" isOwnProfile={false} />);
    await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(false));
    await act(async () => resolve({ data: { note: 'Wrong person' } }));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
  });

  it('cancels debounced saves after closing and never writes them under the next account', async () => {
    const view = render(<ProfileNotes userId="bob" isOwnProfile={false} />);
    await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(false));
    vi.useFakeTimers();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Unfinished draft' } });
    view.unmount();
    useAuthStore.setState({ user: { id: 'carol', accountType: 'central' } as any });
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(mocks.central.put).not.toHaveBeenCalled();
  });
});

describe('private nicknames', () => {
  it('restores and saves central nicknames using central API and isolates account/realm caches', async () => {
    mocks.central.get.mockResolvedValue({ data: [{ target_user_id: 'bob', nickname: 'Bobby' }] });
    render(<ProfileNickname userId="bob" isOwnProfile={false} inCentralContext />);
    await screen.findByDisplayValue('Bobby');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Cat' } });
    fireEvent.click(screen.getByText('common.save'));
    await waitFor(() => expect(useNicknamesStore.getState().byScope[nicknameScope(true)]?.bob).toBe('Cat'));
    expect(mocks.central.put).toHaveBeenCalledWith('/api/profile/nicknames/bob', { nickname: 'Cat' });
    expect(mocks.realm.put).not.toHaveBeenCalled();
    act(() => useAuthStore.setState({ serverUrl: 'https://realm.invalid' }));
    expect(useNicknamesStore.getState().byScope[nicknameScope()]?.bob).toBeUndefined();
    mocks.central.get.mockResolvedValue({ data: [] });
    await act(async () => useAuthStore.setState({ user: { id: 'carol', accountType: 'central' } as any }));
    expect(useNicknamesStore.getState().byScope[nicknameScope(true)]?.bob).toBeUndefined();
  });

  it('uses the realm API in realm profiles and shows failed saves without updating the nickname', async () => {
    mocks.realm.get.mockResolvedValue({ data: [] });
    mocks.realm.put.mockRejectedValue(new Error('offline'));
    render(<ProfileNickname userId="local-bob" isOwnProfile={false} inCentralContext={false} />);
    await waitFor(() => expect((screen.getByRole('textbox') as HTMLInputElement).disabled).toBe(false));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Cat' } });
    fireEvent.click(screen.getByText('common.save'));
    expect((await screen.findByRole('alert')).textContent).toContain('not saved');
    expect(mocks.realm.put).toHaveBeenCalledWith('/api/profile/nicknames/local-bob', { nickname: 'Cat' });
    expect(useNicknamesStore.getState().byScope[nicknameScope()]?.['local-bob']).toBeUndefined();
  });
});

it('bio blur/Cancel makes no request, reopening resets draft, and explicit Save persists', async () => {
  const update = vi.fn();
  render(<ProfileBioEditor bio="Original" isOwnProfile inCentralContext onUpdate={update} />);
  fireEvent.click(screen.getByText('Original'));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Cancelled draft' } });
  fireEvent.blur(screen.getByRole('textbox'));
  fireEvent.click(screen.getByText('common.cancel'));
  expect(mocks.central.put).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Original'));
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Original');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Saved bio' } });
  fireEvent.click(screen.getByText('common.save'));
  await waitFor(() => expect(update).toHaveBeenCalledWith('Saved bio'));
});
