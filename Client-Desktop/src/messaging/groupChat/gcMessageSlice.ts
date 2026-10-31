import { authApi } from '../../lib/authApi';
import { useAuthStore } from '../../stores/authStore';
import type { GroupChatMessage, GroupChatReaction } from '../../types';
import { normalizeGCReactions as normalizeReactions, decryptServerMessage } from '../normalizers/groupChatNormalizers';
import { mergeAndDeduplicateMessages as mergeAndSortMessages } from '../messages/messageCacheHelpers';
import { getAuthHeader } from './gcHelpers';

export type GCMessageSlice = {
  messagesByGroupId: Record<string, GroupChatMessage[]>;
  loadingMessagesByGroupId: Record<string, boolean>;
  hasOlderByGroupId: Record<string, boolean>;
  loadMessages: (groupId: string) => Promise<void>;
  loadOlderMessages: (groupId: string) => Promise<void>;
  markAsRead: (groupId: string) => Promise<void>;
  handleIncomingMessage: (payload: any) => Promise<void>;
  handleMessageUpdate: (payload: any) => Promise<void>;
  handleMessageDelete: (payload: { groupChatId: string; messageId: string }) => void;
  handleReactionUpdate: (payload: { groupChatId: string; messageId: string; reactions: GroupChatReaction[] }) => void;
};

