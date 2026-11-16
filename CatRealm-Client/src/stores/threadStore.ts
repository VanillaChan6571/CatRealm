import { create } from 'zustand';
import type { Thread, ForumPost, Message } from '../types';
import { createApi } from '../lib/api';
import { getSocket } from '../lib/socket';

const EMPTY_FORUM_POSTS: ForumPost[] = [];

interface ThreadState {
  threadsByChannel: Record<string, Thread[]>;
  activeThreadId: string | null;
  activeThread: Thread | null;
  forumPostsByChannel: Record<string, ForumPost[]>;

  /** The message a thread is about to be started from; shows the create-thread dialog. */
  threadDraftSource: Message | null;
  startThreadDraft: (message: Message) => void;
  cancelThreadDraft: () => void;

  fetchThreads: (channelId: string) => Promise<void>;
  createThread: (channelId: string, messageId: string, name?: string, firstMessage?: string) => Promise<Thread>;
  /** Live updates from the realm: a thread was created or renamed, or deleted. */
  applyThread: (thread: Thread) => void;
  removeThread: (channelId: string, threadId: string) => void;
  renameThread: (threadId: string, name: string) => Promise<Thread>;
  deleteThread: (threadId: string) => Promise<void>;
  setActiveThread: (thread: Thread | null) => void;
  fetchForumPosts: (channelId: string) => Promise<void>;
  createForumPost: (channelId: string, title: string, body: string, coverImage?: string | null, attachments?: Array<{ url: string; mime?: string | null; size?: number | null }>) => Promise<ForumPost>;
  addForumPost: (post: ForumPost) => void;
  /** A thread or forum post got a message: refresh its reply count and last-activity time. */
  noteThreadActivity: (channelId: string, threadId: string, lastMessageAt: number, replyCount: number) => void;
  /**
   * Adds a thread that just got a message to its channel's loaded list if it is missing:
   * an empty thread only its creator could see, or one that had auto-hidden.
   */
  revealThread: (channelId: string, threadId: string, replyCount: number) => Promise<void>;
  removeForumPost: (channelId: string, postId: string) => void;
  reset: () => void;
  getSnapshot: () => Pick<ThreadState, 'threadsByChannel'>;
  loadSnapshot: (data: ReturnType<ThreadState['getSnapshot']>) => void;
}

