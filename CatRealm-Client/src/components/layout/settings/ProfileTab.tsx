import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../ui/Button';
import { AvatarImage } from '../../ui/AvatarImage';
import { ActivityDisplay } from '../../ui/ActivityDisplay';
import { useGameActivityStore } from '../../../stores/gameActivityStore';
import { AUTH_BASE } from '../../../lib/authApi';
import { resolveAvatarUrl } from '../../../utils/avatar';
import { GameIcon } from '../../ui/GameIcon';
import { LastfmConnection } from './LastfmConnection';
import type { Profile } from '../../../types';
import type { CropKind } from './settingsTypes';
import { Moon } from 'lucide-react';

type ProfileTabProps = {
  profile: Profile | null;
  profileLoading: boolean;
  profileError: string | null;
  user: { username?: string; accountType?: string; status?: string; id?: string } | null;
  isCentral: boolean;
  serverUrl: string | null;
  uploadingAvatar: boolean;
  uploadingBanner: boolean;
  bioDraft: string;
  setBioDraft: (v: string) => void;
  savingBio: boolean;
  displayNameDraft: string;
  setDisplayNameDraft: (v: string) => void;
  activityTypeDraft: string;
  setActivityTypeDraft: (v: string) => void;
  activityTextDraft: string;
  setActivityTextDraft: (v: string) => void;
  gameActivityState: DesktopGameActivityState;
  setCropTarget: (target: { kind: CropKind; file: File; serverUrl?: string } | null) => void;
  handleRemoveAvatar: () => void;
  handleRemoveBanner: () => void;
  handleSaveBio: () => void;
  handleSaveDisplayName: () => void;
  handleSaveActivity: () => void;
  setStatus: (status: 'online' | 'away' | 'sleeping' | 'invisible') => void;
};

