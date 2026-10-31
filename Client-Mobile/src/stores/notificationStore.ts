import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createAuthenticatedApi } from '@/lib/api';
import { useDMStore } from '@/stores/dmStore';
import { useServerStore } from '@/stores/serverStore';
import { useChannelStore } from '@/stores/channelStore';
import { getLocalDeviceId } from '@/lib/deviceIdentity';
import { decryptNotificationPreviewEnvelope } from '@/lib/notificationPreviewCrypto';
import { captureAccountSession } from '@/lib/accountSession';

const storageKey = (userId: string) => `catrealm:notifications:v2:${userId}`;
const previewCacheKey = (userId: string) => `catrealm:notification-dm-previews:v1:${userId}`;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

// 7-day retention, enforced wherever items enter the store. The UI relies on
// this invariant — re-fetching when a stale item is visible caused an infinite
// load() loop when nothing actually pruned them.
function pruneExpired(items: NotificationItem[]): NotificationItem[] {
  const cutoff = Date.now() - RETENTION_MS;
  return items.filter((item) => item.timestamp >= cutoff);
}

export interface CentralNotificationSummary {
  totalUnread: number;
  unreadDMs: number;
  unreadMentions: number;
  dmByConversation: Record<string, number>;
  mentionsByRealm: Record<string, number>;
  mentionsByChannel: Record<string, number>;
}

interface BaseNotification {
  id: string;
  timestamp: number;
  read: boolean;
}

export interface FriendRequestNotification extends BaseNotification {
  type: 'friend_request';
  requestId: string;
  fromUserId: string;
  fromUsername: string;
  fromAvatar: string | null;
  outcome?: 'accepted' | 'rejected';
}

export interface DMNotification extends BaseNotification {
  type: 'dm_message';
  conversationId: string;
  messageId: string | null;
  otherUserId: string;
  otherUsername: string;
  otherDisplayName: string | null;
  otherAvatar: string | null;
  count: number;
  localPreviewText?: string | null;
}

export interface ServerMentionNotification extends BaseNotification {
  type: 'server_mention';
  serverId: string;
  channelId: string;
  channelName: string | null;
  senderUsername: string | null;
  contentPreview: string;
}

export type NotificationItem = FriendRequestNotification | DMNotification | ServerMentionNotification;

interface WireNotification {
  id: string;
  type: string;
  sourceKind: string;
  sourceId: string;
  subsourceId: string | null;
  messageId?: string | null;
  actorName: string | null;
  createdAt: number;
  readAt: number | null;
  payload: Record<string, unknown> | null;
  encryptedPreviewEnvelope?: string;
}

interface NotificationState {
  items: NotificationItem[];
  summary: CentralNotificationSummary | null;
  loaded: boolean;
  load: () => Promise<void>;
  refresh: () => Promise<void>;
  applySummary: (summary: CentralNotificationSummary) => void;
  prependFromWire: (notification: WireNotification) => void;
  resolveFriendRequest: (requestId: string, outcome: 'accepted' | 'rejected') => void;
  markDMRead: (conversationId: string) => Promise<void>;
  clear: () => Promise<void>;
  hydrateDmPreviews: () => void;
  cacheDmPreview: (notificationId: string, conversationId: string, preview: string) => void;
}

