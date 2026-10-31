import { useEffect } from 'react';
import { connectSocket } from '../../lib/socket';
import { useAuthStore } from '../../stores/authStore';
import { normalizeNowPlaying, useNowPlayingStore } from '../../stores/nowPlayingStore';
import { useDMStore } from '../../stores/dmStore';
import { AUTH_BASE, confirmOrExpireCentralSession, createAuthenticatedApi } from '../../lib/authApi';
import { useSettingsStore } from '../../stores/settingsStore';
import { playNotificationSound } from '../../lib/notificationSounds';
import {
  DM_NOTIFICATION_FALLBACK_BODY,
  dmNotificationPreview,
  holdDMNotification,
  isAppInBackground,
  releaseDMNotification,
  showDesktopNotification,
} from '../../lib/desktopNotifications';
import { resolveAvatarUrl } from '../../utils/avatar';
import type { DMReaction } from '../../types';
import { useGroupChatStore } from '../../stores/groupChatStore';
import { useServerStore } from '../../stores/serverStore';
import { evictIconCacheEntries, fetchGameIconUrl } from '../../hooks/useDesktopGameActivity';
import { reconcileIncomingCentralProfileActivity, scheduleStaleCentralProfileActivityClear } from '../../lib/centralProfileActivity';
import { evictIconCacheByTitle, fetchIconByTitle } from '../../lib/gameLibraryIcons';
import { useGameActivityStore } from '../../stores/gameActivityStore';
import { useFriendStore } from '../../stores/friendStore';
import { useNotificationStore, type CentralNotification, type CentralNotificationSummary } from '../notifications/notificationStore';
import {
  fetchDMKeyManifest,
  loadConversationSecretForCurrentDevice,
  reconcileConversationKeys,
  syncTrustedDeviceKeysForConversation,
  useDMKeyHealthStore,
} from '../crypto/dmKeyStore';
import { getLocalDeviceId } from '../../lib/deviceIdentity';
import { logDMKeyDebug, logDMKeyError } from '../crypto/dmKeyDebug';

// E2EE key-recovery throttles. Module-level so effect remounts don't reset
// them: every manifest/keys fetch counts against the shared per-user DM rate
// limit (all devices share one bucket), and an unthrottled reconcile loop
// starves normal DM traffic into 429s.
let lastDMKeyReconcileAt = 0;
const DM_KEY_RECONCILE_MIN_GAP_MS = 5 * 60 * 1000;
const dmKeyRequestSentAt = new Map<string, number>();
const DM_KEY_REQUEST_COOLDOWN_MS = 5 * 60 * 1000;
const dmKeyFulfillAt = new Map<string, number>();
const DM_KEY_FULFILL_COOLDOWN_MS = 60 * 1000;

/**
 * Hook to manage Socket.io connection to central auth server for DMs
 * Only connects for central accounts
 */
