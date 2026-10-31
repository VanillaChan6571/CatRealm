import type { Profile } from '../../types';
import { AvatarImage } from '../ui/AvatarImage';
import { ActivityDisplay } from '../ui/ActivityDisplay';
import { VerifiedBadge } from '../ui/VerifiedBadge';
import { BotBadge } from '../ui/BotBadge';
import { nicknameScope, useNicknamesStore } from '../../stores/nicknamesStore';
import { ProfileBadges } from './ProfileBadges';
import { DevicePhoneMobileIcon } from '@heroicons/react/24/solid';
import { Crown } from 'lucide-react';

interface ProfileHeaderProps {
  inCentralContext?: boolean;
  profile: Profile;
  resolvedAvatar: string | null;
  resolvedBanner: string | null;
  bannerFailed: boolean;
  onBannerError: () => void;
}

function getDisplayedName(profile: Profile, nickname: string | undefined): string {
  if (nickname) return nickname;
  if (profile.displayName) return profile.displayName;
  return profile.username;
}

function shouldShowUsername(profile: Profile, nickname: string | undefined): boolean {
  return !!(nickname || profile.displayName);
}

export function ProfileHeader({
  inCentralContext = false,
  profile,
  resolvedAvatar,
  resolvedBanner,
  bannerFailed,
  onBannerError,
}: ProfileHeaderProps) {
  const nickname = useNicknamesStore(s => s.byScope[nicknameScope(inCentralContext)]?.[profile.id]);
  const displayedName = getDisplayedName(profile, nickname);
  const showUsername = shouldShowUsername(profile, nickname);
  const isOwnerProfile = profile.isOwner || profile.role === 'owner';

  const statusColors = {
    online: 'bg-success',
    away: 'bg-warning',
    sleeping: 'status-sleeping',
    invisible: 'bg-text-muted',
  };
  const statusLabel = !profile.status || profile.status === 'invisible'
    ? 'Offline'
    : profile.status === 'away'
      ? 'Away'
      : profile.status === 'sleeping'
        ? 'Sleeping'
        : 'Online';
  return (
    <div className="rounded-lg border border-border bg-bg-input overflow-hidden">
      {/* Banner */}
      <div className="h-32 bg-gradient-to-br from-accent/10 to-bg-hover/40">
        {resolvedBanner && (
          <img
            src={resolvedBanner}
            alt={`${profile.username} banner`}
            className="w-full h-full object-cover"
            onError={() => {
              if (bannerFailed) return;
              onBannerError();
            }}
          />
        )}
      </div>

      {/* Avatar & Name Section */}
      <div className="p-4 flex items-start gap-4">
        {/* Avatar */}
        <div className="w-20 h-20 rounded-full avatar-bg flex items-center justify-center text-white text-2xl font-semibold overflow-hidden border-4 border-bg-primary shrink-0">
          <AvatarImage
            src={resolvedAvatar}
            alt={profile.username}
            size={80}
            className="w-20 h-20 object-cover"
            fallback={<span>{profile.username.charAt(0).toUpperCase()}</span>}
          />
        </div>

        {/* Name & Status Info */}
        <div className="min-w-0 flex-1 pt-1">
          {/* Display Name */}
          <div className="flex min-w-0 items-center gap-2 mb-1">
            <h2 className="min-w-0 flex items-center gap-1.5 text-lg font-bold text-text-primary">
              {isOwnerProfile && (
                <Crown className="h-4 w-4 shrink-0 text-yellow-300" aria-label="Owner" />
              )}
              <span className="truncate">{displayedName}</span>
            </h2>
            {profile.isBot && <BotBadge isBot size="md" className="shrink-0" />}
            {!profile.isBot && profile.accountType === 'central' && (
              <VerifiedBadge verified={profile.verified} size="md" className="shrink-0" />
            )}
          </div>

          {/* Username & Pronouns */}
          <div className="flex items-center gap-2 flex-wrap">
            {showUsername && (
              <span className="text-sm text-text-muted">@{profile.username}</span>
            )}
            {profile.pronouns && (
              <>
                {showUsername && <span className="text-text-muted">•</span>}
                <span className="text-sm text-text-secondary italic">{profile.pronouns}</span>
              </>
            )}
          </div>

          {/* Status & Activity */}
          <div className="flex items-center gap-2 mt-2">
            <div className="flex items-center gap-1.5">
              <span
                className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${
                  statusColors[(profile.status || 'invisible') as keyof typeof statusColors]
                }`}
                title={statusLabel}
              />
              {profile.clients?.includes('mobile') && (
                <DevicePhoneMobileIcon
                  className={`w-3.5 h-3.5 shrink-0 ${
                    profile.status === 'away' ? 'text-warning'
                    : profile.status === 'sleeping' ? 'text-yellow-400'
                    : profile.status === 'invisible' ? 'text-text-muted'
                    : 'text-success'
                  }`}
                  title={`${statusLabel} (mobile)`}
                />
              )}
              <span className="text-xs text-text-muted">
                {statusLabel}
              </span>
            </div>

            {(profile.customStatusText || (profile.activityType && profile.activityText)) && (
              <>
                <span className="text-text-muted">•</span>
                <ActivityDisplay
                  customStatusText={profile.customStatusText}
                  activityType={profile.activityType}
                  activityText={profile.activityText}
                  activityStartedAt={profile.activityStartedAt}
                  elapsedFormat="detailed"
                  displayMode="profile"
                  className="text-text-secondary"
                />
              </>
            )}
          </div>

          <ProfileBadges profile={profile} />
        </div>
      </div>
    </div>
  );
}
