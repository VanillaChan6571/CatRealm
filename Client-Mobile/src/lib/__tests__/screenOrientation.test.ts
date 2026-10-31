jest.mock('expo-screen-orientation', () => ({
  OrientationLock: { LANDSCAPE: 6, PORTRAIT_UP: 3 }, lockAsync: jest.fn(async () => {}), unlockAsync: jest.fn(async () => {}),
}));
import * as Orientation from 'expo-screen-orientation';
import { applyScreenOrientation } from '../screenOrientation';

beforeEach(() => { jest.clearAllMocks(); });
test('the most recent pending request wins when entry and exit happen quickly', async () => {
  await Promise.all([applyScreenOrientation(false, true), applyScreenOrientation(false, false)]);
  expect(Orientation.lockAsync).toHaveBeenCalledTimes(1);
  expect(Orientation.lockAsync).toHaveBeenCalledWith(Orientation.OrientationLock.PORTRAIT_UP);
});
test('native rotation failure is handled and does not block a later exit', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  (Orientation.lockAsync as jest.Mock).mockRejectedValueOnce(new Error('Rotation unavailable'));
  await expect(applyScreenOrientation(false, true)).resolves.toBeUndefined();
  await applyScreenOrientation(false, false);
  expect(warn).toHaveBeenCalled();
  expect(Orientation.lockAsync).toHaveBeenLastCalledWith(Orientation.OrientationLock.PORTRAIT_UP);
  warn.mockRestore();
});
test('tablets retain free rotation rather than receiving phone locks', async () => {
  await applyScreenOrientation(true, true);
  expect(Orientation.unlockAsync).toHaveBeenCalledTimes(1);
  expect(Orientation.lockAsync).not.toHaveBeenCalled();
});
