/**
 * Cross-platform secure storage abstraction.
 *
 * - On native (iOS/Android): uses expo-secure-store (Keychain / Keystore).
 * - On web: falls back to AsyncStorage (NOT secure — JWTs would be readable
 *   from JS but that's the standard web tradeoff).
 *
 * Use this for any auth token, sync key, or TOTP secret. Use AsyncStorage
 * directly for non-sensitive data (UI prefs, draft messages, etc).
 */

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

const isNative = Platform.OS === 'ios' || Platform.OS === 'android';
export const IOS_NOTIFICATION_PREVIEW_ACCESS_GROUP = 'group.com.nwya.catrealm.mobile';
const notificationPreviewSharedOptions = Platform.OS === 'ios'
  ? {
      accessGroup: IOS_NOTIFICATION_PREVIEW_ACCESS_GROUP,
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
    }
  : undefined;

export const secureStorage = {
  async get(key: string): Promise<string | null> {
    if (isNative) {
      return SecureStore.getItemAsync(key);
    }
    return AsyncStorage.getItem(key);
  },

  async set(key: string, value: string): Promise<void> {
    if (isNative) {
      await SecureStore.setItemAsync(key, value);
      return;
    }
    await AsyncStorage.setItem(key, value);
  },

  async remove(key: string): Promise<void> {
    if (isNative) {
      await SecureStore.deleteItemAsync(key);
      return;
    }
    await AsyncStorage.removeItem(key);
  },
};

export const sharedNotificationPreviewStorage = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === 'ios') return SecureStore.getItemAsync(key, notificationPreviewSharedOptions);
    return secureStorage.get(key);
  },
  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === 'ios') {
      await SecureStore.setItemAsync(key, value, notificationPreviewSharedOptions);
      return;
    }
    await secureStorage.set(key, value);
  },
};

/** Reserved storage keys — keep them namespaced to avoid collisions with libs. */
export const StorageKeys = {
  authToken: 'catrealm.auth-token',
  authUser: 'catrealm.auth-user',
  syncKey: 'catrealm.sync-key',
  centralToken: 'catrealm.central-token',
  activeServerUrl: 'catrealm.active-server-url',
  themeOverride: 'catrealm.theme-override',
  onboardingDone: 'catrealm.onboarding-done',
  pushToken: 'catrealm.push-token',
  voipPushToken: 'catrealm.voip-push-token',
  deviceId: 'catrealm.device-id',
  deviceDmPrivateKey: 'catrealm.device-dm-private-key',
  deviceNotificationPrivateKey: 'catrealm.device-notification-private-key',
  deviceIdentityOwner: 'catrealm.device-identity-owner',
  deviceIdentityLegacyDeviceId: 'catrealm.device-identity-legacy-device-id',
  savedAccountsList: 'catrealm.saved-accounts',
} as const;

/** Per-account SecureStore keys — suffixed with userId so multiple accounts coexist. */
export const accountTokenKey = (userId: string) => `catrealm.auth-token.${userId}`;
export const accountUserKey = (userId: string) => `catrealm.auth-user.${userId}`;
export const accountSyncKeyKey = (userId: string) => `catrealm.sync-key.${userId}`;
export const accountServerUrlKey = (userId: string) => `catrealm.active-server-url.${userId}`;
export const accountDeviceIdKey = (userId: string) => `catrealm.device-id.${userId}`;
export const accountCentralDeviceSecretKey = (userId: string) => `catrealm.central-device-secret.${userId}`;
export const accountDeviceDmPrivateKeyKey = (userId: string) => `catrealm.device-dm-private-key.${userId}`;
export const accountDeviceNotificationPrivateKeyKey = (userId: string) => `catrealm.device-notification-private-key.${userId}`;
