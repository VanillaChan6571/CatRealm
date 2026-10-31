import axios from 'axios';
import { useAuthStore } from '../../stores/authStore';

// Shared module-level state used across message and unread slices
export const localReadFloorByConversation = new Map<string, number>();

export function getAuthHeader() {
  const token = useAuthStore.getState().token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function getSyncKey(): string | null {
  return useAuthStore.getState().syncKey;
}

export function isRequestAbortError(err: unknown): boolean {
  if (!axios.isAxiosError(err)) return false;
  const code = err.code || '';
  const name = err.name || '';
  const message = String(err.message || '').toLowerCase();
  return (
    code === 'ERR_CANCELED'
    || code === 'ECONNABORTED'
    || name === 'CanceledError'
    || message.includes('request aborted')
    || message.includes('aborted')
    || message.includes('canceled')
    || message.includes('cancelled')
  );
}
