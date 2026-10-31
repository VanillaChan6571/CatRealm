import { describe, expect, it } from 'vitest';
import { getInitialDmConversation } from '../dmSelection';

describe('getInitialDmConversation', () => {
  const conversations = [
    { id: 'conv-1', otherUserId: 'u1', otherUsername: 'alpha', otherAvatar: null, unreadCount: 0, lastMessageAt: 1 },
    { id: 'conv-2', otherUserId: 'u2', otherUsername: 'beta', otherAvatar: null, unreadCount: 0, lastMessageAt: 2 },
  ];

  it('returns the first conversation when none is active', () => {
    expect(getInitialDmConversation(conversations, null)?.id).toBe('conv-1');
  });

  it('returns null when a conversation is already active', () => {
    expect(getInitialDmConversation(conversations, 'conv-2')).toBeNull();
  });

  it('returns null when there are no conversations', () => {
    expect(getInitialDmConversation([], null)).toBeNull();
  });
});