export function createGCMessageSlice(set: any, get: any): GCMessageSlice {
  return {
    messagesByGroupId: {}, loadingMessagesByGroupId: {}, hasOlderByGroupId: {},
  loadMessages: async (groupId: string) => {
    if (!groupId) return;
    set((s: any) => ({ loadingMessagesByGroupId: { ...s.loadingMessagesByGroupId, [groupId]: true } }));
    try {
      if (!get().groupKeysById[groupId]?.length) {
        await get().loadGroupKeys(groupId);
      }
      if (!get().groupDetailsById[groupId]) {
        await get().loadGroupDetail(groupId);
      }
      const res = await authApi.get(`/api/group-chats/${groupId}/messages`, { headers: getAuthHeader() });
      const rawMessages = Array.isArray(res.data?.messages) ? res.data.messages : [];
      const keys = get().groupKeysById[groupId];
      const detail = get().groupDetailsById[groupId];
      const messages: GroupChatMessage[] = [];
      for (const raw of rawMessages) {
        messages.push(await decryptServerMessage(raw, keys, detail?.members));
      }
      set((s: any) => ({
        messagesByGroupId: { ...s.messagesByGroupId, [groupId]: messages },
        hasOlderByGroupId: { ...s.hasOlderByGroupId, [groupId]: rawMessages.length >= 50 },
      }));
      await get().markAsRead(groupId);
    } catch (err: any) {
      set({ error: err?.response?.data?.error || 'Failed to load group messages' });
    } finally {
      set((s: any) => ({ loadingMessagesByGroupId: { ...s.loadingMessagesByGroupId, [groupId]: false } }));
    }
  },

  loadOlderMessages: async (groupId: string) => {
    const existing = get().messagesByGroupId[groupId] || [];
    const earliestCreatedAt = existing[0]?.createdAt;
    if (!earliestCreatedAt) return;
    set((s: any) => ({ loadingMessagesByGroupId: { ...s.loadingMessagesByGroupId, [groupId]: true } }));
    try {
      if (!get().groupKeysById[groupId]?.length) {
        await get().loadGroupKeys(groupId);
      }
      const res = await authApi.get(`/api/group-chats/${groupId}/messages`, {
        headers: getAuthHeader(),
        params: { limit: 50, before: earliestCreatedAt },
      });
      const rawMessages = Array.isArray(res.data?.messages) ? res.data.messages : [];
      const keys = get().groupKeysById[groupId];
      const detail = get().groupDetailsById[groupId];
      const older: GroupChatMessage[] = [];
      for (const raw of rawMessages) {
        older.push(await decryptServerMessage(raw, keys, detail?.members));
      }
      set((s: any) => ({
        messagesByGroupId: {
          ...s.messagesByGroupId,
          [groupId]: mergeAndSortMessages(s.messagesByGroupId[groupId] || [], older),
        },
        hasOlderByGroupId: { ...s.hasOlderByGroupId, [groupId]: rawMessages.length >= 50 },
      }));
    } catch (err: any) {
      set({ error: err?.response?.data?.error || 'Failed to load older messages' });
    } finally {
      set((s: any) => ({ loadingMessagesByGroupId: { ...s.loadingMessagesByGroupId, [groupId]: false } }));
    }
  },

  markAsRead: async (groupId: string) => {
    if (!groupId) return;
    try {
      await authApi.post(`/api/group-chats/${groupId}/mark-read`, {}, { headers: getAuthHeader() });
      set((s: any) => ({
        groups: s.groups.map((g: any) => (g.id === groupId ? { ...g, unreadCount: 0 } : g)),
      }));
    } catch {
      // best effort
    }
  },

  handleIncomingMessage: async (payload: any) => {
    const groupId = typeof payload?.groupChatId === 'string' ? payload.groupChatId : '';
    if (!groupId) return;
    try {
      if (!get().groupKeysById[groupId]?.length) await get().loadGroupKeys(groupId);
      const detail = get().groupDetailsById[groupId] || null;
      if (!detail) void get().loadGroupDetail(groupId);
      const msg = await decryptServerMessage(
        {
          id: payload.id,
          groupChatId: payload.groupChatId,
          senderId: payload.senderId,
          encryptedPayload: payload.encryptedPayload,
          messageType: payload.messageType,
          systemType: payload.systemType,
          systemData: payload.systemData,
          systemText: payload.systemText,
          content: payload.content,
          keyVersion: payload.keyVersion,
          attachmentUrl: payload.attachmentUrl,
          attachmentType: payload.attachmentType,
          attachmentSize: payload.attachmentSize,
          attachmentName: payload.attachmentName,
          attachments: payload.attachments,
          nsfwTags: payload.nsfwTags,
          createdAt: payload.createdAt,
        },
        get().groupKeysById[groupId],
        detail?.members,
      );
      set((s: any) => {
        const isActive = s.activeGroupId === groupId;
        const currentUserId = useAuthStore.getState().user?.id;
        const isSystemMessage = msg.messageType === 'system';
        return {
          messagesByGroupId: {
            ...s.messagesByGroupId,
            [groupId]: mergeAndSortMessages(s.messagesByGroupId[groupId] || [], [msg]),
          },
          groups: s.groups.map((g: any) => g.id === groupId
            ? {
                ...g,
                lastMessageAt: msg.createdAt,
                updatedAt: msg.createdAt,
                unreadCount: isActive ? 0 : (g.unreadCount || 0) + ((msg.senderId === currentUserId || isSystemMessage) ? 0 : 1),
              }
            : g),
        };
      });
      if (get().activeGroupId === groupId) {
        void get().markAsRead(groupId);
      }
    } catch {
      void get().loadMessages(groupId);
    }
  },

  handleMessageUpdate: async (payload: any) => {
    const groupId = typeof payload?.groupChatId === 'string' ? payload.groupChatId : '';
    if (!groupId) return;
    try {
      if (!get().groupKeysById[groupId]?.length) await get().loadGroupKeys(groupId);
      const detail = get().groupDetailsById[groupId] || null;
      const msg = await decryptServerMessage(
        {
          id: payload.id,
          groupChatId: payload.groupChatId,
          senderId: payload.senderId,
          encryptedPayload: payload.encryptedPayload,
          messageType: payload.messageType,
          systemType: payload.systemType,
          systemData: payload.systemData,
          systemText: payload.systemText,
          content: payload.content,
          keyVersion: payload.keyVersion,
          attachmentUrl: payload.attachmentUrl,
          attachmentType: payload.attachmentType,
          attachmentSize: payload.attachmentSize,
          attachmentName: payload.attachmentName,
          attachments: payload.attachments,
          nsfwTags: payload.nsfwTags,
          createdAt: payload.createdAt,
          reactions: payload.reactions,
        },
        get().groupKeysById[groupId],
        detail?.members,
      );
      set((s: any) => ({
        messagesByGroupId: {
          ...s.messagesByGroupId,
          [groupId]: mergeAndSortMessages((s.messagesByGroupId[groupId] || []).filter((m: any) => m.id !== msg.id), [msg]),
        },
      }));
    } catch {
      void get().loadMessages(groupId);
    }
  },

  handleMessageDelete: ({ groupChatId, messageId }) => {
    if (!groupChatId || !messageId) return;
    set((s: any) => ({
      messagesByGroupId: {
        ...s.messagesByGroupId,
        [groupChatId]: (s.messagesByGroupId[groupChatId] || []).filter((m: any) => m.id !== messageId),
      },
    }));
  },

  handleReactionUpdate: ({ groupChatId, messageId, reactions }) => {
    if (!groupChatId || !messageId) return;
    set((s: any) => ({
      messagesByGroupId: {
        ...s.messagesByGroupId,
        [groupChatId]: (s.messagesByGroupId[groupChatId] || []).map((m: any) => (
          m.id === messageId ? { ...m, reactions: normalizeReactions(reactions, useAuthStore.getState().user?.id) } : m
        )),
      },
    }));
  },  };
}
