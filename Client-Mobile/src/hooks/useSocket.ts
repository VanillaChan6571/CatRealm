/**
 * useSocket — mounts the server socket and routes events into the Zustand stores.
 * Call exactly once, inside app/(app)/_layout.tsx (the authenticated shell).
 *
 * Mirrors the logic of CatRealm-Client/src/hooks/useSocket.ts but adapted for
 * React Native (no window.location).
 */

import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import axios from 'axios';
import type { ActivityType, Message, Channel, Category, OnlineUser, GroupChatReaction, Reaction } from '@/types';
import { useChannelStore } from '@/stores/channelStore';
import { AUTH_BASE, createAuthenticatedApi } from '@/lib/api';
import { useNowPlayingStore } from '@/stores/nowPlayingStore';
import { connectSocket, disconnectSocket, resolveServerSocketToken, setActiveSocketUrl } from '@/lib/socket';
import { useAuthStore } from '@/stores/authStore';
import { useServerStore } from '@/stores/serverStore';
import { useMessageStore } from '@/stores/messageStore';
import { useDMStore } from '@/stores/dmStore';
import { usePresenceStore } from '@/stores/presenceStore';
import { useFriendStore } from '@/stores/friendStore';
import { useBlockedUsersStore } from '@/stores/blockedUsersStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { useGroupChatStore } from '@/stores/groupChatStore';
import { playNotificationSound } from '@/lib/notificationSounds';
import type { RawGroupMessage } from '@/stores/groupChatStore';
import { useVoiceStore, type RawVoiceUser } from '@/stores/voiceStore';
import { useTheaterStore, type RawTheaterUser } from '@/stores/theaterStore';
import { useTheaterChatPreviewStore } from '@/stores/theaterChatPreviewStore';
import { useCallStore } from '@/stores/callStore';
import { debugLog } from '@/lib/debugLog';
import { fetchDMKeyManifest, loadConversationSecretForCurrentDevice, syncTrustedDeviceKeysForConversation } from '@/lib/dmKeyStore';
import { getLocalDeviceId } from '@/lib/deviceIdentity';
import { useDMKeyReverificationStore } from '@/stores/dmKeyReverificationStore';
import { captureAccountSession } from '@/lib/accountSession';
import { markRealmChannelRead, recountRealmUnread, syncActiveRealmReadState, syncRealmUnreadCounts } from '@/lib/realmReadState';

const SUSPENSION_RESYNC_THRESHOLD_MS = 5000;
const channelTypingExpiry = new Map<string, ReturnType<typeof setTimeout>>();

// E2EE key-recovery throttles. Module-level so socket effect remounts don't
// reset them: every manifest/keys fetch counts against the shared per-user
// dmKeysLimiter bucket (120/min across ALL devices), and an unthrottled
// reconcile loop can exhaust that budget.
let lastDMKeyReconcileAt = 0;
const DM_KEY_RECONCILE_MIN_GAP_MS = 5 * 60 * 1000;
const dmKeyRequestSentAt = new Map<string, number>();
const DM_KEY_REQUEST_COOLDOWN_MS = 5 * 60 * 1000;
const dmKeyFulfillAt = new Map<string, number>();
const DM_KEY_FULFILL_COOLDOWN_MS = 60 * 1000;

