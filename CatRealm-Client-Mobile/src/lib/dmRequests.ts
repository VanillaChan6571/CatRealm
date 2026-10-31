import type { DMConversation } from '@/types';

export function isIncomingRequest(conversation: DMConversation) {
  return conversation.requestState === 'pending' || conversation.requestState === 'declined';
}

export function canSendDM(conversation: DMConversation | undefined, blocked: boolean) {
  return !!conversation && !blocked && !conversation.isBlockedByThem && conversation.canSend !== false
    && !isIncomingRequest(conversation)
    && conversation.outgoingRequestState !== 'pending' && conversation.outgoingRequestState !== 'declined';
}
