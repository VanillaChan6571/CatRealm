type DMKeyDebugLevel = 'info' | 'warn' | 'error';

function safeError(error: unknown) {
  if (error instanceof Error) {
    const response = (error as Error & {
      response?: { status?: number; data?: { error?: string; code?: string; proofRequired?: boolean } };
    }).response;
    return {
      name: error.name,
      message: error.message,
      status: response?.status,
      serverError: response?.data?.error,
      serverCode: response?.data?.code,
      proofRequired: response?.data?.proofRequired,
    };
  }
  return { message: String(error) };
}

/** Persist non-secret E2EE diagnostics through the desktop host. */
export function logDMKeyDebug(
  message: string,
  details?: Record<string, unknown>,
  level: DMKeyDebugLevel = 'info',
) {
  const entry = { at: Date.now(), level, scope: 'dm-keys', message, details };
  if (level === 'error') console.error(`[DM Keys] ${message}`, details ?? '');
  else if (level === 'warn') console.warn(`[DM Keys] ${message}`, details ?? '');
  else console.info(`[DM Keys] ${message}`, details ?? '');
  void window.electron?.clientDebugLog?.(entry).catch(() => {});
}

export function logDMKeyError(message: string, error: unknown, details?: Record<string, unknown>) {
  logDMKeyDebug(message, { ...details, error: safeError(error) }, 'error');
}
