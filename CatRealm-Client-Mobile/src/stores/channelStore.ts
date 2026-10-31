/**
 * Channel store — per-channel scroll position, draft, slowmode, etc.
 * Mirrors CatRealm-Client/src/stores/channelStore.ts.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuthStore } from '@/stores/authStore';
import { createApi } from '@/lib/api';
import type { Message } from '@/types';

const LAST_CHANNEL_STORAGE_PREFIX = 'catrealm.mobile.last-channel-by-server.v1:';

function lastChannelStorageKey(userId: string): string {
  return `${LAST_CHANNEL_STORAGE_PREFIX}${userId}`;
}

export interface ChannelDraft {
  text: string;
  /** ms epoch when the user last typed — used for typing indicators. */
  updatedAt: number;
}

export interface ChannelState {
  /** Per-channel composer drafts so users don't lose unsent text on nav. */
  drafts: Record<string, ChannelDraft>;
  /** Last-seen scroll offset per channel (FlatList getNativeScrollRef). */
  scrollOffsets: Record<string, number>;
  /** Last opened channel for each server, used by the server drawer. */
  lastChannelByServer: Record<string, string>;
  /** Channel the user is currently viewing (used to suppress unread increments). */
  activeChannelId: string | null;
  /** Per-channel unread message counts. */
  unreadByChannel: Record<string, number>;
  /** Per-channel @mention counts. */
  mentionByChannel: Record<string, number>;
  setDraft: (channelId: string, text: string) => void;
  clearDraft: (channelId: string) => void;
  setScrollOffset: (channelId: string, offset: number) => void;
  setLastChannelForServer: (serverId: string, channelId: string) => Promise<void>;
  setActiveChannel: (channelId: string | null) => void;
  incrementUnread: (channelId: string, isMention: boolean) => void;
  resetCounts: (channelId: string) => void;
  applyMentionSummary: (mentionsByChannel: Record<string, number>) => void;
  /** Realm read state: set unread counts from `unreadCounts`, clear the rest of `channelIds` (read elsewhere). */
  applyReadState: (channelIds: string[], unreadCounts: Record<string, number>) => void;
  /** Pinned messages keyed by channelId. */
  pinnedByChannel: Record<string, Message[]>;
  fetchPins: (channelId: string) => Promise<void>;
  pinMessage: (channelId: string, messageId: string) => Promise<void>;
  unpinMessage: (channelId: string, messageId: string) => Promise<void>;
  hydrate: (userId: string) => Promise<void>;
}

export const useChannelStore = create<ChannelState>((set, get) => ({
  drafts: {},
  scrollOffsets: {},
  lastChannelByServer: {},
  activeChannelId: null,
  unreadByChannel: {},
  mentionByChannel: {},
  pinnedByChannel: {},

  setDraft: (channelId, text) =>
    set((s) => ({
      drafts: { ...s.drafts, [channelId]: { text, updatedAt: Date.now() } },
    })),
  clearDraft: (channelId) =>
    set((s) => {
      const next = { ...s.drafts };
      delete next[channelId];
      return { drafts: next };
    }),
  setScrollOffset: (channelId, offset) =>
    set((s) => ({ scrollOffsets: { ...s.scrollOffsets, [channelId]: offset } })),
  setLastChannelForServer: async (serverId, channelId) => {
    const userId = useAuthStore.getState().user?.id;
    if (userId) {
      const next = {
        ...get().lastChannelByServer,
        [serverId]: channelId,
      };
      await AsyncStorage.setItem(lastChannelStorageKey(userId), JSON.stringify(next));
      set({ lastChannelByServer: next });
      return;
    }
    set({
      lastChannelByServer: {
        ...get().lastChannelByServer,
        [serverId]: channelId,
      },
    });
  },
  setActiveChannel: (channelId) => set({ activeChannelId: channelId }),
  incrementUnread: (channelId, isMention) =>
    set((s) => ({
      unreadByChannel: { ...s.unreadByChannel, [channelId]: (s.unreadByChannel[channelId] ?? 0) + 1 },
      mentionByChannel: { ...s.mentionByChannel, [channelId]: (s.mentionByChannel[channelId] ?? 0) + (isMention ? 1 : 0) },
    })),
  resetCounts: (channelId) =>
    set((s) => ({
      unreadByChannel: { ...s.unreadByChannel, [channelId]: 0 },
      mentionByChannel: { ...s.mentionByChannel, [channelId]: 0 },
    })),
  applyReadState: (channelIds, unreadCounts) =>
    set((s) => {
      const next = { ...s.unreadByChannel };
      for (const id of channelIds) {
        const count = unreadCounts[id] ?? 0;
        // Keep a higher live count (messages that arrived since the realm counted).
        next[id] = count > 0 ? Math.max(next[id] ?? 0, count) : 0;
      }
      return { unreadByChannel: next };
    }),
  applyMentionSummary: (mentionsByChannel) =>
    set((state) => ({
      mentionByChannel: {
        ...Object.fromEntries(Object.keys(state.mentionByChannel).map((channelId) => [channelId, 0])),
        ...mentionsByChannel,
      },
    })),

  fetchPins: async (channelId) => {
    const res = await createApi().get(`/api/channels/${channelId}/pins`).catch(() => null);
    if (!res?.data) return;
    const pins = (Array.isArray(res.data) ? res.data : []) as Message[];
    set((s) => ({ pinnedByChannel: { ...s.pinnedByChannel, [channelId]: pins } }));
  },
  pinMessage: async (channelId, messageId) => {
    await createApi().post(`/api/channels/${channelId}/pins`, { messageId }).catch(() => null);
    await useChannelStore.getState().fetchPins(channelId);
  },
  unpinMessage: async (channelId, messageId) => {
    await createApi().delete(`/api/channels/${channelId}/pins/${messageId}`).catch(() => null);
    set((s) => ({
      pinnedByChannel: {
        ...s.pinnedByChannel,
        [channelId]: (s.pinnedByChannel[channelId] ?? []).filter((m) => m.id !== messageId),
      },
    }));
  },

  hydrate: async (userId) => {
    try {
      const raw = await AsyncStorage.getItem(lastChannelStorageKey(userId));
      const parsed = raw ? (JSON.parse(raw) as Record<string, string>) : {};
      set({ lastChannelByServer: parsed });
    } catch {
      set({ lastChannelByServer: {} });
    }
  },
}));
