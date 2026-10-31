import { create } from 'zustand';
import type { Friend, FriendRequest, FriendNickname, PersonalFriendRole } from '@/types';
import { createAuthenticatedApi } from '@/lib/api';
import { usePresenceStore } from '@/stores/presenceStore';

export interface FriendState {
  friends: Friend[];
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
  nicknames: FriendNickname[];
  personalRoles: PersonalFriendRole[];
  roleAssignments: Record<string, string[]>;
  loading: boolean;
  error: string | null;
  setFriends: (list: Friend[]) => void;
  setRequests: (incoming: FriendRequest[], outgoing: FriendRequest[]) => void;
  setNicknames: (list: FriendNickname[]) => void;
  setPersonalRoles: (list: PersonalFriendRole[]) => void;
  loadPersonalRoles: () => Promise<void>;
  createPersonalRole: (name: string, color?: string | null) => Promise<void>;
  deletePersonalRole: (roleId: string) => Promise<void>;
  setFriendRoleAssigned: (friendId: string, roleId: string, assigned: boolean) => Promise<void>;
  clearError: () => void;
  fetchFriends: () => Promise<void>;
  fetchRequests: () => Promise<void>;
  sendRequest: (username: string) => Promise<void>;
  acceptRequest: (requestId: string) => Promise<void>;
  rejectRequest: (requestId: string) => Promise<void>;
  removeFriend: (userId: string) => Promise<void>;
}

export const useFriendStore = create<FriendState>((set) => ({
  friends: [],
  incoming: [],
  outgoing: [],
  nicknames: [],
  personalRoles: [],
  roleAssignments: {},
  loading: false,
  error: null,

  setFriends: (list) => set({ friends: list }),
  setRequests: (incoming, outgoing) => set({ incoming, outgoing }),
  setNicknames: (list) => set({ nicknames: list }),
  setPersonalRoles: (list) => set({ personalRoles: list }),
  loadPersonalRoles: async () => {
    try {
      const res = await createAuthenticatedApi().get<{ roles?: PersonalFriendRole[]; assignments?: Record<string, string[]> }>(
        '/api/friends/personal-roles',
      );
      set({
        personalRoles: res.data.roles ?? [],
        roleAssignments: res.data.assignments ?? {},
      });
    } catch {
      // silently ignore
    }
  },
  createPersonalRole: async (name, color) => {
    set({ loading: true, error: null });
    try {
      await createAuthenticatedApi().post('/api/friends/personal-roles', {
        name,
        color: color || null,
      });
      const res = await createAuthenticatedApi().get<{ roles?: PersonalFriendRole[]; assignments?: Record<string, string[]> }>(
        '/api/friends/personal-roles',
      );
      set({
        loading: false,
        personalRoles: res.data.roles ?? [],
        roleAssignments: res.data.assignments ?? {},
      });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to create personal role';
      set({ loading: false, error: msg });
    }
  },
  deletePersonalRole: async (roleId) => {
    set({ loading: true, error: null });
    try {
      await createAuthenticatedApi().delete(`/api/friends/personal-roles/${roleId}`);
      const res = await createAuthenticatedApi().get<{ roles?: PersonalFriendRole[]; assignments?: Record<string, string[]> }>(
        '/api/friends/personal-roles',
      );
      set({
        loading: false,
        personalRoles: res.data.roles ?? [],
        roleAssignments: res.data.assignments ?? {},
      });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to delete personal role';
      set({ loading: false, error: msg });
    }
  },
  clearError: () => set({ error: null }),

  setFriendRoleAssigned: async (friendId, roleId, assigned) => {
    set({ loading: true, error: null });
    try {
      await createAuthenticatedApi().put(
        `/api/friends/personal-roles/${roleId}/friends/${friendId}`,
        { assigned },
      );
      set((s) => {
        const current = new Set(s.roleAssignments[friendId] || []);
        if (assigned) current.add(roleId);
        else current.delete(roleId);
        return {
          loading: false,
          roleAssignments: {
            ...s.roleAssignments,
            [friendId]: Array.from(current),
          },
        };
      });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to update personal role assignment';
      set({ loading: false, error: msg });
    }
  },

  fetchFriends: async () => {
    set({ loading: true });
    try {
      const res = await createAuthenticatedApi().get<Friend[]>('/api/friends');
      usePresenceStore.getState().upsertCentral(
        res.data
          .filter((friend) => friend.status)
          .map((friend) => ({
            userId: friend.id,
            status: friend.status!,
            customStatusText: friend.customStatusText ?? null,
            activityType: friend.activityType ?? null,
            activityText: friend.activityText ?? null,
            activityStartedAt: friend.activityStartedAt ?? null,
            clients: friend.clients ?? [],
          })),
      );
      set({ friends: res.data });
    } catch {
      // silently ignore
    } finally {
      set({ loading: false });
    }
  },

  fetchRequests: async () => {
    try {
      const res = await createAuthenticatedApi().get<{ incoming: FriendRequest[]; outgoing: FriendRequest[] }>('/api/friends/requests');
      set({ incoming: res.data.incoming, outgoing: res.data.outgoing });
    } catch {
      // silently ignore
    }
  },

  sendRequest: async (username) => {
    set({ loading: true, error: null });
    try {
      await createAuthenticatedApi().post('/api/friends/request', { username });
      const res = await createAuthenticatedApi().get<{ incoming: FriendRequest[]; outgoing: FriendRequest[] }>('/api/friends/requests');
      set({ incoming: res.data.incoming, outgoing: res.data.outgoing, loading: false });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to send request';
      set({ loading: false, error: msg });
    }
  },

  acceptRequest: async (requestId) => {
    set({ loading: true, error: null });
    try {
      const res = await createAuthenticatedApi().post<{ friend: Friend }>('/api/friends/accept', { requestId });
      if (res.data.friend.status) {
        usePresenceStore.getState().upsertCentral([{
          userId: res.data.friend.id,
          status: res.data.friend.status,
          customStatusText: res.data.friend.customStatusText ?? null,
          activityType: res.data.friend.activityType ?? null,
          activityText: res.data.friend.activityText ?? null,
          activityStartedAt: res.data.friend.activityStartedAt ?? null,
          clients: res.data.friend.clients ?? [],
        }]);
      }
      set((s) => ({
        loading: false,
        friends: [...s.friends, res.data.friend],
        incoming: s.incoming.filter((r) => r.id !== requestId),
      }));
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to accept';
      set({ loading: false, error: msg });
    }
  },

  rejectRequest: async (requestId) => {
    set({ loading: true, error: null });
    try {
      await createAuthenticatedApi().post('/api/friends/reject', { requestId });
      set((s) => ({
        loading: false,
        incoming: s.incoming.filter((r) => r.id !== requestId),
        outgoing: s.outgoing.filter((r) => r.id !== requestId),
      }));
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed';
      set({ loading: false, error: msg });
    }
  },

  removeFriend: async (userId) => {
    set({ loading: true, error: null });
    try {
      await createAuthenticatedApi().delete(`/api/friends/${userId}`);
      set((s) => ({
        loading: false,
        friends: s.friends.filter((f) => f.id !== userId),
        roleAssignments: Object.fromEntries(
          Object.entries(s.roleAssignments).filter(([friendId]) => friendId !== userId),
        ),
      }));
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to remove friend';
      set({ loading: false, error: msg });
    }
  },
}));
