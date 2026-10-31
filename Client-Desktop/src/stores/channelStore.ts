import { create } from 'zustand';
import type { Channel, Category } from '../types';
import { createApi } from '../lib/api';
import { createAuthenticatedApi } from '../lib/authApi';
import { getSocket } from '../lib/socket';
import { useAuthStore } from './authStore';
import { saveLastChannelId, loadLastChannelId } from '../utils/token';
import { logViewAsRoleDebug } from '../lib/viewAsRoleDebug';
import { dismissDesktopNotifications } from '../lib/desktopNotifications';

export const CHANNEL_LIST_CACHE_TTL_MS = 2 * 60 * 1000;

// Invalidate pending requests on navigation, snapshot restoration, or a newer
// socket list. URL comparison alone would miss a quick A -> B -> A switch.
let channelRequestVersion = 0;
let categoryRequestVersion = 0;

interface ChannelState {
  channels: Channel[];
  activeChannelId: string | null;
  // Set when navigating to a specific channel right before its server's channel
  // list has loaded (e.g. clicking a cross-server pinned channel). applyChannelList
  // honors this once the target channel appears, overriding the default first-channel
  // restore. See navigateToPinned in lib/pinnedNavigation.ts.
  pendingActiveChannelId: string | null;
  prefsByChannel: Record<string, { muted: boolean; lastReadAt: number }>;
  unreadByChannel: Record<string, number>;
  mentionByChannel: Record<string, number>;
  atBottomByChannel: Record<string, boolean>;
  categories: Category[];
  channelListFetchedAt: number | null;
  categoryListFetchedAt: number | null;

  applyChannelList: (channels: Channel[]) => void;
  applyCategoryList: (categories: Category[]) => void;
  fetchChannels: () => Promise<void>;
  fetchCategories: () => Promise<void>;
  refreshChannelsIfStale: (maxAgeMs?: number) => Promise<void>;
  refreshCategoriesIfStale: (maxAgeMs?: number) => Promise<void>;
  createCategory: (name: string) => Promise<void>;
  updateCategory: (categoryId: string, name: string) => Promise<void>;
  deleteCategory: (categoryId: string) => Promise<void>;
  reorderChannels: (channelIds: string[]) => Promise<void>;
  reorderCategories: (categoryIds: string[]) => Promise<void>;
  moveChannelCategory: (channelId: string, categoryId: string | null) => Promise<void>;
  setActiveChannel: (channelId: string) => void;
  setPendingActiveChannel: (channelId: string | null) => void;
  createChannel: (name: string, description: string, type: string, categoryId?: string | null, allowDisplayName?: boolean) => Promise<void>;
  updateChannel: (channelId: string, name: string, description: string, type: string, categoryId?: string | null, allowDisplayName?: boolean) => Promise<void>;
  duplicateChannel: (channelId: string) => Promise<void>;
  deleteChannel: (channelId: string) => Promise<void>;
  setChannelPrefs: (channelId: string, prefs: { muted?: boolean; lastReadAt?: number }) => Promise<void>;
  setAtBottom: (channelId: string, atBottom: boolean) => void;
  incrementUnread: (channelId: string, mention: boolean) => void;
  resetCounts: (channelId: string) => void;
  reset: () => void;
  getSnapshot: () => Pick<ChannelState, 'channels' | 'categories' | 'activeChannelId' | 'prefsByChannel' | 'unreadByChannel' | 'mentionByChannel' | 'channelListFetchedAt' | 'categoryListFetchedAt'>;
  loadSnapshot: (data: ReturnType<ChannelState['getSnapshot']>) => void;
}

