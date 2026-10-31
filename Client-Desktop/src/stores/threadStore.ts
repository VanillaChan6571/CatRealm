import { create } from 'zustand';
import type { Thread, ForumPost } from '../types';
import { createApi } from '../lib/api';
import { getSocket } from '../lib/socket';

const EMPTY_FORUM_POSTS: ForumPost[] = [];

interface ThreadState {
  threadsByChannel: Record<string, Thread[]>;
  activeThreadId: string | null;
  activeThread: Thread | null;
  forumPostsByChannel: Record<string, ForumPost[]>;

  fetchThreads: (channelId: string) => Promise<void>;
  createThread: (channelId: string, messageId: string, name?: string) => Promise<Thread>;
  renameThread: (threadId: string, name: string) => Promise<Thread>;
  deleteThread: (threadId: string) => Promise<void>;
  setActiveThread: (thread: Thread | null) => void;
  fetchForumPosts: (channelId: string) => Promise<void>;
  createForumPost: (channelId: string, title: string, body: string, coverImage?: string | null, attachments?: Array<{ url: string; mime?: string | null; size?: number | null }>) => Promise<ForumPost>;
  addForumPost: (post: ForumPost) => void;
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

  fetchThreads: async (channelId) => {
    const api = createApi();
    const res = await api.get('/api/threads', { params: { channelId } });
    const threads = Array.isArray(res.data) ? res.data : [];
    set((s) => ({
      threadsByChannel: { ...s.threadsByChannel, [channelId]: threads },
    }));
  },

  createThread: async (channelId, messageId, name) => {
    const api = createApi();
    const res = await api.post('/api/threads', { channelId, messageId, name });
    const thread: Thread = res.data;
    set((s) => ({
      threadsByChannel: {
        ...s.threadsByChannel,
        [channelId]: [thread, ...(Array.isArray(s.threadsByChannel[channelId]) ? s.threadsByChannel[channelId] : [])],
      },
      activeThreadId: thread.id,
      activeThread: thread,
    }));
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
    set((s) => {
      const channelId = s.activeThread?.channel_id;
      const updated = { ...s.threadsByChannel };
      if (channelId) {
        updated[channelId] = (Array.isArray(updated[channelId]) ? updated[channelId] : []).filter((t) => t.id !== threadId);
      }
      return {
        threadsByChannel: updated,
        activeThreadId: s.activeThreadId === threadId ? null : s.activeThreadId,
        activeThread: s.activeThread?.id === threadId ? null : s.activeThread,
      };
    });
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
