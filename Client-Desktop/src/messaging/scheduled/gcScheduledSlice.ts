import type { GroupChatMessage } from '../../types';

export type GCScheduledSlice = {
  scheduledGCMessages: Record<string, GroupChatMessage[]>;
  publishScheduledGC: (messageId: string, groupId: string) => void;
};

export function createGCScheduledSlice(set: any, _get: any): GCScheduledSlice {
  return {
    scheduledGCMessages: {},

    publishScheduledGC: (messageId: string, groupId: string) => {
      set((s: any) => ({
        scheduledGCMessages: {
          ...s.scheduledGCMessages,
          [groupId]: (s.scheduledGCMessages[groupId] ?? []).filter((m: GroupChatMessage) => m.id !== messageId),
        },
      }));
    },
  };
}
