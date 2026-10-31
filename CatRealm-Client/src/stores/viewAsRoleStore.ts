import { create } from 'zustand';
import type { Role, User } from '../types';

export interface PermissionOverwrite {
  id: string;
  target_type: 'role' | 'user';
  target_id: string;
  allow: number;
  deny: number;
  channel_id?: string;
  category_id?: string;
}

interface ViewAsRoleState {
  active: boolean;
  serverUrl: string | null;
  role: Role | null;
  roles: Role[];
  channelOverwritesByChannelId: Record<string, PermissionOverwrite[]>;
  categoryOverwritesByCategoryId: Record<string, PermissionOverwrite[]>;
  beginSession: (payload: {
    serverUrl: string | null;
    role: Role;
    roles: Role[];
    channelOverwritesByChannelId: Record<string, PermissionOverwrite[]>;
    categoryOverwritesByCategoryId: Record<string, PermissionOverwrite[]>;
  }) => void;
  syncFromUser: (payload: { serverUrl: string | null; user: User | null }) => void;
  endSession: () => void;
}

const emptyState = {
  active: false,
  serverUrl: null,
  role: null,
  roles: [],
  channelOverwritesByChannelId: {},
  categoryOverwritesByCategoryId: {},
};

export const useViewAsRoleStore = create<ViewAsRoleState>((set) => ({
  ...emptyState,
  beginSession: ({ serverUrl, role, roles, channelOverwritesByChannelId, categoryOverwritesByCategoryId }) => set({
    active: true,
    serverUrl,
    role,
    roles,
    channelOverwritesByChannelId,
    categoryOverwritesByCategoryId,
  }),
  syncFromUser: ({ serverUrl, user }) => set((state) => {
    const viewAsRole = user?.viewAsRole;
    if (!viewAsRole) {
      if (!state.active) return state;
      return emptyState;
    }
    const matchedRole = state.roles.find((role) => role.id === viewAsRole.roleId);
    return {
      ...state,
      active: true,
      serverUrl,
      role: matchedRole ?? {
        id: viewAsRole.roleId,
        name: viewAsRole.roleName,
        color: null,
        permissions: user?.permissions ?? 0,
        position: 0,
        is_default: 0,
      },
    };
  }),
  endSession: () => set(emptyState),
}));
