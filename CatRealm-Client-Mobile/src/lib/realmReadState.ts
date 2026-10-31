/**
 * Realm read state — which channels have messages you haven't seen.
 *
 * Mobile only holds a socket to the open realm, so live `message:new` counting misses
 * everything that arrives on other realms or while the app is backgrounded. Each realm's
 * `GET /api/channels/read-state` compares its latest message per channel with the user's
 * `last_read_at`; we seed channel highlights and server-icon dots from it, and write the
 * read position back when a channel is viewed. Realms without the endpoint just skip it.
 */

import { create } from 'zustand';
import { createApi } from '@/lib/api';
import { useChannelStore } from '@/stores/channelStore';
import { useMessageStore } from '@/stores/messageStore';

// `unreadCount` (capped at 100) is newer than `unread`; older realms only send the flag.
type ChannelReadState = { lastMessageAt: number; lastReadAt: number; muted: boolean; unread: boolean; unreadCount?: number };
type RealmAuth = { serverUrl: string; token?: string };

/** Unread (unmuted) channel count per realm URL, for server icons. */
export const useRealmUnreadStore = create<{ byServer: Record<string, number> }>(() => ({ byServer: {} }));

const SERVER_THROTTLE_MS = 30_000;
const PREFETCH_LIMIT = 3;
const lastFetchedAt = new Map<string, number>();
/** Channel ids each realm reported, so a realm's count can be recomputed from local state. */
const channelsByServer = new Map<string, { id: string; muted: boolean }[]>();
/** Realms that answered 404 (older server builds); not asked again this session. */
const unsupported = new Set<string>();

const nowSeconds = () => Math.floor(Date.now() / 1000);

async function fetchReadState({ serverUrl, token }: RealmAuth): Promise<Record<string, ChannelReadState> | null> {
  if (unsupported.has(serverUrl)) return null;
  try {
    const res = await createApi(serverUrl, token).get<{ channels: Record<string, ChannelReadState> }>('/api/channels/read-state');
    lastFetchedAt.set(serverUrl, Date.now());
    const channels = res.data?.channels ?? {};
    channelsByServer.set(serverUrl, Object.entries(channels).map(([id, state]) => ({ id, muted: state.muted })));
    return channels;
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 404) unsupported.add(serverUrl);
    return null;
  }
}

function setServerUnread(serverUrl: string, count: number) {
  const byServer = useRealmUnreadStore.getState().byServer;
  if ((byServer[serverUrl] ?? 0) === count) return;
  useRealmUnreadStore.setState({ byServer: { ...byServer, [serverUrl]: count } });
}

/** The open realm: highlight unread channels and preload a few so tapping one is instant. */
export async function syncActiveRealmReadState(auth: RealmAuth): Promise<void> {
  const channels = await fetchReadState(auth);
  if (!channels) return;
  const channelStore = useChannelStore.getState();
  const activeChannelId = channelStore.activeChannelId;
  const unreadIds = Object.entries(channels)
    .filter(([id, state]) => state.unread && !state.muted && id !== activeChannelId)
    .map(([id]) => id);
  const unreadCounts = Object.fromEntries(unreadIds.map((id) => [id, Math.max(1, channels[id].unreadCount ?? 1)]));
  channelStore.applyReadState(Object.keys(channels), unreadCounts);
  setServerUnread(auth.serverUrl, unreadIds.length);
  const messages = useMessageStore.getState();
  for (const id of unreadIds.slice(0, PREFETCH_LIMIT)) void messages.fetchMessages(id, undefined, auth);
}

/** Other realms: refresh their server-icon dots, at most every 30s per realm. */
export async function syncRealmUnreadCounts(realms: RealmAuth[]): Promise<void> {
  await Promise.all(realms.map(async (realm) => {
    if (Date.now() - (lastFetchedAt.get(realm.serverUrl) ?? 0) < SERVER_THROTTLE_MS) return;
    lastFetchedAt.set(realm.serverUrl, Date.now()); // claim the slot before awaiting, so overlapping calls skip
    const channels = await fetchReadState(realm);
    if (!channels) return;
    setServerUnread(realm.serverUrl, Object.values(channels).filter((state) => state.unread && !state.muted).length);
  }));
}

/** Recount a realm from local channel counts, e.g. when leaving it, without a request. */
export function recountRealmUnread(serverUrl: string): void {
  const known = channelsByServer.get(serverUrl);
  if (!known) return;
  const unread = useChannelStore.getState().unreadByChannel;
  setServerUnread(serverUrl, known.filter((channel) => !channel.muted && (unread[channel.id] ?? 0) > 0).length);
}

/** Record that the user has seen a channel up to now (also keeps other devices in sync). */
export function markRealmChannelRead({ serverUrl, token }: RealmAuth, channelId: string): void {
  void createApi(serverUrl, token).patch(`/api/channels/${channelId}/prefs`, { lastReadAt: nowSeconds() }).catch(() => {});
}
