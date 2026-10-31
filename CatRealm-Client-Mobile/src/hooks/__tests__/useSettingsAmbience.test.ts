import { act, renderHook } from '@testing-library/react-native';
import { useSettingsAmbience } from '../useSettingsAmbience';
import { useAmbienceFxStore } from '@/stores/ambienceFxStore';
import { setTheaterSessionActive } from '@/lib/notificationSounds';

jest.setTimeout(15_000);
let mockForeground = true;
jest.mock('../useAppForeground', () => ({ useAppForeground: () => mockForeground }));
jest.mock('expo-audio', () => ({ setAudioModeAsync: jest.fn(async () => {}), createAudioPlayer: () => {
  const player = { play: jest.fn(), pause: jest.fn(), remove: jest.fn(), release: jest.fn(), volume: 0, loop: false };
  mockPlayers.push(player);
  return player;
} }));
const mockPlayers: { play: jest.Mock; pause: jest.Mock; remove: jest.Mock; release: jest.Mock; volume: number; loop: boolean }[] = [];
beforeEach(() => {
  mockPlayers.length = 0; mockForeground = true;
  setTheaterSessionActive(true);
  useAmbienceFxStore.getState().stopSpawning();
});
afterEach(() => setTheaterSessionActive(false));

test('volume changes including zero reuse one player; disable/unmount release exactly once', async () => {
  const hook = await renderHook<void, { enabled: boolean; volume: number }>(({ enabled, volume }) => useSettingsAmbience(enabled, volume), { initialProps: { enabled: true, volume: 0 } });
  expect(mockPlayers).toHaveLength(1);
  expect(useAmbienceFxStore.getState().spawning).toBe(true);
  for (const volume of [20, 40, 0, 80]) await hook.rerender({ enabled: true, volume });
  expect(mockPlayers).toHaveLength(1);
  expect(mockPlayers[0].volume).toBe(0.8);
  await hook.rerender({ enabled: false, volume: 80 });
  expect(useAmbienceFxStore.getState().spawning).toBe(false);
  expect(mockPlayers[0].release).toHaveBeenCalledTimes(1);
  await hook.unmount();
  expect(mockPlayers[0].release).toHaveBeenCalledTimes(1);
});

test('background/foreground cycles stop and recreate audio without leaving owners behind', async () => {
  const hook = await renderHook(() => useSettingsAmbience(true, 100));
  for (let i = 0; i < 10; i++) {
    mockForeground = false; await hook.rerender({});
    expect(useAmbienceFxStore.getState().spawning).toBe(false);
    expect(mockPlayers.every((player) => player.release.mock.calls.length === 1)).toBe(true);
    mockForeground = true; await hook.rerender({});
  }
  await act(async () => hook.unmount());
  expect(mockPlayers).toHaveLength(11);
  expect(mockPlayers.every((player) => player.release.mock.calls.length === 1)).toBe(true);
});
