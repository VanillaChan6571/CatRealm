import { afterEach, expect, it, vi } from 'vitest';

const desktop = vi.hoisted(() => ({ electron: false }));
vi.mock('../desktopCapture', () => ({ isElectronDesktop: () => desktop.electron, isTauriDesktop: () => false }));

import { detectPrivateBrowsing } from '../privateBrowsing';

const GiB = 1024 ** 3;
function setStorage(storage: Partial<StorageManager> | undefined, chrome = false) {
  Object.defineProperty(navigator, 'storage', { configurable: true, value: storage });
  if (chrome) Object.defineProperty(window, 'chrome', { configurable: true, value: {} });
  else delete (window as Window & { chrome?: unknown }).chrome;
}

afterEach(() => { desktop.electron = false; setStorage(undefined); });

it('flags Firefox/Safari private windows that refuse the private file system', async () => {
  setStorage({ getDirectory: () => Promise.reject(new DOMException('Security error', 'SecurityError')) });
  expect(await detectPrivateBrowsing()).toBe(true);
});

it('flags Chromium incognito by its capped quota but not a normal profile', async () => {
  setStorage({ getDirectory: () => Promise.resolve({} as FileSystemDirectoryHandle), estimate: () => Promise.resolve({ quota: 0.5 * GiB }) }, true);
  expect(await detectPrivateBrowsing()).toBe(true);
  setStorage({ getDirectory: () => Promise.resolve({} as FileSystemDirectoryHandle), estimate: () => Promise.resolve({ quota: 300 * GiB }) }, true);
  expect(await detectPrivateBrowsing()).toBe(false);
});

it('never warns inside the desktop apps', async () => {
  desktop.electron = true;
  setStorage({ getDirectory: () => Promise.reject(new Error('blocked')) });
  expect(await detectPrivateBrowsing()).toBe(false);
});
