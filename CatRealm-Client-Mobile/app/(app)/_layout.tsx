/**
 * App group — everything behind auth. Two-level navigation:
 *   1. Tab bar (home / servers / chats / discover / me)  — `(tabs)/_layout.tsx`
 *   2. Modal/stack screens that push over tabs           — declared here
 *
 * Also mounts the socket lifecycle: connects when token + serverUrl are set,
 * routes all socket events into stores via useSocket(), and redirects to login
 * when a central session expires.
 */

import { useEffect, useRef } from 'react';
import { Alert, AppState, Dimensions, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Stack, usePathname, useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useAuthStore } from '@/stores/authStore';
import { createAuthenticatedApi } from '@/lib/api';
import { useSettingsStore } from '@/stores/settingsStore';
import { useServerStore } from '@/stores/serverStore';
import { connectSocket, disconnectSocket } from '@/lib/socket';
import { useSocket } from '@/hooks/useSocket';
import { useLastfmRealmMirror } from '@/hooks/useLastfmRealmMirror';
import { BottomDock, ChannelsSheet, MediaViewerModal, MembersSheet, SearchSheet, ServerDrawer, TheaterOverlayHost, TranslationEngineHost, VoiceBar, CallOverlay } from '@/components';
import { AmbiencePixelsOverlay } from '@/components/AmbiencePixelsOverlay';
import { useContentSocialStore } from '@/stores/contentSocialStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { usePushSettingsStore } from '@/stores/pushSettingsStore';
import {
  configureForegroundBehavior,
  requestPushPermissionAndGetToken,
  registerPushToken,
  registerVoipPushToken,
} from '@/lib/pushNotifications';
import { getLocalDeviceId, registerCurrentDevice } from '@/lib/deviceIdentity';
import { decryptNotificationPreviewEnvelope } from '@/lib/notificationPreviewCrypto';
import { captureAccountSession } from '@/lib/accountSession';
import { useDeviceRegistration } from '@/hooks/useDeviceRegistration';
import { secureStorage, StorageKeys } from '@/lib/storage';
import { useCallStore } from '@/stores/callStore';
import { nativeCallBridge } from '@/native/nativeCallBridge';
import { drainPendingNativeCallActions } from '@/native/pendingNativeCallActions';
import { isTabletDevice } from '@/hooks/useDeviceLayout';
import { TheaterJoinPromptHost } from '@/components/theater/TheaterJoinModal';
import { applyScreenOrientation } from '@/lib/screenOrientation';
import { useTheaterStore } from '@/stores/theaterStore';
import { CentralConsentModal } from '@/components/CentralConsentModal';
import { AppTourOverlay } from '@/components/appTour/AppTourOverlay';
import { useAppTourAutoStart } from '@/components/appTour/useAppTourAutoStart';
import { DMKeyReverificationBanner } from '@/components/DMKeyReverificationBanner';
import { PasskeyRecommendationBanner } from '@/components/PasskeyRecommendationBanner';
import { useDMKeyReverificationStore } from '@/stores/dmKeyReverificationStore';
import { DeviceApprovalPrompt } from '@/components/DeviceApprovalPrompt';

type NotificationSubscription = { remove: () => void };

