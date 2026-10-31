import { authApi } from '../../lib/authApi';
import type { GroupChatDetail, GroupChatKeyVersion, GroupChatSummary } from '../../types';
import { normalizeDetailToSummary } from '../normalizers/groupChatNormalizers';
import { getAuthHeader } from './gcHelpers';

export type GCConversationSlice = {
  groups: GroupChatSummary[];
  activeGroupId: string | null;
  groupDetailsById: Record<string, GroupChatDetail>;
  groupKeysById: Record<string, GroupChatKeyVersion[]>;
  loading: boolean;
  error: string | null;
  loadGroups: () => Promise<void>;
  selectGroup: (groupId: string | null) => void;
  loadGroupDetail: (groupId: string) => Promise<void>;
  loadGroupKeys: (groupId: string) => Promise<void>;
  createGroup: (name: string, memberIds: string[], retentionDays?: number) => Promise<string | null>;
  addMembers: (groupId: string, memberIds: string[]) => Promise<void>;
  removeMember: (groupId: string, memberUserId: string) => Promise<void>;
  updateAvatar: (groupId: string, file: File) => Promise<void>;
  updateRetention: (groupId: string, retentionDays: number) => Promise<void>;
  clearError: () => void;
  handleListUpdate: (groupChatId?: string | null) => Promise<void>;
  handleRemoved: (groupChatId: string) => void;
  handleRetentionUpdate: (groupChatId: string, retentionDays: number) => void;
  handleKeyRotated: (groupChatId: string) => Promise<void>;
  handleMemberMutation: (groupChatId: string) => Promise<void>;
};

