import { describe, expect, it } from 'vitest';
import { normalizeDmReactions } from '../dmNormalizers';
import { normalizeGCReactions } from '../groupChatNormalizers';

// Central's socket fan-out sends `reacted` computed for whoever reacted, to every member.
const fanOutFromOtherUser = [{ emoji: '😺', count: 2, users: ['me', 'them'], reacted: true }];

describe('reaction normalizers derive `reacted` for the viewer', () => {
  it('DM: trusts users over the broadcast flag', () => {
    expect(normalizeDmReactions(fanOutFromOtherUser, 'me')[0].reacted).toBe(true);
    expect(normalizeDmReactions([{ ...fanOutFromOtherUser[0], users: ['them'] }], 'me')[0].reacted).toBe(false);
  });

  it('DM: falls back to the flag when users are missing', () => {
    expect(normalizeDmReactions([{ emoji: '😺', count: 1, reacted: true }], 'me')[0].reacted).toBe(true);
  });

  it('group chat: highlights my own reaction even when another member triggered the update', () => {
    expect(normalizeGCReactions([{ emoji: '😺', count: 2, users: ['me', 'them'], reacted: false }], 'me')[0].reacted).toBe(true);
    expect(normalizeGCReactions([{ emoji: '😺', count: 1, users: ['them'], reacted: true }], 'me')[0].reacted).toBe(false);
  });

  it('group chat: keeps the flag when no viewer id is known', () => {
    expect(normalizeGCReactions([{ emoji: '😺', count: 1, users: ['them'], reacted: true }])[0].reacted).toBe(true);
  });
});
