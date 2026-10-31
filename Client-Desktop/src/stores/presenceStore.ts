import { create } from 'zustand';
import type { OnlineUser } from '../types';
import { getSocket } from '../lib/socket';
import { useServerStore } from './serverStore';

interface PresenceState {
  onlineUsers: OnlineUser[];
  allMembers: OnlineUser[];
  typingUsers: Record<string, string[]>; // channelId -> usernames

  setOnlineUsers: (users: OnlineUser[]) => void;
  setAllMembers: (users: OnlineUser[]) => void;
  updateOnlineUser: (userId: string, patch: Partial<OnlineUser>) => void;
  setTyping: (channelId: string, username: string, typing: boolean) => void;
  startTyping: (channelId: string) => void;
  stopTyping: (channelId: string) => void;
  reset: () => void;
  getSnapshot: () => Pick<PresenceState, 'onlineUsers' | 'allMembers'>;
  loadSnapshot: (data: ReturnType<PresenceState['getSnapshot']>) => void;
}

const typingTimeouts: Record<string, ReturnType<typeof setTimeout>> = {};

function shouldDebugPresenceStore(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem('catrealm:debug-presence') === '1';
  } catch {
    return false;
  }
}

function summarizePresenceUsers(users: OnlineUser[]) {
  return users.slice(0, 8).map((user) => ({
    id: user.id,
    username: user.username,
    status: user.status ?? null,
    customStatusText: user.customStatusText ?? null,
    activityType: user.activityType ?? null,
    activityText: user.activityText ?? null,
    activityStartedAt: user.activityStartedAt ?? null,
  }));
}

function logPresenceStoreDebug(
  action: 'setOnlineUsers' | 'setAllMembers' | 'updateOnlineUser' | 'loadSnapshot' | 'reset',
  payload: Record<string, unknown>
) {
  if (!shouldDebugPresenceStore()) return;
  console.debug('[presence-debug] store', {
    activeServerUrl: useServerStore.getState().activeServerUrl,
    action,
    ...payload,
  });
}

function mergePresenceUser(
  incoming: OnlineUser,
  currentOnline: OnlineUser | undefined,
  currentMember: OnlineUser | undefined
): OnlineUser {
  const hasCustomStatusText = Object.prototype.hasOwnProperty.call(incoming, 'customStatusText');
  const hasActivityType = Object.prototype.hasOwnProperty.call(incoming, 'activityType');
  const hasActivityText = Object.prototype.hasOwnProperty.call(incoming, 'activityText');
  const hasActivityStartedAt = Object.prototype.hasOwnProperty.call(incoming, 'activityStartedAt');
  return {
    ...(currentMember ?? {}),
    ...(currentOnline ?? {}),
    ...incoming,
    customStatusText: hasCustomStatusText ? (incoming.customStatusText ?? null) : (currentOnline?.customStatusText ?? currentMember?.customStatusText ?? null),
    activityType: hasActivityType ? (incoming.activityType ?? null) : (currentOnline?.activityType ?? currentMember?.activityType ?? null),
    activityText: hasActivityText ? (incoming.activityText ?? null) : (currentOnline?.activityText ?? currentMember?.activityText ?? null),
    activityStartedAt: hasActivityStartedAt ? (incoming.activityStartedAt ?? null) : (currentOnline?.activityStartedAt ?? currentMember?.activityStartedAt ?? null),
  };
}

