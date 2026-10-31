import { createAuthenticatedApi } from '../../lib/authApi';
import { useAuthStore } from '../../stores/authStore';
import type { DMConversation } from '../../types';
import {
  initDMStorage,
  saveConversation,
  getAllConversations,
} from '../persistence/dmStorage';
import { getAuthHeader, isRequestAbortError } from '../dm/dmHelpers';
import { isAppInBackground } from '../../lib/desktopNotifications';

export type DMConversationSlice = {
  conversations: DMConversation[];
  activeConversationId: string | null;
  dmViewOpen: boolean;
  loading: boolean;
  error: string | null;
  initialized: boolean;

  init: () => Promise<void>;
  loadConversations: () => Promise<void>;
  respondToRequest: (otherUserId: string, decision: 'accept' | 'decline') => Promise<void>;
  openConversation: (otherUserId: string, otherUsername: string, otherAvatar?: string | null) => Promise<void>;
  setDMViewOpen: (open: boolean) => void;
  clearError: () => void;
};

let loadConversationsInflight: Promise<void> | null = null;

export function resetConversationModuleState() {
  loadConversationsInflight = null;
}

export function createDMConversationSlice(set: any, get: any): DMConversationSlice {
  return {
    conversations: [],
    activeConversationId: null,
    dmViewOpen: false,
    loading: false,
    error: null,
    initialized: false,

    init: async () => {
      if (get().initialized) return;
      const user = useAuthStore.getState().user;
      if (!user || user.accountType !== 'central') return;
      try {
        await initDMStorage(user.id);
        const localConversations = await getAllConversations();
        set({ conversations: localConversations, initialized: true });
        get().loadConversations();
      } catch (err) {
        console.error('[DM Store] Initialization failed:', err);
      }
    },

    loadConversations: async () => {
      const authState = useAuthStore.getState();
      if (authState.user?.accountType !== 'central' || !authState.token) return;
      if (loadConversationsInflight) return loadConversationsInflight;

      const task: Promise<void> = Promise.resolve().then(async () => {
        try {
          const res = await createAuthenticatedApi().get('/api/dms/conversations', { headers: getAuthHeader() });
          if (useAuthStore.getState().user?.id !== authState.user?.id) return;
          const serverConversations: DMConversation[] = res.data;
          for (const conv of serverConversations) {
            if (useAuthStore.getState().user?.id !== authState.user?.id) return;
            await saveConversation(conv);
          }
          if (useAuthStore.getState().user?.id !== authState.user?.id) return;
          const previousCounts = new Map(get().conversations.map((conversation: DMConversation) => [conversation.id, conversation.unreadCount]));
          set({ conversations: serverConversations.map((conversation) => ({
            ...conversation,
            unreadCount: previousCounts.get(conversation.id) ?? conversation.unreadCount ?? 0,
          })) });
          const { dmViewOpen, activeConversationId } = get();
          if (dmViewOpen && activeConversationId && !isAppInBackground()) {
            set((s: any) => ({
              conversations: s.conversations.map((c: DMConversation) =>
                c.id === activeConversationId ? { ...c, unreadCount: 0 } : c
              ),
            }));
          }
        } catch (err) {
          if (isRequestAbortError(err)) return;
          console.error('[DM Store] Failed to load conversations:', err);
        } finally {
          if (loadConversationsInflight === task) loadConversationsInflight = null;
        }
      });

      loadConversationsInflight = task;
      return task;
    },

    openConversation: async (otherUserId: string, otherUsername: string, otherAvatar?: string | null) => {
      const accountId = useAuthStore.getState().user?.id;
      const state = get();
      let conversation = state.conversations.find((c: DMConversation) => c.otherUserId === otherUserId);

      if (conversation && state.activeConversationId === conversation.id) {
        if (conversation.requestState !== 'pending' && !isAppInBackground()) await get().markAsRead(conversation.id);
        return;
      }

      if (!conversation) {
        try {
          const res = await createAuthenticatedApi().get(`/api/dms/${otherUserId}/messages`, { headers: getAuthHeader() });
          if (useAuthStore.getState().user?.id !== accountId) return;
          const { conversationId } = res.data;
          conversation = {
            id: conversationId,
            otherUserId,
            otherUsername,
            otherAvatar: otherAvatar || null,
            lastMessageAt: Date.now(),
            unreadCount: 0,
            requestState: res.data.requestState,
            outgoingRequestState: res.data.outgoingRequestState,
            canSend: res.data.canSend,
          };
          await saveConversation(conversation);
          if (useAuthStore.getState().user?.id !== accountId) return;
          set({ conversations: [conversation, ...get().conversations.filter((c: DMConversation) => c.id !== conversation.id)] });
        } catch (err) {
          console.error('[DM Store] Failed to open conversation:', err);
          if (useAuthStore.getState().user?.id === accountId) set({ error: 'Could not open this conversation. The user may not accept messages from you.' });
          return;
        }
      }

      set({ activeConversationId: conversation.id });
      await get().loadMessages(conversation.id);
      if (useAuthStore.getState().user?.id !== accountId) return;
      if (conversation.requestState !== 'pending' && !isAppInBackground()) await get().markAsRead(conversation.id);
    },

    respondToRequest: async (otherUserId, decision) => {
      await createAuthenticatedApi().post(`/api/dms/requests/${otherUserId}/${decision}`, {}, { headers: getAuthHeader() });
      await get().loadConversations();
    },

    setDMViewOpen: (open: boolean) => set({ dmViewOpen: open }),
    clearError: () => set({ error: null }),
  };
}
