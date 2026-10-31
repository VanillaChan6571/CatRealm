import * as ScreenOrientation from 'expo-screen-orientation';

let latestRequest = 0;
let pending = Promise.resolve();

/** Serialize native rotation changes and consume rejections (including on blur). */
export function applyScreenOrientation(tablet: boolean, fullscreen: boolean): Promise<void> {
  const request = ++latestRequest;
  const next = pending.then(async () => {
    if (request !== latestRequest) return;
    if (tablet) await ScreenOrientation.unlockAsync();
    else await ScreenOrientation.lockAsync(fullscreen
      ? ScreenOrientation.OrientationLock.LANDSCAPE
      : ScreenOrientation.OrientationLock.PORTRAIT_UP);
  });
  pending = next.catch((error) => { console.warn('[orientation] Unable to change screen orientation', error); });
  return pending;
}
