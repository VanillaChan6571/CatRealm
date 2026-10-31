import { AppState, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import { getMemoryResourceCounts } from './memoryResources';
import { useAmbienceFxStore } from '@/stores/ambienceFxStore';
import { useSettingsStore } from '@/stores/settingsStore';

type NativeMemory = { footprintBytes: number; residentBytes: number };
type NativeDiagnostics = { getMemoryUsage?: () => Promise<NativeMemory | null> };
type HeapMemory = { usedJSHeapSize?: number | null; totalJSHeapSize?: number | null };
const SAMPLE_INTERVAL_MS = 5000;
const toMiB = (bytes: unknown) => typeof bytes === 'number' && Number.isFinite(bytes) && bytes >= 0
  ? Math.round(bytes / 1048576 * 100) / 100 : null;

function readHeapMemory() {
  try {
    // RN 0.86 maps these fields to Hermes' current allocated bytes/heap size.
    // Do not force GC or take heap snapshots while measuring ordinary usage.
    const memory = (globalThis.performance as Performance & { memory?: HeapMemory })?.memory;
    return { jsUsedMiB: toMiB(memory?.usedJSHeapSize), jsHeapMiB: toMiB(memory?.totalJSHeapSize) };
  } catch {
    return { jsUsedMiB: null, jsHeapMiB: null };
  }
}

/** One root-layout owner. Release builds do not resolve native modules or log. */
export function startMemoryDiagnostics(): () => void {
  if (!__DEV__) return () => {};
  let native: NativeDiagnostics | null = null;
  try {
    if (Platform.OS === 'ios') native = requireOptionalNativeModule<NativeDiagnostics>('CatRealmNotificationDiagnostics');
  } catch { /* Old development clients may not contain this module. */ }

  const startedAt = Date.now();
  let live = true;
  let foreground = AppState.currentState === 'active';
  let generation = 0;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const sample = async () => {
    if (!live || !foreground || pending) return;
    pending = true;
    const sampleGeneration = generation;
    try {
      let memory: NativeMemory | null = null;
      let nativeMemoryStatus = Platform.OS !== 'ios' ? 'unsupported-platform' : 'rebuild-required';
      if (typeof native?.getMemoryUsage === 'function') {
        try {
          memory = await native.getMemoryUsage();
          nativeMemoryStatus = memory ? 'available' : 'unavailable';
        } catch { nativeMemoryStatus = 'read-failed'; }
      }
      // Ignore native work completed after backgrounding, unmount, or refresh.
      if (!live || !foreground || sampleGeneration !== generation) return;
      const settings = useSettingsStore.getState();
      console.log('[MemoryDiag]', JSON.stringify({
        timestamp: new Date().toISOString(),
        elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
        nativeMemoryStatus,
        footprintMiB: toMiB(memory?.footprintBytes),
        residentMiB: toMiB(memory?.residentBytes),
        ...readHeapMemory(),
        ambienceEnabled: settings.soundAmbience,
        notificationsEnabled: settings.notificationsEnabled,
        ambienceSpawning: useAmbienceFxStore.getState().spawning,
        ...getMemoryResourceCounts(),
      }));
    } finally {
      pending = false;
      // Schedule only after completion: no overlapping reads or queued samples.
      if (live && foreground) timer = setTimeout(() => { timer = undefined; void sample(); }, SAMPLE_INTERVAL_MS);
    }
  };
  const listener = AppState.addEventListener('change', (state) => {
    generation += 1;
    foreground = state === 'active';
    clearTimeout(timer);
    timer = undefined;
    if (foreground) void sample();
  });
  void sample();
  return () => {
    live = false;
    generation += 1;
    clearTimeout(timer);
    listener.remove();
  };
}
