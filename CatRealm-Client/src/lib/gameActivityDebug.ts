import { useSettingsStore } from '../stores/settingsStore';

function safeReadLocalStorage(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function shouldDebugGameActivity(): boolean {
  try {
    if (useSettingsStore.getState().debugGameActivity) return true;
  } catch {
    // ignore early store access failures
  }
  return safeReadLocalStorage('catrealm:debug-game-activity') === '1';
}

export function logGameActivityDebug(scope: string, payload: Record<string, unknown>) {
  if (!shouldDebugGameActivity()) return;
  console.debug(`[game-activity-debug] ${scope}`, payload);
}
