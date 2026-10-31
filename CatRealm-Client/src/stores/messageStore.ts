import { create } from 'zustand';
import type { Message, MessageAttachment, MessageReaction } from '../types';
import { createApi } from '../lib/api';
import { getSocket } from '../lib/socket';
import { useAuthStore } from './authStore';
import { AUTH_BASE } from '../lib/authApi';
import { resolveAvatarUrl } from '../utils/avatar';
import { decodeToken } from '../utils/token';

interface AttachmentPayload {
  url: string;
  mime: string;
  size: number;
  thumbnailUrl?: string | null;
  thumbnail_url?: string | null;
}

type AttachmentsArg = AttachmentPayload | AttachmentPayload[] | undefined;

interface PinEntry {
  message_id: string;
  pinned_at: number;
  pinned_by: string;
  content: string;
  created_at: number;
  username: string;
}

interface MessageState {
  messagesByChannel: Record<string, Message[]>;
  hasMore: Record<string, boolean>;
  loadingMore: Record<string, boolean>;
  loadFailed: Record<string, boolean>;
  pinnedByChannel: Record<string, Set<string>>;
  pinsByChannel: Record<string, PinEntry[]>;

  fetchMessages: (channelId: string, before?: number) => Promise<void>;
  clearLoadFailure: (channelId: string) => void;
  fetchPins: (channelId: string) => Promise<void>;
  addMessage: (message: Message) => void;
  editMessage: (messageId: string, content: string, embedsEnabled?: number) => void;
  editThreadMessage: (threadId: string, messageId: string, content: string, embedsEnabled?: number) => void;
  removeMessage: (messageId: string, channelId: string) => void;
  removeThreadMessage: (threadId: string, messageId: string) => void;
  sendMessage: (
    channelId: string,
    content: string,
    attachments?: AttachmentsArg,
    threadId?: string | null,
    replyToId?: string,
    forwardFromId?: string,
    nsfwTags?: string[],
    voiceExpiresAt?: number | null,
    scheduledAt?: number | null
  ) => void;
  retryMessage: (nonce: string) => void;
  dismissFailedMessage: (nonce: string) => void;
  scheduledByChannel: Record<string, Message[]>;
  addScheduledMessage: (msg: Message) => void;
  publishScheduledMessage: (messageId: string, channelId: string, published: Message) => void;
  forwardMedia: (channelId: string, url: string, meta: { serverName: string; at: number }) => void;
  requestEdit: (messageId: string, content: string) => void;
  requestDelete: (messageId: string) => void;
  toggleReaction: (messageId: string, emoji: string) => void;
  applyReactionUpdate: (messageId: string, reactions: MessageReaction[], threadId?: string | null) => void;
  pinMessage: (channelId: string, messageId: string) => Promise<void>;
  unpinMessage: (channelId: string, messageId: string) => Promise<void>;
  messagesByThread: Record<string, Message[]>;
  fetchThreadMessages: (threadId: string, before?: number) => Promise<void>;
  addThreadMessage: (message: Message) => void;
  clearChannel: (channelId: string) => void;
  reset: () => void;
  getSnapshot: () => Pick<MessageState, 'messagesByChannel' | 'messagesByThread'>;
  loadSnapshot: (data: ReturnType<MessageState['getSnapshot']>) => void;
}

// ── Optimistic send ("ghost message") plumbing ───────────────────────────────
// A sent message is rendered immediately as a ghost (status: 'sending') and
// reconciled when the server echoes it back. If no echo arrives within the
// timeout, it flips to 'failed' so the user can retry or dismiss it.
const OPTIMISTIC_SEND_TIMEOUT_MS = 12_000;
const OPTIMISTIC_MATCH_WINDOW_SEC = 120;
const SNAPSHOT_MESSAGES_PER_CONVERSATION = 200;

