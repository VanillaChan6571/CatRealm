import type { Profile } from '../types';

export function mergeCentralProfileIntoLoadedProfile(loadedProfile: Profile, centralProfile: Profile | null) {
  if (!centralProfile) return loadedProfile;
  return {
    ...loadedProfile,
    displayName: loadedProfile.displayName ?? centralProfile.displayName ?? null,
    customStatusText: centralProfile.customStatusText ?? null,
    // Central (CatLab) is the sole authority for the social profile: its value
    // wins even when disabled/empty, so a stale realm-served copy can't leak
    // through. Note the caller returns early when centralProfile is null, so a
    // realm with no Central data available still shows what it served.
    socialProfileEnabled: centralProfile.socialProfileEnabled ?? false,
    socialProfileConfig: centralProfile.socialProfileConfig ?? null,
    // Badges are awarded and owned by Central (CatLab), so Central is the sole
    // authority here too — a realm cannot inject or withhold badges. As with the
    // social profile, the null-centralProfile early return above preserves the
    // realm-served list when no Central data is available.
    badges: centralProfile.badges ?? [],
    // Central owns the streak outright so a realm cannot inject or inflate one.
    streakDays: centralProfile.streakDays ?? 0,
    nowPlaying: centralProfile.nowPlaying ?? null,
    activityType: centralProfile.activityType ?? null,
    activityText: centralProfile.activityText ?? null,
    activityStartedAt: centralProfile.activityStartedAt ?? null,
    bio: centralProfile.bio ?? loadedProfile.bio ?? null,
    pronouns: loadedProfile.pronouns ?? centralProfile.pronouns ?? null,
    verified: loadedProfile.verified || centralProfile.verified,
    centralJoinDate: centralProfile.centralJoinDate ?? loadedProfile.centralJoinDate,
  };
}