export function createGCConversationSlice(set: any, get: any): GCConversationSlice {
  return {
    groups: [], activeGroupId: null, groupDetailsById: {}, groupKeysById: {}, loading: false, error: null,
    loadGroups: async () => {
      try {
        set({ loading: true, error: null });
        const res = await authApi.get('/api/group-chats', { headers: getAuthHeader() });
        const groups = Array.isArray(res.data) ? (res.data as GroupChatSummary[]) : [];
        set((s: any) => ({ groups, loading: false, activeGroupId: s.activeGroupId && groups.some((g) => g.id === s.activeGroupId) ? s.activeGroupId : (groups[0]?.id ?? null) }));
      } catch (err: any) { set({ loading: false, error: err?.response?.data?.error || 'Failed to load group chats' }); }
    },
    selectGroup: (groupId) => set({ activeGroupId: groupId }),
    loadGroupDetail: async (groupId) => {
      if (!groupId) return;
      try {
        const res = await authApi.get(`/api/group-chats/${groupId}`, { headers: getAuthHeader() });
        const detail = res.data as GroupChatDetail;
        set((s: any) => ({
          groupDetailsById: { ...s.groupDetailsById, [groupId]: detail },
          groups: s.groups.some((g: GroupChatSummary) => g.id === groupId)
            ? s.groups.map((g: GroupChatSummary) => g.id === groupId ? { ...g, ...normalizeDetailToSummary(detail) } : g)
            : [...s.groups, normalizeDetailToSummary(detail)],
        }));
      } catch (err: any) { set({ error: err?.response?.data?.error || 'Failed to load group chat details' }); }
    },
    loadGroupKeys: async (groupId) => {
      if (!groupId) return;
      try {
        const res = await authApi.get(`/api/group-chats/${groupId}/keys`, { headers: getAuthHeader() });
        const keys = Array.isArray(res.data?.keys) ? (res.data.keys as GroupChatKeyVersion[]) : [];
        set((s: any) => ({ groupKeysById: { ...s.groupKeysById, [groupId]: keys } }));
      } catch (err: any) { set({ error: err?.response?.data?.error || 'Failed to load group chat keys' }); }
    },
    createGroup: async (name, memberIds, retentionDays = 365) => {
      try {
        set({ error: null });
        const res = await authApi.post('/api/group-chats', { name, memberIds, retentionDays }, { headers: getAuthHeader() });
        const groupId = typeof res.data?.id === 'string' ? res.data.id : null;
        await get().loadGroups();
        if (groupId) {
          set({ activeGroupId: groupId });
          await Promise.all([get().loadGroupDetail(groupId), get().loadGroupKeys(groupId), get().loadMessages(groupId)]);
        }
        return groupId;
      } catch (err: any) { set({ error: err?.response?.data?.error || 'Failed to create group chat' }); return null; }
    },
    addMembers: async (groupId, memberIds) => {
      if (!groupId || memberIds.length === 0) return;
      try { set({ error: null }); await authApi.post(`/api/group-chats/${groupId}/members`, { memberIds }, { headers: getAuthHeader() }); await Promise.all([get().loadGroups(), get().loadGroupDetail(groupId)]); }
      catch (err: any) { set({ error: err?.response?.data?.error || 'Failed to add members' }); }
    },
    removeMember: async (groupId, memberUserId) => {
      if (!groupId || !memberUserId) return;
      try { set({ error: null }); await authApi.delete(`/api/group-chats/${groupId}/members/${memberUserId}`, { headers: getAuthHeader() }); await Promise.all([get().loadGroups(), get().loadGroupDetail(groupId), get().loadGroupKeys(groupId)]); }
      catch (err: any) { set({ error: err?.response?.data?.error || 'Failed to remove member' }); }
    },
    updateAvatar: async (groupId, file) => {
      if (!groupId || !file) return;
      try { set({ error: null }); const form = new FormData(); form.append('avatar', file); await authApi.patch(`/api/group-chats/${groupId}/avatar`, form, { headers: getAuthHeader() }); await Promise.all([get().loadGroups(), get().loadGroupDetail(groupId)]); }
      catch (err: any) { set({ error: err?.response?.data?.error || 'Failed to update group avatar' }); }
    },
    updateRetention: async (groupId, retentionDays) => {
      if (!groupId) return;
      try {
        set({ error: null });
        await authApi.patch(`/api/group-chats/${groupId}/retention`, { retentionDays }, { headers: getAuthHeader() });
        set((s: any) => ({
          groups: s.groups.map((g: GroupChatSummary) => g.id === groupId ? { ...g, retentionDays } : g),
          groupDetailsById: s.groupDetailsById[groupId] ? { ...s.groupDetailsById, [groupId]: { ...s.groupDetailsById[groupId], retentionDays } } : s.groupDetailsById,
        }));
      } catch (err: any) { set({ error: err?.response?.data?.error || 'Failed to update retention' }); }
    },
    clearError: () => set({ error: null }),
    handleListUpdate: async () => { await get().loadGroups(); const active = get().activeGroupId; if (active) void get().loadGroupDetail(active); },
    handleRemoved: (groupChatId) => set((s: any) => {
      const nextDetails = { ...s.groupDetailsById }, nextKeys = { ...s.groupKeysById }, nextMessages = { ...s.messagesByGroupId }, nextLoading = { ...s.loadingMessagesByGroupId }, nextOlder = { ...s.hasOlderByGroupId }, nextSending = { ...s.sendingByGroupId };
      delete nextDetails[groupChatId]; delete nextKeys[groupChatId]; delete nextMessages[groupChatId]; delete nextLoading[groupChatId]; delete nextOlder[groupChatId]; delete nextSending[groupChatId];
      const groups = s.groups.filter((g: GroupChatSummary) => g.id !== groupChatId);
      return { groups, groupDetailsById: nextDetails, groupKeysById: nextKeys, messagesByGroupId: nextMessages, loadingMessagesByGroupId: nextLoading, hasOlderByGroupId: nextOlder, sendingByGroupId: nextSending, activeGroupId: s.activeGroupId === groupChatId ? (groups[0]?.id ?? null) : s.activeGroupId };
    }),
    handleRetentionUpdate: (groupChatId, retentionDays) => set((s: any) => ({ groups: s.groups.map((g: GroupChatSummary) => g.id === groupChatId ? { ...g, retentionDays } : g), groupDetailsById: s.groupDetailsById[groupChatId] ? { ...s.groupDetailsById, [groupChatId]: { ...s.groupDetailsById[groupChatId], retentionDays } } : s.groupDetailsById })),
    handleKeyRotated: async (groupChatId) => { await get().loadGroupKeys(groupChatId); if (get().activeGroupId === groupChatId) await get().loadGroupDetail(groupChatId); },
    handleMemberMutation: async (groupChatId) => { await Promise.all([get().loadGroups(), get().loadGroupDetail(groupChatId)]); },
  };
}
