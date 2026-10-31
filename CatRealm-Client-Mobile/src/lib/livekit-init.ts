import Constants from 'expo-constants';

// Polyfill DOMException at module load time — livekit-client references it
// during its own module evaluation, before ensureLiveKitGlobals() is ever called.
if (typeof DOMException === 'undefined') {
  (globalThis as any).DOMException = class DOMException extends Error {
    constructor(message?: string, name?: string) {
      super(message);
      this.name = name || 'DOMException';
    }
  };
}

let liveKitGlobalsReady = false;
let liveKitInitError: string | null = null;

export function ensureLiveKitGlobals(): boolean {
  if (liveKitGlobalsReady) return true;
  if (Constants.appOwnership === 'expo') {
    liveKitInitError = 'LiveKit WebRTC native modules are unavailable in Expo Go';
    return false;
  }
  try {
    // Use require to avoid top-level invariant errors when native modules are missing.
    const { registerGlobals } = require('@livekit/react-native');
    if (typeof registerGlobals === 'function') {
      registerGlobals();
      liveKitGlobalsReady = true;
      liveKitInitError = null;
      return true;
    }
    liveKitInitError = 'registerGlobals is not available from @livekit/react-native';
    return false;
  } catch (e) {
    liveKitInitError = e instanceof Error ? e.message : 'Unknown LiveKit init error';
    console.warn('LiveKit globals registration failed.', e);
    return false;
  }
}

export function getLiveKitInitError(): string | null {
  return liveKitInitError;
}

// Eagerly register on native (dev-client / standalone). Android's TurboModule
// requires LiveKitReactNative.setup() before the module is loaded by the
// TurboModuleManager, not just before first use. The Expo Go guard inside
// ensureLiveKitGlobals() still applies.
ensureLiveKitGlobals();
