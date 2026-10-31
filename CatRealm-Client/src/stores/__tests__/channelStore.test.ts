import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Channel, Category } from '../../types';

const state = vi.hoisted(() => ({
  serverUrl: 'realm-A',
  pending: [] as Array<{ server: string; path: string; resolve: (value: { data: unknown }) => void }>,
}));
vi.mock('../../lib/api', () => ({
  createApi: () => {
    const server = state.serverUrl;
    return { get: (path: string) => new Promise(resolve => state.pending.push({ server, path, resolve })) };
  },
}));
vi.mock('../../lib/authApi', () => ({ createAuthenticatedApi: vi.fn() }));
vi.mock('../../lib/socket', () => ({ getSocket: () => null }));
vi.mock('../authStore', () => ({ useAuthStore: { getState: () => ({ serverUrl: state.serverUrl }) } }));
vi.mock('../../utils/token', () => ({ saveLastChannelId: vi.fn(), loadLastChannelId: () => null }));
vi.mock('../../lib/viewAsRoleDebug', () => ({ logViewAsRoleDebug: vi.fn() }));

import { useChannelStore } from '../channelStore';

const channels = (id: string) => [{ id, name: id, position: 0 }] as Channel[];
const categories = (id: string) => [{ id, name: id, position: 0 }] as Category[];

describe('realm list requests', () => {
  beforeEach(() => {
    useChannelStore.getState().reset();
    state.serverUrl = 'realm-A';
    state.pending = [];
  });

  it('ignores old realm channels and categories arriving after a switch', async () => {
    const oldChannels = useChannelStore.getState().fetchChannels();
    const oldCategories = useChannelStore.getState().fetchCategories();
    useChannelStore.getState().reset();
    state.serverUrl = 'realm-B';
    const newChannels = useChannelStore.getState().fetchChannels();
    const newCategories = useChannelStore.getState().fetchCategories();
    state.pending[2].resolve({ data: channels('B-channel') });
    state.pending[3].resolve({ data: categories('B-category') });
    await Promise.all([newChannels, newCategories]);
    state.pending[0].resolve({ data: channels('A-channel') });
    state.pending[1].resolve({ data: categories('A-category') });
    await Promise.all([oldChannels, oldCategories]);
    expect(useChannelStore.getState().activeChannelId).toBe('B-channel');
    expect(useChannelStore.getState().categories[0].id).toBe('B-category');
  });

  it('ignores requests predating A -> B -> A navigation', async () => {
    const old = useChannelStore.getState().fetchChannels();
    useChannelStore.getState().reset();
    state.serverUrl = 'realm-B';
    useChannelStore.getState().reset();
    state.serverUrl = 'realm-A';
    useChannelStore.getState().applyChannelList(channels('current-A'));
    state.pending[0].resolve({ data: channels('stale-A') });
    await old;
    expect(useChannelStore.getState().activeChannelId).toBe('current-A');
  });

  it('does not overwrite a restored snapshot', async () => {
    useChannelStore.getState().applyChannelList(channels('snapshot'));
    const snapshot = useChannelStore.getState().getSnapshot();
    const pending = useChannelStore.getState().fetchChannels();
    useChannelStore.getState().loadSnapshot(snapshot);
    state.pending[0].resolve({ data: channels('old') });
    await pending;
    expect(useChannelStore.getState().activeChannelId).toBe('snapshot');
  });

  it('preserves a newer socket list over an in-flight HTTP response', async () => {
    const pending = useChannelStore.getState().fetchCategories();
    useChannelStore.getState().applyCategoryList(categories('socket-category'));
    state.pending[0].resolve({ data: categories('old-category') });
    await pending;
    expect(useChannelStore.getState().categories[0].id).toBe('socket-category');
  });

  it('keeps the most recent request when responses arrive out of order', async () => {
    const old = useChannelStore.getState().fetchChannels();
    const current = useChannelStore.getState().fetchChannels();
    state.pending[1].resolve({ data: channels('current') });
    await current;
    state.pending[0].resolve({ data: channels('old') });
    await old;
    expect(useChannelStore.getState().activeChannelId).toBe('current');
  });
});
