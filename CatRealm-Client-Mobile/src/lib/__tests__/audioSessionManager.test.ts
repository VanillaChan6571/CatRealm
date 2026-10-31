import { createAudioSessionManager } from '../audioSessionManager';

test('concurrent owners share one audio session', async () => {
  const start = jest.fn(async () => {});
  const stop = jest.fn(async () => {});
  const manager = createAudioSessionManager(start, stop);
  await Promise.all([manager.acquire(), manager.acquire()]);
  expect(start).toHaveBeenCalledTimes(1);
  await manager.release();
  expect(stop).not.toHaveBeenCalled();
  await manager.release();
  expect(stop).toHaveBeenCalledTimes(1);
});

test('release during native startup cannot leave audio running', async () => {
  let finish!: () => void;
  const start = jest.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  const stop = jest.fn(async () => {});
  const manager = createAudioSessionManager(start, stop);
  const acquire = manager.acquire();
  await Promise.resolve();
  const release = manager.release();
  finish();
  await Promise.all([acquire, release]);
  expect(stop).toHaveBeenCalledTimes(1);
});

test('a failed startup can be retried', async () => {
  const start = jest.fn().mockRejectedValueOnce(new Error('native unavailable')).mockResolvedValue(undefined);
  const stop = jest.fn(async () => {});
  const manager = createAudioSessionManager(start, stop);
  await expect(manager.acquire()).rejects.toThrow('native unavailable');
  await manager.release();
  await manager.acquire();
  expect(start).toHaveBeenCalledTimes(2);
  await manager.release();
  expect(stop).toHaveBeenCalledTimes(1);
});
