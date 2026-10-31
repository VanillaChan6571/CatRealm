import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { createAuthenticatedApi } from '@/lib/api';
import { captureAccountSession } from '@/lib/accountSession';

const EAS_PROJECT_ID = '3eced1a7-2d18-4052-a831-e6aae94086b3';
let pushTokenMutation: Promise<void> = Promise.resolve();

function enqueuePushTokenMutation(action: () => Promise<void>): Promise<void> {
  const pending = pushTokenMutation.then(action, action);
  pushTokenMutation = pending.catch(() => {});
  return pending;
}

export type PushTokenResult =
  | { success: true; token: string }
  | { success: false; reason: 'denied' | 'unavailable' | 'error'; message?: string };

type PermissionState = {
  granted?: boolean;
  status?: string;
};

function hasNotificationPermission(permission: PermissionState): boolean {
  return permission.granted === true || permission.status === 'granted';
}

/**
 * Request notification permissions and return the Expo push token.
 * Always returns a discriminated union — never throws.
 * On denial, returns { success: false, reason: 'denied' } — do not re-prompt.
 * Requires an EAS build (does not work in Expo Go).
 */
export async function requestPushPermissionAndGetToken(): Promise<PushTokenResult> {
  if (!EAS_PROJECT_ID) {
    return { success: false, reason: 'unavailable', message: 'No EAS projectId configured' };
  }

  if (Platform.OS === 'android') {
    // Omit `sound` for the system default; a string is looked up as a bundled res/raw file.
    await Notifications.setNotificationChannelAsync('catrealm-default', {
      name: 'CatRealm Notifications',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#7c3aed',
    });
    await Notifications.setNotificationChannelAsync('catrealm-calls', {
      name: 'CatRealm Calls',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 350, 200, 350, 200, 600],
      lightColor: '#22c55e',
    });
  }

  const existingPermission = await Notifications.getPermissionsAsync();
  let isGranted = hasNotificationPermission(existingPermission as PermissionState);

  if (!isGranted) {
    const requestedPermission = await Notifications.requestPermissionsAsync();
    isGranted = hasNotificationPermission(requestedPermission as PermissionState);
  }

  if (!isGranted) {
    return { success: false, reason: 'denied' };
  }

  try {
    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId: EAS_PROJECT_ID });
    return { success: true, token: tokenData.data };
  } catch (err) {
    return {
      success: false,
      reason: 'error',
      message: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

/**
 * Register a push token with the central server.
 * Non-fatal — silently skips on network failure.
 */
export async function registerPushToken(token: string, deviceId?: string | null): Promise<void> {
  const session = captureAccountSession();
  if (!session.token || session.user?.accountType !== 'central') return;
  await enqueuePushTokenMutation(async () => {
    if (!session.isCurrent()) return;
    try {
      const api = createAuthenticatedApi();
      await api.post('/api/push/token', {
        token,
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
        ...(deviceId ? { deviceId } : {}),
      });
    } catch (err) {
      console.warn('[Push] Token registration failed:', err);
    }
  });
}

/**
 * Unregister a push token from the central server.
 * Call BEFORE clearing the auth token on logout.
 * Non-fatal — silently skips on failure.
 */
export async function unregisterPushToken(token: string): Promise<void> {
  const session = captureAccountSession();
  if (!session.token || session.user?.accountType !== 'central') return;
  await enqueuePushTokenMutation(async () => {
    if (!session.isCurrent()) return;
    try {
      const api = createAuthenticatedApi();
      await api.delete('/api/push/token', { data: { token } });
    } catch {
      // Non-fatal — token will age out or be removed on next DeviceNotRegistered error
    }
  });
}

export async function registerVoipPushToken(token: string, deviceId: string): Promise<void> {
  const session = captureAccountSession();
  if (Platform.OS !== 'ios' || !session.token || session.user?.accountType !== 'central') return;
  await enqueuePushTokenMutation(async () => {
    if (!session.isCurrent()) return;
    try {
      await createAuthenticatedApi().post('/api/push/voip-token', { token, platform: 'ios', deviceId });
    } catch (err) {
      console.warn('[Push] VoIP token registration failed:', err);
    }
  });
}

export async function unregisterVoipPushToken(token: string): Promise<void> {
  const session = captureAccountSession();
  if (Platform.OS !== 'ios' || !session.token || session.user?.accountType !== 'central') return;
  await enqueuePushTokenMutation(async () => {
    if (!session.isCurrent()) return;
    try {
      await createAuthenticatedApi().delete('/api/push/voip-token', { data: { token } });
    } catch {
      // Non-fatal; the current account can continue switching.
    }
  });
}

/**
 * Configure how notifications appear when the app is in the foreground.
 * Call once at app startup before any notifications can arrive.
 */
export function configureForegroundBehavior(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}
