import { authApi } from '../../lib/authApi';
import { useAuthStore } from '../../stores/authStore';
import type { DMConversation, DMMessage } from '../../types';
import { isAppInBackground } from '../../lib/desktopNotifications';
import {
  saveMessage,
  getMessagesByConversation,
  deleteMessage as deleteMessageFromStorage,
} from '../persistence/dmStorage';
import { fetchDMKeyManifest, getLocalConversationSecret, syncTrustedDeviceKeysForConversation } from '../crypto/dmKeyStore';
import {
  normalizeDmReactions,
  normalizeDmMessageType,
  normalizeDmSystemType,
  normalizeDmSystemData,
  normalizeDmServerAttachments as normalizeServerAttachments,
  normalizeDmNsfwTags as normalizeNsfwTags,
  decodeDmMessageText,
} from '../normalizers/dmNormalizers';
import { getAuthHeader, getSyncKey, localReadFloorByConversation } from '../dm/dmHelpers';

export type DMMessageSlice = {
  messagesByConversation: Record<string, DMMessage[]>;
  hasOlderByConversation: Record<string, boolean>;
  loadingOlderByConversation: Record<string, boolean>;
  loadingMessagesByConversation: Record<string, boolean>;
  unavailableMessagesByConversation: Record<string, number>;
  oldestFetchedAtByConversation: Record<string, number>;

  loadMessages: (conversationId: string) => Promise<void>;
  loadOlderMessages: (conversationId: string) => Promise<void>;
  handleIncomingMessage: (msg: any) => Promise<void>;
  handleDeliveryAck: (messageId: string) => void;
  handleMessageUpdate: (msg: any) => Promise<void>;
  removeMessageLocal: (messageId: string) => void;
};

const loadMessagesInflight = new Map<string, Promise<void>>();

function v2KeyVersion(raw: any): number | null {
  const encryptedPayload = raw?.encrypted_payload ?? raw?.encryptedPayload;
  if (typeof encryptedPayload !== 'string') return null;
  try {
    const payload = JSON.parse(encryptedPayload);
    return payload?.v === 2 && Number.isInteger(payload.kid) ? payload.kid : null;
  } catch {
    return null;
  }
}

function isMissingKeyError(error: unknown): boolean {
  if (error instanceof Error && error.message === 'No v2 DM key available for this device') return true;
  return typeof (error as { response?: { status?: unknown } })?.response?.status === 'number';
}

export function resetMessageModuleState() {
  loadMessagesInflight.clear();
}

