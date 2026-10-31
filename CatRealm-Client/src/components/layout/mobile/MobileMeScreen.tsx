import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import {
  Bell, BookText, ChevronRight, Clock, FlaskConical, ImagePlus, Languages, LogOut, Mic, Palette, Pencil, Plus,
  Server, Shield, ShieldCheck, SlidersHorizontal, Smile, SquarePen, UserPen, Users, VenetianMask, X, type LucideIcon,
} from 'lucide-react';
import { useAuthStore } from '../../../stores/authStore';
import { useUIStore } from '../../../stores/uiStore';
import { usePresenceStore } from '../../../stores/presenceStore';
import { syncCentralProfileToJoinedServers } from '../../../stores/serverStore';
import { AvatarImage } from '../../ui/AvatarImage';
import { ImageCropModal } from '../../ui/ImageCropModal';
import { AUTH_BASE, createAuthenticatedApi } from '../../../lib/authApi';
import { createApi } from '../../../lib/api';
import { forgetKnownAccount, loadKnownAccounts, type KnownAccount } from '../../../lib/knownAccounts';
import { writeCentralPresenceCache } from '../../../lib/centralPresenceCache';
import { resolveAvatarUrl } from '../../../utils/avatar';
import { resolveDisplayName } from '../../../utils/displayName';

type Status = 'online' | 'away' | 'sleeping' | 'invisible';

const STATUSES: Array<{ value: Status; labelKey: string; selectable: boolean }> = [
  { value: 'online', labelKey: 'mobile.statusOnline', selectable: true },
  { value: 'away', labelKey: 'mobile.statusAway', selectable: true },
  { value: 'sleeping', labelKey: 'mobile.statusSleepingAuto', selectable: false },
  { value: 'invisible', labelKey: 'mobile.statusInvisible', selectable: true },
];

// Same order as the mobile app's settings list; ids are ProfileSettingsModal tabs.
const SETTINGS_ITEMS: Array<{ id: string; labelKey: string; Icon: LucideIcon; centralOnly?: boolean }> = [
  { id: 'server-profiles', labelKey: 'settings.navServerProfiles', Icon: Server, centralOnly: true },
  { id: 'account-security', labelKey: 'settings.navAccountSecurity', Icon: ShieldCheck, centralOnly: true },
  { id: 'voice', labelKey: 'settings.navVoice', Icon: Mic },
  { id: 'notifications', labelKey: 'settings.navNotifications', Icon: Bell },
  { id: 'appearance', labelKey: 'settings.navAppearance', Icon: Palette },
  { id: 'emotes-settings', labelKey: 'settings.navEmotesSettings', Icon: Smile },
  { id: 'content-social', labelKey: 'settings.navContentSocial', Icon: SlidersHorizontal },
  { id: 'time-format', labelKey: 'settings.navTimeFormat', Icon: Clock },
  { id: 'streamer-mode', labelKey: 'settings.navStreamerMode', Icon: VenetianMask },
  { id: 'language', labelKey: 'settings.navLanguage', Icon: Languages },
  { id: 'cat-lab', labelKey: 'settings.navCatLab', Icon: FlaskConical, centralOnly: true },
];

const MAX_SAVED_ACCOUNTS = 5;

function statusDotClass(status?: string | null) {
  if (status === 'away') return 'bg-warning';
  if (status === 'sleeping') return 'status-sleeping';
  if (status === 'invisible') return 'bg-text-muted';
  return 'bg-success';
}

function statusLabelKey(status?: string | null) {
  if (status === 'away') return 'mobile.statusAway';
  if (status === 'sleeping') return 'mobile.statusSleeping';
  if (status === 'invisible') return 'mobile.statusInvisible';
  return 'mobile.statusOnline';
}

function readCustomStatus(data: { customStatusText?: string | null; custom_status_text?: string | null }) {
  return data.customStatusText ?? data.custom_status_text ?? null;
}

function errorMessage(err: unknown, fallback: string) {
  return (axios.isAxiosError(err) && typeof err.response?.data?.error === 'string') ? err.response.data.error : fallback;
}

interface MobileMeScreenProps {
  onOpenNotes: () => void;
  onOpenFriends: () => void;
  /** The app hides the dock while the profile is being edited. */
  onEditModeChange: (editing: boolean) => void;
}

/**
 * You tab, mirroring the mobile app's: banner + avatar profile header with an
 * inline edit mode, profile panels, the settings list, saved accounts and
 * sign out.
 */
