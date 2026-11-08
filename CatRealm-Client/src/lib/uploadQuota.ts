import axios from 'axios';
import { useUIStore } from '../stores/uiStore';

export type UploadQuotaPeriod = 'hour' | 'day';

export function uploadBytesHeader(files: File | File[]): Record<string, string> {
  const list = Array.isArray(files) ? files : [files];
  const bytes = list.reduce((total, file) => total + Math.max(0, Number(file.size || 0)), 0);
  return { 'X-CatRealm-Upload-Bytes': String(bytes) };
}

export function showUploadQuotaModal(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  const code = String(error.response?.data?.code || '');
  const period: UploadQuotaPeriod | null = code === 'UPLOAD_HOURLY_LIMIT'
    ? 'hour'
    : code === 'UPLOAD_DAILY_LIMIT'
      ? 'day'
      : null;
  if (!period) return false;
  useUIStore.getState().openModal('uploadQuota', { period, nonce: Date.now() });
  return true;
}
