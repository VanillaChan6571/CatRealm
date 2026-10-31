/**
 * DM store — direct-message conversations (1:1).
 * Real implementation: CatRealm-Client/src/stores/dmStore.ts.
 *
 * Mobile note: messages are E2EE on the wire. The web client decrypts before
 * pushing to this store; the mobile client must do the same. Crypto utilities
 * will live in `src/lib/crypto.ts` (port of relevant pieces from web client).
 */

import { create } from 'zustand';
import type { DMConversation, DMMessage, DMReaction, MessageAttachment } from '@/types';
import { createAuthenticatedApi } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { usePresenceStore } from '@/stores/presenceStore';
import { encryptDM, encryptDMV2, getDMPayloadVersion } from '@/utils/dmCrypto';
import { fetchDMKeyManifest, getLocalConversationSecret, loadConversationSecretForCurrentDevice, scheduleTrustedDeviceKeySync } from '@/lib/dmKeyStore';
import { encryptNotificationPreviewForDevice } from '@/lib/notificationPreviewCrypto';
import { dmContextPreviewText } from '@/lib/dmContext';
import { getConversationSecretForSend } from '@/lib/dmKeyStore';
import { createDMKeyBatchLoader, decodeDMPayload } from '@/lib/decodeDMPayload';
import { debugLog } from '@/lib/debugLog';
import { appendFormDataFile } from '@/lib/formData';
import { captureAccountSession } from '@/lib/accountSession';
import { canSendDM } from '@/lib/dmRequests';
import { mergeDMMessagePage } from '@/lib/dmMessageCache';
import { useBlockedUsersStore } from './blockedUsersStore';

/** File picked on-device, sent as multipart alongside the encrypted payload. */
export type DmLocalAttachment = {
  uri: string;
  name: string;
  mime: string;
  isNsfw?: boolean;
};

function formatNotificationSenderName(user?: { username?: string | null; displayName?: string | null } | null) {
  const username = (user?.username ?? '').trim();
  const displayName = (user?.displayName ?? '').trim();
  if (displayName && username && displayName.toLowerCase() !== username.toLowerCase()) {
    return `${displayName} - @${username}`;
  }
  return username ? `@${username}` : 'New message';
}

interface ServerDMMessage {
  id: string;
  conversationId?: string;
  conversation_id?: string;
  senderId?: string;
  sender_id: string;
  recipientId?: string;
  recipient_id: string;
  encryptedPayload?: string | null;
  encrypted_payload?: string | null;
  text?: string | null;
  messageType?: 'user' | 'system';
  message_type?: 'user' | 'system';
  systemType?: string | null;
  system_type?: string | null;
  systemData?: Record<string, unknown> | null;
  system_data?: Record<string, unknown> | null;
  systemText?: string | null;
  system_text?: string | null;
  content?: string | null;
  attachment_url?: string | null;
  attachment_type?: string | null;
  attachment_size?: number | null;
  attachment_name?: string | null;
  attachments?: DMMessage['attachments'];
  nsfw_tags?: string[];
  nsfwTags?: string[];
  reactions?: DMMessage['reactions'];
  createdAt?: number;
  created_at: number;
  delivered?: boolean | number;
  voice_expires_at?: number | null;
  scheduled_at?: number | null;
  edited_at?: number | null;
  editedAt?: number | null;
}

function normalizeDmReactions(reactions: unknown, userId: string | undefined): DMReaction[] {
  if (!Array.isArray(reactions)) return [];
  return reactions
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const item = entry as { emoji?: unknown; users?: unknown; count?: unknown; reacted?: unknown };
      const emoji = typeof item.emoji === 'string' ? item.emoji : '';
      if (!emoji) return null;
      const users = Array.isArray(item.users)
        ? item.users.filter((u: unknown): u is string => typeof u === 'string')
        : [];
      const count = typeof item.count === 'number' ? item.count : users.length;
      const reacted = typeof item.reacted === 'boolean'
        ? item.reacted
        : Boolean(userId && users.includes(userId));
      return { emoji, users, count, reacted };
    })
    .filter((entry): entry is DMReaction => Boolean(entry));
}

