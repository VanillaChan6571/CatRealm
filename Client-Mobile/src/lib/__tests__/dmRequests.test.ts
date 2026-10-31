import { canSendDM, isIncomingRequest } from '../dmRequests';
import type { DMConversation } from '@/types';

const conversation: DMConversation = { id: 'c', otherUserId: 'u', otherUsername: 'user', otherAvatar: null, lastMessageAt: 0, unreadCount: 0 };
test('existing conversations and first message requests remain sendable', () => {
  expect(canSendDM(conversation, false)).toBe(true);
  expect(canSendDM({ ...conversation, requestState: 'accepted', canSend: true }, false)).toBe(true);
});
test.each(['pending', 'declined'] as const)('incoming %s requests must be accepted first', (requestState) => {
  expect(isIncomingRequest({ ...conversation, requestState })).toBe(true);
  expect(canSendDM({ ...conversation, requestState }, false)).toBe(false);
});
test.each(['pending', 'declined'] as const)('outgoing %s requests cannot receive follow-up messages', (outgoingRequestState) => {
  expect(canSendDM({ ...conversation, outgoingRequestState }, false)).toBe(false);
});
test('honors local block, recipient block, and backend contact policy', () => {
  expect(canSendDM(conversation, true)).toBe(false);
  expect(canSendDM({ ...conversation, isBlockedByThem: true }, false)).toBe(false);
  expect(canSendDM({ ...conversation, canSend: false }, false)).toBe(false);
});
