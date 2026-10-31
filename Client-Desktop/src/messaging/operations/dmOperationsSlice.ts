import axios from 'axios';
import { authApi } from '../../lib/authApi';
import { useAuthStore } from '../../stores/authStore';
import type { DMConversation, DMMessage, DMReaction } from '../../types';
import { saveMessage, saveConversation } from '../persistence/dmStorage';
import { getConversationSecretForSend, fetchDMKeyManifest } from '../crypto/dmKeyStore';
import { encryptDMV2 } from '../crypto/dmCrypto';
import { encryptNotificationPreviewForDevice } from '../crypto/notificationPreviewCrypto';
import { dmContextPreviewText } from '../../lib/dmContext';
import {
  normalizeDmReactions,
  normalizeDmServerAttachments as normalizeServerAttachments,
  normalizeDmNsfwTags as normalizeNsfwTags,
} from '../normalizers/dmNormalizers';
import { getAuthHeader, getSyncKey } from '../dm/dmHelpers';

function formatNotificationSenderName(user: { username?: string | null; displayName?: string | null }) {
  const username = (user.username ?? '').trim();
  const displayName = (user.displayName ?? '').trim();
  if (displayName && username && displayName.toLowerCase() !== username.toLowerCase()) {
    return `${displayName} - @${username}`;
  }
  return username ? `@${username}` : 'New message';
}

export type DMOperationsSlice = {
  sendMessage: (otherUserId: string, text: string, attachments?: File[] | File | null, nsfwTags?: string[], voiceExpiresAt?: number | null, scheduledAt?: number | null) => Promise<void>;
  toggleReaction: (messageId: string, emoji: string) => Promise<void>;
  applyReactionUpdate: (messageId: string, reactions: DMReaction[]) => void;
  editMessage: (messageId: string, nextText: string) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
};

