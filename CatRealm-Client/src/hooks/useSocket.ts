import { useEffect } from 'react';
import { connectSocket, getSocket, setActiveSocketUrl } from '../lib/socket';
import { useAuthStore } from '../stores/authStore';
import { attachServerSocketStatusHandlers, useServerStore } from '../stores/serverStore';
import { isRealmCredentialError, isRealmMembershipError } from '../lib/realmSocketRecovery';
import { useMessageStore } from '../stores/messageStore';
import { usePresenceStore } from '../stores/presenceStore';
import { useThreadStore } from '../stores/threadStore';
import { useUIStore } from '../stores/uiStore';
import type { Message, MessageReaction, OnlineUser, Channel, ForumPost } from '../types';
import { useChannelStore } from '../stores/channelStore';
import { useVoiceStore, type VoiceSignal } from '../stores/voiceStore';
import { useTheaterStore } from '../stores/theaterStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useFriendStore } from '../stores/friendStore';
import { useBotStore, type EphemeralBotMessage } from '../stores/botStore';
import { clearRealtimeReconnectTarget, getRealtimeReconnectTarget, persistRealtimeReconnectTarget } from '../lib/realtimeReconnect';
import { saveSession } from '../utils/token';
import { playNotificationSound } from '../lib/notificationSounds';
import { isAppInBackground, messageNotificationPreview, showDesktopNotification, SERVER_NOTIFICATION_FALLBACK_BODY } from '../lib/desktopNotifications';
import axios from 'axios';
import { resolveAvatarUrl } from '../utils/avatar';
import { logViewAsRoleDebug } from '../lib/viewAsRoleDebug';
import { emptyServerSnapshot, seedRealmReadState } from '../lib/realmReadState';
import {
  CONNECT_TO_VOICE_PERMISSION_MESSAGE,
  isConnectToVoicePermissionError,
} from '../lib/voicePermissionErrors';

const REALTIME_RECONNECT_FAILOVER_MS = 10000;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function detectMention(content: string, currentUser: { id: string; username: string }, alias: string, mentionScope: 'everyone' | 'user') {
  const usernameMention = new RegExp(`(^|\\s)@${escapeRegExp(currentUser.username)}(\\b|$)`, 'i').test(content);
  const uuidMention = new RegExp(`(^|\\s)@${escapeRegExp(currentUser.id)}(\\b|$)`, 'i').test(content);
  const aliasMention = new RegExp(`(^|\\s)${escapeRegExp(alias)}(\\b|$)`, 'i').test(content);
  return {
    usernameMention,
    uuidMention,
    aliasMention,
    isMention: usernameMention || uuidMention || (mentionScope === 'everyone' && aliasMention),
  };
}

type VoiceSocketUser = {
  id: string;
  username: string;
  avatar: string | null;
  roleColor: string | null;
  isOwner: boolean;
  status?: 'online' | 'away' | 'sleeping' | 'invisible';
  accountType?: 'local' | 'central';
  muted: boolean;
  deafened: boolean;
};

function shouldDebugPresence(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem('catrealm:debug-presence') === '1';
  } catch {
    return false;
  }
}

function logPresenceDebug(serverUrl: string, source: 'allMembers' | 'presence:update', users: OnlineUser[]) {
  if (!shouldDebugPresence()) return;
  const sample = users.slice(0, 5).map((user) => ({
    id: user.id,
    username: user.username,
    status: user.status ?? null,
    activityType: user.activityType ?? null,
    activityText: user.activityText ?? null,
  }));
  console.debug(`[presence-debug] ${source} ${serverUrl}`, {
    count: users.length,
    withActivity: users.filter((user) => !!user.activityType && !!user.activityText).length,
    sample,
  });
}

function isCurrentPresenceTarget(serverUrl: string, isCentral: boolean): boolean {
  if (!isCentral) return true;
  return useServerStore.getState().activeServerUrl === serverUrl;
}

