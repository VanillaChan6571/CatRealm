import axios from 'axios';
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../stores/authStore', async () => {
  const { create } = await import('zustand');
  return { useAuthStore: create(() => ({ user: { id: 'alice', accountType: 'central' }, token: 'alice-token' })) };
});
vi.mock('../../utils/token', () => ({ decodeToken: () => ({ exp: Date.now() / 1000 + 60 }), saveSession: vi.fn() }));
import { useAuthStore } from '../../stores/authStore';
import { createAuthenticatedApi } from '../authApi';

beforeEach(() => {
  vi.restoreAllMocks();
  useAuthStore.setState({ user: { id: 'alice', accountType: 'central' } as any, token: 'alice-token' });
});

it('does not send a queued private write using the next account credentials', async () => {
  const api = createAuthenticatedApi();
  const adapter = vi.fn(); api.defaults.adapter = adapter;
  useAuthStore.setState({ user: { id: 'bob', accountType: 'central' } as any, token: 'bob-token' });
  await expect(api.put('/api/profile/notes/carol', { note: 'Alice private note' })).rejects.toMatchObject({ code: 'ERR_CANCELED' });
  expect(adapter).not.toHaveBeenCalled();
});

it('drops a refresh and pending private write if the account changes while refreshing', async () => {
  let finish!: (value: any) => void;
  const refresh = vi.spyOn(axios, 'post').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const api = createAuthenticatedApi();
  const adapter = vi.fn(); api.defaults.adapter = adapter;
  const request = api.put('/api/profile/notes/carol', { note: 'Alice private note' });
  const result = expect(request).rejects.toMatchObject({ code: 'ERR_CANCELED' });
  await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
  useAuthStore.setState({ user: { id: 'bob', accountType: 'central' } as any, token: 'bob-token' });
  finish({ data: { token: 'alice-refreshed-token' } });
  await result;
  expect(adapter).not.toHaveBeenCalled();
  expect(useAuthStore.getState().token).toBe('bob-token');
});
