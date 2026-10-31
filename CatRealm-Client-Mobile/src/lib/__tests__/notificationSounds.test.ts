jest.mock('expo-audio', () => ({ createAudioPlayer: jest.fn(() => mockPlayer), setAudioModeAsync: jest.fn(async () => {}) }));

import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { getMemoryResourceCounts } from '../memoryResources';
import { playNotificationSound, setTheaterSessionActive, startLoopingNotificationSound, setLoopingNotificationSoundVolume } from '../notificationSounds';

const mockPlayer = { play: jest.fn(), pause: jest.fn(), remove: jest.fn(), release: jest.fn(), loop: false, volume: 0 };
beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); setTheaterSessionActive(true); });
afterEach(() => { jest.runOnlyPendingTimers(); jest.useRealTimers(); setTheaterSessionActive(false); });

test('sound effects cannot deactivate the theater audio session when they finish', async () => {
  await playNotificationSound('send-message', 100);
  expect(getMemoryResourceCounts().notificationOneShots).toBe(1);
  expect(setAudioModeAsync).not.toHaveBeenCalled();
  expect(createAudioPlayer).toHaveBeenCalledWith(expect.anything(), { keepAudioSessionActive: true });
  jest.advanceTimersByTime(10_000);
  expect(mockPlayer.remove).toHaveBeenCalled();
  expect(mockPlayer.release).toHaveBeenCalledTimes(1);
  expect(getMemoryResourceCounts().notificationOneShots).toBe(0);
});
test('stopping a ringtone does not deactivate the newly answered call session', async () => {
  const stop = await startLoopingNotificationSound('dm-incoming-call', 100);
  expect(getMemoryResourceCounts().notificationLoops).toBe(1);
  expect(createAudioPlayer).toHaveBeenCalledWith(expect.anything(), { keepAudioSessionActive: true });
  await stop();
  expect(getMemoryResourceCounts().notificationLoops).toBe(0);
  expect(mockPlayer.pause).toHaveBeenCalled();
  expect(mockPlayer.remove).toHaveBeenCalled();
  expect(mockPlayer.release).toHaveBeenCalledTimes(1);
});

test.each(['loop', 'one-shot'])('failed %s playback still removes and releases its allocated player', async (kind) => {
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockPlayer.play.mockImplementationOnce(() => { throw new Error('Synthetic native playback failure'); });
  if (kind === 'loop') await (await startLoopingNotificationSound('ambience', 100))();
  else await playNotificationSound('ambience', 100);
  expect(mockPlayer.remove).toHaveBeenCalledTimes(1);
  expect(mockPlayer.release).toHaveBeenCalledTimes(1);
  warning.mockRestore();
});

test('cleanup is idempotent and still releases if pause/remove throws', async () => {
  const stop = await startLoopingNotificationSound('ambience', 100);
  mockPlayer.pause.mockImplementationOnce(() => { throw new Error('Pause failed'); });
  mockPlayer.remove.mockImplementationOnce(() => { throw new Error('Remove failed'); });
  await stop(); await stop();
  expect(mockPlayer.pause).toHaveBeenCalledTimes(1);
  expect(mockPlayer.remove).toHaveBeenCalledTimes(1);
  expect(mockPlayer.release).toHaveBeenCalledTimes(1);
});

test('a stale stop cannot release a replacement loop and zero-volume loops update in place', async () => {
  const replacement = { play: jest.fn(), pause: jest.fn(), remove: jest.fn(), release: jest.fn(), volume: 0, loop: false };
  const firstStop = await startLoopingNotificationSound('ambience', 100);
  (createAudioPlayer as jest.Mock).mockReturnValueOnce(replacement);
  const secondStop = await startLoopingNotificationSound('ambience', 0);
  expect(mockPlayer.release).toHaveBeenCalledTimes(1);
  await firstStop();
  expect(replacement.release).not.toHaveBeenCalled();
  setLoopingNotificationSoundVolume('ambience', 70);
  expect(replacement.volume).toBe(0.7);
  await secondStop(); await secondStop();
  expect(replacement.release).toHaveBeenCalledTimes(1);
  setLoopingNotificationSoundVolume('ambience', 100);
  expect(replacement.volume).toBe(0.7);
});

test('100 failed starts retain no player registrations or native objects', async () => {
  const registered = new Set<unknown>();
  const retained = new Set<unknown>();
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
  for (let i = 0; i < 100; i++) {
    const player = { volume: 1, loop: false, pause() {}, play() { throw new Error('Start failed'); },
      remove() { registered.delete(player); }, release() { retained.delete(player); } };
    registered.add(player); retained.add(player);
    (createAudioPlayer as jest.Mock).mockReturnValueOnce(player);
    await (await startLoopingNotificationSound('ambience', 100))();
  }
  expect(registered.size).toBe(0);
  expect(retained.size).toBe(0);
  expect(getMemoryResourceCounts().notificationLoops).toBe(0);
  warning.mockRestore();
});

test('abort during pending configuration allocates no player', async () => {
  setTheaterSessionActive(false);
  let finish!: () => void;
  (setAudioModeAsync as jest.Mock).mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
  const controller = new AbortController();
  const pending = startLoopingNotificationSound('ambience', 100, { signal: controller.signal });
  controller.abort(); finish();
  await (await pending)();
  expect(createAudioPlayer).not.toHaveBeenCalled();
});

test('overlapping pending starts allocate only the latest owner', async () => {
  const first = startLoopingNotificationSound('ambience', 30);
  const second = startLoopingNotificationSound('ambience', 80);
  const [stopFirst, stopSecond] = await Promise.all([first, second]);
  expect(createAudioPlayer).toHaveBeenCalledTimes(1);
  expect(mockPlayer.volume).toBe(0.8);
  await stopFirst();
  expect(mockPlayer.release).not.toHaveBeenCalled();
  await stopSecond();
  expect(mockPlayer.release).toHaveBeenCalledTimes(1);
});
