import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAuthenticatedApi } from '@/lib/api';
import { captureAccountSession } from '@/lib/accountSession';

const STORAGE_KEY = 'catrealm-blocked-users';

interface BlockedUsersState {
  blockedUsers: Set<string>;
  blockUser: (userId: string) => Promise<void>;
  unblockUser: (userId: string) => Promise<void>;
  isBlocked: (userId: string) => boolean;
  loadBlockedUsers: (blockedUserIds: string[]) => void;
  hydrateFromStorage: () => Promise<void>;
  fetchFromApi: () => Promise<void>;
}

export const useBlockedUsersStore = create<BlockedUsersState>((set, get) => ({
  blockedUsers: new Set<string>(),

  blockUser: async (userId) => {
    const session = captureAccountSession();
    await createAuthenticatedApi().post(`/api/profile/block/${encodeURIComponent(userId)}`);
    if (!session.isCurrent()) return;
    set((state) => {
      const next = new Set(state.blockedUsers);
      next.add(userId);
      void AsyncStorage.setItem(`${STORAGE_KEY}:${session.user?.id}`, JSON.stringify([...next]));
      return { blockedUsers: next };
    });
  },

  unblockUser: async (userId) => {
    const session = captureAccountSession();
    await createAuthenticatedApi().delete(`/api/profile/block/${encodeURIComponent(userId)}`);
    if (!session.isCurrent()) return;
    set((state) => {
      const next = new Set(state.blockedUsers);
      next.delete(userId);
      void AsyncStorage.setItem(`${STORAGE_KEY}:${session.user?.id}`, JSON.stringify([...next]));
      return { blockedUsers: next };
    });
  },

  isBlocked: (userId) => get().blockedUsers.has(userId),

  loadBlockedUsers: (blockedUserIds) => {
    const session = captureAccountSession();
    const next = new Set(blockedUserIds);
    set({ blockedUsers: next });
    if (session.user) void AsyncStorage.setItem(`${STORAGE_KEY}:${session.user.id}`, JSON.stringify(blockedUserIds));
  },

  hydrateFromStorage: async () => {
    const session = captureAccountSession();
    if (!session.user) return;
    try {
      const raw = await AsyncStorage.getItem(`${STORAGE_KEY}:${session.user.id}`);
      if (!session.isCurrent()) return;
      if (raw) {
        const ids: string[] = JSON.parse(raw);
        if (Array.isArray(ids)) set({ blockedUsers: new Set(ids.filter((id) => typeof id === 'string')) });
      }
    } catch {
      // ignore
    }
  },

  fetchFromApi: async () => {
    const session = captureAccountSession();
    if (session.user?.accountType !== 'central') return;
    try {
      const res = await createAuthenticatedApi().get<{ blockedUsers: { id: string }[] }>('/api/profile/blocked');
      if (!session.isCurrent()) return;
      const ids = res.data.blockedUsers.map((u) => u.id);
      get().loadBlockedUsers(ids);
    } catch {
      // ignore — offline or not central account
    }
  },
}));
