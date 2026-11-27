import { useAuthStore } from '../../stores/authStore';
import type { StoreApi } from 'zustand';
import type { GroupChatState } from '../../stores/groupChatStore';
import type { GroupChatKeyVersion } from '../../types';

export type GCSet = StoreApi<GroupChatState>['setState'];
export type GCGet = StoreApi<GroupChatState>['getState'];

export function getAuthHeader() {
  const token = useAuthStore.getState().token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function keyMaterialForVersion(keys: GroupChatKeyVersion[] | undefined, keyVersion: number): string | null {
  if (!Array.isArray(keys)) return null;
  const match = keys.find((k) => k.keyVersion === keyVersion);
  return match?.keyMaterial ?? null;
}