function normalizeDmMessageType(message: ServerDMMessage): 'user' | 'system' {
  return (message.message_type ?? message.messageType) === 'system' ? 'system' : 'user';
}

function normalizeSystemText(message: ServerDMMessage, currentUserId?: string): string {
  const text = message.system_text ?? message.systemText ?? message.content ?? message.text;
  if (typeof text === 'string' && text.trim()) return text;
  const data = normalizeSystemData(message);
  const actor = typeof data?.actorDisplayName === 'string' && data.actorDisplayName
    ? data.actorDisplayName
    : typeof data?.actorUsername === 'string' && data.actorUsername
      ? data.actorUsername
      : 'Someone';
  switch (message.system_type ?? message.systemType) {
    case 'call_declined': return `${actor} declined the call`;
    case 'call_cancelled': return data?.actorUserId === currentUserId ? 'Call cancelled' : 'Missed call';
    case 'call_ended': {
      const duration = typeof data?.duration === 'number' ? data.duration : null;
      return duration === null ? 'Call ended' : `Call ended • ${formatCallDuration(duration)}`;
    }
    case 'dm_e2ee_upgraded':
      return 'This DM is now encrypted and keys have been synced to account holders.';
    case 'central_limit_warning':
      return (typeof data?.warningText === 'string' && data.warningText)
        ? data.warningText
        : "Modified Clients are welcomed but not to overwhelm central's resources! If you continue this or attempt to override Central's Limitations your account will be limited.";
    case 'central_account_limited': {
      const limitedUntil = typeof data?.limitedUntil === 'number' ? data.limitedUntil : null;
      const untilLabel = limitedUntil
        ? new Date(limitedUntil * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
        : null;
      return untilLabel
        ? `This account has been limited by Central: DM and group-chat calls are disabled until ${untilLabel}.`
        : 'This account has been limited by Central: DM and group-chat calls are disabled for 14 days.';
    }
    default: return '';
  }
}

function formatCallDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.max(0, Math.floor(totalSeconds % 60));
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function normalizeSystemData(message: ServerDMMessage): Record<string, unknown> | null {
  const value = message.system_data ?? message.systemData;
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function normalizeAttachments(message: ServerDMMessage): MessageAttachment[] | null {
  const attachments = message.attachments;
  if (!Array.isArray(attachments) || attachments.length === 0) return null;
  return attachments;
}

function normalizeNsfwTags(message: ServerDMMessage): string[] {
  const tags = message.nsfw_tags ?? message.nsfwTags;
  if (!Array.isArray(tags)) return [];
  return tags
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeCreatedAt(message: ServerDMMessage): number {
  const value = message.created_at ?? message.createdAt ?? Date.now();
  return value < 10_000_000_000 ? value * 1000 : value;
}

async function decodeMessageText(
  message: ServerDMMessage,
  syncKey: string | null,
  conversationId: string,
  currentUserId?: string,
  loadSecret?: (conversationId: string, keyVersion: number) => Promise<string | null>,
): Promise<string> {
  if (normalizeDmMessageType(message) === 'system') return normalizeSystemText(message, currentUserId);
  const encryptedPayload = message.encrypted_payload ?? message.encryptedPayload;
  if (typeof encryptedPayload !== 'string' || !encryptedPayload) return message.text ?? '';
  return decodeDMPayload(encryptedPayload, syncKey, conversationId, loadSecret);
}

async function mapServerMessage(
  message: ServerDMMessage,
  conversationId: string,
  syncKey: string | null,
  currentUserId: string | undefined,
  loadSecret?: (conversationId: string, keyVersion: number) => Promise<string | null>,
): Promise<DMMessage> {
  const serverConversationId = message.conversation_id ?? message.conversationId ?? conversationId;
  return {
    id: message.id,
    conversationId: serverConversationId,
    senderId: message.sender_id ?? message.senderId ?? '',
    recipientId: message.recipient_id ?? message.recipientId ?? '',
    text: await decodeMessageText(message, syncKey, serverConversationId, currentUserId, loadSecret),
    messageType: normalizeDmMessageType(message),
    systemType: message.system_type ?? message.systemType ?? null,
    systemData: normalizeSystemData(message),
    attachmentUrl: message.attachment_url ?? null,
    attachmentType: message.attachment_type ?? null,
    attachmentSize: message.attachment_size ?? null,
    attachmentName: message.attachment_name ?? null,
    attachments: normalizeAttachments(message),
    nsfwTags: normalizeNsfwTags(message),
    reactions: normalizeDmReactions(message.reactions, currentUserId),
    createdAt: normalizeCreatedAt(message),
    delivered: Boolean(message.delivered),
    read: false,
    voiceExpiresAt: message.voice_expires_at ?? null,
    scheduledAt: message.scheduled_at ?? null,
    editedAt: (message.edited_at ?? message.editedAt) ? Number(message.edited_at ?? message.editedAt) * 1000 : null,
  };
}

export interface DMPinnedEntry {
  messageId: string;
  pinnedBy: string;
  pinnedAt: number;
  message: DMMessage;
}

interface ServerDMPin {
  messageId: string;
  pinnedBy: string;
  pinnedAt: number;
  message: ServerDMMessage | null;
}

const pinFetchSeq = new Map<string, number>();
const messageFetchSeq = new Map<string, number>();

// Guards the decrypt-failure refetch: without it a conversation whose keys
// never arrive refetches every 1.2s forever, exhausting the per-device DM
// rate limit and 429ing all other DM traffic.
const decryptRetryAt = new Map<string, number>();
const DECRYPT_RETRY_MIN_GAP_MS = 60 * 1000;

export interface DMState {
  conversations: DMConversation[];
  messages: Record<string, DMMessage[]>;
  loading: Record<string, boolean>;
  hasMore: Record<string, boolean>;
  oldestCursor: Record<string, number | null>;
  activeConversationId: string | null;
  typingByConversation: Record<string, string[]>;
  setConversations: (list: DMConversation[]) => void;
  upsertConversation: (conversation: DMConversation) => void;
  setMessages: (conversationId: string, messages: DMMessage[]) => void;
  appendMessage: (conversationId: string, message: DMMessage) => void;
  appendServerMessage: (message: ServerDMMessage) => Promise<void>;
  fetchConversations: () => Promise<void>;
  respondToRequest: (otherUserId: string, decision: 'accept' | 'decline') => Promise<void>;
  fetchMessages: (conversationId: string, before?: number) => Promise<void>;
  releaseMessages: (conversationId: string) => void;
  sendMessage: (conversationId: string, text: string, attachments?: DmLocalAttachment[], options?: { voiceExpiresAt?: number | null }) => Promise<boolean>;
  markAsRead: (conversationId: string) => Promise<void>;
  applyUnreadSummary: (dmByConversation: Record<string, number>) => void;
  setActiveConversationId: (conversationId: string | null) => void;
  setTypingByOtherUserId: (otherUserId: string, typing: boolean) => void;
  toggleReaction: (messageId: string, emoji: string) => Promise<void>;
  applyReactionUpdate: (messageId: string, reactions: DMReaction[]) => void;
  pinsByConversation: Record<string, DMPinnedEntry[]>;
  fetchPins: (conversationId: string) => Promise<void>;
  pinMessage: (messageId: string) => Promise<void>;
  unpinMessage: (messageId: string) => Promise<void>;
  applyPinUpdate: (payload: { conversationId: string; messageId: string; pinned: boolean }) => void;
  editMessage: (messageId: string, nextText: string) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  removeMessageLocal: (messageId: string) => void;
}

const dmTypingExpiry = new Map<string, ReturnType<typeof setTimeout>>();

export const useDMStore = create<DMState>((set, get) => ({
  conversations: [],
  messages: {},
  loading: {},
  hasMore: {},
  oldestCursor: {},
  activeConversationId: null,
  typingByConversation: {},

  setConversations: (list) => set({ conversations: list }),

  upsertConversation: (conversation) =>
    set((s) => {
      const idx = s.conversations.findIndex((c) => c.id === conversation.id);
      if (idx === -1) {
        return {
          conversations: [conversation, ...s.conversations].sort((a, b) => b.lastMessageAt - a.lastMessageAt),
        };
      }
      const next = [...s.conversations];
      next[idx] = conversation;
      return { conversations: next.sort((a, b) => b.lastMessageAt - a.lastMessageAt) };
    }),

  setMessages: (id, messages) =>
    set((s) => ({ messages: { ...s.messages, [id]: messages } })),

  appendMessage: (id, message) =>
    set((s) => {
      const existing = s.messages[id] ?? [];
      if (existing.some((m) => m.id === message.id)) return s;
      return { messages: { ...s.messages, [id]: [...existing, message] } };
    }),

  appendServerMessage: async (message) => {
    const conversationId = message.conversation_id ?? message.conversationId;
    if (!conversationId) return;
    try {
      const auth = useAuthStore.getState();
      const dmMessage = await mapServerMessage(message, conversationId, auth.syncKey, auth.user?.id);
      const currentUserId = auth.user?.id;
      const isActiveConversation = get().activeConversationId === dmMessage.conversationId;

      set((s) => {
        const existing = s.messages[dmMessage.conversationId] ?? [];
        if (existing.some((entry) => entry.id === dmMessage.id)) return s;
        return {
          messages: {
            ...s.messages,
            [dmMessage.conversationId]: [...existing, dmMessage],
          },
        };
      });

      set((s) => {
        const existing = s.conversations.find((c) => c.id === dmMessage.conversationId);
        const otherUserId = dmMessage.senderId === currentUserId ? dmMessage.recipientId : dmMessage.senderId;
        const nextConversation: DMConversation = existing
          ? {
              ...existing,
              lastMessageAt: dmMessage.createdAt,
              // Central notification summary owns durable DM unread counts.
              unreadCount: isActiveConversation ? 0 : existing.unreadCount,
            }
          : {
              id: dmMessage.conversationId,
              otherUserId,
              otherUsername: otherUserId || 'Unknown',
              otherDisplayName: otherUserId || null,
              otherAvatar: null,
              lastMessageAt: dmMessage.createdAt,
              unreadCount: 0,
            };
        const conversations = existing
          ? s.conversations.map((c) => (c.id === dmMessage.conversationId ? nextConversation : c))
          : [nextConversation, ...s.conversations];
        return {
          conversations: conversations.sort((a, b) => b.lastMessageAt - a.lastMessageAt),
          typingByConversation: isActiveConversation
            ? { ...s.typingByConversation, [dmMessage.conversationId]: [] }
            : s.typingByConversation,
        };
      });

      if (!get().conversations.find((c) => c.id === dmMessage.conversationId)) {
        void get().fetchConversations();
      }
    } catch {
      // Ignore undecryptable socket events; a reload will retry from history.
    }
  },

  fetchConversations: async () => {
    const session = captureAccountSession();
    try {
      const res = await createAuthenticatedApi().get<DMConversation[]>('/api/dms/conversations');
      if (!session.isCurrent()) return;
      usePresenceStore.getState().upsertCentral(
        res.data
          .filter((conversation) => conversation.otherStatus)
          .map((conversation) => ({
            userId: conversation.otherUserId,
            status: conversation.otherStatus!,
            clients: conversation.otherClients ?? [],
          })),
      );
      set((s) => {
        const localMap = new Map(s.conversations.map((c) => [c.id, c]));
        return {
          conversations: res.data.map((serverConvo) => {
            const local = localMap.get(serverConvo.id);
            // Central notification summary will hydrate unread counts separately;
            // never resurrect stale server/local DM counters during list refresh.
            return { ...serverConvo, unreadCount: local?.unreadCount ?? 0 };
          }),
        };
      });
    } catch {
      // silently ignore — list stays empty
    }
  },

  respondToRequest: async (otherUserId, decision) => {
    const session = captureAccountSession();
    await createAuthenticatedApi().post(`/api/dms/requests/${encodeURIComponent(otherUserId)}/${decision}`);
    if (session.isCurrent()) await get().fetchConversations();
  },

  fetchMessages: async (conversationId, before) => {
    if (get().loading[conversationId]) return;
    if (before && get().hasMore[conversationId] === false) return;
    const fetchSeq = (messageFetchSeq.get(conversationId) ?? 0) + 1;
    messageFetchSeq.set(conversationId, fetchSeq);
    set((s) => ({ loading: { ...s.loading, [conversationId]: true } }));
    try {
      const conversation = get().conversations.find((c) => c.id === conversationId);
      if (!conversation) return;
      void (async () => {
        const manifest = await fetchDMKeyManifest(conversationId);
        if (manifest.activeKeyVersion != null) {
          const secret = await getLocalConversationSecret(conversationId, manifest.activeKeyVersion);
          if (secret) scheduleTrustedDeviceKeySync(conversationId, manifest.activeKeyVersion, secret);
        }
      })().catch(() => {});
      const limit = 50;
      const params: Record<string, unknown> = { limit };
      if (before) params.before = before;
      const res = await createAuthenticatedApi().get<{
        messages: ServerDMMessage[];
        conversationId: string;
      }>(
        `/api/dms/${conversation.otherUserId}/messages`,
        { params },
      );
      if (messageFetchSeq.get(conversationId) !== fetchSeq) return;
      const auth = useAuthStore.getState();
      const mapped: DMMessage[] = [];
      let sawDecryptFailure = false;
      const loadSecretOnce = createDMKeyBatchLoader((id, keyVersion) => {
        if (useAuthStore.getState().user?.id !== auth.user?.id) return Promise.reject(new Error('Account changed'));
        return loadConversationSecretForCurrentDevice(id, keyVersion);
      });
      for (const message of res.data.messages) {
        if (messageFetchSeq.get(conversationId) !== fetchSeq) return;
        try {
          mapped.push(await mapServerMessage(
            message,
            res.data.conversationId,
            auth.syncKey,
            auth.user?.id,
            loadSecretOnce,
          ));
        } catch (cause) {
          const response = (cause as { response?: { status?: number; headers?: Record<string, string> } })?.response;
          const rateLimited = response?.status === 429;
          if (!rateLimited) sawDecryptFailure = true;
          const encryptedPayload = message.encrypted_payload ?? message.encryptedPayload;
          const encryptedVersion = typeof encryptedPayload === 'string' ? getDMPayloadVersion(encryptedPayload) : null;
          const retryAfterSeconds = Number(response?.headers?.['retry-after']);
          const retryAt = rateLimited ? Date.now() + Math.max(60, Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : 60) * 1000 : null;
          mapped.push({
            id: message.id,
            conversationId: res.data.conversationId,
            senderId: message.sender_id ?? message.senderId ?? '',
            recipientId: message.recipient_id ?? message.recipientId ?? '',
            text: rateLimited
              ? '[Key sync is temporarily busy. Wait a minute, then retry this conversation.]'
              : '[Unable to decrypt this message on this device. The encryption key may not be available yet. Try opening this conversation on another trusted device, then retry.]',
            messageType: 'system',
            systemType: 'decrypt_failed',
            systemData: { encryptedVersion, keySyncRateLimited: rateLimited, retryAt },
            attachments: null,
            nsfwTags: [],
            reactions: [],
            createdAt: normalizeCreatedAt(message),
            delivered: Boolean(message.delivered),
            read: false,
          });
        }
      }
      if (messageFetchSeq.get(conversationId) !== fetchSeq) return;
      const existing = get().messages[conversationId] ?? [];
      // A fresh-page retry replaces failures it received and drops stale failed
      // placeholders outside that page so they cannot pin the recovery banner.
      const next = mergeDMMessagePage(existing, mapped, Boolean(before));
      if (sawDecryptFailure && !before && Date.now() - (decryptRetryAt.get(conversationId) ?? 0) > DECRYPT_RETRY_MIN_GAP_MS) {
        decryptRetryAt.set(conversationId, Date.now());
        // A newly trusted device may receive its wrapped key moments after the first fetch.
        // Retry once shortly so the screen heals without waiting for another user to type.
        setTimeout(() => {
          const current = get().messages[conversationId] ?? [];
          if (current.some((message) => message.systemType === 'decrypt_failed')) {
            void get().fetchMessages(conversationId);
          }
        }, 1200);
      }
      const oldestCreatedAt = next[0]?.createdAt ?? null;
      set((s) => ({
        messages: { ...s.messages, [conversationId]: next },
        hasMore: { ...s.hasMore, [conversationId]: res.data.messages.length >= limit },
        oldestCursor: { ...s.oldestCursor, [conversationId]: oldestCreatedAt },
      }));
      void import('@/stores/notificationStore').then(({ useNotificationStore }) => useNotificationStore.getState().hydrateDmPreviews());
    } catch {
      // ignore
    } finally {
      if (messageFetchSeq.get(conversationId) === fetchSeq) {
        set((s) => ({ loading: { ...s.loading, [conversationId]: false } }));
      }
    }
  },

  releaseMessages: (conversationId) => {
    messageFetchSeq.set(conversationId, (messageFetchSeq.get(conversationId) ?? 0) + 1);
    set((s) => {
      const messages = { ...s.messages };
      const loading = { ...s.loading };
      const hasMore = { ...s.hasMore };
      const oldestCursor = { ...s.oldestCursor };
      delete messages[conversationId];
      delete loading[conversationId];
      delete hasMore[conversationId];
      delete oldestCursor[conversationId];
      return { messages, loading, hasMore, oldestCursor };
    });
  },

  markAsRead: async (conversationId) => {
    try {
      await createAuthenticatedApi().post(`/api/dms/conversations/${conversationId}/mark-read`, {});
    } catch {
      // best-effort; local state still clears immediately
    }
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === conversationId ? { ...c, unreadCount: 0 } : c
      ),
      messages: {
        ...s.messages,
        ...(s.messages[conversationId]
          ? { [conversationId]: s.messages[conversationId].map((m) => ({ ...m, read: true })) }
          : {}),
      },
    }));
  },

  applyUnreadSummary: (dmByConversation) =>
    set((s) => ({
      conversations: s.conversations.map((conversation) => ({
        ...conversation,
        unreadCount: dmByConversation[conversation.id] ?? 0,
      })),
    })),

  sendMessage: async (conversationId, text, attachments, options) => {
    const convo = get().conversations.find((c) => c.id === conversationId);
    if (!convo) {
      debugLog('dmStore', 'send-failed', { conversationId, reason: 'conversation-not-loaded' });
      return false;
    }
    const auth = captureAccountSession();
    const api = createAuthenticatedApi();
    if (!canSendDM(convo, useBlockedUsersStore.getState().isBlocked(convo.otherUserId))) return false;
    if (!auth.syncKey) {
      debugLog('dmStore', 'send-failed', { conversationId, reason: 'no-sync-key' });
      return false;
    }
    const files = attachments ?? [];
    try {
      const provisioned = await getConversationSecretForSend(convo.id);
      const encryptedPayload = provisioned
        ? await encryptDMV2(text, provisioned.secret, convo.id, provisioned.keyVersion)
        : await encryptDM(text, auth.syncKey, convo.id);
      const manifest = await fetchDMKeyManifest(convo.id);
      const previewTargets = manifest.devices.filter((device) =>
        device.userId === convo.otherUserId && device.dmTrustState === 'trusted' && device.pushCapable && device.notificationPublicKey
      );
      // Replies carry a [[crdmctx:…]] envelope; previews show only the reply's own text.
      const previewText = dmContextPreviewText(text);
      const notificationPreviewEnvelopes = (await Promise.all(previewTargets.map((device) =>
        encryptNotificationPreviewForDevice(device, {
          type: 'dm_message',
          conversationId: convo.id,
          senderId: auth.user?.id,
          senderDisplayName: formatNotificationSenderName(auth.user),
          preview: previewText,
          createdAt: Math.floor(Date.now() / 1000),
        })
      ))).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

      let res;
      if (files.length > 0) {
        // Mirror desktop dmOperationsSlice: multipart straight to the DM send
        // endpoint; central stores/compresses the file itself.
        const formData = new FormData();
        formData.append('encryptedPayload', encryptedPayload);
        formData.append('notificationPreviewEnvelopes', JSON.stringify(notificationPreviewEnvelopes));
        for (const file of files) {
          await appendFormDataFile(formData, 'attachment', {
            uri: file.uri,
            name: file.name,
            type: file.mime,
          });
        }
        const nsfwTags = files.some((file) => file.isNsfw) ? ['nsfw'] : [];
        if (nsfwTags.length > 0) formData.append('nsfwTags', JSON.stringify(nsfwTags));
        if (options?.voiceExpiresAt != null) formData.append('voiceExpiresAt', String(options.voiceExpiresAt));
        if (!auth.isCurrent()) return false;
        res = await api.post<ServerDMMessage>(
          `/api/dms/${convo.otherUserId}/send`,
          formData,
          { headers: { 'Content-Type': 'multipart/form-data' } },
        );
      } else {
        if (!auth.isCurrent()) return false;
        res = await api.post<ServerDMMessage>(`/api/dms/${convo.otherUserId}/send`, {
          encryptedPayload,
          notificationPreviewEnvelopes,
        });
      }
      const dmMessage = await mapServerMessage(res.data, convo.id, auth.syncKey, auth.user?.id);
      if (!auth.isCurrent()) return false;
      get().appendMessage(dmMessage.conversationId, dmMessage);
      await get().fetchConversations();
      return true;
    } catch (err: unknown) {
      const status = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { status?: number; data?: unknown } }).response?.status
        : undefined;
      debugLog('dmStore', 'send-failed', {
        conversationId,
        status,
        message: err instanceof Error ? err.message : String(err),
        stackHead: err instanceof Error ? err.stack?.split('\n').slice(0, 3).join(' | ') : undefined,
      });
      return false;
    }
  },

  setActiveConversationId: (conversationId) => set({ activeConversationId: conversationId }),

  setTypingByOtherUserId: (otherUserId, typing) =>
    set((s) => {
      const conversation = s.conversations.find((c) => c.otherUserId === otherUserId);
      const conversationId = conversation?.id ?? s.activeConversationId;
      if (!conversationId) return s;
      // Typers re-send start every ~2.5s; clear after 6s of silence in case the stop was lost.
      clearTimeout(dmTypingExpiry.get(otherUserId));
      if (typing) {
        dmTypingExpiry.set(otherUserId, setTimeout(() => useDMStore.getState().setTypingByOtherUserId(otherUserId, false), 6000));
      }
      return {
        typingByConversation: {
          ...s.typingByConversation,
          [conversationId]: typing ? [otherUserId] : [],
        },
      };
    }),

  toggleReaction: async (messageId, emoji) => {
    try {
      const res = await createAuthenticatedApi().post<{ reactions?: unknown }>(`/api/dms/${messageId}/reactions`, {
        emoji,
      });
      const currentUserId = useAuthStore.getState().user?.id;
      const reactions = normalizeDmReactions(res.data?.reactions, currentUserId);
      get().applyReactionUpdate(messageId, reactions);
    } catch {
      // ignore
    }
  },

  pinsByConversation: {},

  fetchPins: async (conversationId) => {
    // Bumped by unpin events too, so a stale in-flight fetch can't resurrect
    // a pin that was removed while the request was outstanding.
    const seq = (pinFetchSeq.get(conversationId) ?? 0) + 1;
    pinFetchSeq.set(conversationId, seq);
    try {
      const res = await createAuthenticatedApi().get<{ pins?: ServerDMPin[] }>(
        `/api/dms/conversations/${conversationId}/pins`,
      );
      const auth = useAuthStore.getState();
      const entries: DMPinnedEntry[] = [];
      for (const pin of res.data?.pins ?? []) {
        if (!pin?.message) continue;
        let message: DMMessage;
        try {
          message = await mapServerMessage(pin.message, conversationId, auth.syncKey, auth.user?.id);
        } catch {
          // Text is the only field inside the encrypted body; keep server metadata.
          message = {
            id: pin.message.id,
            conversationId,
            senderId: pin.message.sender_id ?? '',
            recipientId: pin.message.recipient_id ?? '',
            text: '(unable to decrypt)',
            messageType: normalizeDmMessageType(pin.message),
            systemType: pin.message.system_type ?? pin.message.systemType ?? null,
            systemData: normalizeSystemData(pin.message),
            attachmentUrl: pin.message.attachment_url ?? null,
            attachmentType: pin.message.attachment_type ?? null,
            attachmentSize: pin.message.attachment_size ?? null,
            attachmentName: pin.message.attachment_name ?? null,
            attachments: normalizeAttachments(pin.message),
            nsfwTags: normalizeNsfwTags(pin.message),
            reactions: normalizeDmReactions(pin.message.reactions, auth.user?.id),
            createdAt: normalizeCreatedAt(pin.message),
            delivered: true,
            read: true,
            voiceExpiresAt: pin.message.voice_expires_at ?? null,
            editedAt: pin.message.edited_at ? Number(pin.message.edited_at) * 1000 : null,
          };
        }
        entries.push({ messageId: pin.messageId, pinnedBy: pin.pinnedBy, pinnedAt: pin.pinnedAt, message });
      }
      if (pinFetchSeq.get(conversationId) !== seq) return;
      set((s) => ({ pinsByConversation: { ...s.pinsByConversation, [conversationId]: entries } }));
    } catch {
      // best-effort; sheet shows the last known list
    }
  },

  pinMessage: async (messageId) => {
    // Local state syncs via the dm:pin:update broadcast (echoed to the sender too).
    try {
      await createAuthenticatedApi().put(`/api/dms/${messageId}/pin`, {});
    } catch {
      // ignore
    }
  },

  unpinMessage: async (messageId) => {
    try {
      await createAuthenticatedApi().delete(`/api/dms/${messageId}/pin`);
    } catch {
      // ignore
    }
  },

  applyPinUpdate: ({ conversationId, messageId, pinned }) => {
    if (pinned) {
      // Payload carries no message content; refresh the conversation's pin list.
      void get().fetchPins(conversationId);
      return;
    }
    pinFetchSeq.set(conversationId, (pinFetchSeq.get(conversationId) ?? 0) + 1);
    set((s) => {
      const existing = s.pinsByConversation[conversationId];
      if (!existing) return s;
      return {
        pinsByConversation: {
          ...s.pinsByConversation,
          [conversationId]: existing.filter((entry) => entry.messageId !== messageId),
        },
      };
    });
  },

  applyReactionUpdate: (messageId, reactions) => {
    const normalized = normalizeDmReactions(reactions, useAuthStore.getState().user?.id);
    set((s) => {
      const next = { ...s.messages };
      let found = false;
      for (const conversationId of Object.keys(next)) {
        const idx = next[conversationId].findIndex((message) => message.id === messageId);
        if (idx === -1) continue;
        const updatedMessages = [...next[conversationId]];
        updatedMessages[idx] = { ...updatedMessages[idx], reactions: normalized };
        next[conversationId] = updatedMessages;
        found = true;
        break;
      }
      if (!found) return s;
      return { messages: next };
    });
  },

  editMessage: async (messageId, nextText) => {
    const trimmed = nextText.trim();
    if (!trimmed) return;

    let targetMessage: DMMessage | null = null;
    for (const conversationId of Object.keys(get().messages)) {
      const found = get().messages[conversationId].find((message) => message.id === messageId);
      if (found) {
        targetMessage = found;
        break;
      }
    }
    if (!targetMessage) return;

    const syncKey = useAuthStore.getState().syncKey;
    if (!syncKey) return;

    try {
      const provisioned = await getConversationSecretForSend(targetMessage.conversationId);
      const encryptedPayload = provisioned
        ? await encryptDMV2(trimmed, provisioned.secret, targetMessage.conversationId, provisioned.keyVersion)
        : await encryptDM(trimmed, syncKey, targetMessage.conversationId);
      await createAuthenticatedApi().patch(`/api/dms/${messageId}`, { encryptedPayload });

      set((s) => {
        const next = { ...s.messages };
        for (const conversationId of Object.keys(next)) {
          const idx = next[conversationId].findIndex((message) => message.id === messageId);
          if (idx === -1) continue;
          const updatedMessages = [...next[conversationId]];
          updatedMessages[idx] = { ...updatedMessages[idx], text: trimmed };
          next[conversationId] = updatedMessages;
          break;
        }
        return { messages: next };
      });
    } catch {
      // ignore
    }
  },

  deleteMessage: async (messageId) => {
    try {
      await createAuthenticatedApi().delete(`/api/dms/${messageId}`);
      get().removeMessageLocal(messageId);
    } catch {
      // ignore
    }
  },

  removeMessageLocal: (messageId) =>
    set((s) => {
      const next = { ...s.messages };
      for (const conversationId of Object.keys(next)) {
        next[conversationId] = next[conversationId].filter((message) => message.id !== messageId);
      }
      return { messages: next };
    }),
}));
