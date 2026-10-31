import { describe, expect, it } from 'vitest';
import { formatActivitySummary, formatElapsed } from '../presenceActivity';
import { mergeCentralProfileIntoLoadedProfile } from '../profileMerge';
import { imageForYearBadge, yearBadgeTier } from '../../components/profile/ProfileBadges';

describe('formatElapsed', () => {
  it('shows seconds before the first minute', () => {
    expect(formatElapsed(1_700_000_000, 1_700_000_045_000, 'compact')).toBe('45s');
  });
});

describe('formatActivitySummary', () => {
  it('prefers the activity over custom status in compact summaries', () => {
    expect(formatActivitySummary({
      customStatusText: 'Busy',
      activityType: 'Playing',
      activityText: 'Cat Quest',
      activityStartedAt: 1_700_000_000,
      nowMs: 1_700_000_125_000,
    })).toBe('🎮 Playing Cat Quest • 2m');
  });

  it('falls back to custom status when there is no activity', () => {
    expect(formatActivitySummary({
      customStatusText: 'Busy',
      activityType: null,
      activityText: null,
      activityStartedAt: null,
      nowMs: 1_700_000_125_000,
    })).toBe('Busy');
  });
});

describe('mergeCentralProfileIntoLoadedProfile', () => {
  it('carries the central activity start time into the merged profile', () => {
    const merged = mergeCentralProfileIntoLoadedProfile(
      {
        id: 'server-user',
        username: 'cat',
        role: 'member',
        avatar: null,
        bio: null,
        accountType: 'central',
        activityType: 'Playing',
        activityText: 'Cat Quest',
        activityStartedAt: null,
      },
      {
        id: 'central-user',
        username: 'cat',
        role: 'member',
        avatar: null,
        bio: null,
        accountType: 'central',
        activityType: 'Playing',
        activityText: 'Cat Quest',
        activityStartedAt: 1_700_000_000,
      }
    );

    expect(merged.activityStartedAt).toBe(1_700_000_000);
  });

  it('lets the central profile clear stale activity with explicit nulls', () => {
    const merged = mergeCentralProfileIntoLoadedProfile(
      {
        id: 'server-user',
        username: 'cat',
        role: 'member',
        avatar: null,
        bio: null,
        accountType: 'central',
        activityType: 'Playing',
        activityText: 'Minecraft',
        activityStartedAt: 1_700_000_000,
      },
      {
        id: 'central-user',
        username: 'cat',
        role: 'member',
        avatar: null,
        bio: null,
        accountType: 'central',
        activityType: null,
        activityText: null,
        activityStartedAt: null,
      }
    );

    expect(merged.activityType).toBeNull();
    expect(merged.activityText).toBeNull();
    expect(merged.activityStartedAt).toBeNull();
  });

  it('treats Central as the sole authority for the social profile, overriding a stale local copy', () => {
    const merged = mergeCentralProfileIntoLoadedProfile(
      {
        id: 'server-user',
        username: 'cat',
        role: 'member',
        avatar: null,
        bio: null,
        accountType: 'central',
        socialProfileEnabled: true,
        socialProfileConfig: { links: [{ type: 'twitch', url: 'https://twitch.tv/stale' }] },
      },
      {
        id: 'central-user',
        username: 'cat',
        role: 'member',
        avatar: null,
        bio: null,
        accountType: 'central',
        socialProfileEnabled: false,
        socialProfileConfig: null,
      }
    );

    expect(merged.socialProfileEnabled).toBe(false);
    expect(merged.socialProfileConfig).toBeNull();
  });

  it('leaves the realm-served social profile intact when no Central profile is available', () => {
    const loaded = {
      id: 'server-user',
      username: 'cat',
      role: 'member',
      avatar: null,
      bio: null,
      accountType: 'central' as const,
      socialProfileEnabled: true,
      socialProfileConfig: { links: [{ type: 'twitch' as const, url: 'https://twitch.tv/kept' }] },
    };

    const merged = mergeCentralProfileIntoLoadedProfile(loaded, null);

    expect(merged.socialProfileEnabled).toBe(true);
    expect(merged.socialProfileConfig).toEqual(loaded.socialProfileConfig);
  });

  it('treats Central as the sole authority for badges, overriding a realm-served list', () => {
    const merged = mergeCentralProfileIntoLoadedProfile(
      {
        id: 'server-user',
        username: 'cat',
        role: 'member',
        avatar: null,
        bio: null,
        accountType: 'central',
        badges: [{ id: 'realm-fake', label: 'Realm Injected' }],
      },
      {
        id: 'central-user',
        username: 'cat',
        role: 'member',
        avatar: null,
        bio: null,
        accountType: 'central',
        badges: [{ id: 'staff', label: 'Staff' }],
      }
    );

    expect(merged.badges).toEqual([{ id: 'staff', label: 'Staff' }]);
  });

  it('drops realm-injected badges when Central reports none', () => {
    const merged = mergeCentralProfileIntoLoadedProfile(
      {
        id: 'server-user',
        username: 'cat',
        role: 'member',
        avatar: null,
        bio: null,
        accountType: 'central',
        badges: [{ id: 'realm-fake', label: 'Realm Injected' }],
      },
      {
        id: 'central-user',
        username: 'cat',
        role: 'member',
        avatar: null,
        bio: null,
        accountType: 'central',
      }
    );

    expect(merged.badges).toEqual([]);
  });
});

describe('yearBadgeTier', () => {
  const YEAR_MS = 365.2425 * 24 * 60 * 60 * 1000;
  const secondsAgo = (years: number) => Math.floor((Date.now() - years * YEAR_MS) / 1000);

  it('awards no year badge before the first full year', () => {
    expect(yearBadgeTier(secondsAgo(0.5))).toBe(0);
    expect(imageForYearBadge(yearBadgeTier(secondsAgo(0.5)))).toBeNull();
  });

  it('makes Year 1 mean one completed year', () => {
    expect(yearBadgeTier(secondsAgo(1.1))).toBe(1);
  });

  it('increments the tier with each completed year', () => {
    expect(yearBadgeTier(secondsAgo(2.3))).toBe(2);
    expect(yearBadgeTier(secondsAgo(5.9))).toBe(5);
  });

  it('returns tier 0 when no join date is known', () => {
    expect(yearBadgeTier(undefined)).toBe(0);
  });
});
