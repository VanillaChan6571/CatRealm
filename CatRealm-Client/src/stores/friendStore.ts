import { create } from 'zustand';
import axios from 'axios';
import { authApi } from '../lib/authApi';
import { useAuthStore } from './authStore';
import type { Friend, FriendRequest, PersonalFriendRole } from '../types';

interface FriendState {
  friends: Friend[];
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
  personalRoles: PersonalFriendRole[];
  roleAssignments: Record<string, string[]>;
  loading: boolean;
  error: string | null;

  fetchFriends: (options?: { force?: boolean }) => Promise<void>;
  fetchRequests: (options?: { force?: boolean }) => Promise<void>;
  sendRequest: (username: string) => Promise<void>;
  acceptRequest: (requestId: string) => Promise<void>;
  rejectRequest: (requestId: string) => Promise<void>;
  removeFriend: (userId: string) => Promise<void>;
  loadPersonalRoles: () => Promise<void>;
  createPersonalRole: (name: string, color?: string | null) => Promise<void>;
  updatePersonalRole: (roleId: string, name: string, color?: string | null) => Promise<void>;
  deletePersonalRole: (roleId: string) => Promise<void>;
  setFriendRoleAssigned: (friendId: string, roleId: string, assigned: boolean) => Promise<void>;
  clearError: () => void;
  reset: () => void;
}