function mergeMemberUser(
  incoming: OnlineUser,
  currentMember: OnlineUser | undefined,
  currentOnline: OnlineUser | undefined
): OnlineUser {
  const hasCustomStatusText = Object.prototype.hasOwnProperty.call(incoming, 'customStatusText');
  const hasActivityType = Object.prototype.hasOwnProperty.call(incoming, 'activityType');
  const hasActivityText = Object.prototype.hasOwnProperty.call(incoming, 'activityText');
  const hasActivityStartedAt = Object.prototype.hasOwnProperty.call(incoming, 'activityStartedAt');
  return {
    ...(currentMember ?? {}),
    ...(currentOnline ?? {}),
    ...incoming,
    customStatusText: hasCustomStatusText ? (incoming.customStatusText ?? null) : (currentMember?.customStatusText ?? currentOnline?.customStatusText ?? null),
    activityType: hasActivityType ? (incoming.activityType ?? null) : (currentMember?.activityType ?? currentOnline?.activityType ?? null),
    activityText: hasActivityText ? (incoming.activityText ?? null) : (currentMember?.activityText ?? currentOnline?.activityText ?? null),
    activityStartedAt: hasActivityStartedAt ? (incoming.activityStartedAt ?? null) : (currentMember?.activityStartedAt ?? currentOnline?.activityStartedAt ?? null),
  };
}

function applyPresencePatch(current: OnlineUser, patch: Partial<OnlineUser>): OnlineUser {
  const hasCustomStatusText = Object.prototype.hasOwnProperty.call(patch, 'customStatusText');
  const hasActivityType = Object.prototype.hasOwnProperty.call(patch, 'activityType');
  const hasActivityText = Object.prototype.hasOwnProperty.call(patch, 'activityText');
  const hasActivityStartedAt = Object.prototype.hasOwnProperty.call(patch, 'activityStartedAt');

  return {
    ...current,
    ...patch,
    customStatusText: hasCustomStatusText ? (patch.customStatusText ?? null) : (current.customStatusText ?? null),
    activityType: hasActivityType ? (patch.activityType ?? null) : (current.activityType ?? null),
    activityText: hasActivityText ? (patch.activityText ?? null) : (current.activityText ?? null),
    activityStartedAt: hasActivityStartedAt ? (patch.activityStartedAt ?? null) : (current.activityStartedAt ?? null),
  };
}