type OptimisticSendArgs = {
  channelId: string;
  content: string;
  attachments?: AttachmentsArg;
  threadId?: string | null;
  replyToId?: string;
  forwardFromId?: string;
  nsfwTags?: string[];
  voiceExpiresAt?: number | null;
};

const pendingSendTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingSendArgs = new Map<string, OptimisticSendArgs>();

function makeNonce(): string {
  return `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// Server reaction summaries carry { emoji, count, users }; `reacted` is viewer-specific.
function normalizeFetchedReactions(messages: Message[]): Message[] {
  const selfId = selfServerUserId();
  return messages.map((m) =>
    Array.isArray(m.reactions) && m.reactions.length > 0
      ? { ...m, reactions: m.reactions.map((r) => ({ ...r, reacted: Boolean(selfId && r.users?.includes(selfId)) })) }
      : m
  );
}

function clearPending(nonce: string | null | undefined): void {
  if (!nonce) return;
  const timer = pendingSendTimers.get(nonce);
  if (timer) clearTimeout(timer);
  pendingSendTimers.delete(nonce);
  pendingSendArgs.delete(nonce);
}

function clearAllPending(): void {
  for (const timer of pendingSendTimers.values()) clearTimeout(timer);
  pendingSendTimers.clear();
  pendingSendArgs.clear();
}

function normalizeAttachments(attachments: AttachmentsArg): AttachmentPayload[] {
  return Array.isArray(attachments) ? attachments : attachments ? [attachments] : [];
}

// Central accounts are known to a realm by a realm-local id (not their central id); every
// realm payload (authors, reaction users) uses that id. Mirrors MessageItem's actorUserId.
function selfServerUserId(): string | null {
  const { user, token } = useAuthStore.getState();
  if (!user) return null;
  if (user.accountType !== 'central') return user.id;
  const tokenId = token ? decodeToken(token)?.id : null;
  return user.serverUserId ?? (typeof tokenId === 'string' ? tokenId : null) ?? user.id;
}

// Locate an in-flight optimistic message that a freshly arrived server message
// should replace. Prefer the explicit nonce echo; fall back to a content/author
// heuristic so the feature degrades gracefully against servers that predate the
// nonce echo (otherwise the ghost would duplicate and hang).
function findOptimisticMatchIndex(list: Message[], message: Message): number {
  if (message.client_nonce) {
    const byNonce = list.findIndex(
      (m) => !!m.status && !!m.client_nonce && m.client_nonce === message.client_nonce
    );
    if (byNonce >= 0) return byNonce;
  }
  const selfId = selfServerUserId();
  if (selfId && message.user_id === selfId) {
    const incomingAttCount = message.attachments?.length ?? (message.attachment_url ? 1 : 0);
    return list.findIndex(
      (m) =>
        !!m.status &&
        (m.content ?? '') === (message.content ?? '') &&
        ((m.attachments?.length ?? (m.attachment_url ? 1 : 0)) === incomingAttCount) &&
        Math.abs((message.created_at ?? 0) - (m.created_at ?? 0)) < OPTIMISTIC_MATCH_WINDOW_SEC
    );
  }
  return -1;
}

function buildOptimisticMessage(nonce: string, args: OptimisticSendArgs): Message {
  const { user, serverUrl } = useAuthStore.getState();
  // Pre-resolve to an absolute avatar URL so the ghost renders correctly for
  // central accounts (whose avatar lives on AUTH_BASE, not the active server).
  // MessageItem will pass an absolute URL through unchanged.
  const avatarBase = user?.accountType === 'central' ? AUTH_BASE : serverUrl;
  const resolvedAvatar = resolveAvatarUrl(user?.avatar, avatarBase, user?.accountType);
  const atts = normalizeAttachments(args.attachments);
  const mappedAttachments: MessageAttachment[] = atts.map((a) => ({
    url: a.url,
    mime: a.mime,
    size: a.size,
    thumbnailUrl: a.thumbnailUrl ?? a.thumbnail_url ?? null,
  }));
  const first = atts[0] ?? null;
  return {
    id: nonce,
    client_nonce: nonce,
    status: 'sending',
    channel_id: args.channelId,
    user_id: selfServerUserId() ?? user?.id ?? '',
    username: user?.username ?? '',
    avatar: resolvedAvatar,
    display_name: user?.displayName ?? null,
    verified: user?.verified ?? false,
    is_owner: user?.isOwner ? 1 : 0,
    content: args.content,
    edited: 0,
    message_type: 'user',
    thread_id: args.threadId ?? null,
    created_at: Math.floor(Date.now() / 1000),
    attachments: mappedAttachments.length > 0 ? mappedAttachments : null,
    attachment_url: first?.url ?? null,
    attachment_type: first?.mime ?? null,
    attachment_size: first?.size ?? null,
    voice_expires_at: args.voiceExpiresAt ?? null,
  };
}

function emitSend(nonce: string, args: OptimisticSendArgs): boolean {
  const socket = getSocket();
  if (!socket) return false;
  socket.emit('message:send', {
    channelId: args.channelId,
    content: args.content,
    attachments: normalizeAttachments(args.attachments),
    threadId: args.threadId ?? null,
    replyToId: args.replyToId,
    forwardFromId: args.forwardFromId,
    nsfwTags: args.nsfwTags,
    voice_expires_at: args.voiceExpiresAt ?? null,
    scheduled_at: null,
    client_nonce: nonce,
  });
  return true;
}

export const useMessageStore = create<MessageState>((set, get) => {
  // Patch an optimistic message (matched by nonce) wherever it lives.
  const patchOptimistic = (nonce: string, patch: Partial<Message>): void => {
    set((s) => {
      let changed = false;
      const messagesByChannel = { ...s.messagesByChannel };
      for (const cid of Object.keys(messagesByChannel)) {
        const list = messagesByChannel[cid];
        const idx = list.findIndex((m) => m.client_nonce === nonce);
        if (idx >= 0) {
          const next = [...list];
          next[idx] = { ...next[idx], ...patch };
          messagesByChannel[cid] = next;
          changed = true;
        }
      }
      const messagesByThread = { ...s.messagesByThread };
      for (const tid of Object.keys(messagesByThread)) {
        const list = messagesByThread[tid];
        const idx = list.findIndex((m) => m.client_nonce === nonce);
        if (idx >= 0) {
          const next = [...list];
          next[idx] = { ...next[idx], ...patch };
          messagesByThread[tid] = next;
          changed = true;
        }
      }
      return changed ? { messagesByChannel, messagesByThread } : s;
    });
  };

  const removeOptimistic = (nonce: string): void => {
    set((s) => {
      let changed = false;
      const messagesByChannel = { ...s.messagesByChannel };
      for (const cid of Object.keys(messagesByChannel)) {
        const list = messagesByChannel[cid];
        if (list.some((m) => m.client_nonce === nonce)) {
          messagesByChannel[cid] = list.filter((m) => m.client_nonce !== nonce);
          changed = true;
        }
      }
      const messagesByThread = { ...s.messagesByThread };
      for (const tid of Object.keys(messagesByThread)) {
        const list = messagesByThread[tid];
        if (list.some((m) => m.client_nonce === nonce)) {
          messagesByThread[tid] = list.filter((m) => m.client_nonce !== nonce);
          changed = true;
        }
      }
      return changed ? { messagesByChannel, messagesByThread } : s;
    });
  };

  const armFailureTimer = (nonce: string): void => {
    const existing = pendingSendTimers.get(nonce);
    if (existing) clearTimeout(existing);
    pendingSendTimers.set(
      nonce,
      setTimeout(() => {
        pendingSendTimers.delete(nonce);
        patchOptimistic(nonce, { status: 'failed' });
      }, OPTIMISTIC_SEND_TIMEOUT_MS)
    );
  };

  const startOptimisticSend = (nonce: string, args: OptimisticSendArgs): void => {
    pendingSendArgs.set(nonce, args);
    const optimistic = buildOptimisticMessage(nonce, args);
    if (args.threadId) {
      set((s) => {
        const list = s.messagesByThread[args.threadId!] ?? [];
        return { messagesByThread: { ...s.messagesByThread, [args.threadId!]: [...list, optimistic] } };
      });
    } else {
      set((s) => {
        const list = s.messagesByChannel[args.channelId] ?? [];
        return { messagesByChannel: { ...s.messagesByChannel, [args.channelId]: [...list, optimistic] } };
      });
    }
    if (emitSend(nonce, args)) {
      armFailureTimer(nonce);
    } else {
      // No live socket — fail immediately so the user can retry once reconnected.
      patchOptimistic(nonce, { status: 'failed' });
    }
  };

  return {
  messagesByChannel: {},
  hasMore: {},
  loadingMore: {},
  loadFailed: {},
  pinnedByChannel: {},
  pinsByChannel: {},
  messagesByThread: {},
  scheduledByChannel: {},

  fetchMessages: async (channelId, before) => {
    if (get().loadingMore[channelId]) return;

    set((s) => ({
      loadingMore: { ...s.loadingMore, [channelId]: true },
      loadFailed: { ...s.loadFailed, [channelId]: false },
    }));

    try {
      const api = createApi();
      const params: Record<string, string | number> = { limit: 50 };
      if (before) params.before = before;

      const res = await api.get(`/api/messages/${channelId}`, { params });
      const fetched: Message[] = normalizeFetchedReactions(res.data);

      set((s) => {
        const existing = s.messagesByChannel[channelId] ?? [];
        const existingIds = new Set(existing.map((m) => m.id));
        const newMessages = fetched.filter((m) => !existingIds.has(m.id));

        return {
          messagesByChannel: {
            ...s.messagesByChannel,
            [channelId]: before
              ? [...newMessages, ...existing]
              : [...existing, ...newMessages],
          },
          hasMore: { ...s.hasMore, [channelId]: fetched.length >= 50 },
          loadingMore: { ...s.loadingMore, [channelId]: false },
        };
      });
    } catch {
      // Park the channel on a failure instead of leaving `hasMore` true: the
      // infinite-scroll observer re-arms the moment `loadingMore` clears, and
      // with the sentinel still on screen (nothing was prepended) that turns a
      // persistent error — an expired token 403, say — into an unbounded
      // request loop. Cleared on channel switch or an explicit retry.
      set((s) => ({
        loadingMore: { ...s.loadingMore, [channelId]: false },
        loadFailed: { ...s.loadFailed, [channelId]: true },
      }));
    }
  },

  clearLoadFailure: (channelId) => {
    if (!get().loadFailed[channelId]) return;
    set((s) => ({ loadFailed: { ...s.loadFailed, [channelId]: false } }));
  },

  fetchPins: async (channelId) => {
    try {
      const api = createApi();
      const res = await api.get(`/api/channels/${channelId}/pins`);
      const fetchedIds = new Set<string>((res.data ?? []).map((p: { message_id: string }) => p.message_id));
      set((s) => {
        // Keep the existing Set when nothing changed so subscribers to this
        // channel's pins don't re-render on every channel switch.
        const previous = s.pinnedByChannel[channelId];
        const unchanged = previous && previous.size === fetchedIds.size && [...fetchedIds].every((id) => previous.has(id));
        return {
          pinnedByChannel: unchanged ? s.pinnedByChannel : { ...s.pinnedByChannel, [channelId]: fetchedIds },
          pinsByChannel: { ...s.pinsByChannel, [channelId]: res.data ?? [] },
        };
      });
    } catch {
      // ignore
    }
  },

  addMessage: (message) => {
    const channelId = message.channel_id;
    const existing = get().messagesByChannel[channelId] ?? [];
    const matchIdx = findOptimisticMatchIndex(existing, message);
    if (matchIdx >= 0) {
      const matchNonce = existing[matchIdx].client_nonce ?? null;
      clearPending(matchNonce);
      set((s) => {
        const list = s.messagesByChannel[channelId] ?? [];
        const idx = matchNonce
          ? list.findIndex((m) => m.client_nonce === matchNonce)
          : findOptimisticMatchIndex(list, message);
        if (idx < 0) {
          if (list.some((m) => m.id === message.id)) return s;
          return { messagesByChannel: { ...s.messagesByChannel, [channelId]: [...list, message] } };
        }
        const next = [...list];
        next[idx] = message;
        return { messagesByChannel: { ...s.messagesByChannel, [channelId]: next } };
      });
      return;
    }
    set((s) => {
      const list = s.messagesByChannel[channelId] ?? [];
      if (list.some((m) => m.id === message.id)) return s;
      return {
        messagesByChannel: {
          ...s.messagesByChannel,
          [channelId]: [...list, message],
        },
      };
    });
  },

  editMessage: (messageId, content, embedsEnabled) => {
    set((s) => {
      const updated: Record<string, Message[]> = {};
      for (const [channelId, messages] of Object.entries(s.messagesByChannel)) {
        updated[channelId] = messages.map((m) =>
          m.id === messageId ? { ...m, content, edited: 1, embeds_enabled: embedsEnabled ?? m.embeds_enabled } : m
        );
      }
      return { messagesByChannel: updated };
    });
  },

  editThreadMessage: (threadId, messageId, content, embedsEnabled) => {
    set((s) => {
      const messages = s.messagesByThread[threadId];
      if (!messages) return s;
      return {
        messagesByThread: {
          ...s.messagesByThread,
          [threadId]: messages.map((m) => (m.id === messageId ? { ...m, content, edited: 1, embeds_enabled: embedsEnabled ?? m.embeds_enabled } : m)),
        },
      };
    });
  },

  removeMessage: (messageId, channelId) => {
    set((s) => {
      const messages = s.messagesByChannel[channelId];
      if (!messages) return s;
      return {
        messagesByChannel: {
          ...s.messagesByChannel,
          [channelId]: messages.filter((m) => m.id !== messageId),
        },
      };
    });
  },

  removeThreadMessage: (threadId, messageId) => {
    set((s) => {
      const messages = s.messagesByThread[threadId];
      if (!messages) return s;
      return {
        messagesByThread: {
          ...s.messagesByThread,
          [threadId]: messages.filter((m) => m.id !== messageId),
        },
      };
    });
  },

  sendMessage: (channelId, content, attachments, threadId, replyToId, forwardFromId, nsfwTags, voiceExpiresAt, scheduledAt) => {
    // Scheduled messages don't appear in the live channel, so skip the optimistic
    // ghost path and just forward them to the server.
    if (scheduledAt != null) {
      const socket = getSocket();
      if (socket) {
        socket.emit('message:send', {
          channelId,
          content,
          attachments: normalizeAttachments(attachments),
          threadId,
          replyToId,
          forwardFromId,
          nsfwTags,
          voice_expires_at: voiceExpiresAt ?? null,
          scheduled_at: scheduledAt,
        });
      }
      return;
    }

    const nonce = makeNonce();
    startOptimisticSend(nonce, {
      channelId,
      content,
      attachments,
      threadId,
      replyToId,
      forwardFromId,
      nsfwTags,
      voiceExpiresAt,
    });
  },

  retryMessage: (nonce) => {
    const args = pendingSendArgs.get(nonce);
    if (!args) {
      // Lost the original payload (e.g. after a reload) — just drop the ghost.
      removeOptimistic(nonce);
      clearPending(nonce);
      return;
    }
    patchOptimistic(nonce, { status: 'sending' });
    if (emitSend(nonce, args)) {
      armFailureTimer(nonce);
    } else {
      patchOptimistic(nonce, { status: 'failed' });
    }
  },

  dismissFailedMessage: (nonce) => {
    clearPending(nonce);
    removeOptimistic(nonce);
  },

  addScheduledMessage: (message) => {
    set((s) => {
      const channelId = message.channel_id;
      const existing = s.scheduledByChannel[channelId] ?? [];
      if (existing.some((m) => m.id === message.id)) return s;
      return {
        scheduledByChannel: {
          ...s.scheduledByChannel,
          [channelId]: [...existing, message],
        },
      };
    });
  },

  publishScheduledMessage: (messageId, channelId, published) => {
    set((s) => {
      const scheduled = s.scheduledByChannel[channelId] ?? [];
      const newScheduled = scheduled.filter((m) => m.id !== messageId);
      const existing = s.messagesByChannel[channelId] ?? [];
      const alreadyExists = existing.some((m) => m.id === messageId);
      return {
        scheduledByChannel: { ...s.scheduledByChannel, [channelId]: newScheduled },
        messagesByChannel: alreadyExists
          ? s.messagesByChannel
          : { ...s.messagesByChannel, [channelId]: [...existing, published] },
      };
    });
  },

  forwardMedia: (channelId, url, meta) => {
    const socket = getSocket();
    if (socket) {
      socket.emit('message:send', { channelId, content: url, forwardMeta: { serverName: meta.serverName, at: meta.at } });
    }
  },

  requestEdit: (messageId, content) => {
    const socket = getSocket();
    if (socket) {
      socket.emit('message:edit', { messageId, content });
    }
  },

  requestDelete: (messageId) => {
    const socket = getSocket();
    if (socket) {
      socket.emit('message:delete', { messageId });
    }
  },

  toggleReaction: (messageId, emoji) => {
    const socket = getSocket();
    if (socket) {
      socket.emit('message:react', { messageId, emoji });
    }
  },

  applyReactionUpdate: (messageId, reactions, threadId) => {
    // Server payloads carry { emoji, count, users }; derive our own `reacted`.
    const selfId = selfServerUserId();
    const normalized: MessageReaction[] = (reactions ?? []).map((r) => ({
      ...r,
      reacted: Boolean(selfId && r.users?.includes(selfId)),
    }));
    const patch = (list: Message[] | undefined) => {
      if (!list) return list;
      const idx = list.findIndex((m) => m.id === messageId);
      if (idx < 0) return list;
      const next = [...list];
      next[idx] = { ...next[idx], reactions: normalized };
      return next;
    };
    set((s) => {
      if (threadId) {
        const patched = patch(s.messagesByThread[threadId]);
        if (patched === s.messagesByThread[threadId]) return s;
        return { messagesByThread: { ...s.messagesByThread, [threadId]: patched! } };
      }
      const messagesByChannel = { ...s.messagesByChannel };
      let changed = false;
      for (const cid of Object.keys(messagesByChannel)) {
        const patched = patch(messagesByChannel[cid]);
        if (patched !== messagesByChannel[cid]) {
          messagesByChannel[cid] = patched!;
          changed = true;
        }
      }
      return changed ? { messagesByChannel } : s;
    });
  },

  pinMessage: async (channelId, messageId) => {
    const api = createApi();
    await api.post(`/api/channels/${channelId}/pins`, { messageId });
    set((s) => {
      const setForChannel = new Set(s.pinnedByChannel[channelId] ?? []);
      setForChannel.add(messageId);
      return { pinnedByChannel: { ...s.pinnedByChannel, [channelId]: setForChannel } };
    });
    await get().fetchPins(channelId);
  },

  unpinMessage: async (channelId, messageId) => {
    const api = createApi();
    await api.delete(`/api/channels/${channelId}/pins/${messageId}`);
    set((s) => {
      const setForChannel = new Set(s.pinnedByChannel[channelId] ?? []);
      setForChannel.delete(messageId);
      return { pinnedByChannel: { ...s.pinnedByChannel, [channelId]: setForChannel } };
    });
    await get().fetchPins(channelId);
  },

  fetchThreadMessages: async (threadId, before) => {
    try {
      const api = createApi();
      const params: Record<string, string | number> = { limit: 50 };
      if (before) params.before = before;
      const res = await api.get(`/api/threads/${threadId}/messages`, { params });
      const fetched: Message[] = normalizeFetchedReactions(res.data);
      set((s) => {
        const existing = s.messagesByThread[threadId] ?? [];
        const existingIds = new Set(existing.map((m) => m.id));
        const newMessages = fetched.filter((m) => !existingIds.has(m.id));
        return {
          messagesByThread: {
            ...s.messagesByThread,
            [threadId]: before ? [...newMessages, ...existing] : [...existing, ...newMessages],
          },
        };
      });
    } catch {
      // ignore
    }
  },

  addThreadMessage: (message) => {
    if (!message.thread_id) return;
    const threadId = message.thread_id;
    const existing = get().messagesByThread[threadId] ?? [];
    const matchIdx = findOptimisticMatchIndex(existing, message);
    if (matchIdx >= 0) {
      const matchNonce = existing[matchIdx].client_nonce ?? null;
      clearPending(matchNonce);
      set((s) => {
        const list = s.messagesByThread[threadId] ?? [];
        const idx = matchNonce
          ? list.findIndex((m) => m.client_nonce === matchNonce)
          : findOptimisticMatchIndex(list, message);
        if (idx < 0) {
          if (list.some((m) => m.id === message.id)) return s;
          return { messagesByThread: { ...s.messagesByThread, [threadId]: [...list, message] } };
        }
        const next = [...list];
        next[idx] = message;
        return { messagesByThread: { ...s.messagesByThread, [threadId]: next } };
      });
      return;
    }
    set((s) => {
      const list = s.messagesByThread[threadId] ?? [];
      if (list.some((m) => m.id === message.id)) return s;
      return {
        messagesByThread: {
          ...s.messagesByThread,
          [threadId]: [...list, message],
        },
      };
    });
  },

  clearChannel: (channelId) => {
    set((s) => {
      const { [channelId]: _, ...rest } = s.messagesByChannel;
      return { messagesByChannel: rest };
    });
  },

  reset: () => {
    clearAllPending();
    set({ messagesByChannel: {}, hasMore: {}, loadingMore: {}, pinnedByChannel: {}, pinsByChannel: {}, messagesByThread: {}, scheduledByChannel: {} });
  },

  getSnapshot: () => {
    // Never persist in-flight/failed ghosts — they have no server identity and
    // would hang forever after a restore.
    const stripGhosts = (byKey: Record<string, Message[]>): Record<string, Message[]> => {
      const out: Record<string, Message[]> = {};
      for (const [key, list] of Object.entries(byKey)) {
        out[key] = list.filter((m) => !m.status).slice(-SNAPSHOT_MESSAGES_PER_CONVERSATION);
      }
      return out;
    };
    const { messagesByChannel, messagesByThread } = get();
    return { messagesByChannel: stripGhosts(messagesByChannel), messagesByThread: stripGhosts(messagesByThread) };
  },

  loadSnapshot: (data) => {
    set({
      messagesByChannel: Object.fromEntries(
        Object.entries(data.messagesByChannel ?? {}).map(([key, list]) => [key, list.slice(-SNAPSHOT_MESSAGES_PER_CONVERSATION)])
      ),
      messagesByThread: Object.fromEntries(
        Object.entries(data.messagesByThread ?? {}).map(([key, list]) => [key, list.slice(-SNAPSHOT_MESSAGES_PER_CONVERSATION)])
      ),
      hasMore: {},
      loadingMore: {},
      pinnedByChannel: {},
      pinsByChannel: {},
      scheduledByChannel: {},
    });
  },
  };
});