export function useDMSocket() {
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const isCentral = user?.accountType === 'central';

  useEffect(() => {
    // Only connect DM socket for central accounts
    if (!isCentral || !token || !user) {
      return;
    }

    const authServerUrl = AUTH_BASE;
    useDMKeyHealthStore.getState().setAccountId(user.id);

    // Also refresh handshake credentials for the next reconnect while connected.
    const socket = connectSocket(authServerUrl, token);

    // Initialize DM store
    useDMStore.getState().init();

    const refreshCentralProfile = async () => {
      try {
        const profileRes = await createAuthenticatedApi().get('/api/profile/me');
        const reconciledActivity = reconcileIncomingCentralProfileActivity({
          source: 'dm-socket:refresh',
          userId: profileRes.data.id ?? user.id,
          activityType: profileRes.data.activityType ?? profileRes.data.activity_type ?? null,
          activityText: profileRes.data.activityText ?? profileRes.data.activity_text ?? null,
          activityStartedAt: profileRes.data.activityStartedAt ?? profileRes.data.activity_started_at ?? null,
        });
        if (reconciledActivity.shouldClearUpstream) {
          scheduleStaleCentralProfileActivityClear({
            source: 'dm-socket:refresh',
            userId: profileRes.data.id ?? user.id,
          });
        }
        useNowPlayingStore.getState().setNowPlaying(profileRes.data.id ?? user.id, profileRes.data.nowPlaying);
        useAuthStore.getState().updateUser({
          avatar: profileRes.data.avatar ?? null,
          banner: profileRes.data.banner ?? null,
          bio: profileRes.data.bio ?? null,
          status: profileRes.data.status ?? 'online',
          displayName: profileRes.data.display_name ?? null,
          customStatusText: profileRes.data.customStatusText ?? profileRes.data.custom_status_text ?? null,
          activityType: reconciledActivity.activityType,
          activityText: reconciledActivity.activityText,
          activityStartedAt: reconciledActivity.activityStartedAt,
        });
      } catch {
        // best-effort refresh after central socket connects
      }
    };

    // Self-healing E2EE pass: pull missing wrapped keys from the server,
    // backfill other trusted devices, and ask live peers for conversations
    // this device still can't unlock.
    const reconcileDMKeys = (force = false) => {
      const now = Date.now();
      if (!force && now - lastDMKeyReconcileAt < DM_KEY_RECONCILE_MIN_GAP_MS) return;
      lastDMKeyReconcileAt = now;
      void reconcileConversationKeys((conversationId) => {
        const lastSentAt = dmKeyRequestSentAt.get(conversationId) ?? 0;
        if (!force && now - lastSentAt < DM_KEY_REQUEST_COOLDOWN_MS) return;
        dmKeyRequestSentAt.set(conversationId, now);
        socket.emit('dm:keys:request', { conversationId, deviceId: getLocalDeviceId() });
      }).catch((error) => {
        logDMKeyError('DM key reconciliation failed', error);
      });
    };

    const onConnect = () => {
      console.log('[DM Socket] Connected to central auth server');

      // Register for DM delivery
      socket.emit('dm:register');
      void refreshCentralProfile();
      reconcileDMKeys();

      // Reload conversations to get any new messages
      useDMStore.getState().loadConversations();
      void useNotificationStore.getState().refresh();
      useGroupChatStore.getState().loadGroups();

      // If the server list is empty (e.g. initial load failed due to no internet), retry now
      if (useServerStore.getState().servers.length === 0) {
        useServerStore.getState().loadPersistedServers();
      }
    };

    const onDisconnect = () => {
      console.log('[DM Socket] Disconnected from central auth server');
    };

    const onDeviceTrustUpdated = ({ deviceId, dmTrustState, approvalMethod }: { deviceId?: string; dmTrustState?: string; approvalMethod?: string }) => {
      logDMKeyDebug('Device trust update received', { deviceId, dmTrustState, localDeviceId: getLocalDeviceId() });
      if (dmTrustState !== 'trusted') return;
      if (approvalMethod === 'passkey-self' && deviceId && deviceId !== getLocalDeviceId()) {
        useDMKeyHealthStore.getState().notePasskeyApprovedDevice(deviceId);
      }
      // Key-holding sessions backfill for the newly trusted device; a newly
      // trusted session pulls its own keys or asks peers for a backfill.
      reconcileDMKeys(true);
      // Also ask peers explicitly for the active DM in case the conversation
      // isn't persisted locally yet (brand-new device).
      const activeConversationId = useDMStore.getState().activeConversationId;
      if (activeConversationId) {
        useDMKeyHealthStore.getState().markConversationKeysUpdated(activeConversationId);
      }
      if (deviceId === getLocalDeviceId() && activeConversationId) {
        socket.emit('dm:keys:request', { conversationId: activeConversationId, deviceId });
      }
    };

    const onDMKeysRequested = async ({ conversationId }: { conversationId?: string }) => {
      if (!conversationId) return;
      // Cooldown per conversation — peers may re-request on every reconnect,
      // and each fulfillment attempt costs several rate-limited REST calls.
      const now = Date.now();
      if (now - (dmKeyFulfillAt.get(conversationId) ?? 0) < DM_KEY_FULFILL_COOLDOWN_MS) return;
      dmKeyFulfillAt.set(conversationId, now);
      logDMKeyDebug('Peer requested conversation key backfill', { conversationId, localDeviceId: getLocalDeviceId() });
      try {
        const manifest = await fetchDMKeyManifest(conversationId);
        if (manifest.activeKeyVersion == null) return;
        // Pull our wrapped key from the server if it isn't cached locally yet —
        // a device can fulfill requests as long as an envelope exists for it.
        const secret = await loadConversationSecretForCurrentDevice(conversationId, manifest.activeKeyVersion);
        if (!secret) {
          logDMKeyDebug('Cannot fulfill peer key request — no key available to this device', { conversationId }, 'warn');
          return;
        }
        await syncTrustedDeviceKeysForConversation(conversationId, manifest.activeKeyVersion, secret);
      } catch (error) {
        logDMKeyError('Failed to fulfill peer key request', error, { conversationId });
      }
    };

    const onDMKeyRequestStatus = (payload: {
      conversationId?: string;
      deviceId?: string;
      accepted?: boolean;
      reason?: string;
      peerSocketCount?: number;
    }) => {
      logDMKeyDebug('Conversation key request acknowledged by server', payload, payload.accepted ? 'info' : 'warn');
    };

    const onDMKeysUpdated = ({ conversationId, deviceIds }: { conversationId?: string; deviceIds?: string[] }) => {
      logDMKeyDebug('Conversation key update received', {
        conversationId,
        targetDeviceIds: deviceIds ?? [],
        localDeviceId: getLocalDeviceId(),
      });
      if (!conversationId) return;
      if (!deviceIds?.includes(getLocalDeviceId())) {
        useDMKeyHealthStore.getState().markConversationKeysUpdated(conversationId);
        return;
      }
      const dmState = useDMStore.getState();
      if (dmState.activeConversationId === conversationId) {
        void (async () => {
          // If the initial locked load is still in flight, wait for it to
          // finish and then run a fresh pass with the newly available key.
          await dmState.loadMessages(conversationId);
          if (useDMStore.getState().activeConversationId === conversationId) {
            await useDMStore.getState().loadMessages(conversationId);
          }
          useDMKeyHealthStore.getState().markConversationKeysUpdated(conversationId);
        })();
      } else {
        useDMKeyHealthStore.getState().markConversationKeysUpdated(conversationId);
      }
    };

    const onReconnect = () => {
      console.log('[DM Socket] Reconnected to central auth server');

      // Re-register for DM delivery
      socket.emit('dm:register');
      void refreshCentralProfile();
      reconcileDMKeys();

      // Reload conversations and active messages
      useDMStore.getState().loadConversations();
      void useNotificationStore.getState().refresh();
      useGroupChatStore.getState().loadGroups();
      const activeConvId = useDMStore.getState().activeConversationId;
      if (activeConvId) {
        useDMStore.getState().loadMessages(activeConvId);
        if (useDMStore.getState().dmViewOpen && !isAppInBackground()) {
          void useDMStore.getState().markAsRead(activeConvId);
        }
      }

      // If the server list is empty (e.g. initial load failed due to no internet), retry now
      if (useServerStore.getState().servers.length === 0) {
        useServerStore.getState().loadPersistedServers();
      }
    };

    const onDMMessage = async (msg: any) => {
      console.log('[DM Socket] Received message:', msg);

      // Handle incoming message
      await useDMStore.getState().handleIncomingMessage(msg);
      if (msg?.id) {
        const decrypted = useDMStore.getState().messagesByConversation[msg.conversationId]?.find((m) => m.id === msg.id);
        releaseDMNotification(msg.id, decrypted ? dmNotificationPreview(decrypted) : null);
      }

      const isSystemMessage = (msg?.messageType ?? msg?.message_type) === 'system';
      const isOwnMessage = msg?.senderId === useAuthStore.getState().user?.id;
      const dmState = useDMStore.getState();
      const conversationId = msg?.conversationId ?? msg?.conversation_id;
      const inCurrentDm = dmState.dmViewOpen && dmState.activeConversationId === conversationId;
      const inForeground = !isAppInBackground();
      if (!isSystemMessage && !isOwnMessage && inCurrentDm && inForeground && conversationId) {
        void dmState.markAsRead(conversationId);
      }
      const settings = useSettingsStore.getState();
      const soundsDisabled = settings.streamerMode && settings.streamerModeDisableSounds;
      if (!isSystemMessage && !isOwnMessage && (!window.electron || !inForeground) && settings.notificationsEnabled && !soundsDisabled) {
        if (inCurrentDm && settings.soundDMMessageInCurrent) {
          const volume = settings.soundVolumes?.['soundDMMessageInCurrent'] ?? 60;
          playNotificationSound('dm-message-current', volume);
        } else if (settings.soundDMMessageFromOther) {
          const volume = settings.soundVolumes?.['soundDMMessageFromOther'] ?? 60;
          playNotificationSound('dm-message-other', volume);
        }
      }

      // Send delivery acknowledgment
      socket.emit('dm:delivered', { messageId: msg.id });
    };

    const onDeliveryAck = ({ messageId }: { messageId: string }) => {
      console.log('[DM Socket] Message delivered:', messageId);
      useDMStore.getState().handleDeliveryAck(messageId);
    };

    const onDMSent = ({ messageId, delivered }: { messageId: string; delivered: boolean }) => {
      console.log('[DM Socket] Message sent confirmation:', messageId, 'delivered:', delivered);
      if (delivered) {
        useDMStore.getState().handleDeliveryAck(messageId);
      }
    };

    const onReactionUpdate = ({ messageId, reactions }: { messageId: string; reactions: DMReaction[] }) => {
      useDMStore.getState().applyReactionUpdate(messageId, reactions);
    };

    const onDMMessageUpdate = async (msg: any) => {
      await useDMStore.getState().handleMessageUpdate(msg);
    };
    const onDMMessageDelete = ({ messageId }: { messageId: string }) => {
      useDMStore.getState().removeMessageLocal(messageId);
    };
    const onDMPinUpdate = (payload: { conversationId: string; messageId: string; pinned: boolean }) => {
      useDMStore.getState().handleDmPinUpdate(payload);
    };

    const onConnectError = (error: any) => {
      console.error('[DM Socket] Connection error:', error);
      const message = String(error?.message ?? '').trim();
      if (message === 'Invalid token' || message === 'No token') {
        void confirmOrExpireCentralSession();
      }
    };

    const onGroupListUpdate = ({ groupChatId }: { groupChatId?: string }) => {
      void useGroupChatStore.getState().handleListUpdate(groupChatId ?? null);
    };

    const onGroupRemoved = ({ groupChatId }: { groupChatId: string }) => {
      if (!groupChatId) return;
      useGroupChatStore.getState().handleRemoved(groupChatId);
    };

    const onGroupRetentionUpdate = ({ groupChatId, retentionDays }: { groupChatId: string; retentionDays: number }) => {
      if (!groupChatId || !Number.isFinite(retentionDays)) return;
      useGroupChatStore.getState().handleRetentionUpdate(groupChatId, retentionDays);
    };

    const onGroupKeyRotated = ({ groupChatId }: { groupChatId: string }) => {
      if (!groupChatId) return;
      void useGroupChatStore.getState().handleKeyRotated(groupChatId);
    };

    const onGroupMemberMutated = ({ groupChatId }: { groupChatId: string }) => {
      if (!groupChatId) return;
      void useGroupChatStore.getState().handleMemberMutation(groupChatId);
    };

    const onGroupMessage = async (payload: any) => {
      await useGroupChatStore.getState().handleIncomingMessage(payload);
      void useGroupChatStore.getState().handleListUpdate(payload?.groupChatId ?? null);
    };

    const onGroupMessageUpdate = async (payload: any) => {
      await useGroupChatStore.getState().handleMessageUpdate(payload);
    };

    const onGroupMessageDelete = (payload: { groupChatId: string; messageId: string }) => {
      useGroupChatStore.getState().handleMessageDelete(payload);
      void useGroupChatStore.getState().handleListUpdate(payload?.groupChatId ?? null);
    };

    let notificationRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    const onNotificationNew = (notification: CentralNotification) => {
      const notificationStore = useNotificationStore.getState();
      notificationStore.prepend(notification);
      if (notificationRefreshTimer) clearTimeout(notificationRefreshTimer);
      notificationRefreshTimer = setTimeout(() => {
        notificationRefreshTimer = null;
        void useNotificationStore.getState().refresh();
      }, 100);
      if (notification.type === 'dm_message') {
        const dmState = useDMStore.getState();
        if (!isAppInBackground() && dmState.dmViewOpen && dmState.activeConversationId === notification.sourceId) return;
        const payload = notification.payload ?? {};
        const name = String(payload.otherDisplayName || payload.otherUsername || notification.actorName || 'Someone');
        const settings = useSettingsStore.getState();
        const hidePersonalInfo = settings.streamerMode && settings.streamerModeHidePI;
        const avatar = typeof payload.otherAvatar === 'string' ? payload.otherAvatar : null;
        const request = {
          id: notification.id,
          sourceKind: 'dm' as const,
          sourceId: notification.sourceId,
          title: name,
          body: DM_NOTIFICATION_FALLBACK_BODY,
          iconUrl: hidePersonalInfo ? undefined : resolveAvatarUrl(avatar, null, 'central') ?? undefined,
        };
        if (hidePersonalInfo || !notification.messageId) {
          showDesktopNotification(request);
          return;
        }
        const decrypted = dmState.messagesByConversation[notification.sourceId]?.find((m) => m.id === notification.messageId);
        if (decrypted) {
          showDesktopNotification({ ...request, body: dmNotificationPreview(decrypted) });
          return;
        }
        holdDMNotification(notification.messageId, request);
      } else if (notification.type === 'server_mention') {
        showDesktopNotification({
          id: notification.id,
          sourceKind: 'server',
          sourceId: notification.sourceId,
          subsourceId: notification.subsourceId ?? undefined,
          title: notification.actorName || 'Mention',
          body: 'Mentioned you in a server',
        });
      }
    };

    const onNotificationSummary = (summary: CentralNotificationSummary) => {
      useNotificationStore.getState().applySummary(summary);
    };

    const onGroupReactionUpdate = (payload: { groupChatId: string; messageId: string; reactions: DMReaction[] }) => {
      useGroupChatStore.getState().handleReactionUpdate(payload as any);
    };

    const onDMMessagePublished = ({ id, conversationId }: { id: string; conversationId: string }) => {
      useDMStore.getState().publishScheduledDM(id, conversationId);
    };

    const onGCMessagePublished = ({ id, groupChatId }: { id: string; groupChatId: string }) => {
      useGroupChatStore.getState().publishScheduledGC(id, groupChatId);
    };

    const handleGameLibraryInvalidate = ({
      processNames,
      title,
      prefetchTitle,
    }: {
      processNames: string[];
      title?: string;
      prefetchTitle: boolean;
    }) => {
      if (Array.isArray(processNames) && processNames.length) evictIconCacheEntries(processNames);
      if (title) {
        evictIconCacheByTitle(title);
        if (prefetchTitle) {
          fetchIconByTitle(title).catch(() => {});
        }
      }
      window.electron?.invalidateGameActivityCatalog?.().catch(() => {});
      const { detectorState, setGameIconUrl } = useGameActivityStore.getState();
      const currentProcess = detectorState.activity?.processName;
      const currentTitle = detectorState.activity?.activityText;
      const matchesCurrentProcess = currentProcess && Array.isArray(processNames) && processNames.some((p) => p.toLowerCase() === currentProcess.toLowerCase());
      const matchesCurrentTitle = title && currentTitle && title.toLowerCase() === currentTitle.toLowerCase();
      if (matchesCurrentProcess) {
        fetchGameIconUrl(currentProcess).then(setGameIconUrl).catch(() => {});
      } else if (matchesCurrentTitle) {
        if (prefetchTitle) {
          fetchIconByTitle(title).then(setGameIconUrl).catch(() => {});
        } else {
          setGameIconUrl(null);
        }
      }
    };

    const onGameLibraryUpdated = ({ processNames, title }: { gameId: string; processNames: string[]; title?: string }) => {
      handleGameLibraryInvalidate({ processNames, title, prefetchTitle: true });
    };

    const onGameLibraryDeleted = ({ processNames, title }: { gameId: string; processNames: string[]; title?: string }) => {
      handleGameLibraryInvalidate({ processNames, title, prefetchTitle: false });
    };
    const onPersonalRolesUpdate = () => {
      void useFriendStore.getState().loadPersonalRoles();
    };

    const onFriendsSync = () => {
      void useFriendStore.getState().fetchFriends({ force: true });
      void useFriendStore.getState().fetchRequests({ force: true });
      void useDMStore.getState().loadConversations();
    };

    const onNowPlaying = (payload: { userId?: string; nowPlaying?: unknown }) => {
      if (typeof payload?.userId !== 'string') return;
      useNowPlayingStore.getState().setNowPlaying(payload.userId, normalizeNowPlaying(payload.nowPlaying));
    };

    // Set up event listeners
    const onRequestsChanged = () => { void useDMStore.getState().loadConversations(); };
    socket.on('dm:requests:changed', onRequestsChanged);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('reconnect', onReconnect);
    socket.on('connect_error', onConnectError);
    socket.on('dm:message', onDMMessage);
    socket.on('dm:delivery-ack', onDeliveryAck);
    socket.on('dm:sent', onDMSent);
    socket.on('dm:reaction:update', onReactionUpdate);
    socket.on('dm:message:update', onDMMessageUpdate);
    socket.on('dm:message:delete', onDMMessageDelete);
    socket.on('dm:pin:update', onDMPinUpdate);
    socket.on('dm:message:published', onDMMessagePublished);
    socket.on('gc:list:update', onGroupListUpdate);
    socket.on('gc:removed', onGroupRemoved);
    socket.on('gc:retention:update', onGroupRetentionUpdate);
    socket.on('gc:key:rotated', onGroupKeyRotated);
    socket.on('gc:member:added', onGroupMemberMutated);
    socket.on('gc:member:removed', onGroupMemberMutated);
    socket.on('gc:message', onGroupMessage);
    socket.on('gc:message:update', onGroupMessageUpdate);
    socket.on('gc:message:delete', onGroupMessageDelete);
    socket.on('notification:new', onNotificationNew);
    socket.on('notification:summary', onNotificationSummary);
    socket.on('gc:reaction:update', onGroupReactionUpdate);
    socket.on('gc:message:published', onGCMessagePublished);
    socket.on('gamelibrary:game:updated', onGameLibraryUpdated);
    socket.on('gamelibrary:game:deleted', onGameLibraryDeleted);
    socket.on('friends:personal-roles:update', onPersonalRolesUpdate);
    socket.on('friends:sync', onFriendsSync);
    socket.on('presence:now-playing', onNowPlaying);
    socket.on('device:trust-updated', onDeviceTrustUpdated);
    socket.on('dm:keys:requested', onDMKeysRequested);
    socket.on('dm:keys:updated', onDMKeysUpdated);
    socket.on('dm:keys:request-status', onDMKeyRequestStatus);
    logDMKeyDebug('DM key socket diagnostics attached', {
      socketId: socket.id || null,
      connected: socket.connected,
      localDeviceId: getLocalDeviceId(),
    });

    // If already connected, register immediately without re-emitting connect logs
    if (socket.connected) {
      socket.emit('dm:register');
      void refreshCentralProfile();
      reconcileDMKeys();
      useDMStore.getState().loadConversations();
      void useNotificationStore.getState().refresh();
      useGroupChatStore.getState().loadGroups();
    }

    // Cleanup function
    return () => {
      if (notificationRefreshTimer) clearTimeout(notificationRefreshTimer);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('reconnect', onReconnect);
      socket.off('connect_error', onConnectError);
      socket.off('dm:message', onDMMessage);
      socket.off('dm:requests:changed', onRequestsChanged);
      socket.off('dm:delivery-ack', onDeliveryAck);
      socket.off('dm:sent', onDMSent);
      socket.off('dm:reaction:update', onReactionUpdate);
      socket.off('dm:message:update', onDMMessageUpdate);
      socket.off('dm:message:delete', onDMMessageDelete);
      socket.off('dm:pin:update', onDMPinUpdate);
      socket.off('gc:list:update', onGroupListUpdate);
      socket.off('gc:removed', onGroupRemoved);
      socket.off('gc:retention:update', onGroupRetentionUpdate);
      socket.off('gc:key:rotated', onGroupKeyRotated);
      socket.off('gc:member:added', onGroupMemberMutated);
      socket.off('gc:member:removed', onGroupMemberMutated);
      socket.off('gc:message', onGroupMessage);
      socket.off('gc:message:update', onGroupMessageUpdate);
      socket.off('gc:message:delete', onGroupMessageDelete);
      socket.off('notification:new', onNotificationNew);
      socket.off('notification:summary', onNotificationSummary);
      socket.off('gc:reaction:update', onGroupReactionUpdate);
      socket.off('dm:message:published', onDMMessagePublished);
      socket.off('gc:message:published', onGCMessagePublished);
      socket.off('gamelibrary:game:updated', onGameLibraryUpdated);
      socket.off('gamelibrary:game:deleted', onGameLibraryDeleted);
      socket.off('friends:personal-roles:update', onPersonalRolesUpdate);
      socket.off('friends:sync', onFriendsSync);
      socket.off('presence:now-playing', onNowPlaying);
      socket.off('device:trust-updated', onDeviceTrustUpdated);
      socket.off('dm:keys:requested', onDMKeysRequested);
      socket.off('dm:keys:updated', onDMKeysUpdated);
      socket.off('dm:keys:request-status', onDMKeyRequestStatus);
    };
  }, [isCentral, token, user?.id]);
}
