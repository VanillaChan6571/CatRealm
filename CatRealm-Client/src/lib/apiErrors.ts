import axios from 'axios';

/** Read a user-facing error returned by the API without trusting arbitrary thrown values. */
export function apiErrorMessage(error: unknown, fallback: string): string {
  if (!axios.isAxiosError<{ error?: unknown }>(error)) return fallback;
  const message = error.response?.data?.error;
  return typeof message === 'string' && message.trim() ? message : fallback;
}
