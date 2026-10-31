import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import { sharedNotificationPreviewStorage, StorageKeys } from '@/lib/storage';

export type NotificationPreviewDiagnostic = {
  status?: string;
  updatedAtMs?: number;
  hasEnvelope?: boolean;
  hasAvatarUrl?: boolean;
  payloadType?: string;
  hasPreview?: boolean;
  previewLength?: number;
  hasSenderName?: boolean;
  title?: string;
  body?: string;
  attachmentCount?: number;
};

export type NotificationPreviewLocalReadiness = {
  hasSharedDeviceId: boolean;
  hasSharedNotificationPrivateKey: boolean;
};

type NativeNotificationDiagnostics = {
  getLatest(): Promise<NotificationPreviewDiagnostic | null>;
  clearLatest(): Promise<boolean>;
};

let nativeModule: NativeNotificationDiagnostics | null = null;
let didResolveNativeModule = false;

function getNativeModule(): NativeNotificationDiagnostics | null {
  if (Platform.OS !== 'ios') return null;
  if (!didResolveNativeModule) {
    nativeModule = requireOptionalNativeModule<NativeNotificationDiagnostics>('CatRealmNotificationDiagnostics');
    didResolveNativeModule = true;
  }
  return nativeModule;
}

export async function getLatestNotificationPreviewDiagnostic(): Promise<NotificationPreviewDiagnostic | null> {
  return getNativeModule()?.getLatest() ?? null;
}

export async function clearLatestNotificationPreviewDiagnostic(): Promise<boolean> {
  return getNativeModule()?.clearLatest() ?? false;
}

export async function getNotificationPreviewLocalReadiness(): Promise<NotificationPreviewLocalReadiness | null> {
  if (Platform.OS !== 'ios') return null;
  const [deviceId, privateKey] = await Promise.all([
    sharedNotificationPreviewStorage.get(StorageKeys.deviceId),
    sharedNotificationPreviewStorage.get(StorageKeys.deviceNotificationPrivateKey),
  ]);
  return {
    hasSharedDeviceId: Boolean(deviceId),
    hasSharedNotificationPrivateKey: Boolean(privateKey),
  };
}