export function ProfileTab(props: ProfileTabProps) {
  const { t } = useTranslation();
  const [bannerFailed, setBannerFailed] = useState(false);
  const effectiveGameStartedAt = useGameActivityStore((s) => s.effectiveGameStartedAt);
  const gameIconUrl = useGameActivityStore((s) => s.gameIconUrl);
  useEffect(() => { setBannerFailed(false); }, [props.profile?.banner]);

  const {
    profile,
    profileLoading,
    profileError,
    user,
    isCentral,
    serverUrl,
    uploadingAvatar,
    uploadingBanner,
    bioDraft,
    setBioDraft,
    savingBio,
    displayNameDraft,
    setDisplayNameDraft,
    activityTypeDraft,
    setActivityTypeDraft,
    activityTextDraft,
    setActivityTextDraft,
    gameActivityState,
    setCropTarget,
    handleRemoveAvatar,
    handleRemoveBanner,
    handleSaveBio,
    handleSaveDisplayName,
    handleSaveActivity,
    setStatus,
  } = props;

  return (
    <div className="space-y-6 max-w-2xl">
      <h3 className="text-xl font-bold text-text-primary">{t('profile.myAccount')}</h3>

      {profileLoading && <p className="text-sm text-text-muted">{t('profile.loading')}</p>}
      {profileError && <p className="text-sm text-danger">{profileError}</p>}

      <div className="flex items-center gap-4 bg-bg-hover/30 p-4 rounded-lg" data-tour="profile-avatar">
        <label className="relative w-20 h-20 rounded-full avatar-bg flex items-center justify-center text-white text-2xl font-semibold overflow-hidden cursor-pointer group">
          <AvatarImage
            src={resolveAvatarUrl(profile?.avatar, isCentral ? AUTH_BASE : serverUrl)}
            alt={profile?.username ?? 'avatar'}
            size={80}
            className="w-20 h-20 object-cover"
            fallback={<span>{user?.username?.charAt(0).toUpperCase()}</span>}
          />
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) setCropTarget({ kind: 'profile-avatar', file });
              e.currentTarget.value = '';
            }}
            className="hidden"
          />
          <div className="absolute inset-0 bg-black/50 text-white text-xs font-medium opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
            {t('profile.changeAvatar')}
          </div>
        </label>
        <div className="flex-1">
          <p className="text-lg font-semibold text-text-primary">
            {user?.username ?? t('profile.unknownUser')}
          </p>
          <p className="text-sm text-text-muted capitalize">{user?.accountType ?? 'local'} {t('profile.accountSuffix')}</p>
          {profile?.avatar && (
            <Button variant="ghost" size="sm" onClick={handleRemoveAvatar} disabled={uploadingAvatar} className="mt-2">
              {t('profile.removeAvatar')}
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-2" data-tour="profile-banner">
        <label className="text-sm font-medium text-text-primary">{t('profile.banner')}</label>
        <div className="rounded-lg border border-border overflow-hidden bg-bg-hover/30">
          <div className="h-40 bg-bg-input flex items-center justify-center relative">
            {profile?.banner && !bannerFailed ? (
              <img
                src={resolveAvatarUrl(profile.banner, isCentral ? AUTH_BASE : serverUrl) ?? undefined}
                alt={t('profile.profileBannerAlt')}
                className="w-full h-full object-cover"
                onError={() => setBannerFailed(true)}
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-r from-zinc-700 to-zinc-600" />
            )}
          </div>
          <div className="p-3 flex items-center gap-3">
            <label className="text-xs px-3 py-1.5 rounded bg-bg-input border border-border text-text-secondary cursor-pointer hover:text-text-primary">
              {t('profile.uploadBanner')}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) setCropTarget({ kind: 'profile-banner', file });
                  e.currentTarget.value = '';
                }}
                className="hidden"
                disabled={uploadingBanner}
              />
            </label>
            {profile?.banner && (
              <Button variant="ghost" size="sm" onClick={handleRemoveBanner} disabled={uploadingBanner}>
                {t('profile.removeBanner')}
              </Button>
            )}
            <span className="text-xs text-text-muted">
              {t('profile.mediaLimit')}
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-text-primary">{t('profile.displayName')}</label>
        <input
          type="text"
          value={displayNameDraft}
          onChange={(e) => setDisplayNameDraft(e.target.value)}
          maxLength={32}
          placeholder={user?.username}
          className="w-full bg-bg-input border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-muted">
            {displayNameDraft ? `${displayNameDraft.length}/32` : t('profile.leaveBlankUsername')}
          </span>
          <Button variant="primary" size="sm" onClick={handleSaveDisplayName}>
            {t('common.save')}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-text-primary">{t('profile.bio')}</label>
        <textarea
          value={bioDraft}
          onChange={(e) => setBioDraft(e.target.value)}
          rows={4}
          maxLength={500}
          className="w-full bg-bg-input border border-border rounded px-3 py-2 text-sm text-text-primary resize-none focus:outline-none focus:border-accent"
          placeholder={t('profile.bioPlaceholder')}
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-muted">{bioDraft.length}/500</span>
          <Button variant="primary" size="sm" onClick={handleSaveBio} disabled={savingBio}>
            {savingBio ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {gameActivityState.status === 'active' && gameActivityState.activity && (
          <div className="rounded-lg border border-border bg-bg-hover/30 p-3">
            <p className="text-sm font-medium text-text-primary">{t('profile.gameActivity')}</p>
            <div className="mt-2 flex items-center gap-3">
              <GameIcon iconUrl={gameIconUrl} size={40} className="rounded-lg shrink-0" />
              <ActivityDisplay
                activityType={gameActivityState.activity.activityType}
                activityText={gameActivityState.activity.activityText}
                activityStartedAt={gameActivityState.activity.activityStartedAt ?? effectiveGameStartedAt}
                className="text-text-secondary"
              />
            </div>
            <p className="mt-2 text-xs text-text-muted">
              {t('profile.gameActivityDesc')}
            </p>
          </div>
        )}

        <label className="text-sm font-medium text-text-primary">
          {gameActivityState.status === 'active' && gameActivityState.activity ? t('profile.manualActivity') : t('profile.activity')}
        </label>
        <select
          value={activityTypeDraft}
          onChange={(e) => setActivityTypeDraft(e.target.value)}
          className="w-full bg-bg-input border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
        >
          <option value="">{t('profile.none')}</option>
          <option value="Playing">{t('profile.playing')}</option>
          <option value="Listening">{t('profile.listening')}</option>
          <option value="Watching">{t('profile.watching')}</option>
          <option value="Custom">{t('profile.custom')}</option>
        </select>

        {activityTypeDraft ? (
          <>
            <input
              type="text"
              value={activityTextDraft}
              onChange={(e) => setActivityTextDraft(e.target.value)}
              maxLength={128}
              placeholder={
                activityTypeDraft === 'Playing' ? t('profile.gameNamePlaceholder')
                : activityTypeDraft === 'Listening' ? t('profile.songArtistPlaceholder')
                : activityTypeDraft === 'Watching' ? t('profile.showMoviePlaceholder')
                : t('profile.customStatusPlaceholder')
              }
              className="w-full bg-bg-input border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-muted">{activityTextDraft.length}/128</span>
              <Button variant="primary" size="sm" onClick={handleSaveActivity}>
                {gameActivityState.status === 'active' && gameActivityState.activity ? t('profile.saveManualActivity') : t('profile.saveActivity')}
              </Button>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between rounded-lg border border-border/60 bg-bg-hover/20 px-3 py-2">
            <span className="text-xs text-text-muted">{t('profile.clearManualActivity')}</span>
            <Button variant="primary" size="sm" onClick={handleSaveActivity}>
              {gameActivityState.status === 'active' && gameActivityState.activity ? t('profile.saveManualActivity') : t('profile.saveActivity')}
            </Button>
          </div>
        )}
      </div>

      {isCentral && <LastfmConnection userId={user?.id} />}

      <div className="space-y-2">
        <label className="text-sm font-medium text-text-primary">{t('profile.status')}</label>
        <div className="flex flex-wrap gap-2">
          <button
            className={`px-4 py-2 rounded text-sm border border-border transition-colors ${
              user?.status === 'online' ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'
            }`}
            onClick={() => setStatus('online')}
          >
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-success" /> {t('status.online')}</span>
          </button>
          <button
            className={`px-4 py-2 rounded text-sm border border-border transition-colors ${
              user?.status === 'away' ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'
            }`}
            onClick={() => setStatus('away')}
          >
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-warning" /> {t('status.away')}</span>
          </button>
          <span className="px-4 py-2 rounded text-sm border border-border text-text-muted opacity-70">
            <span className="inline-flex items-center gap-1.5"><Moon className="h-3.5 w-3.5" /> {t('status.sleeping')}</span>
          </span>
          <button
            className={`px-4 py-2 rounded text-sm border border-border transition-colors ${
              user?.status === 'invisible' ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'
            }`}
            onClick={() => setStatus('invisible')}
          >
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-text-muted" /> {t('status.offline')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