function mapWireNotification(notification: WireNotification): NotificationItem | null {
  const timestamp = notification.createdAt < 10_000_000_000
    ? notification.createdAt * 1000
    : notification.createdAt;
  const payload = notification.payload ?? {};
  const read = notification.readAt != null;

  if (notification.type === 'friend_request') {
    return {
      id: notification.id,
      type: 'friend_request',
      requestId: String(payload.requestId ?? notification.sourceId),
      fromUserId: String(payload.fromUserId ?? ''),
      fromUsername: String(payload.fromUsername ?? notification.actorName ?? 'Unknown'),
      fromAvatar: typeof payload.fromAvatar === 'string' ? payload.fromAvatar : null,
      timestamp,
      read,
    };
  }
  if (notification.type === 'dm_message') {
    return {
      id: notification.id,
      type: 'dm_message',
      conversationId: notification.sourceId,
      messageId: typeof notification.messageId === 'string' ? notification.messageId : null,
      otherUserId: String(payload.otherUserId ?? ''),
      otherUsername: String(payload.otherUsername ?? notification.actorName ?? 'Unknown'),
      otherDisplayName: typeof payload.otherDisplayName === 'string' ? payload.otherDisplayName : null,
      otherAvatar: typeof payload.otherAvatar === 'string' ? payload.otherAvatar : null,
      count: Number(payload.count ?? 1) || 1,
      timestamp,
      read,
    };
  }
  if (notification.type === 'server_mention') {
    return {
      id: notification.id,
      type: 'server_mention',
      serverId: notification.sourceId,
      channelId: String(payload.channelId ?? notification.subsourceId ?? ''),
      channelName: typeof payload.channelName === 'string' ? payload.channelName : null,
      senderUsername: typeof payload.senderUsername === 'string' ? payload.senderUsername : notification.actorName,
      contentPreview: typeof payload.contentPreview === 'string' ? payload.contentPreview : '',
      timestamp,
      read,
    };
  }
  return null;
}

async function persist(userId: string, items: NotificationItem[]) {
  try {
    await AsyncStorage.setItem(storageKey(userId), JSON.stringify(items));
  } catch {
    // storage is a cache only
  }
}

let previewCache: Record<string, string> = {};
export function resetNotificationCache() {
  previewCache = {};
}
async function loadPreviewCache(userId: string): Promise<Record<string, string>> {
  try { return JSON.parse((await AsyncStorage.getItem(previewCacheKey(userId))) || '{}') as Record<string, string>; } catch { return {}; }
}
async function persistPreviewCache(userId: string, items: NotificationItem[]) {
  previewCache = Object.fromEntries(items
    .filter((item): item is DMNotification => item.type === 'dm_message' && !!item.localPreviewText)
    .map((item) => [item.id, item.localPreviewText as string]));
  try { await AsyncStorage.setItem(previewCacheKey(userId), JSON.stringify(previewCache)); } catch { /* Best-effort cache. */ }
}
async function persistPreviewCacheMap(userId: string) {
  try { await AsyncStorage.setItem(previewCacheKey(userId), JSON.stringify(previewCache)); } catch { /* Best-effort cache. */ }
}
function withLocalDmPreviews(items: NotificationItem[]) {
  const messages = useDMStore.getState().messages;
  return items.map((item) => {
    if (item.type !== 'dm_message') return item;
    const conversationMessages = messages[item.conversationId] ?? [];
    const message = (item.messageId ? conversationMessages.find((candidate) => candidate.id === item.messageId) : null)
      ?? [...conversationMessages].reverse().find((candidate) => candidate.messageType !== 'system');
    return { ...item, localPreviewText: message?.text?.trim() || previewCache[item.id] || null };
  });
}
async function withEncryptedDmPreviews(items: NotificationItem[], wires: WireNotification[]) {
  const envelopeById = new Map(wires.map((wire) => [wire.id, wire.encryptedPreviewEnvelope]));
  return Promise.all(items.map(async (item) => {
    if (item.type !== 'dm_message' || item.localPreviewText) return item;
    const envelope = envelopeById.get(item.id);
    if (!envelope) return item;
    const preview = await decryptNotificationPreviewEnvelope(envelope);
    return preview?.conversationId === item.conversationId && preview.preview?.trim()
      ? { ...item, localPreviewText: preview.preview.trim() }
      : item;
  }));
}

