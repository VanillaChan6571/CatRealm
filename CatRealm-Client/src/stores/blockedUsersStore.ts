import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface BlockedUsersState {
  blockedUsers: Set<string>; // Set of blocked user IDs
  blockUser: (userId: string) => void;
  unblockUser: (userId: string) => void;
  isBlocked: (userId: string) => boolean;
  loadBlockedUsers: (blockedUserIds: string[]) => void;
}

export const useBlockedUsersStore = create<BlockedUsersState>()(
  persist(
    (set, get) => ({
      blockedUsers: new Set<string>(),
      blockUser: (userId) =>
        set((state) => {
          const newBlocked = new Set(state.blockedUsers);
          newBlocked.add(userId);
          return { blockedUsers: newBlocked };
        }),
      unblockUser: (userId) =>
        set((state) => {
          const newBlocked = new Set(state.blockedUsers);
          newBlocked.delete(userId);
          return { blockedUsers: newBlocked };
        }),
      isBlocked: (userId) => get().blockedUsers.has(userId),
      loadBlockedUsers: (blockedUserIds) =>
        set({ blockedUsers: new Set(blockedUserIds) }),
    }),
    {
      name: 'catrealm-blocked-users',
      // Convert Set to Array for storage
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name);
          if (!str) return null;
          const { state } = JSON.parse(str);
          return {
            state: {
              ...state,
              blockedUsers: new Set(state.blockedUsers || []),
            },
          };
        },
        setItem: (name, value) => {
          const { state } = value;
          localStorage.setItem(
            name,
            JSON.stringify({
              state: {
                ...state,
                blockedUsers: Array.from(state.blockedUsers),
              },
            })
          );
        },
        removeItem: (name) => localStorage.removeItem(name),
      },
    }
  )
);
