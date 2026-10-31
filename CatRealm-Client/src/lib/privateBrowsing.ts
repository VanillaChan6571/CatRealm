import { isElectronDesktop, isTauriDesktop } from './desktopCapture';

type PerformanceWithMemory = Performance & { memory?: { jsHeapSizeLimit?: number } };

// Best-effort: browsers don't expose private mode, so this uses the storage
// quirks each engine has there. A miss only means no warning is shown.
export async function detectPrivateBrowsing(): Promise<boolean> {
  if (typeof navigator === 'undefined' || isElectronDesktop() || isTauriDesktop()) return false;
  const storage = navigator.storage;
  if (!storage) return false;
  // Firefox and Safari private windows refuse the origin private file system.
  if (typeof storage.getDirectory === 'function') {
    try {
      await storage.getDirectory();
    } catch {
      return true;
    }
  }
  // Chromium incognito caps quota near the JS heap limit instead of a share of the disk.
  if (!('chrome' in window) || typeof storage.estimate !== 'function') return false;
  try {
    const { quota } = await storage.estimate();
    const heapLimit = (performance as PerformanceWithMemory).memory?.jsHeapSizeLimit ?? 1024 ** 3;
    return typeof quota === 'number' && quota < heapLimit * 2;
  } catch {
    return false;
  }
}
