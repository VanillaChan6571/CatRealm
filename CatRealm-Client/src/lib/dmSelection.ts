import type { DMConversation } from '../types';

export function getInitialDmConversation(
  conversations: DMConversation[],
  activeConversationId: string | null
): DMConversation | null {
  if (activeConversationId) return null;
  return conversations[0] ?? null;
}
