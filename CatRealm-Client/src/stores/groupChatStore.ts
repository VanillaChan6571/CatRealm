import { create } from 'zustand';
import { createGCConversationSlice, type GCConversationSlice } from '../messaging/groupChat/gcConversationSlice';
import { createGCMessageSlice, type GCMessageSlice } from '../messaging/groupChat/gcMessageSlice';
import { createGCOperationsSlice, type GCOperationsSlice } from '../messaging/groupChat/gcOperationsSlice';
import { createGCScheduledSlice, type GCScheduledSlice } from '../messaging/scheduled/gcScheduledSlice';

type GroupChatState = GCConversationSlice & GCMessageSlice & GCOperationsSlice & GCScheduledSlice & {
  reset: () => void;
};

export const useGroupChatStore = create<GroupChatState>((set, get) => ({
  ...createGCConversationSlice(set, get),
  ...createGCMessageSlice(set, get),
  ...createGCOperationsSlice(set, get),
  ...createGCScheduledSlice(set, get),

  reset: () => set({
    groups: [],
    activeGroupId: null,
    groupDetailsById: {},
    groupKeysById: {},
    messagesByGroupId: {},
    scheduledGCMessages: {},
    loadingMessagesByGroupId: {},
    hasOlderByGroupId: {},
    sendingByGroupId: {},
    loading: false,
    error: null,
  }),
}));
