let logSeq = 0;

function readEnvFlag(name: string): boolean {
  const value = process.env[name];
  return value === '1' || value === 'true' || value === 'yes';
}

const isDevRuntime = Boolean((globalThis as { __DEV__?: boolean }).__DEV__);
const debugEnabled = isDevRuntime || readEnvFlag('EXPO_PUBLIC_MOBILE_DEBUG_LOGS');

function safeJson(data: unknown): string {
  try {
    return JSON.stringify(data);
  } catch {
    return '[unserializable]';
  }
}

export function debugLog(scope: string, event: string, data?: unknown): void {
  if (!debugEnabled) return;
  logSeq += 1;
  const now = new Date().toISOString();
  if (typeof data === 'undefined') {
    console.log(`[MDBG#${logSeq}] ${now} [${scope}] ${event}`);
    return;
  }
  console.log(`[MDBG#${logSeq}] ${now} [${scope}] ${event} ${safeJson(data)}`);
}

export function debugTap(scope: string, target: string, data?: unknown): void {
  debugLog(scope, `tap:${target}`, data);
}