export const useChannelStore = create<ChannelState>((set, get) => ({
  channels: [],
  activeChannelId: null,
  pendingActiveChannelId: null,
  prefsByChannel: {},
  unreadByChannel: {},
  mentionByChannel: {},
  atBottomByChannel: {},
  categories: [],
  channelListFetchedAt: null,
  categoryListFetchedAt: null,

  applyChannelList: (incoming) => {
    if (!Array.isArray(incoming)) return;
    channelRequestVersion++;
    const channels: Channel[] = [...incoming].sort(
      (a: Channel, b: Channel) => a.position - b.position
    );
    set({ channels, channelListFetchedAt: Date.now() });
    logViewAsRoleDebug('channels:apply', {
      count: channels.length,
      ids: channels.map((channel) => channel.id),
      names: channels.map((channel) => channel.name),
    });

    const currentActive = get().activeChannelId;
    if (channels.length === 0) {
      if (currentActive) {
        set({ activeChannelId: null });
      }
      return;
    }

    // Honor a queued pin navigation target before falling back to last/first channel.
    const pending = get().pendingActiveChannelId;
    if (pending) {
      if (channels.some((c) => c.id === pending)) {
        get().setActiveChannel(pending);
        return;
      }
      // Target isn't visible on this server (deleted or no permission) — drop it
      // so the default selection below can proceed.
      set({ pendingActiveChannelId: null });
    }

    if (!currentActive || !channels.some((c) => c.id === currentActive)) {
      const serverUrl = useAuthStore.getState().serverUrl;
      const lastChannelId = serverUrl ? loadLastChannelId(serverUrl) : null;
      const restore = lastChannelId && channels.some((c) => c.id === lastChannelId)
        ? lastChannelId
        : channels[0].id;
      get().setActiveChannel(restore);
    }
  },

  applyCategoryList: (incoming) => {
    if (!Array.isArray(incoming)) return;
    categoryRequestVersion++;
    const categories: Category[] = [...incoming].sort((a: Category, b: Category) => a.position - b.position);
    set({ categories, categoryListFetchedAt: Date.now() });
  },

  fetchChannels: async () => {
    const requestVersion = ++channelRequestVersion;
    const serverUrl = useAuthStore.getState().serverUrl;
    try {
      const api = createApi();
      const res = await api.get('/api/channels');
      if (requestVersion !== channelRequestVersion || serverUrl !== useAuthStore.getState().serverUrl) return;
      if (!Array.isArray(res.data)) return;
      get().applyChannelList(res.data);
      logViewAsRoleDebug('channels:fetch', { count: get().channels.length });
    } catch {
      // will be handled by socket reconnect or UI
    }
  },

  fetchCategories: async () => {
    const requestVersion = ++categoryRequestVersion;
    const serverUrl = useAuthStore.getState().serverUrl;
    const api = createApi();
    const res = await api.get('/api/categories');
    if (requestVersion !== categoryRequestVersion || serverUrl !== useAuthStore.getState().serverUrl) return;
    if (!Array.isArray(res.data)) return;
    get().applyCategoryList(res.data);
  },

  refreshChannelsIfStale: async (maxAgeMs = CHANNEL_LIST_CACHE_TTL_MS) => {
    const { channels, channelListFetchedAt } = get();
    if (channels.length > 0 && channelListFetchedAt && Date.now() - channelListFetchedAt < maxAgeMs) {
      return;
    }
    await get().fetchChannels();
  },

  refreshCategoriesIfStale: async (maxAgeMs = CHANNEL_LIST_CACHE_TTL_MS) => {
    const { categories, categoryListFetchedAt } = get();
    if (categories.length > 0 && categoryListFetchedAt && Date.now() - categoryListFetchedAt < maxAgeMs) {
      return;
    }
    await get().fetchCategories();
  },

  createCategory: async (name) => {
    const api = createApi();
    await api.post('/api/categories', { name });
    await get().fetchCategories();
  },

  updateCategory: async (categoryId, name) => {
    const api = createApi();
    await api.patch(`/api/categories/${categoryId}`, { name });
    await get().fetchCategories();
  },

  deleteCategory: async (categoryId) => {
    const api = createApi();
    await api.delete(`/api/categories/${categoryId}`);
    await get().fetchCategories();
    await get().fetchChannels();
  },

  reorderChannels: async (channelIds) => {
    const api = createApi();
    for (let i = 0; i < channelIds.length; i++) {
      await api.patch(`/api/channels/${channelIds[i]}`, { position: i });
    }
    await get().fetchChannels();
  },

  reorderCategories: async (categoryIds) => {
    const api = createApi();
    for (let i = 0; i < categoryIds.length; i++) {
      await api.patch(`/api/categories/${categoryIds[i]}`, { position: i });
    }
    await get().fetchCategories();
  },

  moveChannelCategory: async (channelId, categoryId) => {
    const api = createApi();
    await api.patch(`/api/channels/${channelId}`, { categoryId });
    await get().fetchChannels();
  },

  setActiveChannel: (channelId) => {
    if (get().activeChannelId === channelId && get().pendingActiveChannelId === null) {
      return;
    }
    set({ activeChannelId: channelId, pendingActiveChannelId: null });
    const serverUrl = useAuthStore.getState().serverUrl;
    if (serverUrl) {
      saveLastChannelId(serverUrl, channelId);
    }
    const socket = getSocket();
    if (socket) {
      socket.emit('channel:join', channelId);
    }
  },

  setPendingActiveChannel: (channelId) => set({ pendingActiveChannelId: channelId }),

  createChannel: async (name, description, type, categoryId, allowDisplayName) => {
    const api = createApi();
    await api.post('/api/channels', { name, description, type, categoryId, allowDisplayName });
    await get().fetchChannels();
  },

  updateChannel: async (channelId, name, description, type, categoryId, allowDisplayName) => {
    const api = createApi();
    await api.patch(`/api/channels/${channelId}`, { name, description, type, categoryId, allowDisplayName });
    await get().fetchChannels();
  },

  duplicateChannel: async (channelId) => {
    const api = createApi();
    await api.post(`/api/channels/${channelId}/duplicate`);
    await get().fetchChannels();
  },

  deleteChannel: async (channelId) => {
    const api = createApi();
    await api.delete(`/api/channels/${channelId}`);
    const { activeChannelId, channels } = get();
    if (activeChannelId === channelId) {
      const remaining = channels.filter((c) => c.id !== channelId);
      set({ activeChannelId: remaining.length > 0 ? remaining[0].id : null });
    }
    await get().fetchChannels();
  },

  setChannelPrefs: async (channelId, prefs) => {
    const api = createApi();
    const res = await api.patch(`/api/channels/${channelId}/prefs`, prefs);
    set((s) => ({
      prefsByChannel: {
        ...s.prefsByChannel,
        [channelId]: {
          muted: res.data.muted,
          lastReadAt: res.data.lastReadAt,
        },
      },
    }));
    const auth = useAuthStore.getState();
    if (prefs.lastReadAt != null && auth.serverUrl) dismissDesktopNotifications('server', auth.serverUrl, channelId);
    if (auth.user?.accountType === 'central' && auth.serverUrl && prefs.lastReadAt != null) {
      void createAuthenticatedApi().post('/api/notifications/read-stream', {
        streamKind: 'server',
        streamId: auth.serverUrl,
        subsourceId: channelId,
      }).catch(() => {});
    }
  },

  setAtBottom: (channelId, atBottom) => {
    set((s) => ({
      atBottomByChannel: { ...s.atBottomByChannel, [channelId]: atBottom },
    }));
  },

  incrementUnread: (channelId, mention) => {
    set((s) => ({
      unreadByChannel: {
        ...s.unreadByChannel,
        [channelId]: (s.unreadByChannel[channelId] ?? 0) + 1,
      },
      mentionByChannel: {
        ...s.mentionByChannel,
        [channelId]: (s.mentionByChannel[channelId] ?? 0) + (mention ? 1 : 0),
      },
    }));
  },

  resetCounts: (channelId) => {
    set((s) => ({
      unreadByChannel: { ...s.unreadByChannel, [channelId]: 0 },
      mentionByChannel: { ...s.mentionByChannel, [channelId]: 0 },
    }));
  },

  reset: () => {
    channelRequestVersion++;
    categoryRequestVersion++;
    set({ channels: [], activeChannelId: null, pendingActiveChannelId: null, prefsByChannel: {}, unreadByChannel: {}, mentionByChannel: {}, atBottomByChannel: {}, categories: [], channelListFetchedAt: null, categoryListFetchedAt: null });
  },

  getSnapshot: () => {
    const { channels, categories, activeChannelId, prefsByChannel, unreadByChannel, mentionByChannel, channelListFetchedAt, categoryListFetchedAt } = get();
    return { channels, categories, activeChannelId, prefsByChannel, unreadByChannel, mentionByChannel, channelListFetchedAt, categoryListFetchedAt };
  },

  loadSnapshot: (data) => {
    channelRequestVersion++;
    categoryRequestVersion++;
    set({
      channels: data.channels,
      categories: data.categories,
      activeChannelId: data.activeChannelId,
      prefsByChannel: data.prefsByChannel,
      unreadByChannel: data.unreadByChannel,
      mentionByChannel: data.mentionByChannel,
      channelListFetchedAt: data.channelListFetchedAt ?? null,
      categoryListFetchedAt: data.categoryListFetchedAt ?? null,
      atBottomByChannel: {},
    });
  },
}));