export function useSocket() {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const token = useAuthStore((s) => s.token);
  const accountSwitching = useAuthStore((s) => s.accountSwitching);
  const accountType = useAuthStore((s) => s.user?.accountType);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const activeServer = useServerStore((s) =>
    s.activeServerId ? s.byId(s.activeServerId) : undefined,
  );

  const socketUrl = accountSwitching ? null : activeServer?.url ?? serverUrl;
  // A Central session is never a realm credential, including while a realm
  // token is missing or being refreshed.
  const socketToken = accountSwitching ? null : resolveServerSocketToken(accountType, activeServer?.token, token);
  const dmSocketUrl = accountType === 'central' ? AUTH_BASE : socketUrl;
  const dmSocketToken = accountSwitching ? null : token;

  useEffect(() => {
    if (!socketUrl || !socketToken) {
      debugLog('useSocket', 'skip:missing-socket-creds', {
        hasSocketUrl: Boolean(socketUrl),
        hasSocketToken: Boolean(socketToken),
      });
      setActiveSocketUrl(null);
      return;
    }

    debugLog('useSocket', 'connect:server-socket', {
      socketUrl,
      activeServerId,
    });
    setActiveSocketUrl(socketUrl);
    const socket = connectSocket(socketUrl, socketToken);
    const memberSnapshotById = new Map<string, OnlineUser>();
    let fetchMembersInFlight = false;
    let lastMemberFetchAt = 0;

    const mergeWithMemberSnapshot = (users: OnlineUser[]): OnlineUser[] =>
      users.map((user) => {
        const snapshot = memberSnapshotById.get(user.id);
        if (!snapshot) return user;
        return {
          ...user,
          // status intentionally NOT taken from snapshot — snapshot holds stored profile
          // status (always 'online'), live presence event is the authoritative source
          customStatusText: user.customStatusText ?? snapshot.customStatusText,
          activityType: user.activityType ?? snapshot.activityType,
          activityText: user.activityText ?? snapshot.activityText,
          activityStartedAt: user.activityStartedAt ?? snapshot.activityStartedAt,
        };
      });

    const applyPresenceUsers = (users: OnlineUser[]) => {
      const serverId = useServerStore.getState().activeServerId;
      const merged = mergeWithMemberSnapshot(users);
      const onlineIds = new Set(merged.map((u) => u.id));
      const offlineUsers: OnlineUser[] = [];
      for (const member of memberSnapshotById.values()) {
        if (!onlineIds.has(member.id)) {
          offlineUsers.push({ ...member, status: 'invisible' });
        }
      }
      debugLog('useSocket', 'applyPresence', {
        eventCount: users.length,
        mergedOnline: merged.length,
        snapshotSize: memberSnapshotById.size,
        offlineAdded: offlineUsers.length,
        sample: offlineUsers.slice(0, 3).map((u) => ({ id: u.id.slice(0, 8), status: u.status, name: u.username })),
      });
      if (serverId) useServerStore.getState().setOnlineUsers(serverId, [...merged, ...offlineUsers]);
      usePresenceStore.getState().upsertMany([
        ...merged.map((u) => ({
          userId: u.id,
          status: u.status ?? 'invisible',
          customStatusText: u.customStatusText,
          activityType: u.activityType as ActivityType | null,
          activityText: u.activityText,
          activityStartedAt: u.activityStartedAt,
        })),
        // Upsert offline members with invisible so profile views show "Offline" instead of
        // falling back to the stale DB-stored status (which is always 'online').
        ...offlineUsers.map((u) => ({
          userId: u.id,
          status: 'invisible' as const,
          customStatusText: null,
          activityType: null as ActivityType | null,
          activityText: null,
          activityStartedAt: null,
        })),
      ]);
    };

    const fetchAllMembers = async () => {
      if (fetchMembersInFlight) return;
      fetchMembersInFlight = true;
      try {
        const res = await axios.get<OnlineUser[]>(`${socketUrl.replace(/\/+$/, '')}/api/users`, {
          headers: { Authorization: `Bearer ${socketToken}`, 'X-CatRealm-Client': 'mobile' },
          timeout: 15000,
        });
        memberSnapshotById.clear();
        for (const user of res.data ?? []) {
          memberSnapshotById.set(user.id, user);
        }
        lastMemberFetchAt = Date.now();
        debugLog('useSocket', 'fetchAllMembers:done', {
          total: res.data?.length ?? 0,
          sample: (res.data ?? []).slice(0, 6).map((u) => ({ name: u.username, status: u.status })),
        });
        usePresenceStore.getState().setAllMembers(res.data ?? []);
      } catch (err) {
        debugLog('useSocket', 'fetchAllMembers:error', { err: String(err) });
        // Keep last known snapshot map.
      } finally {
        fetchMembersInFlight = false;
      }
    };

    const fetchVoiceRooms = () => {
      socket.emit('voice:rooms:get', (resp: {
        rooms?: Array<{ channelId: string; count: number; users?: RawVoiceUser[]; startedAt?: number | null }>;
      }) => {
        if (!resp?.rooms) return;
        useVoiceStore.getState().handleRoomsSnapshot({ rooms: resp.rooms });
      });
    };

    const fetchTheaterRooms = () => {
      socket.emit('theater:rooms:get', (resp: {
        rooms?: Array<{ channelId: string; users: RawTheaterUser[]; startedAt: number | null }>;
      }) => {
        if (!resp?.rooms) return;
        useTheaterStore.getState().handleRoomsSnapshot({ rooms: resp.rooms });
      });
    };

    const emitAppState = (state: AppStateStatus, target: typeof socket) => {
      target.emit(state === 'active' ? 'client:foreground' : 'client:background');
    };

    // Debounce the heavy resync so rapid state flickers (active→inactive→active) don't hammer the API
    let lastResyncAt = 0;
    const RESYNC_DEBOUNCE_MS = 3000;
    // Track suspension time — if the app was backgrounded long enough, bypass debounce on return
    let suspendedAt: number | null = null;

    const resyncChannel = () => {
      const now = Date.now();
      if (now - lastResyncAt < RESYNC_DEBOUNCE_MS) return;
      lastResyncAt = now;

      const channelId = useChannelStore.getState().activeChannelId;
      if (channelId) {
        // Re-join so the server restores room membership for future message:new events
        socket.emit('channel:join', channelId);
        // Fetch latest page — prependMessages merges+sorts chronologically, no flash.
        // Pass the socket's own url+token: createApi()'s implicit active-server
        // resolution can race store hydration and end up with no baseURL.
        void useMessageStore.getState().fetchMessages(channelId, undefined, { serverUrl: socketUrl, token: socketToken });
      }
      // Wipe stale typing indicators — server won't re-send typing:stop for missed events
      useMessageStore.setState({ typingByChannel: {} });
      // Highlight channels that got messages while we weren't listening, here and on other realms.
      void syncActiveRealmReadState({ serverUrl: socketUrl, token: socketToken });
      void syncRealmUnreadCounts(useServerStore.getState().servers
        .filter((server) => server.url !== socketUrl && server.token)
        .map((server) => ({ serverUrl: server.url, token: server.token })));
      void fetchAllMembers();
      fetchVoiceRooms();
      fetchTheaterRooms();
    };

    const onServerConnect = () => {
      emitAppState(AppState.currentState, socket);
      resyncChannel();
    };

    const onAppStateChange = (state: AppStateStatus) => {
      emitAppState(state, socket);
      if (state === 'active') {
        // If the app was suspended long enough, bypass the debounce to force a fresh resync —
        // a meaningful suspension likely means missed messages/events the debounce would otherwise skip
        if (suspendedAt !== null && Date.now() - suspendedAt > SUSPENSION_RESYNC_THRESHOLD_MS) {
          lastResyncAt = 0;
        }
        suspendedAt = null;
        // When the app returns to foreground, resync even if the socket never dropped —
        // iOS keeps TCP alive during suspension so onServerConnect may not fire
        resyncChannel();
      } else {
        suspendedAt = Date.now();
        // Leaving the app counts as having read the open channel up to now.
        const openChannelId = useChannelStore.getState().activeChannelId;
        if (openChannelId) markRealmChannelRead({ serverUrl: socketUrl, token: socketToken }, openChannelId);
      }
    };

    socket.on('connect', onServerConnect);
    const appStateSub = AppState.addEventListener('change', onAppStateChange);
    // If already connected when effect mounts, initialise immediately
    if (socket.connected) {
      onServerConnect();
    } else {
      void fetchAllMembers();
      fetchVoiceRooms();
      fetchTheaterRooms();
    }

    socket.on('message:new', (msg: Message) => {
      useMessageStore.getState().appendMessage(msg.channel_id, msg);
      useTheaterChatPreviewStore.getState().receive(socketUrl, msg);

      const currentUser = useAuthStore.getState().user;
      if (!currentUser || msg.user_id === currentUser.id || msg.message_type === 'system') return;
      const channelId = msg.channel_id;
      const activeChannelId = useChannelStore.getState().activeChannelId;
      const settings = useSettingsStore.getState();

      if (activeChannelId === channelId) {
        useChannelStore.getState().resetCounts(channelId);
        if (currentUser.accountType === 'central' && socketUrl) {
          void createAuthenticatedApi().post('/api/notifications/read-stream', {
            streamKind: 'server',
            streamId: socketUrl,
            subsourceId: channelId,
          }).catch(() => {});
        }
        if (settings.notificationsEnabled && settings.soundMessageInChannel) {
          const vol = settings.soundVolumes?.soundMessageInChannel ?? 100;
          void playNotificationSound('message-in-channel', vol);
        }
        return;
      }

      const content = msg.content ?? '';
      const usernameMention = new RegExp(`(^|\\s)@${currentUser.username}(\\b|$)`, 'i').test(content);
      const uuidMention = new RegExp(`(^|\\s)@${currentUser.id}(\\b|$)`, 'i').test(content);
      const isMention = usernameMention || uuidMention;
      const isEveryone = /@everyone\b|@here\b/i.test(content);
      useChannelStore.getState().incrementUnread(channelId, useAuthStore.getState().user?.accountType === 'central' ? false : isMention);

      if (!settings.notificationsEnabled) return;
      if (isMention && settings.soundMessageMention) {
        void playNotificationSound('message-mention', settings.soundVolumes?.soundMessageMention ?? 100);
      } else if (isEveryone && settings.soundMessageEveryone) {
        void playNotificationSound('message-everyone', settings.soundVolumes?.soundMessageEveryone ?? 100);
      } else if (settings.soundMessageInServer) {
        void playNotificationSound('message-in-server', settings.soundVolumes?.soundMessageInServer ?? 100);
      }
    });

    socket.on('bot:ephemeral', (msg: {
      interactionId?: string;
      channelId: string;
      botUserId: string;
      username: string;
      displayName?: string | null;
      avatar?: string | null;
      content: string;
      interaction?: Message['interaction'];
      created_at: number;
    }) => {
      useMessageStore.getState().appendMessage(msg.channelId, {
        id: `ephemeral:${msg.interactionId ?? `${msg.botUserId}:${msg.created_at}`}`,
        channel_id: msg.channelId,
        user_id: msg.botUserId,
        username: msg.username,
        display_name: msg.displayName ?? null,
        avatar: msg.avatar ?? null,
        content: msg.content,
        edited: 0,
        is_bot: 1,
        message_type: 'user',
        created_at: msg.created_at,
        interaction: msg.interaction ?? null,
        ephemeral: true,
      });
    });

    socket.on('message:edited', (msg: Message) => {
      useMessageStore.getState().updateMessage(msg.channel_id, msg);
      useTheaterChatPreviewStore.getState().invalidate(socketUrl, msg.channel_id, msg.id);
    });

    socket.on(
      'message:deleted',
      ({ messageId, channelId }: { messageId: string; channelId: string }) => {
        useMessageStore.getState().removeMessage(channelId, messageId);
        useTheaterChatPreviewStore.getState().invalidate(socketUrl, channelId, messageId);
      },
    );

    socket.on(
      'message:reaction:update',
      ({ messageId, channelId, reactions }: { messageId: string; channelId: string; threadId?: string | null; reactions: Reaction[] }) => {
        useMessageStore.getState().applyReactionUpdate(channelId, messageId, reactions, useAuthStore.getState().user?.id);
      },
    );

    socket.on(
      'typing:update',
      ({
        channelId,
        users,
        username,
        typing,
      }: {
        channelId: string;
        users?: string[];
        username?: string;
        typing?: boolean;
      }) => {
        const messageStore = useMessageStore.getState();
        if (Array.isArray(users)) {
          messageStore.setTypingUsers(channelId, users);
          return;
        }
        if (!username) return;
        const current = messageStore.typingByChannel[channelId] ?? [];
        const next = typing
          ? Array.from(new Set([...current, username]))
          : current.filter((name) => name !== username);
        messageStore.setTypingUsers(channelId, next);
        // Typers re-send start every ~2.5s; drop one after 6s of silence in case the stop was lost.
        const key = `${channelId}:${username}`;
        clearTimeout(channelTypingExpiry.get(key));
        channelTypingExpiry.delete(key);
        if (typing) {
          channelTypingExpiry.set(key, setTimeout(() => {
            channelTypingExpiry.delete(key);
            const latest = useMessageStore.getState().typingByChannel[channelId] ?? [];
            useMessageStore.getState().setTypingUsers(channelId, latest.filter((name) => name !== username));
          }, 6000));
        }
      },
    );

    socket.on('presence:update', (users: OnlineUser[]) => {
      usePresenceStore.getState().setOnlineUsers(users);
      applyPresenceUsers(users);
      const now = Date.now();
      if (now - lastMemberFetchAt > 15000) {
        void fetchAllMembers().then(() => applyPresenceUsers(users));
      }
    });

    socket.on('channel:list', (channels: Channel[]) => {
      const serverId = useServerStore.getState().activeServerId;
      debugLog('useSocket', 'event:channel:list', {
        serverId,
        count: channels.length,
        ids: channels.map((ch) => ch.id),
      });
      if (serverId) useServerStore.getState().setChannels(serverId, channels);
    });

    socket.on('category:list', (categories: Category[]) => {
      const serverId = useServerStore.getState().activeServerId;
      debugLog('useSocket', 'event:category:list', {
        serverId,
        count: categories.length,
        ids: categories.map((cat) => cat.id),
      });
      if (serverId) useServerStore.getState().setCategories(serverId, categories);
    });

    socket.on('connect_error', (err: Error) => {
      const fatal = ['Invalid token', 'No token', 'Removed from server', 'Banned from server'];
      if (fatal.some((f) => err.message.includes(f))) {
        useAuthStore.getState().signOut();
      }
    });

    // ── Voice events ──────────────────────────────────────────────────────────
    socket.on('voice:users', (payload) => {
      useVoiceStore.getState().handleVoiceUsers(payload);
    });
    socket.on('voice:join:ok', (payload) => {
      useVoiceStore.getState().handleVoiceUsers(payload);
    });
    socket.on('voice:user-joined', (payload) => {
      const wasInChannel = useVoiceStore.getState().channelId === payload.channelId;
      useVoiceStore.getState().handleUserJoined(payload);
      if (wasInChannel) {
        const settings = useSettingsStore.getState();
        if (settings.notificationsEnabled && settings.soundVoiceUserJoined) {
          void playNotificationSound('voice-user-joined', settings.soundVolumes?.soundVoiceUserJoined ?? 100);
        }
      }
    });
    socket.on('voice:user-left', (payload) => {
      const wasInChannel = useVoiceStore.getState().channelId === payload.channelId;
      useVoiceStore.getState().handleUserLeft(payload);
      if (wasInChannel) {
        const settings = useSettingsStore.getState();
        if (settings.notificationsEnabled && settings.soundVoiceUserLeft) {
          void playNotificationSound('voice-user-left', settings.soundVolumes?.soundVoiceUserLeft ?? 100);
        }
      }
    });
    socket.on('voice:user-state', (payload) => {
      useVoiceStore.getState().handleUserState(payload);
    });
    socket.on('voice:room-count', (payload) => {
      useVoiceStore.getState().handleRoomCount(payload);
    });
    socket.on('voice:room-sync', (payload) => {
      useVoiceStore.getState().handleRoomSync(payload);
    });
    socket.on('voice:force-disconnect', () => {
      useVoiceStore.getState().handleForceDisconnect();
    });

    // ── Theater events ────────────────────────────────────────────────────────
    socket.on('theater:users', (payload) => {
      useTheaterStore.getState().handleTheaterUsers(payload);
    });
    socket.on('theater:user-joined', (payload) => {
      useTheaterStore.getState().handleUserJoined(payload);
    });
    socket.on('theater:user-left', (payload) => {
      useTheaterStore.getState().handleUserLeft(payload);
    });
    socket.on('theater:sync', (payload) => {
      useTheaterStore.getState().handleSync(payload);
    });
    socket.on('theater:queue-updated', (payload) => {
      useTheaterStore.getState().handleQueueUpdated(payload);
    });
    socket.on('theater:host-changed', (payload) => {
      useTheaterStore.getState().handleHostChanged(payload);
    });
    socket.on('theater:room-users', (payload) => {
      useTheaterStore.getState().handleRoomUsers(payload);
    });
    socket.on('theater:user-state', (payload) => {
      useTheaterStore.getState().handleUserState(payload);
    });

    return () => {
      debugLog('useSocket', 'disconnect:server-socket', { socketUrl });
      recountRealmUnread(socketUrl);
      appStateSub.remove();
      socket.off('connect', onServerConnect);
      socket.off('message:new');
      socket.off('bot:ephemeral');
      socket.off('message:edited');
      socket.off('message:deleted');
      socket.off('message:reaction:update');
      socket.off('typing:update');
      socket.off('presence:update');
      socket.off('channel:list');
      socket.off('category:list');
      socket.off('connect_error');
      // Voice
      socket.off('voice:users');
      socket.off('voice:join:ok');
      socket.off('voice:user-joined');
      socket.off('voice:user-left');
      socket.off('voice:user-state');
      socket.off('voice:room-count');
      socket.off('voice:room-sync');
      socket.off('voice:force-disconnect');
      // Theater
      socket.off('theater:users');
      socket.off('theater:user-joined');
      socket.off('theater:user-left');
      socket.off('theater:sync');
      socket.off('theater:queue-updated');
      socket.off('theater:host-changed');
      socket.off('theater:room-users');
      socket.off('theater:user-state');
      disconnectSocket(socketUrl);
    };
  }, [socketUrl, socketToken, activeServerId]);

  useEffect(() => {
    if (!dmSocketUrl || !dmSocketToken) return;

    debugLog('useSocket', 'connect:dm-socket', { dmSocketUrl });
    const socket = connectSocket(dmSocketUrl, dmSocketToken);
    const dmSession = captureAccountSession();
    useCallStore.getState().setSocket(accountType === 'central' ? socket : null);
    socket.on('dm:requests:changed', () => void useDMStore.getState().fetchConversations());
    let centralFriendSyncInFlight = false;
    let lastCentralFriendSyncAt = 0;
    const CENTRAL_FRIEND_SYNC_INTERVAL_MS = 60000;
    const CENTRAL_FRIEND_SYNC_MIN_GAP_MS = 12000;
    const runCentralFriendSync = async () => {
      if (useAuthStore.getState().user?.accountType !== 'central') return;
      if (centralFriendSyncInFlight) return;
      const now = Date.now();
      if (now - lastCentralFriendSyncAt < CENTRAL_FRIEND_SYNC_MIN_GAP_MS) return;
      centralFriendSyncInFlight = true;
      lastCentralFriendSyncAt = now;
      try {
        await useFriendStore.getState().fetchFriends();
        await useFriendStore.getState().fetchRequests();
        void useBlockedUsersStore.getState().fetchFromApi();
      } finally {
        centralFriendSyncInFlight = false;
      }
    };
    const centralFriendSyncTimer = globalThis.setInterval(() => {
      void runCentralFriendSync();
    }, CENTRAL_FRIEND_SYNC_INTERVAL_MS);

    let lastDMResyncAt = 0;
    const DM_RESYNC_DEBOUNCE_MS = 3000;
    let dmSuspendedAt: number | null = null;

    const resyncDM = () => {
      const now = Date.now();
      if (now - lastDMResyncAt < DM_RESYNC_DEBOUNCE_MS) return;
      lastDMResyncAt = now;
      useDMStore.setState({ typingByConversation: {} });
      const activeConversationId = useDMStore.getState().activeConversationId;
      if (activeConversationId) {
        void useDMStore.getState().fetchMessages(activeConversationId);
        void useDMStore.getState().fetchPins(activeConversationId);
      }
    };

    // Self-healing E2EE pass (parity with desktop useDMSocket): pull missing
    // wrapped keys from the server, backfill other trusted devices, and ask
    // live peers for conversations this device still can't unlock. Runs
    // sequentially and rarely — DM message loading must win the rate budget.
    const reconcileDMKeys = async (force = false) => {
      if (useAuthStore.getState().user?.accountType !== 'central') return;
      const now = Date.now();
      if (!force && now - lastDMKeyReconcileAt < DM_KEY_RECONCILE_MIN_GAP_MS) return;
      lastDMKeyReconcileAt = now;
      const deviceId = await getLocalDeviceId();
      if (useDMStore.getState().conversations.length === 0) {
        await useDMStore.getState().fetchConversations();
      }
      const conversations = useDMStore.getState().conversations;
      for (const conversation of conversations) {
        try {
          const manifest = await fetchDMKeyManifest(conversation.id);
          if (manifest.activeKeyVersion == null) continue;
          const secret = await loadConversationSecretForCurrentDevice(conversation.id, manifest.activeKeyVersion).catch(() => null);
          if (secret) {
            if (force) await syncTrustedDeviceKeysForConversation(conversation.id, manifest.activeKeyVersion, secret);
            continue;
          }
          const lastSentAt = dmKeyRequestSentAt.get(conversation.id) ?? 0;
          if (!force && now - lastSentAt < DM_KEY_REQUEST_COOLDOWN_MS) continue;
          dmKeyRequestSentAt.set(conversation.id, now);
          socket.emit('dm:keys:request', { conversationId: conversation.id, deviceId });
        } catch {
          // Skip this conversation; the next reconcile pass retries.
        }
      }
    };

    const onDMConnect = () => {
      socket.emit(AppState.currentState === 'active' ? 'client:foreground' : 'client:background');
      resyncDM();
      void useCallStore.getState().recoverActiveCalls();
      void reconcileDMKeys().catch((err) => debugLog('useSocket', 'dm-keys:reconcile-failed', { err: String(err) }));
    };

    const onDMAppStateChange = (state: AppStateStatus) => {
      socket.emit(state === 'active' ? 'client:foreground' : 'client:background');
      if (state === 'active') {
        if (dmSuspendedAt !== null && Date.now() - dmSuspendedAt > SUSPENSION_RESYNC_THRESHOLD_MS) {
          lastDMResyncAt = 0;
        }
        dmSuspendedAt = null;
        resyncDM();
        void useCallStore.getState().recoverActiveCalls();
        void reconcileDMKeys().catch((err) => debugLog('useSocket', 'dm-keys:reconcile-failed', { err: String(err) }));
      } else {
        dmSuspendedAt = Date.now();
      }
    };

    socket.on('connect', onDMConnect);
    const dmAppStateSub = AppState.addEventListener('change', onDMAppStateChange);
    if (socket.connected) onDMConnect();

    socket.on('dm:message', (msg) => {
      void useDMStore.getState().appendServerMessage(msg);
      const currentUserId = useAuthStore.getState().user?.id;
      const senderId = msg?.senderId ?? msg?.sender_id;
      const isOwnMessage = currentUserId ? senderId === currentUserId : false;
      const isSystemMessage = (msg?.messageType ?? msg?.message_type) === 'system';
      if (isOwnMessage || isSystemMessage) return;
      const conversationId = msg?.conversationId ?? msg?.conversation_id;
      const activeConversationId = useDMStore.getState().activeConversationId;
      if (conversationId && activeConversationId === conversationId) {
        void useDMStore.getState().markAsRead(conversationId);
      }
      const settings = useSettingsStore.getState();
      if (!settings.notificationsEnabled || !conversationId) return;
      if (activeConversationId === conversationId && settings.soundDMMessageInCurrent) {
        const volume = settings.soundVolumes?.soundDMMessageInCurrent ?? 100;
        void playNotificationSound('dm-message-current', volume);
      } else if (settings.soundDMMessageFromOther) {
        const volume = settings.soundVolumes?.soundDMMessageFromOther ?? 100;
        void playNotificationSound('dm-message-other', volume);
      }
    });
    socket.on('dm:message:new', (msg) => {
      void useDMStore.getState().appendServerMessage(msg);
      const currentUserId = useAuthStore.getState().user?.id;
      const senderId = msg?.senderId ?? msg?.sender_id;
      const isOwnMessage = currentUserId ? senderId === currentUserId : false;
      const isSystemMessage = (msg?.messageType ?? msg?.message_type) === 'system';
      if (isOwnMessage || isSystemMessage) return;
      const conversationId = msg?.conversationId ?? msg?.conversation_id;
      const activeConversationId = useDMStore.getState().activeConversationId;
      if (conversationId && activeConversationId === conversationId) {
        void useDMStore.getState().markAsRead(conversationId);
      }
      const settings = useSettingsStore.getState();
      if (!settings.notificationsEnabled || !conversationId) return;
      if (activeConversationId === conversationId && settings.soundDMMessageInCurrent) {
        const volume = settings.soundVolumes?.soundDMMessageInCurrent ?? 100;
        void playNotificationSound('dm-message-current', volume);
      } else if (settings.soundDMMessageFromOther) {
        const volume = settings.soundVolumes?.soundDMMessageFromOther ?? 100;
        void playNotificationSound('dm-message-other', volume);
      }
    });
    socket.on('dm:typing:start', ({ userId }: { userId: string }) => {
      useDMStore.getState().setTypingByOtherUserId(userId, true);
    });
    socket.on('dm:typing:stop', ({ userId }: { userId: string }) => {
      useDMStore.getState().setTypingByOtherUserId(userId, false);
    });
    socket.on('dm:reaction:update', ({ messageId, reactions }: { messageId: string; reactions: unknown }) => {
      useDMStore.getState().applyReactionUpdate(messageId, Array.isArray(reactions) ? reactions : []);
    });
    socket.on('dm:pin:update', ({ conversationId, messageId, pinned }: { conversationId: string; messageId: string; pinned: boolean }) => {
      if (!conversationId || !messageId) return;
      useDMStore.getState().applyPinUpdate({ conversationId, messageId, pinned: Boolean(pinned) });
    });
    socket.on('dm:message:update', ({ conversationId }: { conversationId?: string }) => {
      if (!conversationId) return;
      void useDMStore.getState().fetchMessages(conversationId);
    });
    socket.on('dm:message:delete', ({ messageId }: { messageId: string }) => {
      useDMStore.getState().removeMessageLocal(messageId);
    });
    socket.on('gc:message', (raw: RawGroupMessage) => {
      const groupChatId = raw.groupChatId ?? raw.group_chat_id;
      if (!groupChatId) return;
      void useGroupChatStore.getState().appendDecryptedMessage(groupChatId, raw);
    });
    socket.on('gc:list:update', () => {
      void useGroupChatStore.getState().fetchGroups();
    });
    socket.on('gc:member:added', ({ groupChatId }: { groupChatId?: string }) => {
      if (groupChatId) void useGroupChatStore.getState().fetchGroups();
    });
    socket.on('gc:reaction:update', ({ groupChatId, messageId, reactions }: { groupChatId: string; messageId: string; reactions: unknown }) => {
      if (!groupChatId || !messageId) return;
      useGroupChatStore.getState().applyReactionUpdate(groupChatId, messageId, Array.isArray(reactions) ? (reactions as GroupChatReaction[]) : []);
    });
    socket.on('call:incoming', (p) => useCallStore.getState().handleIncomingDM(p));
    socket.on('call:initiated', (p) => useCallStore.getState().handleDMInitiated(p));
    socket.on('call:accepted', (p) => void useCallStore.getState().handleDMAccepted(p));
    socket.on('call:ended', (p) => useCallStore.getState().handleDMEnded(p));
    socket.on('call:declined', (p) => useCallStore.getState().handleDMDeclined(p));
    socket.on('call:busy', () => useCallStore.getState().handleDMBusy());
    socket.on('call:participant-joined', (p) => useCallStore.getState().handleDMParticipantJoined(p));
    socket.on('call:participant-left', (p) => useCallStore.getState().handleDMParticipantLeft(p));
    socket.on('call:handled-elsewhere', (p) => useCallStore.getState().handleDMHandledElsewhere(p));
    socket.on('call:moved-device', (p) => useCallStore.getState().handleDMMovedDevice(p));
    socket.on('call:rejoin:error', (p: { callId: string }) => useCallStore.getState().handleDMEnded({ callId: p.callId, reason: 'ended' }));
    socket.on('call:state:update', (p) => useCallStore.getState().handleParticipantState(p));
    socket.on('call:error', ({ error }: { error: string }) => useCallStore.getState().handleError(error));
    socket.on('gc:call:started', (p) => useCallStore.getState().handleGroupStarted(p));
    socket.on('gc:call:initiated', (p) => useCallStore.getState().handleGroupInitiated(p));
    socket.on('gc:call:joined', (p) => void useCallStore.getState().handleGroupJoined(p));
    socket.on('gc:call:participant-joined', (p) => useCallStore.getState().handleGroupParticipantJoined(p));
    socket.on('gc:call:participant-left', (p) => useCallStore.getState().handleGroupParticipantLeft(p));
    socket.on('gc:call:state:update', (p) => useCallStore.getState().handleParticipantState(p));
    socket.on('gc:call:ended', (p) => useCallStore.getState().handleDMEnded(p));
    socket.on('gc:call:error', ({ error }: { error: string }) => useCallStore.getState().handleError(error));

    socket.on('friends:personal-roles:update', () => {
      void useFriendStore.getState().loadPersonalRoles();
    });
    socket.on('presence:now-playing', (payload: { userId?: string; nowPlaying?: unknown }) => {
      if (typeof payload?.userId !== 'string') return;
      useNowPlayingStore.getState().setNowPlaying(payload.userId, payload.nowPlaying);
    });
    socket.on('friends:sync', () => {
      const refresh = async () => {
        await useFriendStore.getState().fetchFriends();
        await useFriendStore.getState().fetchRequests();
        await useDMStore.getState().fetchConversations();
      };
      void refresh();
    });

    // E2EE key recovery (parity with desktop useDMSocket).
    socket.on('dm:keys:requested', ({ conversationId }: { conversationId?: string }) => {
      if (!conversationId || useAuthStore.getState().user?.accountType !== 'central') return;
      // Cooldown per conversation — peers may re-request on every reconnect,
      // and each fulfillment attempt costs several rate-limited REST calls.
      const now = Date.now();
      if (now - (dmKeyFulfillAt.get(conversationId) ?? 0) < DM_KEY_FULFILL_COOLDOWN_MS) return;
      dmKeyFulfillAt.set(conversationId, now);
      void (async () => {
        const manifest = await fetchDMKeyManifest(conversationId);
        if (manifest.activeKeyVersion == null) return;
        // Pull our wrapped key from the server if it isn't cached locally —
        // a device can fulfill requests as long as an envelope exists for it.
        const secret = await loadConversationSecretForCurrentDevice(conversationId, manifest.activeKeyVersion);
        if (!secret) return;
        await syncTrustedDeviceKeysForConversation(conversationId, manifest.activeKeyVersion, secret);
      })().catch((err) => debugLog('useSocket', 'dm-keys:fulfill-failed', { conversationId, err: String(err) }));
    });
    socket.on('dm:keys:updated', ({ conversationId, deviceIds }: { conversationId?: string; deviceIds?: string[] }) => {
      if (!conversationId) return;
      void (async () => {
        const deviceId = await getLocalDeviceId();
        if (!deviceIds?.includes(deviceId)) return;
        // A peer just supplied our key — reload the open conversation.
        if (useDMStore.getState().activeConversationId === conversationId) {
          await useDMStore.getState().fetchMessages(conversationId);
        }
      })().catch(() => {});
    });
    socket.on('device:trust-updated', ({ deviceId, dmTrustState, approvalMethod }: { deviceId?: string; dmTrustState?: string; approvalMethod?: string }) => {
      if (dmTrustState !== 'trusted' || !dmSession.isCurrent()) return;
      void (async () => {
        const userId = useAuthStore.getState().user?.id;
        const localDeviceId = deviceId && approvalMethod === 'passkey-self' ? await getLocalDeviceId() : null;
        if (!dmSession.isCurrent()) return;
        if (userId && deviceId && approvalMethod === 'passkey-self' && deviceId !== localDeviceId) {
          useDMKeyReverificationStore.getState().setAccountId(userId);
          useDMKeyReverificationStore.getState().notePasskeyApprovedDevice(userId, deviceId);
        }
        await reconcileDMKeys(true);
      })().catch((err) => debugLog('useSocket', 'dm-keys:reconcile-failed', { err: String(err) }));
    });
    socket.on('dm:keys:request-status', (payload: { conversationId?: string; accepted?: boolean; reason?: string; peerSocketCount?: number }) => {
      debugLog('useSocket', 'dm-keys:request-status', payload);
    });

    socket.on('notification:new', (notification) => {
      const notificationStore = useNotificationStore.getState();
      notificationStore.prependFromWire(notification);
      void notificationStore.refresh();
    });
    socket.on('notification:summary', (summary) => {
      useNotificationStore.getState().applySummary(summary);
    });

    return () => {
      debugLog('useSocket', 'disconnect:dm-socket', { dmSocketUrl });
      dmAppStateSub.remove();
      socket.off('connect', onDMConnect);
      globalThis.clearInterval(centralFriendSyncTimer);
      socket.off('dm:message');
      socket.off('dm:requests:changed');
      socket.off('dm:message:new');
      socket.off('dm:typing:start');
      socket.off('dm:typing:stop');
      socket.off('dm:reaction:update');
      socket.off('dm:pin:update');
      socket.off('dm:message:update');
      socket.off('dm:message:delete');
      socket.off('gc:message');
      socket.off('gc:list:update');
      socket.off('gc:member:added');
      socket.off('gc:reaction:update');
      socket.off('call:incoming');
      socket.off('call:initiated');
      socket.off('call:accepted');
      socket.off('call:ended');
      socket.off('call:declined');
      socket.off('call:busy');
      socket.off('call:participant-joined');
      socket.off('call:participant-left');
      socket.off('call:handled-elsewhere');
      socket.off('call:moved-device');
      socket.off('call:rejoin:error');
      socket.off('call:state:update');
      socket.off('call:error');
      socket.off('gc:call:started');
      socket.off('gc:call:initiated');
      socket.off('gc:call:joined');
      socket.off('gc:call:participant-joined');
      socket.off('gc:call:participant-left');
      socket.off('gc:call:state:update');
      socket.off('gc:call:ended');
      socket.off('gc:call:error');
      socket.off('friends:personal-roles:update');
      socket.off('friends:sync');
      socket.off('presence:now-playing');
      socket.off('dm:keys:requested');
      socket.off('dm:keys:updated');
      socket.off('device:trust-updated');
      socket.off('dm:keys:request-status');
      disconnectSocket(dmSocketUrl);
      useCallStore.getState().setSocket(null);
    };
  }, [dmSocketToken, dmSocketUrl, accountType]);
}
