import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../ui/Button';
import { AvatarImage } from '../../ui/AvatarImage';
import { AUTH_BASE } from '../../../lib/authApi';
import { resolveAvatarUrl } from '../../../utils/avatar';
import type { Profile } from '../../../types';
import type { CropKind } from './settingsTypes';

type Server = {
  url: string;
  name: string;
  token: string;
};

type ServerProfilesTabProps = {
  profile: Profile | null;
  user: { username?: string } | null;
  servers: Server[];
  selectedServerUrl: string | null;
  setSelectedServerUrl: (url: string) => void;
  serverAvatars: Record<string, string | null>;
  serverBanners: Record<string, string | null>;
  uploadingServerAvatar: boolean;
  uploadingServerBanner: boolean;
  setCropTarget: (target: { kind: CropKind; file: File; serverUrl?: string } | null) => void;
  handleRemoveServerAvatar: () => void;
  handleRemoveServerBanner: () => void;
};

export function ServerProfilesTab(props: ServerProfilesTabProps) {
  const { t } = useTranslation();
  const [bannerFailed, setBannerFailed] = useState(false);
  useEffect(() => { setBannerFailed(false); }, [props.serverBanners, props.profile?.banner]);

  const {
    profile,
    user,
    servers,
    selectedServerUrl,
    setSelectedServerUrl,
    serverAvatars,
    serverBanners,
    uploadingServerAvatar,
    uploadingServerBanner,
    setCropTarget,
    handleRemoveServerAvatar,
    handleRemoveServerBanner,
  } = props;

  return (
    <div className="space-y-6 max-w-2xl">
      <h3 className="text-xl font-bold text-text-primary">{t('serverProfiles.title')}</h3>
      <p className="text-sm text-text-muted">
        {t('serverProfiles.description')}
      </p>

      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium text-text-primary mb-2 block">{t('serverProfiles.selectServer')}</label>
          <select
            value={selectedServerUrl ?? ''}
            onChange={(e) => setSelectedServerUrl(e.target.value)}
            className="w-full bg-bg-input border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
          >
            {servers.map((server) => (
              <option key={server.url} value={server.url}>
                {server.name} ({new URL(server.url).hostname})
              </option>
            ))}
          </select>
        </div>

        {selectedServerUrl && (
          <div className="space-y-4 bg-bg-hover/30 p-4 rounded-lg">
            <p className="text-sm font-medium text-text-primary">{t('serverProfiles.serverAvatar')}</p>
            <div className="flex items-center gap-4">
              <label className="relative w-20 h-20 rounded-full avatar-bg flex items-center justify-center text-white text-2xl font-semibold overflow-hidden cursor-pointer group">
                <AvatarImage
                  src={
                    serverAvatars[selectedServerUrl]
                      ? resolveAvatarUrl(serverAvatars[selectedServerUrl], selectedServerUrl)
                      : resolveAvatarUrl(profile?.avatar, AUTH_BASE)
                  }
                  alt={t('serverProfiles.serverAvatarAlt')}
                  size={80}
                  className="w-20 h-20 object-cover"
                  fallback={<span>{user?.username?.charAt(0).toUpperCase()}</span>}
                />
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file && selectedServerUrl) {
                      setCropTarget({ kind: 'server-avatar', file, serverUrl: selectedServerUrl });
                    }
                    e.currentTarget.value = '';
                  }}
                  className="hidden"
                />
                <div className="absolute inset-0 bg-black/50 text-white text-xs font-medium opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                  {t('serverProfiles.change')}
                </div>
              </label>
              <div className="flex-1">
                <p className="text-sm text-text-muted">
                  {serverAvatars[selectedServerUrl] ? t('serverProfiles.customAvatarSet') : t('serverProfiles.usingMainAvatar')}
                </p>
                {serverAvatars[selectedServerUrl] && (
                  <Button variant="ghost" size="sm" onClick={handleRemoveServerAvatar} disabled={uploadingServerAvatar} className="mt-2">
                    {t('serverProfiles.removeServerAvatar')}
                  </Button>
                )}
              </div>
            </div>

            <div className="border-t border-border pt-4 space-y-3">
              <p className="text-sm font-medium text-text-primary">{t('serverProfiles.serverBanner')}</p>
              <div className="h-32 rounded border border-border overflow-hidden bg-bg-input">
                {(serverBanners[selectedServerUrl] || profile?.banner) && !bannerFailed ? (
                  <img
                    src={
                      serverBanners[selectedServerUrl]
                        ? (resolveAvatarUrl(serverBanners[selectedServerUrl], selectedServerUrl) ?? '')
                        : (resolveAvatarUrl(profile?.banner, AUTH_BASE) ?? '')
                    }
                    alt={t('serverProfiles.serverBannerAlt')}
                    className="w-full h-full object-cover"
                    onError={() => setBannerFailed(true)}
                  />
                ) : null}
              </div>
              <p className="text-sm text-text-muted">
                {serverBanners[selectedServerUrl] ? t('serverProfiles.customBannerSet') : t('serverProfiles.usingMainBanner')}
              </p>
              <div className="flex items-center gap-2">
                <label className="inline-flex">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file && selectedServerUrl) {
                        setCropTarget({ kind: 'server-banner', file, serverUrl: selectedServerUrl });
                      }
                      e.currentTarget.value = '';
                    }}
                    className="hidden"
                    disabled={uploadingServerBanner}
                  />
                  <span className="inline-flex items-center px-3 py-1.5 rounded bg-bg-elevated border border-border text-text-primary hover:bg-bg-hover cursor-pointer text-sm">
                    {t('serverProfiles.uploadServerBanner')}
                  </span>
                </label>
                {serverBanners[selectedServerUrl] && (
                  <Button variant="ghost" size="sm" onClick={handleRemoveServerBanner} disabled={uploadingServerBanner}>
                    {t('serverProfiles.removeServerBanner')}
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
