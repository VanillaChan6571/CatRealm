/**
 * Message store — recent messages per channel + paging cursors.
 * Real implementation in CatRealm-Client/src/stores/messageStore.ts.
 *
 * The mobile build will likely want to back this with a SQLite cache
 * (expo-sqlite) for offline reads. TODO when wiring real socket handlers.
 */

import { create } from 'zustand';
import type { Message, Reaction } from '@/types';
import { createApi } from '@/lib/api';
import { debugLog } from '@/lib/debugLog';
import { getSocket } from '@/lib/socket';

type OutgoingAttachment = {
  url: string;
  mime: string;
  size: number;
  thumbnailUrl?: string | null;
  isNsfw?: boolean;
};

export interface MessageState {
  byChannel: Record<string, Message[]>;
  /** Earliest message timestamp we have for each channel — pass to /messages?before=. */
  earliestId: Record<string, string | null>;
  hasMore: Record<string, boolean>;
  loading: Record<string, boolean>;
  loadingOlder: Record<string, boolean>;
  errors: Record<string, string | null>;
  /** Usernames currently typing per channel, driven by socket typing:update. */
  typingByChannel: Record<string, string[]>;

  prependMessages: (channelId: string, messages: Message[]) => void;
  appendMessage: (channelId: string, message: Message) => void;
  updateMessage: (channelId: string, message: Message) => void;
  removeMessage: (channelId: string, messageId: string) => void;
  setLoading: (channelId: string, value: boolean) => void;
  setTypingUsers: (channelId: string, users: string[]) => void;
  fetchMessages: (channelId: string, before?: string, serverAuth?: { serverUrl: string; token?: string }) => Promise<void>;
  sendMessage: (channelId: string, content: string, attachments?: OutgoingAttachment[], voiceExpiresAt?: number | null) => void;
  requestEdit: (messageId: string, content: string) => void;
  requestDelete: (messageId: string, channelId?: string) => void;
  applyReactionUpdate: (channelId: string, messageId: string, reactions: Reaction[], selfUserId?: string) => void;
  reset: (channelId?: string) => void;
}

