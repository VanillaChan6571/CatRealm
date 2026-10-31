import axios from 'axios';
import { authApi } from '../../lib/authApi';
import { useAuthStore } from '../../stores/authStore';
import { encryptGroupChatMessage } from '../crypto/groupChatCrypto';
import type { GroupChatMessage } from '../../types';
import { normalizeGCReactions as normalizeReactions, normalizeGCNsfwTags as normalizeNsfwTags, normalizeGCServerAttachments as normalizeServerAttachments } from '../normalizers/groupChatNormalizers';
import { mergeAndDeduplicateMessages as mergeAndSortMessages } from '../messages/messageCacheHelpers';
import { getAuthHeader, keyMaterialForVersion } from './gcHelpers';

export type GCOperationsSlice = {
  sendingByGroupId: Record<string, boolean>;
  sendMessage: (groupId: string, text: string, attachment?: File | null, nsfwTags?: string[], scheduledAt?: number) => Promise<void>;
  toggleReaction: (groupId: string, messageId: string, emoji: string) => Promise<void>;
  editMessage: (groupId: string, messageId: string, nextText: string) => Promise<void>;
  deleteMessage: (groupId: string, messageId: string) => Promise<void>;
};

export function createGCOperationsSlice(set: any, get: any): GCOperationsSlice {
  return {
    sendingByGroupId: {},
  sendMessage: async (groupId: string, text: string, attachment?: File | null, nsfwTags?: string[], scheduledAt?: number) => {
    const trimmed = text.trim();
    const hasText = trimmed.length > 0;
    const hasAttachment = !!attachment;
    if (!groupId || (!hasText && !hasAttachment)) return;

    try {
      set((s: any) => ({
        error: null,
        sendingByGroupId: { ...s.sendingByGroupId, [groupId]: true },
      }));

      if (!get().groupDetailsById[groupId]) await get().loadGroupDetail(groupId);
      if (!get().groupKeysById[groupId]?.length) await get().loadGroupKeys(groupId);
      const group = get().groupDetailsById[groupId];
      const keys = get().groupKeysById[groupId];
      if (!group) throw new Error('Group details unavailable');
      const keyMaterial = keyMaterialForVersion(keys, group.activeKeyVersion);
      if (!keyMaterial) throw new Error(`Missing group key v${group.activeKeyVersion}`);

      const encryptedPayload = await encryptGroupChatMessage(hasText ? trimmed : '', keyMaterial);
      const res = hasAttachment
        ? await authApi.post(
            `/api/group-chats/${groupId}/messages`,
            (() => {
              const form = new FormData();
              form.append('encryptedPayload', encryptedPayload);
              form.append('keyVersion', String(group.activeKeyVersion));
              if (attachment) form.append('attachment', attachment);
              if (Array.isArray(nsfwTags) && nsfwTags.length > 0) {
                form.append('nsfwTags', JSON.stringify(nsfwTags));
              }
              if (scheduledAt != null) form.append('scheduledAt', String(scheduledAt));
              return form;
            })(),
            { headers: getAuthHeader() }
          )
        : await authApi.post(
            `/api/group-chats/${groupId}/messages`,
            { encryptedPayload, keyVersion: group.activeKeyVersion, nsfwTags: Array.isArray(nsfwTags) ? nsfwTags : [], ...(scheduledAt != null ? { scheduledAt } : {}) },
            { headers: getAuthHeader() }
          );

      const currentUser = useAuthStore.getState().user;
      const message: GroupChatMessage = {
        id: String(res.data.id),
        groupChatId: groupId,
        senderId: currentUser?.id || '',
        senderUsername: currentUser?.username || 'You',
        senderDisplayName: currentUser?.displayName ?? null,
        senderAvatar: currentUser?.avatar ?? null,
        senderIsOwner: !!group.isOwner,
        text: hasText ? trimmed : '',
        keyVersion: group.activeKeyVersion,
        attachmentUrl: res.data.attachment_url ?? null,
        attachmentType: res.data.attachment_type ?? null,
        attachmentSize: res.data.attachment_size ?? null,
        attachmentName: res.data.attachment_name ?? null,
        attachments: normalizeServerAttachments(res.data),
        nsfwTags: normalizeNsfwTags(res.data),
        reactions: normalizeReactions(res.data.reactions, useAuthStore.getState().user?.id),
        createdAt: (res.data.created_at ?? Math.floor(Date.now() / 1000)) * 1000,
        scheduledAt: res.data.scheduled_at ?? null,
      };

      if (message.scheduledAt) {
        set((s: any) => ({
          scheduledGCMessages: {
            ...s.scheduledGCMessages,
            [groupId]: [...(s.scheduledGCMessages[groupId] ?? []), message],
          },
        }));
      } else {
        set((s: any) => ({
          messagesByGroupId: {
            ...s.messagesByGroupId,
            [groupId]: mergeAndSortMessages(s.messagesByGroupId[groupId] || [], [message]),
          },
          groups: s.groups.map((g: any) => (g.id === groupId ? { ...g, lastMessageAt: message.createdAt, updatedAt: message.createdAt } : g)),
        }));
      }
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.status === 409) {
        await Promise.all([get().loadGroupDetail(groupId), get().loadGroupKeys(groupId)]);
      }
      const msg = axios.isAxiosError(err) ? err.response?.data?.error : (err instanceof Error ? err.message : 'Failed to send message');
      set({ error: msg || 'Failed to send message' });
    } finally {
      set((s: any) => ({ sendingByGroupId: { ...s.sendingByGroupId, [groupId]: false } }));
    }
  },

  toggleReaction: async (groupId: string, messageId: string, emoji: string) => {
    if (!groupId || !messageId || !emoji.trim()) return;
    try {
      set({ error: null });
      await authApi.post(
        `/api/group-chats/${groupId}/messages/${messageId}/reactions`,
        { emoji: emoji.trim() },
        { headers: getAuthHeader() }
      );
    } catch (err: any) {
      set({ error: err?.response?.data?.error || 'Failed to toggle reaction' });
    }
  },

  editMessage: async (groupId: string, messageId: string, nextText: string) => {
    const trimmed = nextText.trim();
    if (!groupId || !messageId || !trimmed) return;

    try {
      set({ error: null });
      if (!get().groupDetailsById[groupId]) await get().loadGroupDetail(groupId);
      if (!get().groupKeysById[groupId]?.length) await get().loadGroupKeys(groupId);
      const detail = get().groupDetailsById[groupId];
      const keys = get().groupKeysById[groupId];
      if (!detail) throw new Error('Group details unavailable');
      const keyMaterial = keyMaterialForVersion(keys, detail.activeKeyVersion);
      if (!keyMaterial) throw new Error(`Missing group key v${detail.activeKeyVersion}`);
      const encryptedPayload = await encryptGroupChatMessage(trimmed, keyMaterial);
      await authApi.patch(
        `/api/group-chats/${groupId}/messages/${messageId}`,
        { encryptedPayload, keyVersion: detail.activeKeyVersion },
        { headers: getAuthHeader() }
      );
    } catch (err: any) {
      set({ error: err?.response?.data?.error || err?.message || 'Failed to edit message' });
    }
  },

  deleteMessage: async (groupId: string, messageId: string) => {
    if (!groupId || !messageId) return;
    try {
      set({ error: null });
      await authApi.delete(`/api/group-chats/${groupId}/messages/${messageId}`, { headers: getAuthHeader() });
    } catch (err: any) {
      set({ error: err?.response?.data?.error || 'Failed to delete message' });
    }
  },

  };
}
