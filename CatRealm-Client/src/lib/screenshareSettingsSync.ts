import { useEffect } from 'react';
import {
  useSettingsStore,
  type ScreenShareNativeProfile,
  type ScreenshareCodecPreference,
} from '../stores/settingsStore';

type ScreenShareVideoEncoderBackend = 'auto' | 'd3d11' | 'vulkan';

const SETTINGS_STORAGE_KEY = 'catrealm.settings';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Re-read the persisted screenshare settings into the store. The screenshare
 * wizard can run in a separate Electron window (its own renderer + store); it
 * persists to localStorage, and the main window picks the changes up here when
 * the `storage` event fires. Only the screenshare-relevant keys are applied so
 * unrelated in-memory state isn't clobbered.
 */
export function syncScreenshareSettingsFromStorage() {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return;

    const next: {
      screenshareFps?: 24 | 48 | 60;
      screenshareResolution?: 720 | 1080 | 1440;
      screenshareQualityPreset?: 'quality' | 'efficiency' | 'compressed';
      screenshareCodecPreference?: ScreenshareCodecPreference;
      screenshareDegradationPreference?: 'maintain-framerate' | 'maintain-resolution';
      screenShareSimulcastEnabled?: boolean;
      screenShareEncoderBackend?: ScreenShareVideoEncoderBackend;
      screenShareNativeWhipEnabled?: boolean;
      screenShareNativeWhipSimulcastEnabled?: boolean;
      screenShareNativeProfile?: ScreenShareNativeProfile;
      screenshareWizardCompletedAt?: number | null;
    } = {};

    if (parsed.screenshareFps === 24 || parsed.screenshareFps === 48 || parsed.screenshareFps === 60) {
      next.screenshareFps = parsed.screenshareFps;
    }
    if (parsed.screenshareResolution === 720 || parsed.screenshareResolution === 1080 || parsed.screenshareResolution === 1440) {
      next.screenshareResolution = parsed.screenshareResolution;
    }
    if (parsed.screenshareQualityPreset === 'quality' || parsed.screenshareQualityPreset === 'efficiency' || parsed.screenshareQualityPreset === 'compressed') {
      next.screenshareQualityPreset = parsed.screenshareQualityPreset;
    }
    if (parsed.screenshareCodecPreference === 'auto' || parsed.screenshareCodecPreference === 'vp8' || parsed.screenshareCodecPreference === 'h264' || parsed.screenshareCodecPreference === 'h265') {
      next.screenshareCodecPreference = parsed.screenshareCodecPreference;
    }
    if (parsed.screenshareDegradationPreference === 'maintain-framerate' || parsed.screenshareDegradationPreference === 'maintain-resolution') {
      next.screenshareDegradationPreference = parsed.screenshareDegradationPreference;
    }
    if (typeof parsed.screenShareSimulcastEnabled === 'boolean') {
      next.screenShareSimulcastEnabled = parsed.screenShareSimulcastEnabled;
    }
    if (parsed.screenShareEncoderBackend === 'auto' || parsed.screenShareEncoderBackend === 'd3d11' || parsed.screenShareEncoderBackend === 'vulkan') {
      next.screenShareEncoderBackend = parsed.screenShareEncoderBackend;
    }
    if (typeof parsed.screenShareNativeWhipEnabled === 'boolean') {
      next.screenShareNativeWhipEnabled = parsed.screenShareNativeWhipEnabled;
    }
    if (typeof parsed.screenShareNativeWhipSimulcastEnabled === 'boolean') {
      next.screenShareNativeWhipSimulcastEnabled = parsed.screenShareNativeWhipSimulcastEnabled;
    }
    if (parsed.screenShareNativeProfile === 'high' || parsed.screenShareNativeProfile === 'main' || parsed.screenShareNativeProfile === 'baseline' || parsed.screenShareNativeProfile === 'constrained-baseline') {
      next.screenShareNativeProfile = parsed.screenShareNativeProfile;
    }
    if (typeof parsed.screenshareWizardCompletedAt === 'number' && Number.isFinite(parsed.screenshareWizardCompletedAt)) {
      next.screenshareWizardCompletedAt = parsed.screenshareWizardCompletedAt;
    } else if (parsed.screenshareWizardCompletedAt === null) {
      next.screenshareWizardCompletedAt = null;
    }

    if (Object.keys(next).length > 0) {
      useSettingsStore.setState(next);
    }
  } catch {
    // Ignore malformed persisted settings.
  }
}

/**
 * Keep this window's screenshare settings in sync with the persisted copy that
 * the standalone wizard window writes. Mount in any surface that gates on
 * `screenshareWizardCompletedAt` (settings panel, share picker).
 */
export function useScreenshareSettingsSync() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === SETTINGS_STORAGE_KEY) {
        syncScreenshareSettingsFromStorage();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);
}