function reconcileSummary(summary: CentralNotificationSummary) {
  useDMStore.getState().applyUnreadSummary(summary.dmByConversation);
  useServerStore.getState().applyCentralMentionSummary(summary.mentionsByRealm);
  const activeServerUrl = useServerStore.getState().activeServerId;
  if (!activeServerUrl) return;
  const prefix = `${activeServerUrl}:`;
  useChannelStore.getState().applyMentionSummary(Object.fromEntries(
    Object.entries(summary.mentionsByChannel)
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, count]) => [key.slice(prefix.length), count]),
  ));
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  items: [],
  summary: null,
  loaded: false,

  load: async () => {
    const session = captureAccountSession();
    const userId = session.user?.id;
    if (!userId) return;
    const cachedPreviews = await loadPreviewCache(userId);
    if (!session.isCurrent()) return;
    previewCache = cachedPreviews;
    try {
      const raw = await AsyncStorage.getItem(storageKey(userId));
      if (raw && session.isCurrent()) {
        const parsed = JSON.parse(raw) as NotificationItem[];
        set({ items: Array.isArray(parsed) ? pruneExpired(parsed) : [] });
      }
    } catch {
      // ignore cache failures
    }
    if (session.isCurrent()) await get().refresh();
  },

  refresh: async () => {
    const session = captureAccountSession();
    const userId = session.user?.id;
    if (!userId) return;
    try {
      const api = createAuthenticatedApi();
      const [itemsRes, summaryRes] = await Promise.all([
        api.get<WireNotification[]>('/api/notifications', { params: { limit: 100, deviceId: await getLocalDeviceId() } }),
        api.get<CentralNotificationSummary>('/api/notifications/summary'),
      ]);
      const mapped = withLocalDmPreviews(pruneExpired(itemsRes.data.map(mapWireNotification).filter((item): item is NotificationItem => !!item)));
      const items = await withEncryptedDmPreviews(mapped, itemsRes.data);
      if (!session.isCurrent()) return;
      set({ items, summary: summaryRes.data, loaded: true });
      reconcileSummary(summaryRes.data);
      void persist(userId, items);
      void persistPreviewCache(userId, items);
    } catch {
      if (session.isCurrent()) set({ loaded: true });
    }
  },

  applySummary: (summary) => {
    set({ summary });
    reconcileSummary(summary);
  },

  prependFromWire: (wire) => {
    const userId = captureAccountSession().user?.id;
    if (!userId) return;
    const notification = mapWireNotification(wire);
    if (!notification) return;
    const items = get().items.some((item) => item.id === notification.id)
      ? get().items
      : withLocalDmPreviews([notification, ...get().items].slice(0, 100));
    set({ items });
    void persist(userId, items);
    void persistPreviewCache(userId, items);
  },

  hydrateDmPreviews: () => {
    const userId = captureAccountSession().user?.id;
    if (!userId) return;
    const items = withLocalDmPreviews(get().items);
    set({ items });
    void persist(userId, items);
    void persistPreviewCache(userId, items);
  },

  cacheDmPreview: (notificationId, conversationId, preview) => {
    const userId = captureAccountSession().user?.id;
    if (!userId) return;
    const trimmed = preview.trim();
    if (!trimmed) return;
    previewCache[notificationId] = trimmed;
    const items = get().items.map((item) =>
      item.type === 'dm_message' && item.id === notificationId && item.conversationId === conversationId
        ? { ...item, localPreviewText: trimmed }
        : item
    );
    set({ items });
    void persist(userId, items);
    void persistPreviewCacheMap(userId);
  },

  resolveFriendRequest: (requestId, outcome) => {
    const userId = captureAccountSession().user?.id;
    if (!userId) return;
    const items = get().items.map((item) =>
      item.type === 'friend_request' && item.requestId === requestId
        ? { ...item, outcome }
        : item,
    );
    set({ items });
    void persist(userId, items);
  },

  markDMRead: async (conversationId) => {
    const session = captureAccountSession();
    const userId = session.user?.id;
    if (!userId) return;
    try {
      await createAuthenticatedApi().post('/api/notifications/read-stream', { streamKind: 'dm', streamId: conversationId });
    } catch {
      // DM route also marks read; this is a best-effort convergence helper.
    }
    if (!session.isCurrent()) return;
    const items = get().items.map((item) =>
      item.type === 'dm_message' && item.conversationId === conversationId
        ? { ...item, read: true, count: 0 }
        : item,
    );
    set({ items });
    void persist(userId, items);
    void get().refresh();
  },

  clear: async () => {
    const session = captureAccountSession();
    const userId = session.user?.id;
    if (!userId) return;
    try {
      await createAuthenticatedApi().post('/api/notifications/read-all');
    } catch {
      // local cache still clears optimistically
    }
    if (!session.isCurrent()) return;
    set({ items: [] });
    await AsyncStorage.removeItem(storageKey(userId));
  },
}));
