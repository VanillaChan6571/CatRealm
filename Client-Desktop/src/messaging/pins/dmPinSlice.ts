import { authApi } from '../../lib/authApi';
import type { DMMessage } from '../../types';
import { decodeDmMessageText, normalizeDmMessageType, normalizeDmServerAttachments, normalizeDmNsfwTags } from '../normalizers/dmNormalizers';
import { getAuthHeader, getSyncKey } from '../dm/dmHelpers';

export interface DMPinnedEntry {
  messageId: string;
  pinnedBy: string;
  pinnedAt: number;
  message: DMMessage;
}

export interface DMPinSlice {
  dmPinsByConversation: Record<string, DMPinnedEntry[]>;
  fetchDmPins: (conversationId: string) => Promise<void>;
  pinDmMessage: (messageId: string) => Promise<void>;
  unpinDmMessage: (messageId: string) => Promise<void>;
  handleDmPinUpdate: (payload: { conversationId: string; messageId: string; pinned: boolean }) => void;
}

export function createDMPinSlice(set: any, get: any): DMPinSlice {
  return {
    dmPinsByConversation: {},

    fetchDmPins: async (conversationId: string) => {
      try {
        const res = await authApi.get(`/api/dms/conversations/${conversationId}/pins`, { headers: getAuthHeader() });
        const syncKey = getSyncKey();
        const entries: DMPinnedEntry[] = [];
        for (const pin of res.data?.pins ?? []) {
          const raw = pin.message;
          if (!raw) continue;
          let text = '';
          try {
            text = await decodeDmMessageText(raw, syncKey, conversationId);
          } catch {
            text = '(unable to decrypt)';
          }
          entries.push({
            messageId: pin.messageId,
            pinnedBy: pin.pinnedBy,
            pinnedAt: pin.pinnedAt,
            message: {
              id: raw.id,
              conversationId,
              senderId: raw.sender_id,
              recipientId: raw.recipient_id,
              text,
              messageType: normalizeDmMessageType(raw),
              attachmentUrl: raw.attachment_url ?? null,
              attachmentType: raw.attachment_type ?? null,
              attachmentSize: raw.attachment_size ?? null,
              attachmentName: raw.attachment_name ?? null,
              attachments: normalizeDmServerAttachments(raw),
              nsfwTags: normalizeDmNsfwTags(raw),
              createdAt: raw.created_at * 1000,
              delivered: true,
              read: true,
              voiceExpiresAt: raw.voice_expires_at ?? null,
              editedAt: raw.edited_at ? raw.edited_at * 1000 : null,
            },
          });
        }
        set((s: any) => ({
          dmPinsByConversation: { ...s.dmPinsByConversation, [conversationId]: entries },
        }));
      } catch (err) {
        console.error('[DM Store] Failed to fetch pins:', err);
      }
    },

    pinDmMessage: async (messageId: string) => {
      // Sync happens via the dm:pin:update broadcast (which echoes to the sender too).
      await authApi.put(`/api/dms/${messageId}/pin`, {}, { headers: getAuthHeader() });
    },

    unpinDmMessage: async (messageId: string) => {
      await authApi.delete(`/api/dms/${messageId}/pin`, { headers: getAuthHeader() });
    },

    handleDmPinUpdate: ({ conversationId, messageId, pinned }) => {
      if (pinned) {
        // Payload has no message content; refresh the conversation's pin list.
        void get().fetchDmPins(conversationId);
        return;
      }
      set((s: any) => {
        const existing = s.dmPinsByConversation[conversationId];
        if (!existing) return {};
        return {
          dmPinsByConversation: {
            ...s.dmPinsByConversation,
            [conversationId]: existing.filter((entry: DMPinnedEntry) => entry.messageId !== messageId),
          },
        };
      });
    },
  };
}
