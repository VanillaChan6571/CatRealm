// Off by default — only the main-process crash handlers write to the voice-debug
// log unless the user explicitly enables the voice debug console. This keeps the
// per-call IPC + disk churn out of the hot path (screen-share stats etc.).
let voiceDebugLoggingEnabled = false;

export function setVoiceDebugLoggingEnabled(enabled: boolean) {
  voiceDebugLoggingEnabled = enabled;
}

export function logVoiceDebug(
  scope: string,
  message: string,
  details?: unknown,
  level: VoiceDebugLogEntry['level'] = 'info',
) {
  if (!voiceDebugLoggingEnabled) return;
  if (typeof window === 'undefined' || !window.electron?.voiceDebugLog) return;
  window.electron.voiceDebugLog({
    at: Date.now(),
    level,
    scope,
    message,
    details,
  }).catch(() => {});
}

// Awaitable variant: waits for the main process to flush the entry to disk.
// Use this before calls that may crash the process so the breadcrumb is guaranteed on disk.
export async function logVoiceDebugAwaitable(
  scope: string,
  message: string,
  details?: unknown,
  level: VoiceDebugLogEntry['level'] = 'info',
): Promise<void> {
  if (!voiceDebugLoggingEnabled) return;
  if (typeof window === 'undefined' || !window.electron?.voiceDebugLog) return;
  try {
    await window.electron.voiceDebugLog({ at: Date.now(), level, scope, message, details });
  } catch {
    // ignore
  }
}
