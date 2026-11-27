import type { GroupChatMessage } from '../../types';
import type { GCSet } from '../groupChat/gcHelpers';

export type GCScheduledSlice = {
  scheduledGCMessages: Record<string, GroupChatMessage[]>;
  publishScheduledGC: (messageId: string, groupId: string) => void;
};

export function createGCScheduledSlice(set: GCSet): GCScheduledSlice {
  return {
    scheduledGCMessages: {},

    publishScheduledGC: (messageId: string, groupId: string) => {
      set((s) => ({
        scheduledGCMessages: {
          ...s.scheduledGCMessages,
          [groupId]: (s.scheduledGCMessages[groupId] ?? []).filter((m: GroupChatMessage) => m.id !== messageId),
        },
      }));
    },
  };
}