export function useSocket() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const isCentral = user?.accountType === 'central';

  // For decentralized accounts, connect using authStore
  const decentralServerUrl = useAuthStore((s) => s.serverUrl);
  const decentralToken = useAuthStore((s) => s.token);

  // For central accounts, connect using serverStore
  const activeServerUrl = useServerStore((s) => s.activeServerUrl);
  const servers = useServerStore((s) => s.servers);
  const setServerStatus = useServerStore((s) => s.setServerStatus);

  // Determine the actual serverUrl and token to use
  const serverUrl = isCentral ? activeServerUrl : decentralServerUrl;
  const token = isCentral
    ? servers.find((s) => s.url === activeServerUrl)?.token ?? null
    : decentralToken;

  useEffect(() => {
    const isSecureContext = typeof window !== 'undefined' && window.location.protocol === 'https:';
    if (isSecureContext && serverUrl?.startsWith('http://')) {
      useUIStore.getState().setConnectionStatus('disconnected');
      setServerStatus(serverUrl, 'disconnected');
      setActiveSocketUrl(null);
      return;
    }

    if (!serverUrl || !token) {
      setActiveSocketUrl(null);
      useUIStore.getState().setConnectionStatus('disconnected');
      return;
    }

    setActiveSocketUrl(serverUrl);

    // Reuse existing connected socket, or create a new one
    const existing = getSocket(serverUrl);
    const socket = existing?.connected ? existing : connectSocket(serverUrl, token);
    if (isCentral) attachServerSocketStatusHandlers(serverUrl, socket, setServerStatus);
    socket.emit('client:foreground');
    const attachmentBatchNoticeWindow = new Map<string, number>();

    if (!existing?.connected) {
      useUIStore.getState().setConnectionStatus('reconnecting');
      setServerStatus(serverUrl, 'reconnecting');
    }

    const fetchAllMembers = () => {
      axios.get(`${serverUrl}/api/users`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((res) => {
        logPresenceDebug(serverUrl, 'allMembers', res.data);
        if (!isCurrentPresenceTarget(serverUrl, isCentral)) return;
        usePresenceStore.getState().setAllMembers(res.data);
      }).catch(() => {});
    };
    const fetchVoiceRooms = () => {
      socket.emit('voice:rooms:get', (resp: { rooms?: Array<{ channelId: string; count: number; users?: VoiceSocketUser[]; liveUserIds?: string[]; startedAt?: number | null }> }) => {
        if (!resp?.rooms) return;
        useVoiceStore.getState().handleRoomsSnapshot({ rooms: resp.rooms });
      });
    };
    const fetchTheaterRooms = () => {
      socket.emit('theater:rooms:get', (resp: { rooms?: Array<{ channelId: string; users: import('../types').TheaterUser[]; startedAt: number | null }> }) => {
        if (!resp?.rooms) return;
        useTheaterStore.getState().handleRoomsSnapshot({ rooms: resp.rooms });
      });
    };
    const refreshServerIdentity = async () => {
      try {
        const res = await axios.get(`${serverUrl}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        logViewAsRoleDebug('socket:auth-me', {
          serverUrl,
          role: res.data?.user?.role,
          permissions: res.data?.user?.permissions,
          viewAsRole: res.data?.user?.viewAsRole ?? null,
        });
        const nextToken = typeof res.data?.token === 'string' ? res.data.token : null;
        const nextUser = res.data?.user;
        if (nextToken) {
          if (isCentral) {
            useServerStore.getState().updateServerToken(serverUrl, nextToken);
          } else {
            useAuthStore.setState({ token: nextToken });
            // Persist the refreshed token so restoreSession reads a fresh copy
            // on next app start (prevents logout after 7d from original login).
            const authState = useAuthStore.getState();
            if (authState.user && authState.serverUrl) {
              saveSession(nextToken, authState.serverUrl, authState.user, null);
            }
          }
        }
        if (nextUser && typeof nextUser === 'object') {
          const current = useAuthStore.getState().user;
          if (current) {
            if (isCentral) {
              // Keep central identity stable; only merge server-scoped auth fields.
              const next = nextUser as Partial<typeof current>;
              useAuthStore.setState({
                user: {
                  ...current,
                  serverUserId: typeof next.id === 'string' ? next.id : (current.serverUserId ?? null),
                  role: typeof next.role === 'string' ? next.role : current.role,
                  permissions: typeof next.permissions === 'number' ? next.permissions : current.permissions,
                  isOwner: typeof next.isOwner === 'boolean' ? next.isOwner : current.isOwner,
                  verified: typeof next.verified === 'boolean' ? next.verified : current.verified,
                  onboardingCompleted: typeof next.onboardingCompleted === 'boolean' ? next.onboardingCompleted : current.onboardingCompleted,
                },
              });
            } else {
              useAuthStore.setState({
                user: {
                  ...current,
                  ...nextUser,
                },
              });
            }
          }
        }
      } catch {
        // best-effort
      }
    };

    const queueRealtimeReconnectIfNeeded = () => {
      const settings = useSettingsStore.getState();
      const currentUserId = useAuthStore.getState().user?.id ?? null;

      const voiceState = useVoiceStore.getState();
      const voiceChannelId = voiceState.activeChannelId ?? voiceState.pendingChannelId;
      if (voiceChannelId && voiceState.voiceServerUrl === serverUrl) {
        if (settings.reconnectToRealtimeChannels) {
          persistRealtimeReconnectTarget({
            kind: 'voice',
            serverUrl,
            channelId: voiceChannelId,
            channelName: voiceState.voiceChannelName ?? null,
            userId: currentUserId,
          });
        }
        voiceState.cleanup();
        return;
      }

      const theaterState = useTheaterStore.getState();
      if (theaterState.activeChannelId && theaterState.theaterServerUrl === serverUrl) {
        if (settings.reconnectToRealtimeChannels) {
          persistRealtimeReconnectTarget({
            kind: 'theater',
            serverUrl: theaterState.theaterServerUrl,
            channelId: theaterState.activeChannelId,
            channelName: theaterState.theaterChannelName ?? null,
            userId: currentUserId,
          });
        }
        theaterState.cleanup();
      }
    };

    let serverDisconnectReconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let realtimeReconnectFailoverTimer: ReturnType<typeof setTimeout> | null = null;
    const clearRealtimeReconnectFailoverTimer = () => {
      if (realtimeReconnectFailoverTimer !== null) {
        window.clearTimeout(realtimeReconnectFailoverTimer);
        realtimeReconnectFailoverTimer = null;
      }
    };
    const clearRealtimeReconnectPrompt = () => {
      useUIStore.getState().clearRealtimeReconnectPrompt();
    };
    const hasRecoveredRealtimeSession = (target: NonNullable<ReturnType<typeof getRealtimeReconnectTarget>>) => {
      if (target.kind === 'voice') {
        const voiceState = useVoiceStore.getState();
        return voiceState.activeChannelId === target.channelId;
      }
      const theaterState = useTheaterStore.getState();
      return theaterState.activeChannelId === target.channelId
        && theaterState.theaterServerUrl === target.serverUrl;
    };
    const showRealtimeReconnectPrompt = (target: NonNullable<ReturnType<typeof getRealtimeReconnectTarget>>) => {
      useUIStore.getState().setRealtimeReconnectPrompt({
        kind: target.kind,
        serverUrl: target.serverUrl,
        channelId: target.channelId,
        channelName: target.channelName ?? null,
      });
    };
    const scheduleRealtimeReconnectFailover = (target: NonNullable<ReturnType<typeof getRealtimeReconnectTarget>>) => {
      clearRealtimeReconnectFailoverTimer();
      realtimeReconnectFailoverTimer = setTimeout(() => {
        const currentUserId = useAuthStore.getState().user?.id ?? null;
        const latestTarget = getRealtimeReconnectTarget({
          serverUrl: target.serverUrl,
          userId: currentUserId,
        });
        if (!latestTarget) return;
        if (latestTarget.kind !== target.kind || latestTarget.channelId !== target.channelId) return;
        if (hasRecoveredRealtimeSession(latestTarget)) {
          clearRealtimeReconnectPrompt();
          return;
        }
        showRealtimeReconnectPrompt(latestTarget);
      }, REALTIME_RECONNECT_FAILOVER_MS);
    };

    const tryRestoreRealtimeReconnect = () => {
      if (!useSettingsStore.getState().reconnectToRealtimeChannels) {
        clearRealtimeReconnectTarget();
        clearRealtimeReconnectPrompt();
        return;
      }
      const currentUserId = useAuthStore.getState().user?.id ?? null;
      const queued = getRealtimeReconnectTarget({ serverUrl, userId: currentUserId });
      if (!queued) {
        clearRealtimeReconnectPrompt();
        return;
      }
      if (hasRecoveredRealtimeSession(queued)) {
        clearRealtimeReconnectFailoverTimer();
        clearRealtimeReconnectPrompt();
        return;
      }
      scheduleRealtimeReconnectFailover(queued);
      if (queued.kind === 'voice') {
        const voiceState = useVoiceStore.getState();
        if (!voiceState.activeChannelId && !voiceState.pendingChannelId) {
          void voiceState.joinVoice(queued.channelId);
        }
        return;
      }
      const theaterState = useTheaterStore.getState();
      if (!theaterState.activeChannelId) {
        void theaterState.joinTheater(queued.channelId, queued.channelName ?? undefined);
      }
    };

    const onConnect = () => {
      useUIStore.getState().setConnectionStatus('connected');
      useUIStore.getState().setServerRestartPending(false);
      setServerStatus(serverUrl, 'connected');
      // Re-join active channel on reconnect
      const channelId = useChannelStore.getState().activeChannelId;
      if (channelId) socket.emit('channel:join', channelId);
      const thread = useThreadStore.getState().activeThread;
      if (thread) socket.emit('thread:join', thread.id);
      fetchAllMembers();
      fetchVoiceRooms();
      fetchTheaterRooms();
      void refreshServerIdentity();
      tryRestoreRealtimeReconnect();
      void useBotStore.getState().fetchCommands(true);
      void useBotStore.getState().fetchConversations();
      // Pick up channels that got messages while we were closed or offline.
      void seedRealmReadState(serverUrl, token);
    };

    socket.on('connect', onConnect);

    // If already connected, run connect logic immediately
      if (socket.connected) {
      useUIStore.getState().setConnectionStatus('connected');
      setServerStatus(serverUrl, 'connected');
      const channelId = useChannelStore.getState().activeChannelId;
      if (channelId) socket.emit('channel:join', channelId);
      const thread = useThreadStore.getState().activeThread;
      if (thread) socket.emit('thread:join', thread.id);
      fetchAllMembers();
      fetchVoiceRooms();
      fetchTheaterRooms();
      void refreshServerIdentity();
      tryRestoreRealtimeReconnect();
    }

    const onDisconnect = (reason: string) => {
      if (reason === 'io client disconnect') {
        // intentional switch or cleanup
        setServerStatus(serverUrl, 'idle');
        useUIStore.getState().setConnectionStatus('reconnecting');
      } else {
        queueRealtimeReconnectIfNeeded();
        useUIStore.getState().setConnectionStatus('disconnected');
        setServerStatus(serverUrl, 'disconnected');
        // socket.io does not auto-reconnect after a server-initiated disconnect;
        // wait 10s before the first attempt to give the server time to restart
        if (reason === 'io server disconnect') {
          useUIStore.getState().setServerRestartPending(true);
          if (!isCentral) {
            serverDisconnectReconnectTimer = setTimeout(() => {
              serverDisconnectReconnectTimer = null;
              socket.connect();
            }, 10000);
          }
        }
      }
    };
    socket.on('disconnect', onDisconnect);

    const onReconnectAttempt = () => {
      useUIStore.getState().setConnectionStatus('reconnecting');
      setServerStatus(serverUrl, 'reconnecting');
    };
    socket.io.on('reconnect_attempt', onReconnectAttempt);

    const onConnectError = (err: Error) => {
      if (isRealmMembershipError(err.message) || (!isCentral && isRealmCredentialError(err.message))) {
        clearRealtimeReconnectTarget();
        clearRealtimeReconnectPrompt();
        if (isCentral) {
          // Only an explicit membership rejection removes a saved realm.
          // Expired/rotated credentials are recovered by the persistent handler.
          useServerStore.getState().removeServer(serverUrl, 'membership');
        } else {
          logout();
        }
      } else {
        useUIStore.getState().setConnectionStatus('disconnected');
        setServerStatus(serverUrl, 'disconnected');
      }
    };
    socket.on('connect_error', onConnectError);
    socket.on('server:kicked', (payload: { message?: string; removeServer?: boolean }) => {
      clearRealtimeReconnectTarget();
      clearRealtimeReconnectPrompt();
      if (payload?.removeServer && isCentral) {
        useServerStore.getState().removeServer(serverUrl, 'membership');
      }
      useUIStore.getState().setConnectionStatus('disconnected');
      const msg = typeof payload?.message === 'string' && payload.message.trim()
        ? payload.message.trim()
        : 'You were kicked from this server.';
      alert(msg);
    });
    socket.on('friends:personal-roles:update', () => {
      void useFriendStore.getState().loadPersonalRoles();
    });

    // Messages
    const onMessageNew = (msg: Message) => {
      const isPublishingScheduled = useMessageStore.getState()
        .scheduledByChannel[msg.channel_id ?? '']?.some(m => m.id === msg.id);

      if (isPublishingScheduled) {
        useMessageStore.getState().publishScheduledMessage(msg.id, msg.channel_id, msg);
      } else if (msg.thread_id) {
        useMessageStore.getState().addThreadMessage(msg);
      } else {
        useMessageStore.getState().addMessage(msg);
      }

      if (isPublishingScheduled) return;

      const currentUser = useAuthStore.getState().user;
      if (!currentUser || msg.user_id === currentUser.id || msg.message_type === 'system') return;
      if (msg.thread_id) return;
      const channelId = msg.channel_id;
      const isAttachmentOnlyMessage =
        !!msg.attachment_url &&
        (!msg.content || msg.content.trim().length === 0);
      let suppressBatchNotice = false;
      if (isAttachmentOnlyMessage) {
        const batchKey = `${channelId}:${msg.user_id}`;
        const lastBatchAt = attachmentBatchNoticeWindow.get(batchKey);
        if (typeof lastBatchAt === 'number' && Math.abs(msg.created_at - lastBatchAt) <= 10) {
          suppressBatchNotice = true;
        } else {
          attachmentBatchNoticeWindow.set(batchKey, msg.created_at);
        }
        // Lightweight cleanup to avoid unbounded growth.
        for (const [key, ts] of attachmentBatchNoticeWindow.entries()) {
          if (Math.abs(msg.created_at - ts) > 30) attachmentBatchNoticeWindow.delete(key);
        }
      }
      const channelState = useChannelStore.getState();
      const channelEntry = channelState.channels.find((entry) => entry.id === channelId);
      const isTheaterChannel = channelEntry?.type === 'theater';
      const isActive = channelState.activeChannelId === channelId;
      const atBottom = channelState.atBottomByChannel[channelId] ?? false;
      const mentionAlias = useAuthStore.getState().serverInfo?.mentionAlias ?? '@everyone';
      const alias = mentionAlias.startsWith('@') ? mentionAlias : `@${mentionAlias}`;
      const content = msg.content ?? '';
      const isBackground = isAppInBackground();
      const mentionScope = serverUrl ? useServerStore.getState().getServerPrefs(serverUrl).mentionScope : 'everyone';
      const { usernameMention, uuidMention, aliasMention, isMention } = detectMention(content, currentUser, alias, mentionScope);

      if (isActive && atBottom && !isBackground) {
        const now = Math.floor(Date.now() / 1000);
        void channelState.setChannelPrefs(channelId, { lastReadAt: now }).catch(() => {});
        channelState.resetCounts(channelId);
      } else {
        if (!suppressBatchNotice) {
          channelState.incrementUnread(channelId, isCentral ? false : isMention);
        }
      }
      const settings = useSettingsStore.getState();
      const soundsDisabled = settings.streamerMode && settings.streamerModeDisableSounds;
      if (isBackground && !suppressBatchNotice
        && !isTheaterChannel && !channelState.prefsByChannel[channelId]?.muted && serverUrl) {
        // Match DM toasts: author avatar and a message preview, both withheld
        // in streamer mode, plus the realm name so busy users know where.
        const hidePersonalInfo = settings.streamerMode && settings.streamerModeHidePI;
        const serverName = useServerStore.getState().servers.find((entry) => entry.url === serverUrl)?.name;
        const where = `#${channelEntry?.name || 'channel'}${serverName ? `, ${serverName}` : ''}`;
        showDesktopNotification({
          id: msg.id,
          sourceKind: 'server',
          sourceId: serverUrl,
          subsourceId: channelId,
          title: `${msg.display_name || msg.username} (${where})`,
          body: hidePersonalInfo
            ? SERVER_NOTIFICATION_FALLBACK_BODY
            : messageNotificationPreview({
              text: content,
              attachmentType: msg.attachment_type,
              attachments: msg.attachments,
            }, SERVER_NOTIFICATION_FALLBACK_BODY),
          iconUrl: hidePersonalInfo ? undefined : resolveAvatarUrl(msg.avatar, serverUrl) ?? undefined,
        });
      }
      if ((!window.electron || isBackground) && settings.notificationsEnabled && !soundsDisabled && !suppressBatchNotice && !isTheaterChannel) {
        if (aliasMention && settings.soundMessageEveryone) {
          const volume = settings.soundVolumes?.['soundMessageEveryone'] ?? 60;
          playNotificationSound('message-everyone', volume);
        } else if ((usernameMention || uuidMention) && settings.soundMessageMention) {
          const volume = settings.soundVolumes?.['soundMessageMention'] ?? 60;
          playNotificationSound('message-mention', volume);
        } else if (!isActive && settings.soundMessageInServer) {
          const volume = settings.soundVolumes?.['soundMessageInServer'] ?? 60;
          playNotificationSound('message-in-server', volume);
        } else if ((isBackground || !isActive) && settings.soundMessageInChannel) {
          const volume = settings.soundVolumes?.['soundMessageInChannel'] ?? 60;
          playNotificationSound('message-in-channel', volume);
        }
      }
    };
    socket.on('message:new', onMessageNew);

    socket.on('message:scheduled', (msg: Message) => {
      useMessageStore.getState().addScheduledMessage(msg);
    });

    socket.on('message:edited', ({ messageId, content, threadId, embeds_enabled }: { messageId: string; content: string; threadId?: string | null; embeds_enabled?: number }) => {
      if (threadId) {
        useMessageStore.getState().editThreadMessage(threadId, messageId, content, embeds_enabled);
      } else {
        useMessageStore.getState().editMessage(messageId, content, embeds_enabled);
      }
    });

    socket.on('message:deleted', ({ messageId, channelId, threadId }: { messageId: string; channelId: string; threadId?: string | null }) => {
      if (threadId) {
        useMessageStore.getState().removeThreadMessage(threadId, messageId);
      } else {
        useMessageStore.getState().removeMessage(messageId, channelId);
      }
    });

    socket.on('message:reaction:update', ({ messageId, threadId, reactions }: { messageId: string; channelId: string; threadId?: string | null; reactions: MessageReaction[] }) => {
      useMessageStore.getState().applyReactionUpdate(messageId, reactions, threadId ?? null);
    });

    // Presence
    socket.on('presence:update', (users: OnlineUser[]) => {
      logPresenceDebug(serverUrl, 'presence:update', users);
      if (!isCurrentPresenceTarget(serverUrl, isCentral)) return;
      usePresenceStore.getState().setOnlineUsers(users);
    });
    socket.on('permissions:changed', () => {
      logViewAsRoleDebug('socket:permissions-changed', { serverUrl });
      void refreshServerIdentity();
      fetchAllMembers();
      void useChannelStore.getState().fetchChannels();
      // Commands with a defaultPermission appear/disappear with role changes.
      void useBotStore.getState().fetchCommands(true);
    });

    // Voice
    socket.on('voice:users', (payload: { channelId: string; users: VoiceSocketUser[]; you: string; startedAt?: number | null; liveUserIds?: string[] }) => {
      useVoiceStore.getState().handleUsers(payload);
    });
    socket.on('voice:join:ok', (payload: { channelId: string; users: VoiceSocketUser[]; you: string; startedAt?: number | null; liveUserIds?: string[] }) => {
      useVoiceStore.getState().handleUsers(payload);
      const settings = useSettingsStore.getState();
      if (settings.notificationsEnabled && settings.soundVoiceUserJoined) {
        const volume = settings.soundVolumes?.['soundVoiceUserJoined'] ?? 60;
        playNotificationSound('voice-user-joined', volume);
      }
    });
    socket.on('voice:join:failed', (payload: { channelId: string; error: string }) => {
      const permissionDenied = isConnectToVoicePermissionError(payload.error);
      useVoiceStore.getState().cleanup();
      useVoiceStore.setState({
        error: permissionDenied
          ? CONNECT_TO_VOICE_PERMISSION_MESSAGE
          : payload.error || 'Failed to join voice.',
        notice: null,
      });
      if (permissionDenied) {
        const channelName = useChannelStore.getState().channels
          .find((channel) => channel.id === payload.channelId)?.name ?? null;
        useUIStore.getState().openModal('voicePermissionDenied', {
          channelId: payload.channelId,
          channelName,
        });
      }
      const currentUserId = useAuthStore.getState().user?.id ?? null;
      const queued = getRealtimeReconnectTarget({ serverUrl, userId: currentUserId });
      if (queued?.kind === 'voice' && queued.channelId === payload.channelId) {
        showRealtimeReconnectPrompt(queued);
        clearRealtimeReconnectTarget('voice');
      } else {
        clearRealtimeReconnectPrompt();
      }
      useVoiceStore.getState().setLastEvent(`voice:join:failed ${payload.channelId}`);
    });
    socket.on('voice:force-disconnect', (payload: { channelId?: string; reason?: string; message?: string }) => {
      clearRealtimeReconnectTarget('voice');
      clearRealtimeReconnectPrompt();
      useVoiceStore.getState().cleanup();
      useVoiceStore.setState({
        error: null,
        notice: payload.message || 'Meow! You were disconnected because you connected on a different cat client!',
      });
      useVoiceStore.getState().setLastEvent(`voice:force-disconnect ${payload.channelId ?? 'unknown'} ${payload.reason ?? 'unknown'}`);
    });
    socket.on('voice:user-joined', (payload: { channelId: string; user: VoiceSocketUser }) => {
      useVoiceStore.getState().handleUserJoined(payload);
      const settings = useSettingsStore.getState();
      if (settings.notificationsEnabled && settings.soundVoiceUserJoined) {
        const volume = settings.soundVolumes?.['soundVoiceUserJoined'] ?? 60;
        playNotificationSound('voice-user-joined', volume);
      }
    });
    socket.on('voice:user-left', (payload: { channelId: string; userId: string }) => {
      useVoiceStore.getState().handleUserLeft(payload);
      const settings = useSettingsStore.getState();
      if (settings.notificationsEnabled && settings.soundVoiceUserLeft) {
        const volume = settings.soundVolumes?.['soundVoiceUserLeft'] ?? 60;
        playNotificationSound('voice-user-left', volume);
      }
    });
    socket.on('voice:user-state', (payload: { channelId: string; userId: string; muted: boolean; deafened: boolean }) => {
      useVoiceStore.getState().handleUserState(payload);
    });
    socket.on('voice:sync', (payload: { channelId: string; users: VoiceSocketUser[]; liveUserIds?: string[] }) => {
      useVoiceStore.getState().handleUserSync(payload);
    });
    socket.on('voice:room-count', (payload: { channelId: string; count: number; startedAt?: number | null }) => {
      useVoiceStore.getState().handleRoomCount(payload);
    });
    socket.on('voice:room-sync', (payload: { channelId: string; users: VoiceSocketUser[]; startedAt?: number | null; liveUserIds?: string[] }) => {
      useVoiceStore.getState().handleRoomSync(payload);
    });
    socket.on('voice:live-sync', (payload: { channelId: string; userIds: string[] }) => {
      useVoiceStore.getState().handleLiveSync(payload);
    });
    socket.on('voice:signal', (payload: { channelId: string; from: string; data: VoiceSignal }) => {
      useVoiceStore.getState().handleSignal(payload);
    });

    // Theater
    socket.on('theater:users', (payload: { channelId: string; users: import('../types').TheaterUser[]; you: string }) => {
      useTheaterStore.getState().handleUsers(payload);
    });
    socket.on('theater:user-joined', (payload: { channelId: string; user: import('../types').TheaterUser }) => {
      useTheaterStore.getState().handleUserJoined(payload);
      const settings = useSettingsStore.getState();
      if (settings.notificationsEnabled && settings.soundVoiceUserJoined) {
        const volume = settings.soundVolumes?.['soundVoiceUserJoined'] ?? 60;
        playNotificationSound('voice-user-joined', volume);
      }
    });
    socket.on('theater:user-left', (payload: { channelId: string; userId: string }) => {
      useTheaterStore.getState().handleUserLeft(payload);
      const settings = useSettingsStore.getState();
      if (settings.notificationsEnabled && settings.soundVoiceUserLeft) {
        const volume = settings.soundVolumes?.['soundVoiceUserLeft'] ?? 60;
        playNotificationSound('voice-user-left', volume);
      }
    });
    socket.on('theater:kicked', () => {
      useTheaterStore.getState().leaveTheater();
    });
    socket.on('theater:sync', (payload: import('../types').TheaterPlaybackState & { channelId: string; updatedAt: number; videoUrl?: string | null }) => {
      useTheaterStore.getState().handleSync(payload);
    });
    socket.on('theater:queue-updated', (payload: { channelId: string }) => {
      useTheaterStore.getState().handleQueueUpdated(payload);
    });
    socket.on('theater:host-changed', (payload: { channelId: string; hostUserId: string }) => {
      useTheaterStore.getState().handleHostChanged(payload);
    });
    socket.on('theater:user-state', (payload: { channelId: string; userId: string; cameraEnabled?: boolean; micEnabled?: boolean; deafened?: boolean; muted?: boolean; voiceConnected?: boolean }) => {
      useTheaterStore.getState().handleUserState(payload);
    });
    socket.on('theater:reaction', (payload: { channelId: string; userId: string; username: string; emoji: string; at: number }) => {
      useTheaterStore.getState().addReaction({ ...payload, id: `${payload.userId}-${payload.at}` });
    });
    socket.on('theater:room-users', (payload: { channelId: string; users: import('../types').TheaterUser[]; startedAt?: number | null }) => {
      useTheaterStore.getState().handleRoomUsers(payload);
    });

    // Typing
    // Sockets sit in every readable channel's room, so the event's channelId decides where it
    // belongs; older realms omit it, in which case it can only be pinned to the open channel.
    socket.on('typing:update', ({ channelId: eventChannelId, userId, username, typing }: { channelId?: string; userId: string; username: string; typing: boolean }) => {
      const activeChannelId = useChannelStore.getState().activeChannelId;
      const channelId = eventChannelId ?? activeChannelId;
      if (channelId) {
        usePresenceStore.getState().setTyping(channelId, username, typing);
        if (channelId !== activeChannelId) return; // only the open channel plays the typing sound
        const settings = useSettingsStore.getState();
        const activeChannelEntry = useChannelStore.getState().channels.find((entry) => entry.id === channelId);
        const theaterTypingChannel = activeChannelEntry?.type === 'theater';
        const soundsDisabled = settings.streamerMode && settings.streamerModeDisableSounds;
        const currentUserId = useAuthStore.getState().user?.id;
        if (
          typing &&
          userId !== currentUserId &&
          settings.notificationsEnabled &&
          !theaterTypingChannel &&
          !soundsDisabled &&
          settings.soundTyping
        ) {
          const volume = settings.soundVolumes?.['soundTyping'] ?? 60;
          playNotificationSound('typing', volume);
        }
      }
    });

    // Channel list updates
    socket.on('channel:list', (channels: Channel[]) => {
      if (!Array.isArray(channels)) return;
      useChannelStore.getState().applyChannelList(channels);
    });

    // Category list updates
    socket.on('category:list', (categories: any[]) => {
      if (!Array.isArray(categories)) return;
      useChannelStore.getState().applyCategoryList(categories);
    });

    // Live server metadata updates (name/description/etc) from admin changes.
    socket.on('server:info', (payload: {
      name?: string;
      description?: string;
      registrationOpen?: boolean;
      mentionAlias?: string;
      defaultRoleName?: string | null;
      serverIcon?: string | null;
      serverBanner?: string | null;
      welcomeBoardEnabled?: boolean;
    }) => {
      if (!serverUrl) return;
      const hasServerIcon = Object.prototype.hasOwnProperty.call(payload, 'serverIcon');
      const hasServerBanner = Object.prototype.hasOwnProperty.call(payload, 'serverBanner');
      const absoluteIcon = payload.serverIcon
        ? (payload.serverIcon.startsWith('http') ? payload.serverIcon : `${serverUrl}${payload.serverIcon}`)
        : null;
      const auth = useAuthStore.getState();
      if (auth.serverInfo) {
        useAuthStore.setState({
          serverInfo: {
            ...auth.serverInfo,
            name: payload.name ?? auth.serverInfo.name,
            description: payload.description ?? auth.serverInfo.description,
            registrationOpen: typeof payload.registrationOpen === 'boolean'
              ? payload.registrationOpen
              : auth.serverInfo.registrationOpen,
            mentionAlias: payload.mentionAlias ?? auth.serverInfo.mentionAlias,
            defaultRoleName: payload.defaultRoleName ?? auth.serverInfo.defaultRoleName,
            serverIcon: hasServerIcon ? payload.serverIcon : auth.serverInfo.serverIcon,
            serverBanner: hasServerBanner ? payload.serverBanner : auth.serverInfo.serverBanner,
            welcomeBoardEnabled: typeof payload.welcomeBoardEnabled === 'boolean'
              ? payload.welcomeBoardEnabled
              : auth.serverInfo.welcomeBoardEnabled,
          },
        });
      }
      useServerStore.setState((s) => ({
        servers: s.servers.map((entry) => (
          entry.url === serverUrl
            ? {
                ...entry,
                name: payload.name ?? entry.name,
                icon: hasServerIcon ? (absoluteIcon ?? undefined) : entry.icon,
                info: {
                  ...entry.info,
                  name: payload.name ?? entry.info.name,
                  description: payload.description ?? entry.info.description,
                  registrationOpen: typeof payload.registrationOpen === 'boolean'
                    ? payload.registrationOpen
                    : entry.info.registrationOpen,
                  mentionAlias: payload.mentionAlias ?? entry.info.mentionAlias,
                  defaultRoleName: payload.defaultRoleName ?? entry.info.defaultRoleName,
                  serverIcon: hasServerIcon ? payload.serverIcon : entry.info.serverIcon,
                  serverBanner: hasServerBanner ? payload.serverBanner : entry.info.serverBanner,
                  welcomeBoardEnabled: typeof payload.welcomeBoardEnabled === 'boolean'
                    ? payload.welcomeBoardEnabled
                    : entry.info.welcomeBoardEnabled,
                },
              }
            : entry
        )),
      }));
      useServerStore.getState().persistServers();
    });

    // Forum post live sync
    socket.on('forum:created', (post: ForumPost) => {
      useThreadStore.getState().addForumPost(post);
    });
    socket.on('forum:deleted', ({ id, channel_id }: { id: string; channel_id: string }) => {
      useThreadStore.getState().removeForumPost(channel_id, id);
    });

    // Bots
    socket.on('bots:commands_updated', () => {
      void useBotStore.getState().fetchCommands(true);
    });
    socket.on('bot:dm', (msg: Parameters<ReturnType<typeof useBotStore.getState>['handleIncomingBotDm']>[0]) => {
      useBotStore.getState().handleIncomingBotDm(msg);
    });
    socket.on('bot:ephemeral', (msg: EphemeralBotMessage) => {
      useBotStore.getState().addEphemeral(msg);
    });
    socket.on('interaction:failed', ({ id, reason }: { id: string; reason: string }) => {
      console.warn('[CatRealm] Bot interaction failed:', id, reason);
    });

    // Server errors
    socket.on('error', (msg: string) => {
      console.error('[CatRealm]', msg);
    });

    return () => {
      // Remove event listeners but keep socket alive in background
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off('message:new', onMessageNew);
      socket.off('message:scheduled');
      socket.off('message:edited');
      socket.off('message:deleted');
      socket.off('message:reaction:update');
      socket.off('presence:update');
      socket.off('permissions:changed');
      socket.off('typing:update');
      socket.off('channel:list');
      socket.off('category:list');
      socket.off('server:info');
      socket.off('server:kicked');
      socket.off('friends:personal-roles:update');
      socket.off('error');
      socket.off('voice:users');
      socket.off('voice:user-joined');
      socket.off('voice:user-left');
      socket.off('voice:user-state');
      socket.off('voice:sync');
      socket.off('voice:room-count');
      socket.off('voice:room-sync');
      socket.off('voice:live-sync');
      socket.off('voice:signal');
      socket.off('voice:join:failed');
      socket.off('voice:join:ok');
      socket.off('voice:force-disconnect');
      socket.off('forum:created');
      socket.off('forum:deleted');
      socket.off('bots:commands_updated');
      socket.off('bot:dm');
      socket.off('bot:ephemeral');
      socket.off('interaction:failed');
      socket.off('theater:users');
      socket.off('theater:user-joined');
      socket.off('theater:user-left');
      socket.off('theater:kicked');
      socket.off('theater:sync');
      socket.off('theater:queue-updated');
      socket.off('theater:host-changed');
      socket.off('theater:user-state');
      socket.off('theater:reaction');
      socket.off('theater:room-users');
      socket.io.off('reconnect_attempt', onReconnectAttempt);
      if (serverDisconnectReconnectTimer !== null) {
        clearTimeout(serverDisconnectReconnectTimer);
        serverDisconnectReconnectTimer = null;
        useUIStore.getState().setServerRestartPending(false);
      }
      clearRealtimeReconnectFailoverTimer();
      // Voice lifecycle is managed independently — leaveVoice() on explicit leave,
      // cleanup() on force-disconnect/join-failed, and logout() handles it on sign-out.
      // Do NOT clean up voice here so users stay connected while roaming servers.
    };
  }, [serverUrl, token, logout, isCentral, setServerStatus]);

  // Central-only: keep lightweight message handlers on background server sockets
  // so mentions and unread counts are not dropped while another server or home is active.
  useEffect(() => {
    if (!isCentral) return;

    const backgroundEntries = servers.filter((entry) => entry.url !== serverUrl);
    if (backgroundEntries.length === 0) return;

    const cleanups: Array<() => void> = [];

    for (const entry of backgroundEntries) {
      const bgSocket = getSocket(entry.url);
      if (!bgSocket) continue;
      bgSocket.emit('client:background');

      const onBgMessage = (msg: Message) => {
        const currentUser = useAuthStore.getState().user;
        const mentionAlias = entry.info.mentionAlias ?? '@everyone';
        const alias = mentionAlias.startsWith('@') ? mentionAlias : `@${mentionAlias}`;
        const mentionScope = useServerStore.getState().getServerPrefs(entry.url).mentionScope;
        const mentionState = currentUser
          ? detectMention(msg.content ?? '', currentUser, alias, mentionScope)
          : { aliasMention: false, usernameMention: false, uuidMention: false, isMention: false };
        const { aliasMention, usernameMention, uuidMention, isMention } = mentionState;

        useServerStore.setState((state) => {
          const snapshot = state.snapshots[entry.url] ?? emptyServerSnapshot();

          const messagesByChannel = { ...snapshot.messagesByChannel };
          const messagesByThread = { ...snapshot.messagesByThread };
          if (msg.thread_id) {
            const existing = messagesByThread[msg.thread_id] ?? [];
            if (!existing.some((entry) => entry.id === msg.id)) {
              messagesByThread[msg.thread_id] = [...existing, msg];
            }
          } else {
            const existing = messagesByChannel[msg.channel_id] ?? [];
            if (!existing.some((entry) => entry.id === msg.id)) {
              messagesByChannel[msg.channel_id] = [...existing, msg];
            }
          }

          const shouldCountUnread =
            !!currentUser &&
            msg.user_id !== currentUser.id &&
            msg.message_type !== 'system' &&
            !msg.thread_id;

          return {
            snapshots: {
              ...state.snapshots,
              [entry.url]: {
                ...snapshot,
                messagesByChannel,
                messagesByThread,
                unreadByChannel: shouldCountUnread
                  ? {
                      ...snapshot.unreadByChannel,
                      [msg.channel_id]: (snapshot.unreadByChannel[msg.channel_id] ?? 0) + 1,
                    }
                  : snapshot.unreadByChannel,
                mentionByChannel: shouldCountUnread
                  ? {
                      ...snapshot.mentionByChannel,
                      [msg.channel_id]: (snapshot.mentionByChannel[msg.channel_id] ?? 0) + (isMention ? 1 : 0),
                    }
                  : snapshot.mentionByChannel,
              },
            },
          };
        });

        if (!currentUser || msg.user_id === currentUser.id || msg.message_type === 'system' || msg.thread_id) return;

        const settings = useSettingsStore.getState();
        const soundsDisabled = settings.streamerMode && settings.streamerModeDisableSounds;
        if ((window.electron && !isAppInBackground()) || !settings.notificationsEnabled || soundsDisabled) return;

        if (aliasMention && settings.soundMessageEveryone) {
          const volume = settings.soundVolumes?.['soundMessageEveryone'] ?? 60;
          playNotificationSound('message-everyone', volume);
        } else if ((usernameMention || uuidMention) && settings.soundMessageMention) {
          const volume = settings.soundVolumes?.['soundMessageMention'] ?? 60;
          playNotificationSound('message-mention', volume);
        }
      };

      bgSocket.on('message:new', onBgMessage);
      cleanups.push(() => bgSocket.off('message:new', onBgMessage));

      // Background realms only count live messages; seed what was missed (throttled per realm).
      const onBgConnect = () => { void seedRealmReadState(entry.url, entry.token); };
      if (bgSocket.connected) onBgConnect();
      bgSocket.on('connect', onBgConnect);
      cleanups.push(() => bgSocket.off('connect', onBgConnect));
    }

    return () => cleanups.forEach((cleanup) => cleanup());
  }, [isCentral, servers, serverUrl]);
}
