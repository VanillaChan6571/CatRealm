import { describe, expect, it } from 'vitest';
import { buildMemberList, filterMemberListByVisibleIds, mergeMemberPresence } from '../MemberList';

describe('buildMemberList', () => {
  it('preserves activity data from allMembers when live presence is sparse', () => {
    const result = buildMemberList(
      [
        {
          id: 'user-1',
          username: 'cat',
          role: 'member',
          status: 'online',
          activityType: 'Custom',
          activityText: 'Eating tuna',
        },
      ],
      [
        {
          id: 'user-1',
          username: 'cat',
          role: 'member',
          status: 'online',
        },
      ]
    );

    expect(result).toHaveLength(1);
    expect(result[0].activityType).toBe('Custom');
    expect(result[0].activityText).toBe('Eating tuna');
    expect(result[0].offline).toBe(false);
  });

  it('keeps invisible users grouped as offline', () => {
    const result = buildMemberList([], [
      {
        id: 'user-2',
        username: 'ghost',
        role: 'member',
        status: 'invisible',
      },
    ]);

    expect(result[0].status).toBe('invisible');
    expect(result[0].offline).toBe(true);
  });

  it('clears stale activity when live presence explicitly sends nulls', () => {
    const merged = mergeMemberPresence(
      {
        id: 'user-3',
        username: 'miner',
        role: 'member',
        status: 'online',
        activityType: 'Playing',
        activityText: 'Minecraft',
        activityStartedAt: 123,
      },
      {
        id: 'user-3',
        username: 'miner',
        role: 'member',
        status: 'online',
        activityType: null,
        activityText: null,
        activityStartedAt: null,
      }
    );

    expect(merged.activityType).toBeNull();
    expect(merged.activityText).toBeNull();
    expect(merged.activityStartedAt).toBeNull();
  });

  it('filters members by selected channel visibility', () => {
    const members = buildMemberList(
      [
        { id: 'user-1', username: 'visible', role: 'member' },
        { id: 'user-2', username: 'hidden', role: 'member' },
      ],
      []
    );

    const result = filterMemberListByVisibleIds(members, new Set(['user-1']));

    expect(result.map((user) => user.id)).toEqual(['user-1']);
  });
});