function getAuthHeader() {
  const token = useAuthStore.getState().token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const FRIENDS_REFRESH_MS = 60_000;
const REQUESTS_REFRESH_MS = 60_000;

let friendsInFlight: Promise<void> | null = null;
let requestsInFlight: Promise<void> | null = null;
let friendsLastFetchedAt = 0;
let requestsLastFetchedAt = 0;
let friendsRetryAfterUntil = 0;
let requestsRetryAfterUntil = 0;

function parseRetryAfterMs(err: unknown): number {
  if (!axios.isAxiosError(err)) return 0;
  if (err.response?.status !== 429) return 0;
  const retryAfter = err.response?.headers?.['retry-after'];
  if (!retryAfter) return 60_000;
  const asNumber = Number(retryAfter);
  if (Number.isFinite(asNumber) && asNumber > 0) return asNumber * 1000;
  const asDate = Date.parse(String(retryAfter));
  if (Number.isFinite(asDate)) {
    const ms = asDate - Date.now();
    return ms > 0 ? ms : 60_000;
  }
  return 60_000;
}

export const useFriendStore = create<FriendState>((set) => ({
  friends: [],
  incoming: [],
  outgoing: [],
  personalRoles: [],
  roleAssignments: {},
  loading: false,
  error: null,

  fetchFriends: async ({ force = false } = {}) => {
    const authState = useAuthStore.getState();
    if (authState.user?.accountType !== 'central' || !authState.token) return;

    const now = Date.now();
    if (!force) {
      if (friendsInFlight) return friendsInFlight;
      if (now < friendsRetryAfterUntil) return;
      if (now - friendsLastFetchedAt < FRIENDS_REFRESH_MS) return;
    }
    if (friendsInFlight) return friendsInFlight;

    friendsInFlight = (async () => {
      try {
        const res = await authApi.get('/api/friends', { headers: getAuthHeader() });
        friendsLastFetchedAt = Date.now();
        friendsRetryAfterUntil = 0;
        set({ friends: res.data });
      } catch (err: unknown) {
        const retryMs = parseRetryAfterMs(err);
        if (retryMs > 0) friendsRetryAfterUntil = Date.now() + retryMs;
        // silently fail — friends are optional
      }
    })().finally(() => {
      friendsInFlight = null;
    });
    return friendsInFlight;
  },

  fetchRequests: async ({ force = false } = {}) => {
    const authState = useAuthStore.getState();
    if (authState.user?.accountType !== 'central' || !authState.token) return;

    const now = Date.now();
    if (!force) {
      if (requestsInFlight) return requestsInFlight;
      if (now < requestsRetryAfterUntil) return;
      if (now - requestsLastFetchedAt < REQUESTS_REFRESH_MS) return;
    }
    if (requestsInFlight) return requestsInFlight;

    requestsInFlight = (async () => {
      try {
        const res = await authApi.get('/api/friends/requests', { headers: getAuthHeader() });
        requestsLastFetchedAt = Date.now();
        requestsRetryAfterUntil = 0;
        set({ incoming: res.data.incoming, outgoing: res.data.outgoing });
      } catch (err: unknown) {
        const retryMs = parseRetryAfterMs(err);
        if (retryMs > 0) requestsRetryAfterUntil = Date.now() + retryMs;
        // silently fail
      }
    })().finally(() => {
      requestsInFlight = null;
    });
    return requestsInFlight;
  },

  sendRequest: async (username: string) => {
    set({ loading: true, error: null });
    try {
      await authApi.post('/api/friends/request', { username }, { headers: getAuthHeader() });
      set({ loading: false });
      // Refresh requests list
      const res = await authApi.get('/api/friends/requests', { headers: getAuthHeader() });
      set({ incoming: res.data.incoming, outgoing: res.data.outgoing });
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err) ? err.response?.data?.error : 'Failed to send request';
      set({ loading: false, error: msg || 'Failed to send request' });
    }
  },

  acceptRequest: async (requestId: string) => {
    set({ loading: true, error: null });
    try {
      const res = await authApi.post('/api/friends/accept', { requestId }, { headers: getAuthHeader() });
      set((s) => ({
        loading: false,
        friends: [...s.friends, res.data.friend],
        incoming: s.incoming.filter((r) => r.id !== requestId),
      }));
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err) ? err.response?.data?.error : 'Failed to accept';
      set({ loading: false, error: msg || 'Failed to accept request' });
    }
  },

  rejectRequest: async (requestId: string) => {
    set({ loading: true, error: null });
    try {
      await authApi.post('/api/friends/reject', { requestId }, { headers: getAuthHeader() });
      set((s) => ({
        loading: false,
        incoming: s.incoming.filter((r) => r.id !== requestId),
        outgoing: s.outgoing.filter((r) => r.id !== requestId),
      }));
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err) ? err.response?.data?.error : 'Failed';
      set({ loading: false, error: msg || 'Failed' });
    }
  },

  removeFriend: async (userId: string) => {
    set({ loading: true, error: null });
    try {
      await authApi.delete(`/api/friends/${userId}`, { headers: getAuthHeader() });
      set((s) => ({
        loading: false,
        friends: s.friends.filter((f) => f.id !== userId),
        roleAssignments: Object.fromEntries(
          Object.entries(s.roleAssignments).filter(([friendId]) => friendId !== userId)
        ),
      }));
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err) ? err.response?.data?.error : 'Failed to remove friend';
      set({ loading: false, error: msg || 'Failed to remove friend' });
    }
  },

  loadPersonalRoles: async () => {
    try {
      const res = await authApi.get('/api/friends/personal-roles', { headers: getAuthHeader() });
      set({
        personalRoles: res.data.roles ?? [],
        roleAssignments: res.data.assignments ?? {},
      });
    } catch {
      // silently fail
    }
  },

  createPersonalRole: async (name: string, color?: string | null) => {
    set({ loading: true, error: null });
    try {
      await authApi.post('/api/friends/personal-roles', { name, color: color || null }, { headers: getAuthHeader() });
      const res = await authApi.get('/api/friends/personal-roles', { headers: getAuthHeader() });
      set({
        loading: false,
        personalRoles: res.data.roles ?? [],
        roleAssignments: res.data.assignments ?? {},
      });
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err) ? err.response?.data?.error : 'Failed to create personal role';
      set({ loading: false, error: msg || 'Failed to create personal role' });
    }
  },

  updatePersonalRole: async (roleId: string, name: string, color?: string | null) => {
    set({ loading: true, error: null });
    try {
      await authApi.put(`/api/friends/personal-roles/${roleId}`, { name, color: color || null }, { headers: getAuthHeader() });
      const res = await authApi.get('/api/friends/personal-roles', { headers: getAuthHeader() });
      set({
        loading: false,
        personalRoles: res.data.roles ?? [],
        roleAssignments: res.data.assignments ?? {},
      });
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err) ? err.response?.data?.error : 'Failed to update personal role';
      set({ loading: false, error: msg || 'Failed to update personal role' });
    }
  },

  deletePersonalRole: async (roleId: string) => {
    set({ loading: true, error: null });
    try {
      await authApi.delete(`/api/friends/personal-roles/${roleId}`, { headers: getAuthHeader() });
      const res = await authApi.get('/api/friends/personal-roles', { headers: getAuthHeader() });
      set({
        loading: false,
        personalRoles: res.data.roles ?? [],
        roleAssignments: res.data.assignments ?? {},
      });
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err) ? err.response?.data?.error : 'Failed to delete personal role';
      set({ loading: false, error: msg || 'Failed to delete personal role' });
    }
  },

  setFriendRoleAssigned: async (friendId: string, roleId: string, assigned: boolean) => {
    set({ loading: true, error: null });
    try {
      await authApi.put(
        `/api/friends/personal-roles/${roleId}/friends/${friendId}`,
        { assigned },
        { headers: getAuthHeader() }
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
      const msg = axios.isAxiosError(err) ? err.response?.data?.error : 'Failed to update personal role assignment';
      set({ loading: false, error: msg || 'Failed to update personal role assignment' });
    }
  },

  clearError: () => set({ error: null }),

  reset: () => {
    friendsInFlight = null;
    requestsInFlight = null;
    friendsLastFetchedAt = 0;
    requestsLastFetchedAt = 0;
    friendsRetryAfterUntil = 0;
    requestsRetryAfterUntil = 0;
    set({ friends: [], incoming: [], outgoing: [], personalRoles: [], roleAssignments: {}, loading: false, error: null });
  },
}));
