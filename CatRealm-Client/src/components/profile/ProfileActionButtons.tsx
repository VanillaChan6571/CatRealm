import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlaskConical } from 'lucide-react';
import { Button } from '../ui/Button';
import { ProfileContextMenu } from './ProfileContextMenu';
import type { Profile } from '../../types';

interface ProfileActionButtonsProps {
  profile: Profile;
  isOwnProfile: boolean;
  isBlocked: boolean;
  isFriend: boolean;
  hasPendingRequest: boolean;
  inCentralContext: boolean;
  canViewServerProfile: boolean;
  showFullProfileButton: boolean;
  showMainSocialProfileButton: boolean;
  onMessage: () => void;
  onViewFullProfile: () => void;
  onEditMainSocialProfile: () => void;
  onFriendRequest: () => void;
  onRemoveFriend: () => void;
  onBlock: () => void;
  onUnblock: () => void;
  onViewMainProfile: () => void;
  onViewServerProfile: () => void;
  onInviteToServer: () => void;
  onCopyUserId: () => void;
}

export function ProfileActionButtons({
  profile,
  isOwnProfile,
  isBlocked,
  isFriend,
  hasPendingRequest,
  inCentralContext,
  canViewServerProfile,
  showFullProfileButton,
  showMainSocialProfileButton,
  onMessage,
  onViewFullProfile,
  onEditMainSocialProfile,
  onFriendRequest,
  onRemoveFriend,
  onBlock,
  onUnblock,
  onViewMainProfile,
  onViewServerProfile,
  onInviteToServer,
  onCopyUserId,
}: ProfileActionButtonsProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Message Button */}
      {!isOwnProfile && !isBlocked && profile.accountType === 'central' && !profile.isBot && (
        <Button
          size="sm"
          variant="secondary"
          onClick={onMessage}
          className="flex-1"
        >
          {t('profile.message')}
        </Button>
      )}

      {/* Cat Lab Full Profile Button */}
      {!isOwnProfile && !isBlocked && showFullProfileButton && (
        <Button
          size="sm"
          variant="secondary"
          onClick={onViewFullProfile}
          className="shrink-0"
        >
          <span className="inline-flex items-center justify-center gap-1.5">
            <span>View Full Profile</span>
            <span className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-accent">
              <FlaskConical className="h-3 w-3" />
              Cat Lab
            </span>
          </span>
        </Button>
      )}

      {/* Own Social Profile Button */}
      {isOwnProfile && showMainSocialProfileButton && (
        <Button
          size="sm"
          variant="primary"
          onClick={onEditMainSocialProfile}
          className="flex-1"
        >
          View Social Profile
        </Button>
      )}

      {/* Friend Button */}
      {!isOwnProfile && !isBlocked && profile.accountType === 'central' && !profile.isBot && (
        <Button
          size="sm"
          variant={isFriend ? 'ghost' : 'primary'}
          onClick={isFriend ? onRemoveFriend : onFriendRequest}
          disabled={hasPendingRequest}
          className="flex-1"
        >
          {hasPendingRequest
            ? t('profile.requestSent')
            : isFriend
            ? t('profile.removeFriend')
            : t('profile.addFriend')}
        </Button>
      )}

      {/* Three Dots Menu */}
      <div className="relative">
        <Button
          ref={menuButtonRef}
          size="sm"
          variant="ghost"
          onClick={() => setMenuOpen(!menuOpen)}
          className="px-3"
        >
          •••
        </Button>

        {menuOpen && (
          <ProfileContextMenu
            profile={profile}
            isOwnProfile={isOwnProfile}
            isBlocked={isBlocked}
            inCentralContext={inCentralContext}
            canViewServerProfile={canViewServerProfile}
            anchorRef={menuButtonRef}
            onClose={() => setMenuOpen(false)}
            onViewMainProfile={onViewMainProfile}
            onViewServerProfile={onViewServerProfile}
            onInviteToServer={onInviteToServer}
            onBlock={onBlock}
            onUnblock={onUnblock}
            onCopyUserId={onCopyUserId}
          />
        )}
      </div>
    </div>
  );
}
