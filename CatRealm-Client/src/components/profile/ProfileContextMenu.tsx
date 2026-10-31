import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { RefObject } from 'react';
import type { Profile } from '../../types';
import { useTranslation } from 'react-i18next';

interface ProfileContextMenuProps {
  profile: Profile;
  isOwnProfile: boolean;
  isBlocked: boolean;
  inCentralContext: boolean;
  canViewServerProfile: boolean;
  anchorRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  onViewMainProfile: () => void;
  onViewServerProfile: () => void;
  onInviteToServer: () => void;
  onBlock: () => void;
  onUnblock: () => void;
  onCopyUserId: () => void;
}

export function ProfileContextMenu({
  profile,
  isOwnProfile,
  isBlocked,
  inCentralContext,
  canViewServerProfile,
  anchorRef,
  onClose,
  onViewMainProfile,
  onViewServerProfile,
  onInviteToServer,
  onBlock,
  onUnblock,
  onCopyUserId,
}: ProfileContextMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  useEffect(() => {
    const updatePosition = () => {
      const anchorEl = anchorRef?.current;
      if (!anchorEl) return;
      const rect = anchorEl.getBoundingClientRect();
      const menuWidth = 224; // Tailwind w-56
      const menuHeightEstimate = 220;
      const margin = 8;

      let left = rect.right - menuWidth;
      left = Math.max(margin, Math.min(left, window.innerWidth - menuWidth - margin));

      let top = rect.bottom + 4;
      if (top + menuHeightEstimate > window.innerHeight - margin && rect.top - menuHeightEstimate > margin) {
        top = Math.max(margin, rect.top - menuHeightEstimate - 4);
      }

      setPosition({ top, left });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [anchorRef]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const handleAction = (action: () => void) => {
    action();
    onClose();
  };

  const showViewMainProfile = !inCentralContext && profile.accountType === 'central';
  const showViewServerProfile = inCentralContext && canViewServerProfile && profile.accountType === 'central';
  const showInviteToServer = !isOwnProfile && !profile.isBot;
  const showBlockActions = !isOwnProfile;

  const menu = (
    <div
      ref={menuRef}
      style={{ top: position.top, left: position.left }}
      className="fixed w-56 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-bg-elevated/95 backdrop-blur-md shadow-2xl overflow-hidden z-[70]"
    >
      {showViewMainProfile && (
        <button
          onClick={() => handleAction(onViewMainProfile)}
          className="w-full px-4 py-2.5 text-left text-sm text-text-primary hover:bg-bg-hover transition-colors"
        >
          {t('profile.viewMainProfile')}
        </button>
      )}

      {showViewServerProfile && (
        <button
          onClick={() => handleAction(onViewServerProfile)}
          className="w-full px-4 py-2.5 text-left text-sm text-text-primary hover:bg-bg-hover transition-colors"
        >
          {t('profile.viewServerProfile')}
        </button>
      )}

      {showInviteToServer && (
        <button
          onClick={() => handleAction(onInviteToServer)}
          className="w-full px-4 py-2.5 text-left text-sm text-text-primary hover:bg-bg-hover transition-colors"
        >
          {t('profile.inviteToServer')}
        </button>
      )}

      {showBlockActions && (
        <button
          onClick={() => handleAction(isBlocked ? onUnblock : onBlock)}
          className={`w-full px-4 py-2.5 text-left text-sm hover:bg-bg-hover transition-colors ${
            isBlocked ? 'text-success' : 'text-danger'
          }`}
        >
          {isBlocked ? t('profile.unblockUser') : t('profile.blockUser')}
        </button>
      )}

      <div className="border-t border-border" />

      <button
        onClick={() => handleAction(onCopyUserId)}
        className="w-full px-4 py-2.5 text-left text-sm text-text-muted hover:bg-bg-hover transition-colors"
      >
        {t('profile.copyUserId')}
      </button>
    </div>
  );

  return createPortal(menu, document.body);
}
