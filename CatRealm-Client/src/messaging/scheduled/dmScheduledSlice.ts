import type { DMSet } from '../dm/dmHelpers';
import type { DMMessage } from '../../types';

export type DMScheduledSlice = {
  scheduledDMs: Record<string, DMMessage[]>;
  addScheduledDM: (msg: DMMessage) => void;
  publishScheduledDM: (messageId: string, conversationId: string) => void;
};

export function createDMScheduledSlice(set: DMSet): DMScheduledSlice {
  return {
    scheduledDMs: {},

    addScheduledDM: (msg: DMMessage) => {
      set((s) => {
        const existing = s.scheduledDMs[msg.conversationId] ?? [];
        if (existing.some((m: DMMessage) => m.id === msg.id)) return s;
        return { scheduledDMs: { ...s.scheduledDMs, [msg.conversationId]: [...existing, msg] } };
      });
    },

    publishScheduledDM: (messageId: string, conversationId: string) => {
      set((s) => {
        const existing = s.scheduledDMs[conversationId] ?? [];
        return { scheduledDMs: { ...s.scheduledDMs, [conversationId]: existing.filter((m: DMMessage) => m.id !== messageId) } };
      });
    },
  };
}
