import { create } from 'zustand';
import { useAuthStore } from './authStore';

export function nicknameScope(central = false): string {
  const { user, serverUrl } = useAuthStore.getState();
  if (!user) return '';
  return JSON.stringify([user.accountType, user.id, central ? 'central' : (serverUrl || 'central')]);
}

interface NicknamesState {
  byScope: Record<string, Record<string, string>>;
  setNickname: (scope: string, userId: string, nickname: string) => void;
  removeNickname: (scope: string, userId: string) => void;
  loadNicknames: (scope: string, rows: Array<{ target_user_id: string; nickname: string }>) => void;
  reset: () => void;
}

// Server-backed and memory-only: never hydrate the old shared device cache.
export const useNicknamesStore = create<NicknamesState>(set => ({
  byScope: {},
  setNickname: (scope, id, nickname) => set(s => ({ byScope: {
    ...s.byScope, [scope]: { ...s.byScope[scope], [id]: nickname },
  } })),
  removeNickname: (scope, id) => set(s => {
    const next = { ...s.byScope[scope] };
    delete next[id];
    return { byScope: { ...s.byScope, [scope]: next } };
  }),
  loadNicknames: (scope, rows) => set(s => ({ byScope: {
    ...s.byScope, [scope]: Object.fromEntries(rows.map(row => [row.target_user_id, row.nickname])),
  } })),
  reset: () => set({ byScope: {} }),
}));