export default function AppLayout() {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token);
  const syncKey = useAuthStore((s) => s.syncKey);
  const user = useAuthStore((s) => s.user);
  useAppTourAutoStart();
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const serverInfo = useAuthStore((s) => s.serverInfo);
  const expired = useAuthStore((s) => s.centralSessionExpired);
  const accountSwitching = useAuthStore((s) => s.accountSwitching);
  const expiredReason = useAuthStore((s) => s.centralSessionExpiredReason);
  const clearExpired = useAuthStore((s) => s.clearCentralSessionExpired);
  const hydrateSettings = useSettingsStore((s) => s.hydrate);
  const loadContentPrefs = useContentSocialStore((s) => s.loadPrefs);
  const contentPrefsLoaded = useContentSocialStore((s) => s.loaded);
  const loadNotifications = useNotificationStore((s) => s.load);
  const notificationsLoaded = useNotificationStore((s) => s.loaded);
  const fetchServersForCentral = useServerStore((s) => s.fetchServersForCentral);
  const setServers = useServerStore((s) => s.setServers);
  const setActiveServer = useServerStore((s) => s.setActiveServer);
  const hydratePushSettings = usePushSettingsStore((s) => s.hydrate);
  const pushSettingsLoaded = usePushSettingsStore((s) => s.loaded);
  const router = useRouter();
  const pathname = usePathname();
  const theaterFullscreen = useTheaterStore((s) => s.overlayMode === 'expanded' && s.focused);
  const notificationTapListener = useRef<NotificationSubscription | null>(null);
  const notificationReceivedListener = useRef<NotificationSubscription | null>(null);
  const handledNotificationIds = useRef(new Set<string>());

  // Mount all socket event → store listeners
  useSocket();
  useLastfmRealmMirror();
  useDeviceRegistration();

  useEffect(() => {
    useDMKeyReverificationStore.getState().setAccountId(user?.accountType === 'central' ? user.id : null);
  }, [user?.id, user?.accountType]);

  useEffect(() => {
    const unsubscribeActions = nativeCallBridge.subscribe((action) => {
      void useCallStore.getState().handleNativeCallAction(action);
    });
    const unsubscribeVoip = nativeCallBridge.subscribeVoipToken((voipToken) => {
      if (!voipToken) return;
      void (async () => {
        await secureStorage.set(StorageKeys.voipPushToken, voipToken);
        const state = useAuthStore.getState();
        if (state.accountSwitching || state.user?.accountType !== 'central') return;
        const userId = state.user.id;
        const deviceId = await registerCurrentDevice();
        if (useAuthStore.getState().user?.id === userId) await registerVoipPushToken(voipToken, deviceId);
      })().catch(() => {});
    });
    void drainPendingNativeCallActions().then((actions) => {
      actions.forEach((action) => void useCallStore.getState().handleNativeCallAction(action));
    });
    return () => {
      unsubscribeActions();
      unsubscribeVoip();
    };
  }, []);

  // App/theater orientation shares one owner; screen and player must not compete.
  useEffect(() => {
    let lastTablet: boolean | null = null;
    const apply = () => {
      const tablet = isTabletDevice();
      if (tablet === lastTablet) return;
      lastTablet = tablet;
      void applyScreenOrientation(tablet, pathname.includes('/theater/') && theaterFullscreen);
    };
    apply();
    const sub = Dimensions.addEventListener('change', apply);
    return () => sub.remove();
  }, [pathname, theaterFullscreen]);

  useEffect(() => {
    void hydrateSettings();
  }, [hydrateSettings]);

  useEffect(() => {
    if (token && !accountSwitching && !contentPrefsLoaded) void loadContentPrefs();
  }, [token, accountSwitching, contentPrefsLoaded, loadContentPrefs]);

  useEffect(() => {
    if (token && !accountSwitching && !notificationsLoaded) void loadNotifications();
  }, [token, accountSwitching, notificationsLoaded, loadNotifications]);

  useEffect(() => {
    if (!token) return;
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') void useNotificationStore.getState().refresh();
    });
    return () => sub.remove();
  }, [token]);

  // Central auto-sleep wake: desktop marks Central 'sleeping' after 10 idle minutes
  // (matching realms); opening the app on this device counts as activity.
  useEffect(() => {
    if (!token || accountSwitching || user?.accountType !== 'central') return;
    const wake = async () => {
      try {
        const api = createAuthenticatedApi();
        const res = await api.get<{ status?: string }>('/api/profile/me');
        if (res.data?.status !== 'sleeping') return;
        await api.put('/api/profile/me/status', { status: 'online' });
        await useAuthStore.getState().updateUser({ status: 'online' });
      } catch {
        // Best effort; the next foreground retries.
      }
    };
    void wake();
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') void wake();
    });
    return () => sub.remove();
  }, [token, accountSwitching, user?.accountType]);

  // Hydrate push mute settings for central accounts
  useEffect(() => {
    if (token && !accountSwitching && user?.accountType === 'central' && !pushSettingsLoaded) {
      void hydratePushSettings();
    }
  }, [token, accountSwitching, user?.accountType, pushSettingsLoaded, hydratePushSettings]);

  // Configure foreground notification display once on mount
  useEffect(() => {
    configureForegroundBehavior();
  }, []);

  // Register push token with central server (central accounts only)
  useEffect(() => {
    if (!token || !user || accountSwitching || user.accountType !== 'central') return;
    let cancelled = false;
    void (async () => {
      const deviceId = await getLocalDeviceId().catch(() => null);
      const result = await requestPushPermissionAndGetToken();
      if (cancelled || !result.success) return;
      const prev = await secureStorage.get(StorageKeys.pushToken);
      if (cancelled || useAuthStore.getState().user?.id !== user.id) return;
      await registerPushToken(result.token, deviceId);
      if (prev !== result.token) {
        await secureStorage.set(StorageKeys.pushToken, result.token);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, user?.id, accountSwitching]);

  const cacheEncryptedDmPreview = async (data: Record<string, unknown>) => {
    const session = captureAccountSession();
    if (
      data.type !== 'dm_message' ||
      typeof data.notificationId !== 'string' ||
      typeof data.conversationId !== 'string' ||
      typeof data.encryptedPreviewEnvelope !== 'string'
    ) return;
    const preview = await decryptNotificationPreviewEnvelope(data.encryptedPreviewEnvelope);
    if (!session.isCurrent()) return;
    if (preview?.conversationId !== data.conversationId || typeof preview.preview !== 'string') return;
    useNotificationStore.getState().cacheDmPreview(data.notificationId, data.conversationId, preview.preview);
  };

  const hydrateIncomingCallFromPush = (data: Record<string, unknown>) => {
    if (
      data.type !== 'dm_call' ||
      typeof data.callId !== 'string' ||
      typeof data.conversationId !== 'string' ||
      typeof data.callerId !== 'string' ||
      typeof data.callerName !== 'string'
    ) return false;
    useCallStore.getState().handleIncomingDM({
      callId: data.callId,
      conversationId: data.conversationId,
      callerId: data.callerId,
      callerName: data.callerName,
      callerAvatar: typeof data.callerAvatar === 'string' ? data.callerAvatar : null,
      mediaType: data.mediaType === 'video' ? 'video' : 'audio',
    });
    return true;
  };

  const hydrateGroupCallFromPush = (data: Record<string, unknown>) => {
    if (
      data.type !== 'group_call' ||
      typeof data.callId !== 'string' ||
      typeof data.groupChatId !== 'string' ||
      typeof data.initiatorName !== 'string'
    ) return false;
    useCallStore.getState().handleGroupStarted({
      callId: data.callId,
      groupChatId: data.groupChatId,
      initiatorName: data.initiatorName,
      mediaType: data.mediaType === 'video' ? 'video' : 'audio',
    });
    return true;
  };

  // Handle notification receipt/tap. Native background rendering still needs the
  // iOS NSE / Android-side decrypt path, but a foregrounded app can hydrate the
  // shared inbox immediately from the same encrypted envelope.
  useEffect(() => {
    const handleNotificationResponse = (response: Notifications.NotificationResponse) => {
      const active = useAuthStore.getState();
      if (active.accountSwitching || !active.token || !active.user) return;
      const notificationId = response.notification.request.identifier;
      if (handledNotificationIds.current.has(notificationId)) return;
      handledNotificationIds.current.add(notificationId);
      const data = response.notification.request.content.data as Record<string, string>;
      void cacheEncryptedDmPreview(data);
      if (!data?.type) return;
      switch (data.type) {
        case 'dm_message':
          if (data.conversationId) {
            router.push({ pathname: '/dm/[conversationId]', params: { conversationId: data.conversationId } });
          }
          break;
        case 'dm_call':
          hydrateIncomingCallFromPush(data);
          if (data.conversationId) {
            router.push({ pathname: '/dm/[conversationId]', params: { conversationId: data.conversationId } });
          }
          break;
        case 'group_message':
          if (data.groupChatId) {
            router.push({ pathname: '/group/[groupChatId]', params: { groupChatId: data.groupChatId } });
          }
          break;
        case 'group_call':
          hydrateGroupCallFromPush(data);
          if (data.groupChatId) {
            router.push({ pathname: '/group/[groupChatId]', params: { groupChatId: data.groupChatId } });
          }
          break;
        case 'server_mention': {
          if (data.serverId && data.channelId) {
            const servers = useServerStore.getState().servers;
            const server = servers.find((s) => s.url === data.serverId);
            if (server) {
              void useServerStore.getState().setActiveServer(server.id);
              router.push({
                pathname: '/server/[serverId]/channel/[channelId]',
                params: { serverId: server.id, channelId: data.channelId },
              });
            }
          }
          break;
        }
        case 'friend_request':
          router.push('/(app)/(tabs)/discover');
          break;
      }
    };
    notificationReceivedListener.current = Notifications.addNotificationReceivedListener((notification) => {
      const active = useAuthStore.getState();
      if (active.accountSwitching || !active.token || !active.user) return;
      const data = notification.request.content.data as Record<string, unknown>;
      void cacheEncryptedDmPreview(data);
      void useNotificationStore.getState().refresh();
      hydrateIncomingCallFromPush(data);
      hydrateGroupCallFromPush(data);
    });
    notificationTapListener.current = Notifications.addNotificationResponseReceivedListener(handleNotificationResponse);
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) handleNotificationResponse(response);
    });
    return () => {
      notificationReceivedListener.current?.remove();
      notificationTapListener.current?.remove();
    };
  }, [router]);

  // Connect socket when auth is ready; clean up on sign-out
  useEffect(() => {
    if (accountSwitching) {
      disconnectSocket();
    } else if (token && serverUrl) {
      connectSocket(serverUrl, token);
    } else if (!token) {
      disconnectSocket();
    }
  }, [token, serverUrl, accountSwitching]);

  // Central server membership is stored as encrypted sync data on auth.
  // Load it once the central session and sync key are available so settings
  // and server profile screens do not depend on visiting the Servers tab first.
  useEffect(() => {
    if (token && syncKey && user?.accountType === 'central') {
      void fetchServersForCentral();
    } else if (token && user?.accountType !== 'central' && serverUrl) {
      setServers([
        {
          id: 'local',
          name: serverInfo?.name ?? 'Server',
          url: serverUrl,
          token: '',
          iconUrl: serverInfo?.serverIcon ?? null,
          bannerUrl: serverInfo?.serverBanner ?? null,
          membersOnline: serverInfo?.userCount ?? 0,
          unread: 0,
          mention: 0,
        },
      ]);
      void setActiveServer('local');
    } else if (!token) {
      setServers([]);
    }
  }, [fetchServersForCentral, serverInfo, serverUrl, setActiveServer, setServers, syncKey, token, user?.accountType]);

  // Leaving the app shell must be driven by auth state, not by each button.
  // When a central session expires, the effect below owns the redirect
  // (central-login + reason alert) — don't race it to /welcome.
  useEffect(() => {
    if ((!token || !user) && !expired && !accountSwitching) {
      router.replace('/(auth)/welcome');
    }
  }, [router, token, user, expired, accountSwitching]);

  // Redirect to login when central session expires mid-flight
  useEffect(() => {
    if (expired) {
      const keyRotated = expiredReason === 'key_rotated';
      clearExpired();
      router.replace('/(auth)/central-login');
      if (keyRotated) {
        Alert.alert(t('auth.centralRestartedTitle'), t('auth.centralRestartedMsg'));
      }
    }
  }, [expired, expiredReason, clearExpired, router, t]);

  return (
    <View style={styles.root}>
      <DMKeyReverificationBanner />
      <PasskeyRecommendationBanner />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" options={{ animation: 'none' }} />
        <Stack.Screen name="server/[serverId]/channel/[channelId]" options={{ animation: 'none' }} />
        <Stack.Screen name="server/[serverId]/voice/[channelId]" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
        <Stack.Screen name="server/[serverId]/threads/[channelId]" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="server/[serverId]/forum/[channelId]" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="server/[serverId]/theater/[channelId]" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="server/[serverId]/settings" options={{ presentation: 'modal' }} />
        <Stack.Screen name="dm/[conversationId]" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="group/[groupChatId]" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="profile/[userId]" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
        <Stack.Screen name="notes/index" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="add-server" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="discover-servers" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="notes/[noteId]" options={{ animation: 'slide_from_right' }} />
      </Stack>
      <ServerDrawer />
      <ChannelsSheet />
      <MembersSheet />
      <SearchSheet />
      <MediaViewerModal />
      <TheaterOverlayHost />
      <TheaterJoinPromptHost />
      <VoiceBar />
      <CallOverlay />
      <BottomDock />
      <TranslationEngineHost />
      <AmbiencePixelsOverlay />
      <CentralConsentModal />
      <DeviceApprovalPrompt />
      <AppTourOverlay />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
