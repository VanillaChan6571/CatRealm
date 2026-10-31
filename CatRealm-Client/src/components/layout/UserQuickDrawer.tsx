import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import { Button } from '../ui/Button';
import { AvatarImage } from '../ui/AvatarImage';
import { createApi } from '../../lib/api';
import type { Profile } from '../../types';
import { usePresenceStore } from '../../stores/presenceStore';
import { resolveAvatarUrl } from '../../utils/avatar';
import { Crown } from 'lucide-react';

type PingState = 'idle' | 'loading' | 'ok' | 'error';

const MAX_SNIPPET = 140;

function getServerDescription(desc: string | null | undefined) {
  if (!desc) return 'Self-hosted CatRealm server';
  const trimmed = desc.trim();
  if (trimmed.length <= MAX_SNIPPET) return trimmed;
  return `${trimmed.slice(0, MAX_SNIPPET)}…`;
}

export function UserQuickDrawer() {
  const { t } = useTranslation();
  const activeDrawer = useUIStore((s) => s.activeDrawer);
  const closeDrawer = useUIStore((s) => s.closeDrawer);
  const serverInfo = useAuthStore((s) => s.serverInfo);
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const user = useAuthStore((s) => s.user);
  const updateUser = useAuthStore((s) => s.updateUser);
  const updateOnlineUser = usePresenceStore((s) => s.updateOnlineUser);

  const [pingMs, setPingMs] = useState<number | null>(null);
  const [pingState, setPingState] = useState<PingState>('idle');

  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [bioDraft, setBioDraft] = useState('');
  const [savingBio, setSavingBio] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const drawerRef = useRef<HTMLDivElement>(null);

  const isServerInfo = activeDrawer === 'serverInfo';
  const isProfile = activeDrawer === 'userProfile';

  useEffect(() => {
    if (!isServerInfo || !serverUrl) return;
    let cancelled = false;
    const measurePing = async () => {
      setPingState('loading');
      setPingMs(null);
      const start = performance.now();
      try {
        await axios.get(`${serverUrl}/api/server`);
        if (cancelled) return;
        const duration = Math.round(performance.now() - start);
        setPingMs(duration);
        setPingState('ok');
      } catch {
        if (cancelled) return;
        setPingState('error');
      }
    };
    measurePing();
    return () => {
      cancelled = true;
    };
  }, [isServerInfo, serverUrl]);

  useEffect(() => {
    if (!isProfile) return;
    setProfileError(null);
    setProfileLoading(true);
    const api = createApi();
    api.get('/api/profile/me')
      .then((res) => {
        setProfile(res.data);
        setBioDraft(res.data.bio ?? '');
      })
      .catch((err) => {
        const msg = axios.isAxiosError(err) ? err.response?.data?.error : 'Failed to load profile';
        setProfileError(msg || 'Failed to load profile');
      })
      .finally(() => setProfileLoading(false));
  }, [isProfile]);

  useEffect(() => {
    if (!activeDrawer) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDrawer();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeDrawer, closeDrawer]);

  useEffect(() => {
    if (!activeDrawer) return;
    const handleClick = (e: MouseEvent) => {
      if (!drawerRef.current) return;
      if (!drawerRef.current.contains(e.target as Node)) {
        closeDrawer();
      }
    };
    window.addEventListener('mousedown', handleClick);
    return () => window.removeEventListener('mousedown', handleClick);
  }, [activeDrawer, closeDrawer]);

  const handleRetest = () => {
    if (!serverUrl) return;
    setPingState('loading');
    setPingMs(null);
    const start = performance.now();
    axios.get(`${serverUrl}/api/server`)
      .then(() => {
        const duration = Math.round(performance.now() - start);
        setPingMs(duration);
        setPingState('ok');
      })
      .catch(() => setPingState('error'));
  };

  const handleSaveBio = () => {
    const api = createApi();
    setSavingBio(true);
    setProfileError(null);
    api.put('/api/profile/me', { bio: bioDraft })
      .then((res) => {
        setProfile(res.data);
        setBioDraft(res.data.bio ?? '');
      })
      .catch((err) => {
        const msg = axios.isAxiosError(err) ? err.response?.data?.error : 'Failed to save bio';
        setProfileError(msg || 'Failed to save bio');
      })
      .finally(() => setSavingBio(false));
  };

  const handleAvatarChange = (file: File | null) => {
    if (!file) return;
    const api = createApi();
    const form = new FormData();
    form.append('avatar', file);
    setUploadingAvatar(true);
    setProfileError(null);
    api.post('/api/profile/me/avatar', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
      .then((res) => {
        setProfile(res.data);
        updateUser({ avatar: res.data.avatar ?? null });
        updateOnlineUser(res.data.id, { avatar: res.data.avatar ?? null });
      })
      .catch((err) => {
        const msg = axios.isAxiosError(err) ? err.response?.data?.error : 'Failed to upload avatar';
        setProfileError(msg || 'Failed to upload avatar');
      })
      .finally(() => setUploadingAvatar(false));
  };

  const handleRemoveAvatar = () => {
    const api = createApi();
    setUploadingAvatar(true);
    setProfileError(null);
    api.delete('/api/profile/me/avatar')
      .then((res) => {
        setProfile(res.data);
        updateUser({ avatar: res.data.avatar ?? null });
        updateOnlineUser(res.data.id, { avatar: res.data.avatar ?? null });
      })
      .catch((err) => {
        const msg = axios.isAxiosError(err) ? err.response?.data?.error : 'Failed to remove avatar';
        setProfileError(msg || 'Failed to remove avatar');
      })
      .finally(() => setUploadingAvatar(false));
  };

  const pingLabel = useMemo(() => {
    if (pingState === 'loading') return 'Measuring...';
    if (pingState === 'error') return 'Failed';
    if (pingState === 'ok' && pingMs !== null) return `${pingMs} ms`;
    return 'Not tested';
  }, [pingState, pingMs]);

  if (!activeDrawer) return null;

  return (
    <div className="fixed left-2 bottom-14 z-40 pointer-events-none">
      <div
        ref={drawerRef}
        className="w-64 rounded-lg border border-border/80 bg-bg-elevated shadow-xl pointer-events-auto quick-drawer"
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <h2 className="text-sm font-semibold text-text-primary">
            {isServerInfo ? 'Server Info' : t('profile.profile')}
          </h2>
          <button
            onClick={closeDrawer}
            className="text-text-muted hover:text-text-primary transition-colors text-lg leading-none"
            aria-label={t('common.close')}
          >
            &times;
          </button>
        </div>

        {isServerInfo && (
          <div className="p-3 space-y-3 text-sm">
            <div className="space-y-1">
              <p className="text-text-primary font-semibold">
                {serverInfo?.name ?? 'CatRealm Server'}
              </p>
              <p className="text-text-secondary">
                {getServerDescription(serverInfo?.description)}
              </p>
              {serverUrl && (
                <p className="text-xs text-text-muted">{serverUrl}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <p className="text-text-muted">Mode</p>
                <p className="text-text-secondary">{serverInfo?.mode ?? 'unknown'}</p>
              </div>
              <div>
                <p className="text-text-muted">Registration</p>
                <p className="text-text-secondary">
                  {serverInfo?.registrationOpen ? 'Open' : 'Closed'}
                </p>
              </div>
              <div>
                <p className="text-text-muted">Users Online</p>
                <p className="text-text-secondary">{serverInfo?.userCount ?? '-'}</p>
              </div>
              <div>
                <p className="text-text-muted">Version</p>
                <p className="text-text-secondary">{serverInfo?.version ?? '-'}</p>
              </div>
            </div>

            <div className="flex items-center justify-between rounded border border-border bg-bg-input px-2 py-1.5">
              <div>
                <p className="text-xs text-text-muted">Ping</p>
                <p className="text-text-secondary text-xs">{pingLabel}</p>
              </div>
              <Button variant="secondary" size="sm" onClick={handleRetest}>
                Retest
              </Button>
            </div>
          </div>
        )}

        {isProfile && (
          <div className="p-3 space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-full avatar-bg flex items-center justify-center text-white text-sm font-semibold overflow-hidden">
                <AvatarImage
                  src={resolveAvatarUrl(profile?.avatar, serverUrl, profile?.accountType)}
                  alt={profile?.username ?? 'avatar'}
                  size={40}
                  className="w-10 h-10 object-cover"
                  fallback={<span>{user?.username?.charAt(0).toUpperCase()}</span>}
                />
              </div>
              <div className="min-w-0">
                <p className="text-text-primary font-semibold truncate">
                  {(profile?.isOwner || user?.isOwner || user?.role === 'owner') && <Crown className="mr-1 inline h-4 w-4" />}
                  {user?.username ?? t('profile.unknownUser')}
                </p>
                <p className="text-xs text-text-muted">{user?.accountType ?? 'local'}</p>
              </div>
            </div>

            {profileLoading && (
              <p className="text-xs text-text-muted">{t('profile.loading')}</p>
            )}
            {profileError && (
              <p className="text-xs text-danger">{profileError}</p>
            )}

            <div className="flex items-center gap-2">
              <label className="text-xs text-text-muted">Avatar</label>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={(e) => handleAvatarChange(e.target.files?.[0] ?? null)}
                className="text-xs text-text-secondary"
              />
              {profile?.avatar && (
                <Button variant="ghost" size="sm" onClick={handleRemoveAvatar} disabled={uploadingAvatar}>
                  {t('common.remove')}
                </Button>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-xs text-text-muted">{t('profile.bio')}</label>
              <textarea
                value={bioDraft}
                onChange={(e) => setBioDraft(e.target.value)}
                rows={3}
                maxLength={500}
                className="w-full bg-bg-input border border-border rounded px-2 py-1 text-xs text-text-primary resize-none focus:outline-none focus:border-accent"
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-muted">
                  {bioDraft.length}/500
                </span>
                <Button variant="secondary" size="sm" onClick={handleSaveBio} disabled={savingBio}>
                  {savingBio ? t('common.saving') : t('common.save')}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