export function MobileMeScreen({ onOpenNotes, onOpenFriends, onEditModeChange }: MobileMeScreenProps) {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const updateUser = useAuthStore((s) => s.updateUser);
  const updateOnlineUser = usePresenceStore((s) => s.updateOnlineUser);
  const openModal = useUIStore((s) => s.openModal);
  const openFullscreenView = useUIStore((s) => s.openFullscreenView);

  const [editing, setEditing] = useState(false);
  const [displayNameDraft, setDisplayNameDraft] = useState('');
  const [statusDraft, setStatusDraft] = useState<Status>('online');
  const [customStatusDraft, setCustomStatusDraft] = useState('');
  const [bioDraft, setBioDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [cropTarget, setCropTarget] = useState<{ kind: 'avatar' | 'banner'; file: File } | null>(null);
  const [uploading, setUploading] = useState<'avatar' | 'banner' | null>(null);
  const [savedAccounts, setSavedAccounts] = useState<KnownAccount[]>(() => loadKnownAccounts());
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onEditModeChange(editing);
  }, [editing, onEditModeChange]);
  useEffect(() => () => onEditModeChange(false), [onEditModeChange]);

  if (!user) return null;

  const isCentral = user.accountType === 'central';
  const profileApi = () => (isCentral ? createAuthenticatedApi() : createApi());
  const avatarBase = isCentral ? AUTH_BASE : serverUrl;
  const displayName = resolveDisplayName(user.id, user.username, user.displayName);
  const avatarUrl = resolveAvatarUrl(user.avatar, avatarBase, user.accountType);
  const bannerUrl = user.banner ? resolveAvatarUrl(user.banner, avatarBase, user.accountType) : null;
  const activityText = user.activityType && user.activityType !== 'Custom' && user.activityText
    ? `${user.activityType} ${user.activityText}`
    : null;
  const otherAccounts = savedAccounts.filter((account) => account.id !== user.id);

  const enterEditMode = () => {
    setDisplayNameDraft(user.displayName ?? '');
    setStatusDraft((user.status as Status | undefined) ?? 'online');
    setCustomStatusDraft(user.customStatusText ?? '');
    setBioDraft(user.bio ?? '');
    setMessage(null);
    setEditing(true);
  };

  const saveProfile = async () => {
    setSaving(true);
    setMessage(null);
    const api = profileApi();
    try {
      const nextDisplayName = displayNameDraft.trim();
      const nameRes = await (nextDisplayName
        ? api.put('/api/profile/me/display-name', { displayName: nextDisplayName })
        : api.delete('/api/profile/me/display-name'));
      const resolvedDisplayName = nameRes.data.displayName ?? nameRes.data.display_name ?? null;

      const bioRes = await api.put('/api/profile/me', { bio: bioDraft.trim() });

      const statusChanged = statusDraft !== user.status && statusDraft !== 'sleeping';
      const statusRes = statusChanged ? await api.put('/api/profile/me/status', { status: statusDraft }) : null;

      const nextCustomStatus = customStatusDraft.trim();
      const customChanged = nextCustomStatus !== (user.customStatusText ?? '');
      const customRes = customChanged
        ? await (nextCustomStatus
          ? api.put('/api/profile/me/custom-status', { customStatusText: nextCustomStatus })
          : api.delete('/api/profile/me/custom-status'))
        : null;
      const resolvedCustomStatus = customRes ? readCustomStatus(customRes.data) : user.customStatusText ?? null;

      const patch = {
        displayName: resolvedDisplayName,
        bio: bioRes.data.bio ?? null,
        ...(statusRes ? { status: statusRes.data.status } : {}),
        ...(customRes ? { customStatusText: resolvedCustomStatus } : {}),
      };
      updateUser(patch);
      updateOnlineUser(user.id, patch);
      if (isCentral) {
        writeCentralPresenceCache(user.id, {
          ...(statusRes ? { status: statusRes.data.status } : {}),
          ...(customRes ? { customStatusText: resolvedCustomStatus } : {}),
        });
        // Mirror presence to the connected realm the way Settings does.
        if (serverUrl) {
          const realmApi = createApi();
          if (statusRes) {
            realmApi.put('/api/profile/me/status', { status: statusRes.data.status })
              .then((res) => updateOnlineUser(res.data.id, { status: res.data.status }))
              .catch(() => {});
          }
          if (customRes) {
            (resolvedCustomStatus
              ? realmApi.put('/api/profile/me/custom-status', { customStatusText: resolvedCustomStatus })
              : realmApi.delete('/api/profile/me/custom-status')
            ).catch(() => {});
          }
        }
        void syncCentralProfileToJoinedServers();
      }
      setEditing(false);
    } catch (err) {
      setMessage(errorMessage(err, t('mobile.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  const uploadMedia = async (kind: 'avatar' | 'banner', file: File) => {
    setUploading(kind);
    setMessage(null);
    try {
      const form = new FormData();
      form.append(kind, file);
      const res = await profileApi().post(`/api/profile/me/${kind}`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const value = res.data[kind] ?? null;
      updateUser({ [kind]: value });
      updateOnlineUser(user.id, { [kind]: value });
      if (isCentral) void syncCentralProfileToJoinedServers();
    } catch (err) {
      setMessage(errorMessage(err, t('mobile.uploadFailed')));
    } finally {
      setUploading(null);
    }
  };

  const pickFile = (kind: 'avatar' | 'banner') => (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) setCropTarget({ kind, file });
    event.currentTarget.value = '';
  };

  const removeSavedAccount = (id: string) => {
    forgetKnownAccount(id);
    setSavedAccounts(loadKnownAccounts());
  };

  const panel = (children: ReactNode, className = '') => (
    <div className={`rounded-2xl bg-bg-elevated border border-border/60 p-4 ${className}`}>{children}</div>
  );
  const label = (text: string, editable = false) => (
    <div className="mb-2 flex items-center justify-between">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">{text}</span>
      {editable && <Pencil className="w-3.5 h-3.5 text-text-muted" />}
    </div>
  );
  const inputClass = 'w-full rounded-xl bg-bg-input border border-border px-3 py-2.5 text-[15px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent';
  const row = (Icon: LucideIcon, text: string, onClick: () => void, key?: string) => (
    <button
      key={key ?? text}
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3.5 px-4 py-3.5 text-left text-text-secondary hover:bg-bg-hover/60 transition-colors"
    >
      <Icon className="w-[18px] h-[18px] shrink-0" />
      <span className="flex-1 text-[15px] font-semibold">{text}</span>
      <ChevronRight className="w-[18px] h-[18px] text-text-muted shrink-0" />
    </button>
  );

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-bg-primary">
      <input ref={avatarInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={pickFile('avatar')} />
      <input ref={bannerInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={pickFile('banner')} />

      {/* Banner — tap to change while editing */}
      <button
        type="button"
        disabled={!editing || !!uploading}
        onClick={() => bannerInputRef.current?.click()}
        className="relative block w-full h-36 overflow-hidden bg-bg-sidebar border-b border-border disabled:cursor-default"
      >
        {bannerUrl
          ? <img src={bannerUrl} alt="" className="h-full w-full object-cover" />
          : <div className="h-full w-full bg-gradient-to-br from-accent/35 to-bg-deepest" />}
        {editing && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
            {uploading === 'banner' ? <span className="text-sm">{t('mobile.uploading')}</span> : <ImagePlus className="w-6 h-6" />}
          </span>
        )}
      </button>

      <div className="px-4 pb-8">
        {/* Avatar + name */}
        <div className="flex items-end gap-3 -mt-12">
          <button
            type="button"
            disabled={!editing || !!uploading}
            onClick={() => avatarInputRef.current?.click()}
            className="relative shrink-0 w-[104px] h-[104px] rounded-full border-4 border-bg-primary bg-bg-elevated disabled:cursor-default"
          >
            <AvatarImage
              src={avatarUrl}
              alt={displayName}
              size={96}
              className="w-24 h-24 rounded-full object-cover"
              fallback={<span className="text-3xl font-semibold">{displayName.charAt(0).toUpperCase()}</span>}
            />
            {!editing && (
              <span className="absolute bottom-1 right-1 flex rounded-full border-4 border-bg-primary">
                <span className={`block w-3.5 h-3.5 rounded-full ${statusDotClass(user.status)}`} />
              </span>
            )}
            {editing && (
              <span className="absolute bottom-0.5 right-0.5 w-8 h-8 rounded-full bg-accent text-white flex items-center justify-center border-2 border-bg-primary">
                {uploading === 'avatar' ? <span className="text-[10px]">…</span> : <SquarePen className="w-4 h-4" />}
              </span>
            )}
          </button>
        </div>
        <div className="mt-2 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-xl font-bold text-text-primary truncate">{displayName}</p>
            <p className="text-sm text-text-muted truncate">@{user.username}</p>
            {user.status && (
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-text-muted">
                <span className={`inline-block w-2 h-2 rounded-full ${statusDotClass(user.status)}`} />
                {t(statusLabelKey(user.status))}
              </p>
            )}
          </div>
          {!editing && (
            <button
              type="button"
              onClick={enterEditMode}
              className="shrink-0 w-10 h-10 rounded-xl bg-bg-elevated border border-border/60 text-text-secondary hover:text-text-primary flex items-center justify-center"
              aria-label={t('mobile.editProfile')}
            >
              <UserPen className="w-[18px] h-[18px]" />
            </button>
          )}
        </div>

        <div className="mt-5 flex flex-col gap-3">
          {editing ? (
            <>
              {panel(<>
                {label(t('mobile.displayName'), true)}
                <input
                  value={displayNameDraft}
                  onChange={(e) => setDisplayNameDraft(e.target.value)}
                  placeholder={user.username}
                  maxLength={32}
                  className={inputClass}
                />
              </>)}
              {panel(<>
                {label(t('mobile.status'), true)}
                <div className="grid grid-cols-2 gap-2">
                  {STATUSES.map(({ value, labelKey, selectable }) => {
                    const active = statusDraft === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        disabled={!selectable}
                        onClick={() => setStatusDraft(value)}
                        className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm transition-colors disabled:opacity-60 ${
                          active ? 'border-accent bg-accent/15 text-accent' : 'border-border text-text-secondary'
                        }`}
                      >
                        <span className={`inline-block w-2 h-2 rounded-full ${statusDotClass(value)}`} />
                        {t(labelKey)}
                      </button>
                    );
                  })}
                </div>
              </>)}
              {panel(<>
                {label(t('mobile.customStatus'), true)}
                <input
                  value={customStatusDraft}
                  onChange={(e) => setCustomStatusDraft(e.target.value)}
                  placeholder={t('mobile.customStatusPlaceholder')}
                  maxLength={128}
                  className={inputClass}
                />
              </>)}
              {panel(<>
                {label(t('mobile.bio'), true)}
                <textarea
                  value={bioDraft}
                  onChange={(e) => setBioDraft(e.target.value)}
                  placeholder={t('mobile.bioPlaceholder')}
                  maxLength={500}
                  rows={4}
                  className={`${inputClass} resize-none`}
                />
                <p className="mt-2 text-right text-xs text-text-muted">{bioDraft.length}/500</p>
              </>)}
              {message && <p className="text-sm text-danger">{message}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  disabled={saving}
                  className="flex-1 rounded-xl bg-bg-elevated border border-border py-3 text-[15px] font-semibold text-text-secondary"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => void saveProfile()}
                  disabled={saving}
                  className="flex-1 rounded-xl bg-accent py-3 text-[15px] font-semibold text-white disabled:opacity-60"
                >
                  {saving ? t('common.saving') : t('common.save')}
                </button>
              </div>
            </>
          ) : (
            <>
              {user.customStatusText && panel(<>
                {label(t('mobile.customStatus'))}
                <p className="text-[15px] text-text-primary break-words">{user.customStatusText}</p>
              </>)}
              {activityText && panel(<>
                {label(t('mobile.activity'))}
                <p className="text-[15px] text-text-primary break-words">{activityText}</p>
              </>)}
              {panel(<>
                {label(t('mobile.bio'))}
                <p className={`text-[15px] whitespace-pre-wrap break-words ${user.bio?.trim() ? 'text-text-secondary' : 'text-text-muted'}`}>
                  {user.bio?.trim() || t('mobile.noBio')}
                </p>
              </>)}
              {panel(<>
                {label(t('mobile.account'))}
                <div className="flex justify-between gap-3 py-1 text-sm">
                  <span className="text-text-muted">{t('mobile.accountType')}</span>
                  <span className="text-text-secondary">{isCentral ? t('mobile.typeCentral') : t('mobile.typeLocal')}</span>
                </div>
                {serverUrl && (
                  <div className="flex justify-between gap-3 py-1 text-sm">
                    <span className="text-text-muted shrink-0">{t('mobile.server')}</span>
                    <span className="text-text-secondary truncate">{serverUrl}</span>
                  </div>
                )}
              </>)}
              {message && <p className="text-sm text-danger">{message}</p>}

              {/* Settings — each row opens Settings at that section */}
              <div className="mt-2 overflow-hidden rounded-2xl bg-bg-elevated border border-border/60 divide-y divide-border/50">
                {SETTINGS_ITEMS
                  .filter((item) => isCentral || !item.centralOnly)
                  .map(({ id, labelKey, Icon }) => row(Icon, t(labelKey), () => openModal('profileSettings', { initialTab: id }), id))}
              </div>

              <div className="overflow-hidden rounded-2xl bg-bg-elevated border border-border/60 divide-y divide-border/50">
                {isCentral && row(Users, t('nav.friends'), onOpenFriends)}
                {row(BookText, t('nav.myNotes'), onOpenNotes)}
                {row(UserPen, t('mobile.socialProfile'), () => openFullscreenView('socialProfileEditor'))}
                {row(Shield, t('mobile.privacySummary'), () => openModal('privacySummary'))}
              </div>

              {/* Saved accounts */}
              {isCentral && (
                <div className="overflow-hidden rounded-2xl bg-bg-elevated border border-border/60">
                  <div className="px-4 pt-3 pb-2 border-b border-border/50">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">{t('mobile.accounts')}</span>
                  </div>
                  {[{ id: user.id, username: user.username, displayName: user.displayName ?? null, avatar: user.avatar ?? null }, ...otherAccounts]
                    .map((account) => {
                      const isActive = account.id === user.id;
                      return (
                        <div
                          key={account.id}
                          className={`flex items-center gap-3 px-4 py-2.5 border-b border-border/40 last:border-b-0 ${isActive ? 'bg-accent/10' : ''}`}
                        >
                          <button
                            type="button"
                            disabled={isActive}
                            onClick={() => openModal('confirmLogout', { mode: 'switch', username: account.username })}
                            className="flex-1 min-w-0 flex items-center gap-3 text-left disabled:cursor-default"
                          >
                            <AvatarImage
                              src={resolveAvatarUrl(account.avatar, AUTH_BASE, 'central')}
                              alt={account.username}
                              size={32}
                              className="w-8 h-8 rounded-full object-cover shrink-0"
                              fallback={<span className="text-sm font-semibold">{account.username.charAt(0).toUpperCase()}</span>}
                            />
                            <span className="min-w-0 flex-1">
                              <span className={`block truncate text-sm font-medium ${isActive ? 'text-accent' : 'text-text-secondary'}`}>@{account.username}</span>
                              {account.displayName && <span className="block truncate text-xs text-text-muted">{account.displayName}</span>}
                            </span>
                            <span className={`shrink-0 text-xs ${isActive ? 'text-accent' : 'text-text-muted'}`}>
                              {isActive ? t('mobile.active') : t('mobile.tapToSwitch')}
                            </span>
                          </button>
                          {!isActive && (
                            <button
                              type="button"
                              onClick={() => removeSavedAccount(account.id)}
                              className="shrink-0 p-1.5 rounded-lg text-text-muted hover:text-danger"
                              aria-label={t('mobile.removeAccount', { username: account.username })}
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  {otherAccounts.length + 1 < MAX_SAVED_ACCOUNTS && (
                    <button
                      type="button"
                      onClick={() => openModal('confirmLogout', { mode: 'switch', username: '' })}
                      className="w-full flex items-center gap-2 px-4 py-3 border-t border-border/50 text-sm font-medium text-accent hover:bg-bg-hover/60"
                    >
                      <Plus className="w-4 h-4" />
                      {t('mobile.addAccount')}
                    </button>
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={() => openModal('confirmLogout')}
                className="flex items-center justify-center gap-2 rounded-2xl bg-bg-elevated border border-border/60 py-3.5 text-[15px] font-semibold text-danger hover:bg-danger/10"
              >
                <LogOut className="w-[18px] h-[18px]" />
                {t('mobile.logOut')}
              </button>
            </>
          )}
        </div>
      </div>

      <ImageCropModal
        isOpen={!!cropTarget}
        file={cropTarget?.file ?? null}
        title={cropTarget?.kind === 'banner' ? t('mobile.cropBanner') : t('mobile.cropAvatar')}
        aspectRatio={cropTarget?.kind === 'banner' ? 8 / 3 : 1}
        outputWidth={cropTarget?.kind === 'banner' ? 1600 : 512}
        outputHeight={cropTarget?.kind === 'banner' ? 600 : 512}
        shape={cropTarget?.kind === 'banner' ? 'rect' : 'circle'}
        busy={!!uploading}
        onCancel={() => setCropTarget(null)}
        onConfirm={(file) => {
          const kind = cropTarget?.kind;
          setCropTarget(null);
          if (kind) void uploadMedia(kind, file);
        }}
      />
    </div>
  );
}
