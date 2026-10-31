import { createApi } from './api';
import { useChannelStore } from '../stores/channelStore';
import { useServerStore, type ServerSnapshot } from '../stores/serverStore';

/**
 * Realm read state: seeds unread counts for messages that arrived while the client wasn't
 * listening (app closed, asleep, socket down). Live `message:new` handling keeps them current
 * afterwards. Each realm's `GET /api/channels/read-state` compares its latest message per
 * channel with the read position MessageList already saves; realms without it return 404.
 */
type ChannelReadState = { unread: boolean; unreadCount?: number; muted: boolean };

const THROTTLE_MS = 30_000;
const lastSeededAt = new Map<string, number>();
const unsupported = new Set<string>();

export function emptyServerSnapshot(): ServerSnapshot {
  return {
    channels: [],
    categories: [],
    activeChannelId: null,
    messagesByChannel: {},
    messagesByThread: {},
    onlineUsers: [],
    allMembers: [],
    threadsByChannel: {},
    prefsByChannel: {},
    unreadByChannel: {},
    mentionByChannel: {},
    channelListFetchedAt: null,
    categoryListFetchedAt: null,
  };
}

/** Server count wins when it knows of more; channels it reports as read are cleared. */
export function mergeReadState(
  current: Record<string, number>,
  channels: Record<string, ChannelReadState>,
  skipChannelId: string | null,
): Record<string, number> {
  const next = { ...current };
  for (const [id, state] of Object.entries(channels)) {
    if (id === skipChannelId) continue;
    next[id] = state.unread && !state.muted ? Math.max(next[id] ?? 0, state.unreadCount ?? 1) : 0;
  }
  return next;
}

/** Fetch a realm's read state and fold it into the open channel list or that realm's snapshot. */
export async function seedRealmReadState(serverUrl: string, token: string | null | undefined): Promise<void> {
  if (unsupported.has(serverUrl) || Date.now() - (lastSeededAt.get(serverUrl) ?? 0) < THROTTLE_MS) return;
  lastSeededAt.set(serverUrl, Date.now());
  let channels: Record<string, ChannelReadState>;
  try {
    const res = await createApi(serverUrl, token ?? undefined).get<{ channels: Record<string, ChannelReadState> }>('/api/channels/read-state');
    channels = res.data?.channels ?? {};
  } catch (err: unknown) {
    if ((err as { response?: { status?: number } })?.response?.status === 404) unsupported.add(serverUrl);
    return;
  }

  const servers = useServerStore.getState();
  // Decentral accounts have no activeServerUrl; their only realm is the open one.
  if (!servers.activeServerUrl || servers.activeServerUrl === serverUrl) {
    const channelState = useChannelStore.getState();
    useChannelStore.setState({ unreadByChannel: mergeReadState(channelState.unreadByChannel, channels, channelState.activeChannelId) });
    return;
  }
  useServerStore.setState((state) => {
    const snapshot = state.snapshots[serverUrl] ?? emptyServerSnapshot();
    return {
      snapshots: {
        ...state.snapshots,
        [serverUrl]: { ...snapshot, unreadByChannel: mergeReadState(snapshot.unreadByChannel, channels, null) },
      },
    };
  });
}
