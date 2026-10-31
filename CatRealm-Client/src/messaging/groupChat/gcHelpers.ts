import { useAuthStore } from '../../stores/authStore';
import type { GroupChatKeyVersion } from '../../types';

export function getAuthHeader() {
  const token = useAuthStore.getState().token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function keyMaterialForVersion(keys: GroupChatKeyVersion[] | undefined, keyVersion: number): string | null {
  if (!Array.isArray(keys)) return null;
  const match = keys.find((k) => k.keyVersion === keyVersion);
  return match?.keyMaterial ?? null;
}