export function createDMMessageSlice(set: any, get: any): DMMessageSlice {
  return {
    messagesByConversation: {},
    hasOlderByConversation: {},
    loadingOlderByConversation: {},
    loadingMessagesByConversation: {},
    unavailableMessagesByConversation: {},
    oldestFetchedAtByConversation: {},

    loadMessages: async (conversationId: string) => {
      const existing = loadMessagesInflight.get(conversationId);
      if (existing) return existing;

      const task = (async () => {
        set((s: any) => ({
          loadingMessagesByConversation: { ...s.loadingMessagesByConversation, [conversationId]: true },
        }));
        try {
          const localMessages = await getMessagesByConversation(conversationId, 50);
          void (async () => {
            const manifest = await fetchDMKeyManifest(conversationId);
            if (manifest.activeKeyVersion != null) {
              const secret = getLocalConversationSecret(conversationId, manifest.activeKeyVersion);
              if (secret) await syncTrustedDeviceKeysForConversation(conversationId, manifest.activeKeyVersion, secret);
            }
          })().catch(() => {});
          set((s: any) => ({
            messagesByConversation: { ...s.messagesByConversation, [conversationId]: localMessages },
            hasOlderByConversation: { ...s.hasOlderByConversation, [conversationId]: true },
          }));

          const conversation = get().conversations.find((c: DMConversation) => c.id === conversationId);
          if (!conversation) return;

          const res = await authApi.get(`/api/dms/${conversation.otherUserId}/messages`, { headers: getAuthHeader() });
          const { messages, conversationId: serverConvId } = res.data;
          const currentUserId = useAuthStore.getState().user?.id;
          const syncKey = getSyncKey();
          if (!syncKey) { console.error('[DM Store] No sync key available'); return; }

          const decryptedMessages: DMMessage[] = [];
          const unavailableKeyVersions = new Set<number>();
          let unavailableMessages = 0;
          for (const msg of messages) {
            const keyVersion = v2KeyVersion(msg);
            if (keyVersion !== null && unavailableKeyVersions.has(keyVersion)) {
              unavailableMessages++;
              continue;
            }
            try {
              const text = await decodeDmMessageText(msg, syncKey, serverConvId);
              const dmMessage: DMMessage = {
                id: msg.id,
                conversationId: serverConvId,
                senderId: msg.sender_id,
                recipientId: msg.recipient_id,
                text,
                messageType: normalizeDmMessageType(msg),
                systemType: normalizeDmSystemType(msg),
                systemData: normalizeDmSystemData(msg),
                attachmentUrl: msg.attachment_url ?? null,
                attachmentType: msg.attachment_type ?? null,
                attachmentSize: msg.attachment_size ?? null,
                attachmentName: msg.attachment_name ?? null,
                attachments: normalizeServerAttachments(msg),
                nsfwTags: normalizeNsfwTags(msg),
                reactions: normalizeDmReactions(msg.reactions, currentUserId),
                createdAt: msg.created_at * 1000,
                delivered: msg.delivered,
                read: false,
                voiceExpiresAt: msg.voice_expires_at ?? null,
                editedAt: msg.edited_at ? msg.edited_at * 1000 : null,
              };
              await saveMessage(dmMessage);
              decryptedMessages.push(dmMessage);
            } catch (err) {
              if (keyVersion !== null && isMissingKeyError(err)) {
                unavailableKeyVersions.add(keyVersion);
                unavailableMessages++;
              } else {
                console.error('[DM Store] Failed to decrypt message:', err);
              }
            }
          }

          set((s: any) => ({
            messagesByConversation: { ...s.messagesByConversation, [serverConvId]: decryptedMessages },
            hasOlderByConversation: {
              ...s.hasOlderByConversation,
              [serverConvId]: Array.isArray(messages) && messages.length >= 50,
            },
            unavailableMessagesByConversation: {
              ...s.unavailableMessagesByConversation,
              [serverConvId]: unavailableMessages,
            },
            oldestFetchedAtByConversation: {
              ...s.oldestFetchedAtByConversation,
              ...(messages.length > 0 ? { [serverConvId]: messages[0].created_at * 1000 } : {}),
            },
          }));

          void import('../notifications/notificationStore').then(({ useNotificationStore }) =>
            useNotificationStore.getState().hydrateDmPreviews()
          );

          // A message that this device cannot decrypt still exists on the
          // server. Do not purge a cached copy as though it were deleted.
          const serverIds = new Set(messages.map((m: { id: string }) => m.id));
          const gotAll = messages.length < 50;
          const oldestServerTs = messages.length > 0 ? messages[0].created_at * 1000 : Infinity;
          const stale = localMessages.filter((m: DMMessage) => {
            if (serverIds.has(m.id)) return false;
            return gotAll || m.createdAt >= oldestServerTs;
          });
          if (stale.length > 0) await Promise.all(stale.map((m: DMMessage) => deleteMessageFromStorage(m.id)));
        } catch (err) {
          console.error('[DM Store] Failed to load messages:', err);
        } finally {
          set((s: any) => ({
            loadingMessagesByConversation: { ...s.loadingMessagesByConversation, [conversationId]: false },
          }));
          loadMessagesInflight.delete(conversationId);
        }
      })();

      loadMessagesInflight.set(conversationId, task);
      return task;
    },

    loadOlderMessages: async (conversationId: string) => {
      const state = get();
      if (state.loadingOlderByConversation[conversationId]) return;
      if (state.hasOlderByConversation[conversationId] === false) return;

      const currentList = state.messagesByConversation[conversationId] || [];
      const earliestCreatedAt = state.oldestFetchedAtByConversation[conversationId] ?? currentList[0]?.createdAt;
      const conversation = state.conversations.find((c: DMConversation) => c.id === conversationId);
      if (!conversation) return;

      set((s: any) => ({
        loadingOlderByConversation: { ...s.loadingOlderByConversation, [conversationId]: true },
      }));

      try {
        const res = await authApi.get(`/api/dms/${conversation.otherUserId}/messages`, {
          headers: getAuthHeader(),
          params: { limit: 50, ...(typeof earliestCreatedAt === 'number' ? { before: earliestCreatedAt } : {}) },
        });
        const { messages, conversationId: serverConvId } = res.data;
        const currentUserId = useAuthStore.getState().user?.id;
        const syncKey = getSyncKey();
        if (!syncKey) { console.error('[DM Store] No sync key available'); return; }

        const olderMessages: DMMessage[] = [];
        const unavailableKeyVersions = new Set<number>();
        let unavailableMessages = 0;
        for (const msg of messages) {
          const keyVersion = v2KeyVersion(msg);
          if (keyVersion !== null && unavailableKeyVersions.has(keyVersion)) {
            unavailableMessages++;
            continue;
          }
          try {
            const text = await decodeDmMessageText(msg, syncKey, serverConvId);
            const dmMessage: DMMessage = {
              id: msg.id, conversationId: serverConvId,
              senderId: msg.sender_id, recipientId: msg.recipient_id,
              text, messageType: normalizeDmMessageType(msg),
              systemType: normalizeDmSystemType(msg), systemData: normalizeDmSystemData(msg),
              attachmentUrl: msg.attachment_url ?? null, attachmentType: msg.attachment_type ?? null,
              attachmentSize: msg.attachment_size ?? null, attachmentName: msg.attachment_name ?? null,
              attachments: normalizeServerAttachments(msg), nsfwTags: normalizeNsfwTags(msg),
              reactions: normalizeDmReactions(msg.reactions, currentUserId),
              createdAt: msg.created_at * 1000, delivered: msg.delivered,
              read: false, voiceExpiresAt: msg.voice_expires_at ?? null,
              editedAt: msg.edited_at ? msg.edited_at * 1000 : null,
            };
            await saveMessage(dmMessage);
            olderMessages.push(dmMessage);
          } catch (err) {
            if (keyVersion !== null && isMissingKeyError(err)) {
              unavailableKeyVersions.add(keyVersion);
              unavailableMessages++;
            } else {
              console.error('[DM Store] Failed to decrypt older message:', err);
            }
          }
        }

        set((s: any) => {
          const existing = s.messagesByConversation[serverConvId] || [];
          const seen = new Set(existing.map((m: DMMessage) => m.id));
          const mergedOlder = olderMessages.filter((m) => !seen.has(m.id));
          return {
            messagesByConversation: {
              ...s.messagesByConversation,
              [serverConvId]: [...mergedOlder, ...existing],
            },
            hasOlderByConversation: {
              ...s.hasOlderByConversation,
              [serverConvId]: Array.isArray(messages) && messages.length >= 50,
            },
            unavailableMessagesByConversation: {
              ...s.unavailableMessagesByConversation,
              [serverConvId]: (s.unavailableMessagesByConversation[serverConvId] ?? 0) + unavailableMessages,
            },
            oldestFetchedAtByConversation: {
              ...s.oldestFetchedAtByConversation,
              ...(messages.length > 0 ? { [serverConvId]: messages[0].created_at * 1000 } : {}),
            },
          };
        });
      } catch (err) {
        console.error('[DM Store] Failed to load older messages:', err);
      } finally {
        set((s: any) => ({
          loadingOlderByConversation: { ...s.loadingOlderByConversation, [conversationId]: false },
        }));
      }
    },

    handleIncomingMessage: async (msg: any) => {
      const syncKey = getSyncKey();
      const messageType = normalizeDmMessageType(msg);
      if (!syncKey && messageType !== 'system') { console.error('[DM Store] No sync key available'); return; }

      try {
        const text = await decodeDmMessageText(msg, syncKey, msg.conversationId);
        const currentUserId = useAuthStore.getState().user?.id;
        const isOwnSocketMessage = !!currentUserId && msg.senderId === currentUserId;
        const isSystemMessage = messageType === 'system';

        const dmMessage: DMMessage = {
          id: msg.id, conversationId: msg.conversationId,
          senderId: msg.senderId, recipientId: msg.recipientId,
          text, messageType, systemType: normalizeDmSystemType(msg),
          systemData: normalizeDmSystemData(msg),
          attachmentUrl: msg.attachmentUrl ?? null, attachmentType: msg.attachmentType ?? null,
          attachmentSize: msg.attachmentSize ?? null, attachmentName: msg.attachmentName ?? null,
          attachments: normalizeServerAttachments(msg), nsfwTags: normalizeNsfwTags(msg),
          reactions: normalizeDmReactions(msg.reactions, currentUserId),
          createdAt: msg.createdAt * 1000,
          delivered: true,
          read: isOwnSocketMessage || isSystemMessage,
          voiceExpiresAt: msg.voice_expires_at ?? null,
        };

        await saveMessage(dmMessage);

        set((s: any) => {
          const existingMessages = s.messagesByConversation[msg.conversationId] || [];
          const existingIndex = existingMessages.findIndex((entry: DMMessage) => entry.id === dmMessage.id);
          if (existingIndex >= 0) {
            const nextMessages = [...existingMessages];
            nextMessages[existingIndex] = { ...nextMessages[existingIndex], ...dmMessage };
            return { messagesByConversation: { ...s.messagesByConversation, [msg.conversationId]: nextMessages } };
          }
          return {
            messagesByConversation: {
              ...s.messagesByConversation,
              [msg.conversationId]: [...existingMessages, dmMessage],
            },
          };
        });

        // Update conversation
        const conversation = get().conversations.find((c: DMConversation) => c.id === msg.conversationId);
        if (conversation) {
          const state = get();
          const isActiveConversation = state.dmViewOpen && state.activeConversationId === msg.conversationId && !isAppInBackground();
          const newUnreadCount = isActiveConversation ? 0 : conversation.unreadCount;
          const updatedConversation = { ...conversation, lastMessageAt: dmMessage.createdAt, unreadCount: newUnreadCount };
          await import('../persistence/dmStorage').then(({ saveConversation }) => saveConversation(updatedConversation));

          set((s: any) => {
            const fresh = s.conversations.find((c: DMConversation) => c.id === msg.conversationId);
            const floor = localReadFloorByConversation.get(msg.conversationId) ?? 0;
            const mergedUnread = (s.dmViewOpen && s.activeConversationId === msg.conversationId && !isAppInBackground())
              ? 0 : (fresh ? fresh.unreadCount : newUnreadCount);
            const flooredUnread = updatedConversation.lastMessageAt <= floor ? 0 : mergedUnread;
            return {
              conversations: s.conversations.map((c: DMConversation) =>
                c.id === msg.conversationId ? { ...updatedConversation, unreadCount: flooredUnread } : c
              ),
            };
          });
        } else {
          try {
            const res = await authApi.get('/api/dms/conversations', { headers: getAuthHeader() });
            const serverConversations: DMConversation[] = res.data;
            const newConversation = serverConversations.find((c) => c.id === msg.conversationId);
            if (newConversation) {
              await import('../persistence/dmStorage').then(({ saveConversation }) => saveConversation(newConversation));
              set((s: any) => ({ conversations: [newConversation, ...s.conversations] }));
            }
          } catch (err) {
            console.error('[DM Store] Failed to fetch conversation:', err);
          }
        }
      } catch (err) {
        console.error('[DM Store] Failed to handle incoming message:', err);
      }
    },

    handleDeliveryAck: (messageId: string) => {
      set((s: any) => {
        const newMessagesByConv = { ...s.messagesByConversation };
        for (const convId in newMessagesByConv) {
          const messages = newMessagesByConv[convId];
          const msgIndex = messages.findIndex((m: DMMessage) => m.id === messageId);
          if (msgIndex !== -1) {
            const updatedMessages = [...messages];
            updatedMessages[msgIndex] = { ...updatedMessages[msgIndex], delivered: true };
            newMessagesByConv[convId] = updatedMessages;
            saveMessage(updatedMessages[msgIndex]);
            break;
          }
        }
        return { messagesByConversation: newMessagesByConv };
      });
    },

    handleMessageUpdate: async (msg: any) => {
      const syncKey = getSyncKey();
      if (!syncKey && normalizeDmMessageType(msg) !== 'system') { console.error('[DM Store] No sync key available'); return; }
      if (!msg?.id || !msg?.conversationId) return;
      try {
        const text = await decodeDmMessageText(msg, syncKey, msg.conversationId);
        set((s: any) => {
          const next = { ...s.messagesByConversation };
          const list = next[msg.conversationId];
          if (!Array.isArray(list)) return {};
          const idx = list.findIndex((m: DMMessage) => m.id === msg.id);
          if (idx === -1) return {};
          const updatedList = [...list];
          const updated = {
            ...updatedList[idx],
            text,
            messageType: normalizeDmMessageType(msg),
            systemType: normalizeDmSystemType(msg),
            systemData: normalizeDmSystemData(msg),
            reactions: Array.isArray(msg.reactions)
              ? normalizeDmReactions(msg.reactions, useAuthStore.getState().user?.id)
              : updatedList[idx].reactions,
            nsfwTags: normalizeNsfwTags(msg),
            editedAt: msg.editedAt ? msg.editedAt * 1000 : updatedList[idx].editedAt ?? null,
          };
          updatedList[idx] = updated;
          next[msg.conversationId] = updatedList;
          saveMessage(updated);
          return { messagesByConversation: next };
        });
      } catch (err) {
        console.error('[DM Store] Failed to handle message update:', err);
      }
    },

    removeMessageLocal: (messageId: string) => {
      set((s: any) => {
        const newMessagesByConv = { ...s.messagesByConversation };
        let changed = false;
        for (const convId in newMessagesByConv) {
          const current = newMessagesByConv[convId];
          const next = current.filter((m: DMMessage) => m.id !== messageId);
          if (next.length !== current.length) { newMessagesByConv[convId] = next; changed = true; }
        }
        if (!changed) return {};
        return { messagesByConversation: newMessagesByConv };
      });
      void deleteMessageFromStorage(messageId);
    },
  };
}
