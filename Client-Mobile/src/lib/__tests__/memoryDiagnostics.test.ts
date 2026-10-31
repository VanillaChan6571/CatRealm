import { AppState, Platform, type AppStateStatus } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import { startMemoryDiagnostics } from '../memoryDiagnostics';
import { getMemoryResourceCounts, trackMemoryResource } from '../memoryResources';

jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn() }));
jest.mock('@/stores/settingsStore', () => ({ useSettingsStore: { getState: () => ({ soundAmbience: true, notificationsEnabled: true }) } }));
jest.mock('@/stores/ambienceFxStore', () => ({ useAmbienceFxStore: { getState: () => ({ spawning: true }) } }));

const MiB = 1048576;
let onState: (state: AppStateStatus) => void;
let remove: jest.Mock;
let stop: (() => void) | undefined;
const memoryDescriptor = Object.getOwnPropertyDescriptor(globalThis.performance, 'memory');
const initialAppState = AppState.currentState;
const rows = () => (console.log as jest.Mock).mock.calls.filter(([tag]) => tag === '[MemoryDiag]').map(([, json]) => JSON.parse(json));

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.replaceProperty(Platform, 'OS', 'ios');
  AppState.currentState = 'active';
  remove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    onState = listener;
    return { remove };
  });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  Object.defineProperty(globalThis.performance, 'memory', {
    configurable: true, get: () => ({ usedJSHeapSize: 12 * MiB, totalJSHeapSize: 20 * MiB }),
  });
  (requireOptionalNativeModule as jest.Mock).mockReturnValue({
    getMemoryUsage: jest.fn(async () => ({ footprintBytes: 150 * MiB, residentBytes: 130 * MiB })),
  });
});
afterEach(() => {
  stop?.(); stop = undefined;
  jest.restoreAllMocks();
  AppState.currentState = initialAppState;
  if (memoryDescriptor) Object.defineProperty(globalThis.performance, 'memory', memoryDescriptor);
  else Reflect.deleteProperty(globalThis.performance, 'memory');
  jest.useRealTimers();
});

test('logs numeric memory and resource counts every five seconds, with no retained history', async () => {
  const pool = trackMemoryResource('particleViews', 80);
  const particles = trackMemoryResource('activeParticles', 15);
  const audio = trackMemoryResource('notificationLoops');
  try {
    stop = startMemoryDiagnostics();
    await jest.advanceTimersByTimeAsync(0);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({
      nativeMemoryStatus: 'available', footprintMiB: 150, residentMiB: 130,
      jsUsedMiB: 12, jsHeapMiB: 20, particleViews: 80, activeParticles: 15,
      notificationLoops: 1, notificationOneShots: 0, ambienceEnabled: true, ambienceSpawning: true,
    });
    await jest.advanceTimersByTimeAsync(15_000);
    expect(rows()).toHaveLength(4);
    particles.setCount(0); audio.dispose();
    await jest.advanceTimersByTimeAsync(5000);
    expect(rows().at(-1)).toMatchObject({ activeParticles: 0, notificationLoops: 0 });
    stop();
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(5000);
    expect(rows()).toHaveLength(5);
  } finally { pool.dispose(); particles.dispose(); audio.dispose(); }
});

test('old binary and missing heap metrics report unavailable values, not fake zero memory', async () => {
  (requireOptionalNativeModule as jest.Mock).mockReturnValue({ getLatest: jest.fn() });
  Object.defineProperty(globalThis.performance, 'memory', { configurable: true, get: () => undefined });
  stop = startMemoryDiagnostics();
  await jest.advanceTimersByTimeAsync(0);
  expect(rows()[0]).toMatchObject({ nativeMemoryStatus: 'rebuild-required', footprintMiB: null, residentMiB: null, jsUsedMiB: null, jsHeapMiB: null });
});

test('native and JS read errors do not stop subsequent samples', async () => {
  const read = jest.fn().mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValue(null);
  (requireOptionalNativeModule as jest.Mock).mockReturnValue({ getMemoryUsage: read });
  Object.defineProperty(globalThis.performance, 'memory', { configurable: true, get: () => { throw new Error('Unavailable'); } });
  stop = startMemoryDiagnostics();
  await jest.advanceTimersByTimeAsync(0);
  expect(rows()[0]).toMatchObject({ nativeMemoryStatus: 'read-failed', jsUsedMiB: null });
  await jest.advanceTimersByTimeAsync(5000);
  expect(rows()[1].nativeMemoryStatus).toBe('unavailable');
});

test('slow native reads never overlap and stale background/unmount results are discarded', async () => {
  let resolve!: (value: null) => void;
  const read = jest.fn(() => new Promise<null>((done) => { resolve = done; }));
  (requireOptionalNativeModule as jest.Mock).mockReturnValue({ getMemoryUsage: read });
  stop = startMemoryDiagnostics();
  await jest.advanceTimersByTimeAsync(20_000);
  expect(read).toHaveBeenCalledTimes(1);
  onState('background');
  onState('active');
  resolve(null);
  await jest.advanceTimersByTimeAsync(0);
  expect(rows()).toHaveLength(0);
  await jest.advanceTimersByTimeAsync(5000);
  expect(read).toHaveBeenCalledTimes(2);
  stop(); resolve(null);
  await jest.advanceTimersByTimeAsync(20_000);
  expect(rows()).toHaveLength(0);
  expect(jest.getTimerCount()).toBe(0);
  expect(remove).toHaveBeenCalled();
});

test('background pauses sampling and foreground resumes it', async () => {
  stop = startMemoryDiagnostics();
  await jest.advanceTimersByTimeAsync(0);
  onState('background');
  await jest.advanceTimersByTimeAsync(20_000);
  expect(rows()).toHaveLength(1);
  expect(jest.getTimerCount()).toBe(0);
  onState('active');
  await jest.advanceTimersByTimeAsync(0);
  expect(rows()).toHaveLength(2);
});

test('production starts no timers, native reads, listeners, logs, or resource tracking', () => {
  jest.replaceProperty(globalThis as typeof globalThis & { __DEV__: boolean }, '__DEV__', false);
  (requireOptionalNativeModule as jest.Mock).mockClear();
  stop = startMemoryDiagnostics();
  const lease = trackMemoryResource('activeParticles', 80);
  lease.setCount(20); lease.dispose();
  expect(getMemoryResourceCounts().activeParticles).toBe(0);
  expect(requireOptionalNativeModule).not.toHaveBeenCalled();
  expect(AppState.addEventListener).not.toHaveBeenCalled();
  expect(console.log).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

test('resource leases aggregate multiple owners and ignore late disposal/updates', () => {
  const first = trackMemoryResource('particleViews', 80);
  const second = trackMemoryResource('particleViews', 80);
  expect(getMemoryResourceCounts().particleViews).toBe(160);
  first.dispose(); first.dispose(); first.setCount(40);
  expect(getMemoryResourceCounts().particleViews).toBe(80);
  second.dispose();
  expect(getMemoryResourceCounts().particleViews).toBe(0);
});
