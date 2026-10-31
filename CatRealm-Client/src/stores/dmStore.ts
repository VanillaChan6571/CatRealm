import { create } from 'zustand';
import { createDMConversationSlice, resetConversationModuleState, type DMConversationSlice } from '../messaging/conversations/dmConversationSlice';
import { createDMMessageSlice, resetMessageModuleState, type DMMessageSlice } from '../messaging/messages/dmMessageSlice';
import { createDMOperationsSlice, type DMOperationsSlice } from '../messaging/operations/dmOperationsSlice';
import { createDMUnreadSlice, resetUnreadModuleState, type DMUnreadSlice } from '../messaging/unread/dmUnreadSlice';
import { createDMScheduledSlice, type DMScheduledSlice } from '../messaging/scheduled/dmScheduledSlice';
import { createDMPinSlice, type DMPinSlice } from '../messaging/pins/dmPinSlice';
import { localReadFloorByConversation } from '../messaging/dm/dmHelpers';

type DMState = DMConversationSlice & DMMessageSlice & DMOperationsSlice & DMUnreadSlice & DMScheduledSlice & DMPinSlice & {
  reset: () => void;
};

export const useDMStore = create<DMState>((set, get) => ({
  ...createDMConversationSlice(set, get),
  ...createDMMessageSlice(set, get),
  ...createDMOperationsSlice(set, get),
  ...createDMUnreadSlice(set, get),
  ...createDMScheduledSlice(set, get),
  ...createDMPinSlice(set, get),

  reset: () => {
    resetConversationModuleState();
    resetMessageModuleState();
    resetUnreadModuleState();
    localReadFloorByConversation.clear();
    set({
      conversations: [],
      messagesByConversation: {},
      hasOlderByConversation: {},
      loadingOlderByConversation: {},
      loadingMessagesByConversation: {},
      unavailableMessagesByConversation: {},
      oldestFetchedAtByConversation: {},
      activeConversationId: null,
      dmViewOpen: false,
      loading: false,
      error: null,
      initialized: false,
      scheduledDMs: {},
      dmPinsByConversation: {},
    });
  },
}));