export const usePresenceStore = create<PresenceState>((set, get) => ({
  onlineUsers: [],
  allMembers: [],
  typingUsers: {},

  setOnlineUsers: (onlineUsers) => set((s) => {
    const currentOnlineById = new Map(s.onlineUsers.map((user) => [user.id, user]));
    const currentMembersById = new Map(s.allMembers.map((user) => [user.id, user]));
    const nextOnlineUsers = onlineUsers.map((user) => mergePresenceUser(
        user,
        currentOnlineById.get(user.id),
        currentMembersById.get(user.id)
      ));
    logPresenceStoreDebug('setOnlineUsers', {
      incomingCount: onlineUsers.length,
      incomingWithActivity: onlineUsers.filter((user) => !!user.activityType && !!user.activityText).length,
      nextCount: nextOnlineUsers.length,
      nextWithActivity: nextOnlineUsers.filter((user) => !!user.activityType && !!user.activityText).length,
      incomingSample: summarizePresenceUsers(onlineUsers),
      nextSample: summarizePresenceUsers(nextOnlineUsers),
    });
    return {
      onlineUsers: nextOnlineUsers,
    };
  }),
  setAllMembers: (allMembers) => set((s) => {
    const currentMembersById = new Map(s.allMembers.map((user) => [user.id, user]));
    const currentOnlineById = new Map(s.onlineUsers.map((user) => [user.id, user]));
    const nextAllMembers = allMembers.map((user) => mergeMemberUser(
        user,
        currentMembersById.get(user.id),
        currentOnlineById.get(user.id)
      ));
    logPresenceStoreDebug('setAllMembers', {
      incomingCount: allMembers.length,
      incomingWithActivity: allMembers.filter((user) => !!user.activityType && !!user.activityText).length,
      nextCount: nextAllMembers.length,
      nextWithActivity: nextAllMembers.filter((user) => !!user.activityType && !!user.activityText).length,
      incomingSample: summarizePresenceUsers(allMembers),
      nextSample: summarizePresenceUsers(nextAllMembers),
    });
    return {
      allMembers: nextAllMembers,
    };
  }),
  updateOnlineUser: (userId, patch) => {
    set((s) => ({
      onlineUsers: s.onlineUsers.map((u) => (u.id === userId ? applyPresencePatch(u, patch) : u)),
      allMembers: s.allMembers.map((u) => (u.id === userId ? applyPresencePatch(u, patch) : u)),
    }));
    const next = get();
    logPresenceStoreDebug('updateOnlineUser', {
      userId,
      patch: {
        ...patch,
        customStatusText: Object.prototype.hasOwnProperty.call(patch, 'customStatusText') ? (patch.customStatusText ?? null) : '__unchanged__',
        activityType: Object.prototype.hasOwnProperty.call(patch, 'activityType') ? (patch.activityType ?? null) : '__unchanged__',
        activityText: Object.prototype.hasOwnProperty.call(patch, 'activityText') ? (patch.activityText ?? null) : '__unchanged__',
        activityStartedAt: Object.prototype.hasOwnProperty.call(patch, 'activityStartedAt') ? (patch.activityStartedAt ?? null) : '__unchanged__',
      },
      onlineUsersWithActivity: next.onlineUsers.filter((user) => !!user.activityType && !!user.activityText).length,
      allMembersWithActivity: next.allMembers.filter((user) => !!user.activityType && !!user.activityText).length,
      onlineUsersSample: summarizePresenceUsers(next.onlineUsers),
      allMembersSample: summarizePresenceUsers(next.allMembers),
    });
  },

  setTyping: (channelId, username, typing) => {
    const key = `${channelId}:${username}`;

    // Clear existing timeout for this user
    if (typingTimeouts[key]) {
      clearTimeout(typingTimeouts[key]);
      delete typingTimeouts[key];
    }

    if (typing) {
      // Typers re-send typing:start every ~2.5s; clear if they go silent (crash, lost stop).
      typingTimeouts[key] = setTimeout(() => {
        get().setTyping(channelId, username, false);
      }, 6000);
    }

    set((s) => {
      const current = s.typingUsers[channelId] ?? [];
      const updated = typing
        ? current.includes(username) ? current : [...current, username]
        : current.filter((u) => u !== username);

      return {
        typingUsers: { ...s.typingUsers, [channelId]: updated },
      };
    });
  },

  startTyping: (channelId) => {
    const socket = getSocket();
    if (socket) socket.emit('typing:start', { channelId });
  },

  stopTyping: (channelId) => {
    const socket = getSocket();
    if (socket) socket.emit('typing:stop', { channelId });
  },

  reset: () => {
    // Clear all timeouts
    for (const key of Object.keys(typingTimeouts)) {
      clearTimeout(typingTimeouts[key]);
      delete typingTimeouts[key];
    }
    logPresenceStoreDebug('reset', {});
    set({ onlineUsers: [], allMembers: [], typingUsers: {} });
  },

  getSnapshot: () => {
    const { onlineUsers, allMembers } = get();
    return { onlineUsers, allMembers };
  },

  loadSnapshot: (data) => {
    // Clear all timeouts
    for (const key of Object.keys(typingTimeouts)) {
      clearTimeout(typingTimeouts[key]);
      delete typingTimeouts[key];
    }
    logPresenceStoreDebug('loadSnapshot', {
      onlineUsersCount: data.onlineUsers.length,
      allMembersCount: (data.allMembers ?? []).length,
      onlineUsersWithActivity: data.onlineUsers.filter((user) => !!user.activityType && !!user.activityText).length,
      allMembersWithActivity: (data.allMembers ?? []).filter((user) => !!user.activityType && !!user.activityText).length,
      onlineUsersSample: summarizePresenceUsers(data.onlineUsers),
      allMembersSample: summarizePresenceUsers(data.allMembers ?? []),
    });
    set({ onlineUsers: data.onlineUsers, allMembers: data.allMembers ?? [], typingUsers: {} });
  },
}));
