import { create } from 'zustand';
import { createAuthenticatedApi } from '../../lib/authApi';

const PREVIEW_CACHE_KEY = 'catrealm.notification-dm-previews.v1';
import { useDMStore } from '../../stores/dmStore';
import { useServerStore } from '../../stores/serverStore';
import { getLocalDeviceId } from '../../lib/deviceIdentity';
import { decryptNotificationPreviewEnvelope } from '../crypto/notificationPreviewCrypto';
import { dismissDesktopNotifications } from '../../lib/desktopNotifications';

let refreshSequence = 0;
let summarySequence = 0;

export interface CentralNotificationSummary {
  totalUnread: number;
  unreadDMs: number;
  unreadMentions: number;
  dmByConversation: Record<string, number>;
  mentionsByRealm: Record<string, number>;
  mentionsByChannel: Record<string, number>;
}

export interface CentralNotification {
  id: string;
  type: 'dm_message' | 'friend_request' | 'server_mention' | string;
  sourceKind: string;
  sourceId: string;
  subsourceId: string | null;
  messageId: string | null;
  actorName: string | null;
  createdAt: number;
  readAt: number | null;
  payload: Record<string, unknown> | null;
  localPreviewText?: string | null;
  encryptedPreviewEnvelope?: string;
}

interface NotificationState {
  items: CentralNotification[];
  summary: CentralNotificationSummary | null;
  loaded: boolean;
  refresh: () => Promise<void>;
  applySummary: (summary: CentralNotificationSummary) => void;
  prepend: (notification: CentralNotification) => void;
  markRead: (notificationId: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  hydrateDmPreviews: () => void;
}

function readPreviewCache(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(PREVIEW_CACHE_KEY) || '{}') as Record<string, string>; } catch { return {}; }
}
function writePreviewCache(items: CentralNotification[]) {
  const next = Object.fromEntries(items
    .filter((item) => item.type === 'dm_message' && item.localPreviewText)
    .map((item) => [item.id, item.localPreviewText as string]));
  localStorage.setItem(PREVIEW_CACHE_KEY, JSON.stringify(next));
}
function withLocalDmPreviews(items: CentralNotification[]) {
  const messagesByConversation = useDMStore.getState().messagesByConversation;
  const cached = readPreviewCache();
  return items.map((item) => {
    if (item.type !== 'dm_message') return item;
    const message = (messagesByConversation[item.sourceId] ?? []).find((candidate) => candidate.id === item.messageId)
      ?? [...(messagesByConversation[item.sourceId] ?? [])].reverse().find((candidate) => candidate.messageType !== 'system');
    return { ...item, localPreviewText: message?.text?.trim() || cached[item.id] || null };
  });
}
async function withEncryptedDmPreviews(items: CentralNotification[]) {
  return Promise.all(items.map(async (item) => {
    if (item.type !== 'dm_message' || item.localPreviewText || !item.encryptedPreviewEnvelope) return item;
    const preview = await decryptNotificationPreviewEnvelope(item.encryptedPreviewEnvelope);
    return preview?.conversationId === item.sourceId && preview.preview?.trim()
      ? { ...item, localPreviewText: preview.preview.trim() }
      : item;
  }));
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  items: [],
  summary: null,
  loaded: false,

  refresh: async () => {
    const requestSequence = ++refreshSequence;
    const currentSummarySequence = summarySequence;
    try {
      const api = createAuthenticatedApi();
      const [itemsRes, summaryRes] = await Promise.all([
        api.get<CentralNotification[]>('/api/notifications', { params: { limit: 100, deviceId: getLocalDeviceId() } }),
        api.get<CentralNotificationSummary>('/api/notifications/summary'),
      ]);
      const items = await withEncryptedDmPreviews(withLocalDmPreviews(itemsRes.data));
      if (requestSequence !== refreshSequence) return;
      if (currentSummarySequence !== summarySequence) {
        void get().refresh();
        return;
      }
      set({ items, summary: summaryRes.data, loaded: true });
      writePreviewCache(items);
      useDMStore.getState().applyUnreadSummary(summaryRes.data.dmByConversation);
      useServerStore.getState().applyCentralMentionSummary(
        summaryRes.data.mentionsByChannel,
      );
    } catch {
      set({ loaded: true });
    }
  },

  applySummary: (summary) => {
    summarySequence += 1;
    const now = Math.floor(Date.now() / 1000);
    for (const item of get().items) {
      if (item.type === 'dm_message' && !summary.dmByConversation[item.sourceId]) {
        dismissDesktopNotifications('dm', item.sourceId);
      } else if (item.type === 'server_mention' && item.subsourceId
        && !summary.mentionsByChannel[`${item.sourceId}:${item.subsourceId}`]) {
        dismissDesktopNotifications('server', item.sourceId, item.subsourceId);
      }
    }
    set((state) => ({
      summary,
      items: state.items.map((item) => {
        const dmRead = item.type === 'dm_message' && !summary.dmByConversation[item.sourceId];
        const mentionRead = item.type === 'server_mention'
          && !summary.mentionsByChannel[`${item.sourceId}:${item.subsourceId}`];
        return (dmRead || mentionRead) && !item.readAt ? { ...item, readAt: now } : item;
      }),
    }));
    useDMStore.getState().applyUnreadSummary(summary.dmByConversation);
    useServerStore.getState().applyCentralMentionSummary(summary.mentionsByChannel);
  },

  prepend: (notification) =>
    set((state) => {
      const items = state.items.some((item) => item.id === notification.id)
        ? state.items
        : withLocalDmPreviews([notification, ...state.items].slice(0, 100));
      writePreviewCache(items);
      return { items };
    }),

  markRead: async (notificationId) => {
    await createAuthenticatedApi().post(`/api/notifications/${notificationId}/read`);
    set((state) => ({
      items: state.items.map((item) => item.id === notificationId
        ? { ...item, readAt: item.readAt ?? Math.floor(Date.now() / 1000) }
        : item),
    }));
    void useNotificationStore.getState().refresh();
  },

  hydrateDmPreviews: () => set((state) => {
    const items = withLocalDmPreviews(state.items);
    writePreviewCache(items);
    return { items };
  }),

  markAllRead: async () => {
    await createAuthenticatedApi().post('/api/notifications/read-all');
    const now = Math.floor(Date.now() / 1000);
    set((state) => ({
      items: state.items.map((item) => ({ ...item, readAt: item.readAt ?? now })),
    }));
    void useNotificationStore.getState().refresh();
  },
}));
