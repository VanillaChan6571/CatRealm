import { authApi } from '../../lib/authApi';
import { useAuthStore } from '../../stores/authStore';
import type { DMConversation, DMMessage } from '../../types';
import {
  markConversationAsRead,
  saveConversation,
  saveMessage,
} from '../persistence/dmStorage';
import { getAuthHeader, localReadFloorByConversation } from '../dm/dmHelpers';
import { dismissDesktopNotifications } from '../../lib/desktopNotifications';

export type DMUnreadSlice = {
  markAsRead: (conversationId: string) => Promise<void>;
  applyUnreadSummary: (dmByConversation: Record<string, number>) => void;
  markConversationUnread: (conversationId: string, fromMessageId?: string) => Promise<void>;
};

const markAsReadInflight = new Map<string, Promise<void>>();

export function resetUnreadModuleState() {
  markAsReadInflight.clear();
}

export function createDMUnreadSlice(set: any, _get: any): DMUnreadSlice {
  return {
    markAsRead: async (conversationId: string) => {
      const conversation = _get().conversations.find((c: DMConversation) => c.id === conversationId);
      if (conversation?.requestState === 'pending' || conversation?.requestState === 'declined') return;
      const existing = markAsReadInflight.get(conversationId);
      if (existing) return existing;

      const task = (async () => {
        try {
          await authApi.post(`/api/dms/conversations/${conversationId}/mark-read`, {}, { headers: getAuthHeader() });
          try {
            await markConversationAsRead(conversationId);
          } catch (err) {
            console.error('[DM Store] Failed to persist local read state:', err);
          }
          localReadFloorByConversation.set(conversationId, Date.now());

          set((s: any) => ({
            conversations: s.conversations.map((c: DMConversation) =>
              c.id === conversationId ? { ...c, unreadCount: 0 } : c
            ),
            messagesByConversation: {
              ...s.messagesByConversation,
              [conversationId]: s.messagesByConversation[conversationId]?.map((m: DMMessage) => ({ ...m, read: true })) || [],
            },
          }));
          dismissDesktopNotifications('dm', conversationId);
        } catch (err) {
          console.error('[DM Store] Failed to mark conversation as read on server:', err);
        } finally {
          markAsReadInflight.delete(conversationId);
        }
      })();

      markAsReadInflight.set(conversationId, task);
      await task;
    },

    applyUnreadSummary: (dmByConversation: Record<string, number>) => {
      set((s: any) => ({
        conversations: s.conversations.map((conversation: DMConversation) => ({
          ...conversation,
          unreadCount: dmByConversation[conversation.id] ?? 0,
        })),
      }));
    },

    markConversationUnread: async (conversationId: string, fromMessageId?: string) => {
      localReadFloorByConversation.delete(conversationId);
      const currentUserId = useAuthStore.getState().user?.id;
      let unreadCount = 1;
      let updatedMessagesForConv: DMMessage[] | null = null;
      let updatedConversation: DMConversation | null = null;

      set((s: any) => {
        const conversation = s.conversations.find((c: DMConversation) => c.id === conversationId);
        if (!conversation) return {};

        const list: DMMessage[] = s.messagesByConversation[conversationId] || [];
        const anchorIndex = fromMessageId ? list.findIndex((m) => m.id === fromMessageId) : -1;
        const startIndex = anchorIndex >= 0 ? anchorIndex : Math.max(0, list.length - 1);

        if (list.length > 0) {
          let computedUnread = 0;
          const nextList = list.map((msg, idx) => {
            const isIncoming = !!currentUserId && msg.senderId !== currentUserId;
            const shouldUnread = isIncoming && idx >= startIndex;
            if (shouldUnread) computedUnread += 1;
            if (msg.read === !shouldUnread) return msg;
            return { ...msg, read: !shouldUnread ? true : false };
          });
          unreadCount = Math.max(1, computedUnread);
          updatedMessagesForConv = nextList;
        } else {
          unreadCount = Math.max(1, conversation.unreadCount || 0);
          updatedMessagesForConv = [];
        }

        updatedConversation = { ...conversation, unreadCount };

        return {
          conversations: s.conversations.map((c: DMConversation) => (c.id === conversationId ? updatedConversation! : c)),
          messagesByConversation: updatedMessagesForConv
            ? { ...s.messagesByConversation, [conversationId]: updatedMessagesForConv }
            : s.messagesByConversation,
        };
      });

      if (updatedConversation) {
        try {
          await saveConversation(updatedConversation);
        } catch {
          // local persistence best-effort
        }
      }

      const messagesToPersist: DMMessage[] = updatedMessagesForConv || [];
      for (const msg of messagesToPersist) {
        void saveMessage(msg);
      }
    },
  };
}
