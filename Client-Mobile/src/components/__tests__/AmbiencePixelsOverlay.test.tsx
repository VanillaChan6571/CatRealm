import { act, render } from '@testing-library/react-native';
import { Animated } from 'react-native';
import { AmbiencePixelsOverlay } from '../AmbiencePixelsOverlay';
import { useAmbienceFxStore } from '@/stores/ambienceFxStore';
import { getMemoryResourceCounts } from '@/lib/memoryResources';

jest.setTimeout(15_000);
let mockForeground = true;
jest.mock('@/hooks/useAppForeground', () => ({ useAppForeground: () => mockForeground }));
const animations: { finish: () => void; stop: jest.Mock }[] = [];
beforeEach(() => {
  jest.useFakeTimers(); mockForeground = true; animations.length = 0;
  jest.spyOn(globalThis, 'setInterval');
  jest.spyOn(globalThis, 'clearInterval');
  useAmbienceFxStore.getState().startSpawning();
  jest.spyOn(Animated, 'timing').mockImplementation(() => {
    let completion: ((result: { finished: boolean }) => void) | undefined;
    const stop = jest.fn(() => completion?.({ finished: false }));
    animations.push({ finish: () => completion?.({ finished: true }), stop });
    return { start: (callback) => { completion = callback; }, stop, reset: jest.fn() };
  });
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); useAmbienceFxStore.getState().stopSpawning(); });

function expectSpawnTimersCleared() {
  const interval = setInterval as unknown as jest.Mock;
  interval.mock.calls.forEach(([, delay], index) => {
    if (delay === 1000 / 5.5) expect(clearInterval).toHaveBeenCalledWith(interval.mock.results[index].value);
  });
}

test('reuses an 80-view pool at the original spawn rate without publishing frame updates', async () => {
  const screen = await render(<AmbiencePixelsOverlay />);
  const update = jest.fn();
  const unsubscribe = useAmbienceFxStore.subscribe(update);
  expect(screen.getAllByTestId('ambience-particle')).toHaveLength(80);
  await act(() => { jest.advanceTimersByTime(1000); });
  expect(animations).toHaveLength(5);
  expect(getMemoryResourceCounts()).toMatchObject({ particleViews: 80, activeParticles: 5 });
  expect(Animated.timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ useNativeDriver: true, isInteraction: false }));
  await act(() => { jest.advanceTimersByTime(60_000); });
  expect(animations).toHaveLength(80); // even stalled completions cannot grow the pool
  await act(() => { animations.slice(0, 20).forEach((animation) => animation.finish()); jest.advanceTimersByTime(4000); });
  expect(animations).toHaveLength(100); // freed slots are reused, not new views
  expect(screen.getAllByTestId('ambience-particle')).toHaveLength(80);
  expect(update).not.toHaveBeenCalled();
  unsubscribe();
});

test('disabling lets existing particles drain, then releases the entire pool and timer', async () => {
  const screen = await render(<AmbiencePixelsOverlay />);
  await act(() => { jest.advanceTimersByTime(1000); useAmbienceFxStore.getState().stopSpawning(); });
  expect(screen.getByTestId('ambience-particle-pool')).toBeTruthy();
  await act(() => { jest.advanceTimersByTime(5000); });
  expect(animations).toHaveLength(5);
  await act(() => animations.forEach((animation) => animation.finish()));
  expect(screen.queryByTestId('ambience-particle-pool')).toBeNull();
  expect(getMemoryResourceCounts()).toMatchObject({ particleViews: 0, activeParticles: 0 });
  // RN defers Animated.View detach work; flush it before checking for live timers.
  await act(() => { jest.advanceTimersByTime(1000); });
  expectSpawnTimersCleared();
});

test('backgrounding or unmount cancels every native animation and the spawn timer', async () => {
  const screen = await render(<AmbiencePixelsOverlay />);
  await act(() => { jest.advanceTimersByTime(1000); });
  mockForeground = false;
  await screen.rerender(<AmbiencePixelsOverlay />);
  expect(screen.queryByTestId('ambience-particle-pool')).toBeNull();
  expect(animations.every((animation) => animation.stop.mock.calls.length === 1)).toBe(true);
  expect(getMemoryResourceCounts()).toMatchObject({ particleViews: 0, activeParticles: 0 });
  await act(() => { jest.advanceTimersByTime(1000); });
  expectSpawnTimersCleared();
  // Late native callbacks cannot resurrect a removed pool.
  await act(() => animations.forEach((animation) => animation.finish()));
  expect(screen.queryByTestId('ambience-particle-pool')).toBeNull();
  mockForeground = true;
  await screen.rerender(<AmbiencePixelsOverlay />);
  await act(() => { jest.advanceTimersByTime(1000); });
  await screen.unmount();
  expect(animations.every((animation) => animation.stop.mock.calls.length === 1)).toBe(true);
  await act(() => { jest.advanceTimersByTime(1000); });
  expectSpawnTimersCleared();
});