export const useThreadStore = create<ThreadState>((set, get) => ({
  threadsByChannel: {},
  activeThreadId: null,
  activeThread: null,
  forumPostsByChannel: {},
  threadDraftSource: null,

  startThreadDraft: (message) => set({ threadDraftSource: message }),
  cancelThreadDraft: () => set({ threadDraftSource: null }),

  applyThread: (thread) => {
    set((s) => {
      const existing = s.threadsByChannel[thread.channel_id];
      const list = Array.isArray(existing) ? existing : [];
      const known = list.some((t) => t.id === thread.id);
      return {
        threadsByChannel: {
          ...s.threadsByChannel,
          [thread.channel_id]: known ? list.map((t) => (t.id === thread.id ? { ...t, ...thread } : t)) : [thread, ...list],
        },
        activeThread: s.activeThread?.id === thread.id ? { ...s.activeThread, ...thread } : s.activeThread,
      };
    });
  },

  removeThread: (channelId, threadId) => {
    set((s) => {
      const existing = s.threadsByChannel[channelId];
      return {
        threadsByChannel: Array.isArray(existing)
          ? { ...s.threadsByChannel, [channelId]: existing.filter((t) => t.id !== threadId) }
          : s.threadsByChannel,
        activeThreadId: s.activeThreadId === threadId ? null : s.activeThreadId,
        activeThread: s.activeThread?.id === threadId ? null : s.activeThread,
      };
    });
  },

  fetchThreads: async (channelId) => {
    const api = createApi();
    const res = await api.get('/api/threads', { params: { channelId } });
    const threads = Array.isArray(res.data) ? res.data : [];
    set((s) => ({
      threadsByChannel: { ...s.threadsByChannel, [channelId]: threads },
    }));
  },

  createThread: async (channelId, messageId, name, firstMessage) => {
    const api = createApi();
    const res = await api.post('/api/threads', { channelId, messageId, name, ...(firstMessage ? { firstMessage } : {}) });
    const thread: Thread = res.data;
    // The realm also announces the thread over the socket; whichever arrives first adds it.
    get().applyThread(thread);
    set({ activeThreadId: thread.id, activeThread: thread });
    const socket = getSocket();
    if (socket) socket.emit('thread:join', thread.id);
    return thread;
  },

  renameThread: async (threadId, name) => {
    const api = createApi();
    const res = await api.patch(`/api/threads/${threadId}`, { name });
    const updated: Thread = res.data;
    set((s) => ({
      threadsByChannel: {
        ...s.threadsByChannel,
        [updated.channel_id]: (Array.isArray(s.threadsByChannel[updated.channel_id]) ? s.threadsByChannel[updated.channel_id] : []).map((t) =>
          t.id === updated.id ? updated : t
        ),
      },
      activeThread: s.activeThread?.id === updated.id ? updated : s.activeThread,
    }));
    return updated;
  },

  deleteThread: async (threadId) => {
    const api = createApi();
    await api.delete(`/api/threads/${threadId}`);
    // The thread may not be the open one (deleted from the sidebar), so look in every channel.
    for (const [channelId, threads] of Object.entries(get().threadsByChannel)) {
      if (Array.isArray(threads) && threads.some((t) => t.id === threadId)) get().removeThread(channelId, threadId);
    }
    set((s) => ({
      activeThreadId: s.activeThreadId === threadId ? null : s.activeThreadId,
      activeThread: s.activeThread?.id === threadId ? null : s.activeThread,
    }));
  },

  setActiveThread: (thread) => {
    set({ activeThreadId: thread?.id ?? null, activeThread: thread ?? null });
    const socket = getSocket();
    if (socket && thread) socket.emit('thread:join', thread.id);
  },

  fetchForumPosts: async (channelId) => {
    const api = createApi();
    const res = await api.get('/api/threads/forum', { params: { channelId, archived: 1 } });
    const data = Array.isArray(res.data) ? res.data : EMPTY_FORUM_POSTS;
    set((s) => ({
      forumPostsByChannel: { ...s.forumPostsByChannel, [channelId]: data },
    }));
  },

  createForumPost: async (channelId, title, body, coverImage, attachments) => {
    const api = createApi();
    // Step 1: create the body message (returns the message with id)
    const msgRes = await api.post('/api/messages/forum', { channelId, content: body, attachments: attachments ?? [] });
    const msg = msgRes.data;
    // Step 2: create the thread referencing that message
    const threadRes = await api.post('/api/threads', { channelId, messageId: msg.id, name: title, coverImage: coverImage ?? null });
    const thread: Thread = threadRes.data;
    const forumPost: ForumPost = {
      id: thread.id,
      channel_id: thread.channel_id,
      parent_message_id: thread.parent_message_id,
      name: thread.name,
      created_by: thread.created_by,
      created_at: thread.created_at,
      archived: null,
      last_message_at: null,
      author_username: msg.username,
      author_avatar: msg.avatar ?? null,
      author_account_type: (msg.account_type as 'local' | 'central') ?? 'local',
      author_display_name: msg.display_name ?? null,
      preview_content: body,
      reply_count: 0,
      cover_image: coverImage ?? null,
      body_attachments: attachments ?? null,
    };
    set((s) => ({
      forumPostsByChannel: {
        ...s.forumPostsByChannel,
        [channelId]: [forumPost, ...(s.forumPostsByChannel[channelId] ?? EMPTY_FORUM_POSTS)],
      },
    }));
    return forumPost;
  },

  addForumPost: (post) => {
    set((s) => {
      const existing = s.forumPostsByChannel[post.channel_id];
      if (!Array.isArray(existing)) return s;
      // Deduplicate: ignore if already present
      if (existing.some((p) => p.id === post.id)) return s;
      return {
        forumPostsByChannel: {
          ...s.forumPostsByChannel,
          [post.channel_id]: [post, ...existing],
        },
      };
    });
  },

  revealThread: async (channelId, threadId, replyCount) => {
    const loaded = get().threadsByChannel[channelId];
    // An unloaded list will include the thread when it is fetched.
    if (!Array.isArray(loaded) || loaded.some((t) => t.id === threadId)) return;
    try {
      const res = await createApi().get<Thread>(`/api/threads/${threadId}`);
      get().applyThread({ ...res.data, reply_count: replyCount });
    } catch { /* deleted meanwhile, or no longer readable */ }
  },

  noteThreadActivity: (channelId, threadId, lastMessageAt, replyCount) => {
    set((s) => {
      const threads = s.threadsByChannel[channelId];
      if (Array.isArray(threads) && threads.some((t) => t.id === threadId)) {
        return {
          threadsByChannel: {
            ...s.threadsByChannel,
            [channelId]: threads.map((t) => (t.id === threadId ? { ...t, reply_count: replyCount } : t)),
          },
        };
      }
      const existing = s.forumPostsByChannel[channelId];
      if (!Array.isArray(existing) || !existing.some((p) => p.id === threadId)) return s;
      return {
        forumPostsByChannel: {
          ...s.forumPostsByChannel,
          [channelId]: existing.map((p) => (p.id === threadId
            ? { ...p, last_message_at: Math.max(lastMessageAt, p.last_message_at ?? 0), reply_count: replyCount }
            : p)),
        },
      };
    });
  },

  removeForumPost: (channelId, postId) => {
    set((s) => {
      const existing = s.forumPostsByChannel[channelId];
      if (!Array.isArray(existing)) return s;
      return {
        forumPostsByChannel: {
          ...s.forumPostsByChannel,
          [channelId]: existing.filter((p) => p.id !== postId),
        },
      };
    });
  },

  reset: () => set({ threadsByChannel: {}, activeThreadId: null, activeThread: null, forumPostsByChannel: {} }),

  getSnapshot: () => {
    const { threadsByChannel } = get();
    return { threadsByChannel };
  },

  loadSnapshot: (data) => {
    set({ threadsByChannel: data.threadsByChannel, activeThreadId: null, activeThread: null });
  },
}));
