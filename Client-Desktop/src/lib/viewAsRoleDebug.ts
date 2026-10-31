function canUseLocalStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function isViewAsRoleDebugEnabled(): boolean {
  if (!canUseLocalStorage()) return false;
  try {
    return window.localStorage.getItem('catrealm:debug-view-as') === '1';
  } catch {
    return false;
  }
}

export function setViewAsRoleDebugEnabled(enabled: boolean) {
  if (!canUseLocalStorage()) return;
  try {
    window.localStorage.setItem('catrealm:debug-view-as', enabled ? '1' : '0');
  } catch {
    // ignore storage failures
  }
}

export function logViewAsRoleDebug(event: string, payload?: Record<string, unknown>) {
  if (!isViewAsRoleDebugEnabled()) return;
  console.debug('[view-as-debug]', event, payload ?? {});
}