export function createDMOperationsSlice(set: any, get: any): DMOperationsSlice {
  return {
    sendMessage: async (otherUserId, text, attachments, nsfwTags, voiceExpiresAt, scheduledAt) => {
      const filesArray: File[] = !attachments ? [] : Array.isArray(attachments) ? attachments : [attachments];
      const hasText = text.trim().length > 0;
      const hasAttachment = filesArray.length > 0;
      if (!hasText && !hasAttachment) return;

      const state = get();
      const conversation = state.conversations.find((c: DMConversation) => c.otherUserId === otherUserId);
      if (!conversation) { console.error('[DM Store] Conversation not found'); return; }

      const user = useAuthStore.getState().user;
      const syncKey = getSyncKey();
      if (!user || !syncKey) { console.error('[DM Store] User or sync key not available'); return; }

      set({ loading: true, error: null });

      try {
        const provisioned = await getConversationSecretForSend(conversation.id);
        if (!provisioned) throw new Error('Secure messaging is not ready. Both participants need an approved device before sending.');
        const encryptedPayload = await encryptDMV2(hasText ? text : '', provisioned.secret, conversation.id, provisioned.keyVersion);

        const manifest = await fetchDMKeyManifest(conversation.id);
        const previewTargets = manifest.devices.filter((device) =>
          device.userId === otherUserId && device.dmTrustState === 'trusted' && device.pushCapable && device.notificationPublicKey
        );
        // Replies carry a [[crdmctx:…]] envelope; previews show only the reply's own text.
        const previewText = dmContextPreviewText(hasText ? text : '');
        const previewSenderName = formatNotificationSenderName(user);
        const notificationPreviewEnvelopes = (await Promise.all(previewTargets.map((device) =>
          encryptNotificationPreviewForDevice(device, {
            type: 'dm_message',
            conversationId: conversation.id,
            senderId: user.id,
            senderDisplayName: previewSenderName,
            preview: previewText,
            createdAt: Math.floor(Date.now() / 1000),
          })
        ))).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

        const res = hasAttachment
          ? await authApi.post(
              `/api/dms/${otherUserId}/send`,
              (() => {
                const formData = new FormData();
                formData.append('encryptedPayload', encryptedPayload);
                formData.append('notificationPreviewEnvelopes', JSON.stringify(notificationPreviewEnvelopes));
                for (const f of filesArray) formData.append('attachment', f);
                if (Array.isArray(nsfwTags) && nsfwTags.length > 0) formData.append('nsfwTags', JSON.stringify(nsfwTags));
                if (voiceExpiresAt != null) formData.append('voiceExpiresAt', String(voiceExpiresAt));
                if (scheduledAt != null) formData.append('scheduledAt', String(scheduledAt));
                return formData;
              })(),
              { headers: getAuthHeader() }
            )
          : await authApi.post(
              `/api/dms/${otherUserId}/send`,
              { encryptedPayload, notificationPreviewEnvelopes, nsfwTags: Array.isArray(nsfwTags) ? nsfwTags : [], voiceExpiresAt: voiceExpiresAt ?? null, scheduledAt: scheduledAt ?? null },
              { headers: getAuthHeader() }
            );

        const serverMessage = res.data;

        if (serverMessage.scheduled_at) {
          const scheduledMsg: DMMessage = {
            id: serverMessage.id, conversationId: conversation.id,
            senderId: user.id, recipientId: otherUserId,
            text: hasText ? text : '',
            attachmentUrl: serverMessage.attachment_url ?? null,
            attachmentType: serverMessage.attachment_type ?? null,
            attachmentSize: serverMessage.attachment_size ?? null,
            attachmentName: serverMessage.attachment_name ?? null,
            attachments: normalizeServerAttachments(serverMessage),
            nsfwTags: normalizeNsfwTags(serverMessage),
            reactions: [], createdAt: serverMessage.created_at * 1000,
            delivered: false, read: true,
            voiceExpiresAt: serverMessage.voice_expires_at ?? null,
            scheduledAt: serverMessage.scheduled_at,
          };
          set((s: any) => ({
            loading: false,
            scheduledDMs: {
              ...s.scheduledDMs,
              [conversation.id]: [...(s.scheduledDMs[conversation.id] ?? []), scheduledMsg],
            },
          }));
          return;
        }

        const dmMessage: DMMessage = {
          id: serverMessage.id, conversationId: conversation.id,
          senderId: user.id, recipientId: otherUserId,
          text: hasText ? text : '',
          attachmentUrl: serverMessage.attachment_url ?? null,
          attachmentType: serverMessage.attachment_type ?? null,
          attachmentSize: serverMessage.attachment_size ?? null,
          attachmentName: serverMessage.attachment_name ?? null,
          attachments: normalizeServerAttachments(serverMessage),
          nsfwTags: normalizeNsfwTags(serverMessage),
          reactions: normalizeDmReactions(serverMessage.reactions, user.id),
          createdAt: serverMessage.created_at * 1000,
          delivered: false, read: true,
          voiceExpiresAt: serverMessage.voice_expires_at ?? null,
        };

        await saveMessage(dmMessage);

        set((s: any) => {
          const existing = s.messagesByConversation[conversation.id] || [];
          if (existing.some((m: DMMessage) => m.id === dmMessage.id)) return { loading: false };
          return {
            loading: false,
            messagesByConversation: {
              ...s.messagesByConversation,
              [conversation.id]: [...existing, dmMessage],
            },
          };
        });

        const latestConversation = get().conversations.find((c: DMConversation) => c.id === conversation.id) || conversation;
        const updatedConversation = { ...latestConversation, lastMessageAt: dmMessage.createdAt,
          ...(serverMessage.requestState ? {
            requestState: serverMessage.requestState,
            outgoingRequestState: serverMessage.outgoingRequestState,
            canSend: serverMessage.canSend,
          } : {}),
        };
        await saveConversation(updatedConversation);
        set((s: any) => ({
          conversations: s.conversations.map((c: DMConversation) =>
            c.id === conversation.id ? updatedConversation : c
          ),
        }));
      } catch (err: unknown) {
        set({ loading: false });
        if (axios.isAxiosError(err)) {
          if (err.response?.status === 413) throw new Error('Attachment too large. Maximum is 50 MB per file.');
          throw new Error(err.response?.data?.error || 'Failed to send message');
        }
        throw err;
      }
    },

    toggleReaction: async (messageId, emoji) => {
      try {
        const res = await authApi.post(`/api/dms/${messageId}/reactions`, { emoji }, { headers: getAuthHeader() });
        const currentUserId = useAuthStore.getState().user?.id;
        const reactions = normalizeDmReactions(res.data?.reactions, currentUserId);
        get().applyReactionUpdate(messageId, reactions);
      } catch (err) {
        console.error('[DM Store] Failed to toggle reaction:', err);
      }
    },

    applyReactionUpdate: (messageId, reactions) => {
      const normalized = normalizeDmReactions(reactions, useAuthStore.getState().user?.id);
      set((s: any) => {
        const next = { ...s.messagesByConversation };
        let found = false;
        for (const convId of Object.keys(next)) {
          const list = next[convId];
          const idx = list.findIndex((m: DMMessage) => m.id === messageId);
          if (idx === -1) continue;
          const updated = [...list];
          updated[idx] = { ...updated[idx], reactions: normalized };
          next[convId] = updated;
          saveMessage(updated[idx]);
          found = true;
          break;
        }
        if (!found) return {};
        return { messagesByConversation: next };
      });
    },

    editMessage: async (messageId, nextText) => {
      const trimmed = nextText.trim();
      if (!trimmed) return;

      let targetMessage: DMMessage | null = null;
      for (const convId of Object.keys(get().messagesByConversation)) {
        const found = get().messagesByConversation[convId].find((m: DMMessage) => m.id === messageId);
        if (found) { targetMessage = found; break; }
      }
      if (!targetMessage) return;

      const syncKey = getSyncKey();
      if (!syncKey) { console.error('[DM Store] No sync key available'); return; }

      try {
        const provisioned = await getConversationSecretForSend(targetMessage.conversationId);
        if (!provisioned) throw new Error('Secure messaging is not ready. Both participants need an approved device before editing.');
        const encryptedPayload = await encryptDMV2(trimmed, provisioned.secret, targetMessage.conversationId, provisioned.keyVersion);
        await authApi.patch(`/api/dms/${messageId}`, { encryptedPayload }, { headers: getAuthHeader() });
        set((s: any) => {
          const next = { ...s.messagesByConversation };
          for (const convId of Object.keys(next)) {
            const idx = next[convId].findIndex((m: DMMessage) => m.id === messageId);
            if (idx === -1) continue;
            const updatedList = [...next[convId]];
            const updatedMessage = { ...updatedList[idx], text: trimmed };
            updatedList[idx] = updatedMessage;
            next[convId] = updatedList;
            saveMessage(updatedMessage);
            break;
          }
          return { messagesByConversation: next };
        });
      } catch (err) {
        console.error('[DM Store] Failed to edit message:', err);
        throw err;
      }
    },

    deleteMessage: async (messageId) => {
      try {
        await authApi.delete(`/api/dms/${messageId}`, { headers: getAuthHeader() });
        get().removeMessageLocal(messageId);
      } catch (err) {
        console.error('[DM Store] Failed to delete message:', err);
      }
    },
  };
}