export const useMessageStore = create<MessageState>((set, get) => ({
  byChannel: {},
  earliestId: {},
  hasMore: {},
  loading: {},
  loadingOlder: {},
  errors: {},
  typingByChannel: {},

  prependMessages: (channelId, messages) =>
    set((s) => {
      const existing = s.byChannel[channelId] ?? [];
      const ids = new Set(existing.map((m) => m.id));
      const fresh = messages.filter((m) => !ids.has(m.id));
      // Sort merged array oldest-first so byChannel is always chronological
      const next = [...fresh, ...existing].sort((a, b) => a.created_at - b.created_at);
      const earliest = next[0]?.created_at != null
        ? String(next[0].created_at)
        : s.earliestId[channelId] ?? null;
      return {
        byChannel: { ...s.byChannel, [channelId]: next },
        earliestId: { ...s.earliestId, [channelId]: earliest },
      };
    }),

  appendMessage: (channelId, message) =>
    set((s) => {
      const existing = s.byChannel[channelId] ?? [];
      if (existing.some((m) => m.id === message.id)) return s;
      return { byChannel: { ...s.byChannel, [channelId]: [...existing, message] } };
    }),

  updateMessage: (channelId, message) =>
    set((s) => {
      const existing = s.byChannel[channelId] ?? [];
      return {
        byChannel: {
          ...s.byChannel,
          [channelId]: existing.map((m) => (m.id === message.id ? message : m)),
        },
      };
    }),

  removeMessage: (channelId, messageId) =>
    set((s) => ({
      byChannel: {
        ...s.byChannel,
        [channelId]: (s.byChannel[channelId] ?? []).filter((m) => m.id !== messageId),
      },
    })),

  setLoading: (channelId, value) =>
    set((s) => ({ loading: { ...s.loading, [channelId]: value } })),

  setTypingUsers: (channelId, users) =>
    set((s) => ({ typingByChannel: { ...s.typingByChannel, [channelId]: users } })),

  fetchMessages: async (channelId, before, serverAuth) => {
    if (get().loading[channelId]) return;
    if (before && get().hasMore[channelId] === false) return;
    set((s) => ({
      loading: { ...s.loading, [channelId]: true },
      errors: { ...s.errors, [channelId]: null },
      loadingOlder: before ? { ...s.loadingOlder, [channelId]: true } : s.loadingOlder,
    }));
    try {
      const limit = 50;
      const params: Record<string, unknown> = { limit };
      if (before) params.before = before;
      const res = await createApi(serverAuth?.serverUrl, serverAuth?.token).get<Message[]>('/api/messages/' + channelId, { params });
      get().prependMessages(channelId, res.data);
      set((s) => ({
        hasMore: { ...s.hasMore, [channelId]: res.data.length >= limit },
      }));
    } catch (err: unknown) {
      // Messages won't load; user can scroll to retry. Log enough to tell a
      // transport failure (no status) from an auth/route failure (4xx).
      const status = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { status?: number } }).response?.status
        : undefined;
      set((s) => ({ errors: { ...s.errors, [channelId]: status === 403
        ? 'You do not have permission to read this chat.' : 'Could not load chat history. Please retry.' } }));
      debugLog('MessageStore', 'fetch-failed', {
        channelId,
        before: before ?? null,
        serverUrl: serverAuth?.serverUrl ?? null,
        hadToken: serverAuth?.token != null,
        status,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      set((s) => ({
        loading: { ...s.loading, [channelId]: false },
        loadingOlder: before ? { ...s.loadingOlder, [channelId]: false } : s.loadingOlder,
      }));
    }
  },

  sendMessage: (channelId, content, attachments = [], voiceExpiresAt = null) => {
    const bodyAttachments = attachments.map((attachment) => ({
      url: attachment.url,
      mime: attachment.mime,
      size: attachment.size,
      ...(attachment.thumbnailUrl ? { thumbnailUrl: attachment.thumbnailUrl } : {}),
    }));
    const nsfwTags = attachments.some((attachment) => attachment.isNsfw) ? ['nsfw'] : [];
    getSocket()?.emit('message:send', { channelId, content, attachments: bodyAttachments, nsfwTags, voice_expires_at: voiceExpiresAt });
  },

  requestEdit: (messageId, content) => {
    getSocket()?.emit('message:edit', { messageId, content });
  },

  requestDelete: (messageId, channelId) => {
    getSocket()?.emit('message:delete', channelId ? { messageId, channelId } : { messageId });
  },

  applyReactionUpdate: (channelId, messageId, reactions, selfUserId) =>
    set((s) => {
      const existing = s.byChannel[channelId];
      if (!existing) return s;
      const idx = existing.findIndex((m) => m.id === messageId);
      if (idx === -1) return s;
      // Server summaries carry { emoji, count, users }; derive our own `reacted`.
      const normalized = (reactions ?? []).map((r) => ({
        ...r,
        reacted: Boolean(selfUserId && r.users?.includes(selfUserId)),
      }));
      const next = [...existing];
      next[idx] = { ...next[idx], reactions: normalized };
      return { byChannel: { ...s.byChannel, [channelId]: next } };
    }),

  reset: (channelId) =>
    set((s) => {
      if (!channelId)
        return {
          byChannel: {},
          earliestId: {},
          hasMore: {},
          loading: {},
          loadingOlder: {},
          errors: {},
          typingByChannel: {},
        };
      const byChannel = { ...s.byChannel };
      const earliest = { ...s.earliestId };
      const hasMore = { ...s.hasMore };
      const loading = { ...s.loading };
      const loadingOlder = { ...s.loadingOlder };
      const errors = { ...s.errors };
      const typing = { ...s.typingByChannel };
      delete byChannel[channelId];
      delete earliest[channelId];
      delete hasMore[channelId];
      delete loading[channelId];
      delete loadingOlder[channelId];
      delete errors[channelId];
      delete typing[channelId];
      return { byChannel, earliestId: earliest, hasMore, loading, loadingOlder, errors, typingByChannel: typing };
    }),
}));
