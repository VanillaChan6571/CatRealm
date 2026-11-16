import type { DMConversation } from '../types';

export function getInitialDmConversation(
  conversations: DMConversation[],
  activeConversationId: string | null
): DMConversation | null {
  if (activeConversationId) return null;
  return conversations[0] ?? null;
}

export function getActiveDmConversationForUser(
  conversations: DMConversation[],
  activeConversationId: string | null,
  otherUserId: string
): DMConversation | null {
  const requested = conversations.find((conversation) => conversation.otherUserId === otherUserId);
  return requested?.id === activeConversationId ? requested : null;
}
