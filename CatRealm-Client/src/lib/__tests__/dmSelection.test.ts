import { describe, expect, it } from 'vitest';
import { getActiveDmConversationForUser, getInitialDmConversation } from '../dmSelection';

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

  it('does not treat the active announcement DM as the requested user conversation', () => {
    const withAnnouncement = [
      { id: 'official-system', otherUserId: 'official', otherUsername: 'CatRealm', otherAvatar: null, unreadCount: 0, lastMessageAt: 3, conversationKind: 'official_system' as const },
      ...conversations,
    ];

    expect(getActiveDmConversationForUser(withAnnouncement, 'official-system', 'u2')).toBeNull();
    expect(getActiveDmConversationForUser(withAnnouncement, 'conv-2', 'u2')?.id).toBe('conv-2');
  });
});
