import { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2, ChevronDown, ChevronRight, X, Plus, ShieldCheck } from 'lucide-react';
import type { ContentSocialPrefsPayload } from './settingsTypes';
import { useServerStore } from '../../../stores/serverStore';
import { useAuthStore } from '../../../stores/authStore';
import { useDMStore } from '../../../stores/dmStore';
import { useMessageStore } from '../../../stores/messageStore';
import { resolveAvatarUrl } from '../../../utils/avatar';
import { AUTH_BASE } from '../../../lib/authApi';
import { RADIO_TRACK_TITLE, RADIO_TRACK_URL } from '../../../lib/catRealmRadio';
import { clearRadioCache, getRadioCacheBytes } from '../../../lib/radioCache';
import { LOCKED_ALLOWED_DOMAINS, normalizeAllowedDomain } from '../../../utils/domainAllowlist';

type ContentSocialTabProps = {
  allowNsfw: boolean;
  setAllowNsfw: (v: boolean) => void;
  nsfwLewds: boolean;
  setNsfwLewds: (v: boolean) => void;
  nsfwBlood: boolean;
  setNsfwBlood: (v: boolean) => void;
  nsfwGore: boolean;
  setNsfwGore: (v: boolean) => void;
  dmFilter: 'all' | 'non-friends' | 'none';
  setDmFilter: (v: 'all' | 'non-friends' | 'none') => void;
  allowDms: boolean;
  setAllowDms: (v: boolean) => void;
  frEveryone: boolean;
  setFrEveryone: (v: boolean) => void;
  frFriendOfFriends: boolean;
  setFrFriendOfFriends: (v: boolean) => void;
  frServerMembers: boolean;
  setFrServerMembers: (v: boolean) => void;
  customAllowedDomains: string[];
  setCustomAllowedDomains: (v: string[]) => void;
  saveContentSocialPreferences: (overrides?: Partial<ContentSocialPrefsPayload>) => void;
};

export function ContentSocialTab(props: ContentSocialTabProps) {
  const { t } = useTranslation();
  const {
    allowNsfw,
    setAllowNsfw,
    nsfwLewds,
    setNsfwLewds,
    nsfwBlood,
    setNsfwBlood,
    nsfwGore,
    setNsfwGore,
    dmFilter,
    setDmFilter,
    allowDms,
    setAllowDms,
    frEveryone,
    setFrEveryone,
    frFriendOfFriends,
    setFrFriendOfFriends,
    frServerMembers,
    setFrServerMembers,
    customAllowedDomains,
    setCustomAllowedDomains,
    saveContentSocialPreferences,
  } = props;
  const [domainDraft, setDomainDraft] = useState('');
  const [domainError, setDomainError] = useState<string | null>(null);

  const addCustomDomain = () => {
    const domain = normalizeAllowedDomain(domainDraft);
    if (!domain) {
      setDomainError('Enter a valid domain, like example.com.');
      return;
    }
    if (LOCKED_ALLOWED_DOMAINS.includes(domain as typeof LOCKED_ALLOWED_DOMAINS[number])) {
      setDomainError(`${domain} is already in the locked default list.`);
      return;
    }
    if (customAllowedDomains.includes(domain)) {
      setDomainError(`${domain} is already allowed.`);
      return;
    }

    const next = [...customAllowedDomains, domain].sort();
    setCustomAllowedDomains(next);
    saveContentSocialPreferences({ customAllowedDomains: next });
    setDomainDraft('');
    setDomainError(null);
  };

  const removeCustomDomain = (domain: string) => {
    const next = customAllowedDomains.filter((item) => item !== domain);
    setCustomAllowedDomains(next);
    saveContentSocialPreferences({ customAllowedDomains: next });
  };

  return (
    <div className="space-y-8 max-w-2xl">
      {/* Content Section */}
      <div className="space-y-4">
        <h3 className="text-xl font-bold text-text-primary">{t('settingsContent.content')}</h3>

        <div className="bg-yellow-900/20 border border-yellow-600/30 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-yellow-300 mb-2">{t('settingsContent.nsfwFilters')}</h4>
          <p className="text-xs text-yellow-200/80">
            {t('settingsContent.nsfwFiltersDesc')}
          </p>
        </div>

        <div className="flex items-center justify-between bg-bg-hover/30 p-4 rounded-lg">
          <div>
            <p className="text-sm font-medium text-text-primary">{t('settingsContent.allowNsfw')}</p>
            <p className="text-xs text-text-muted">{t('settingsContent.allowNsfwDesc')}</p>
          </div>
          <label className="inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={allowNsfw}
              onChange={(e) => {
                const next = e.target.checked;
                setAllowNsfw(next);
                saveContentSocialPreferences({ allowNsfw: next });
              }}
              className="sr-only"
            />
            <span className={`w-12 h-6 rounded-full transition-colors ${allowNsfw ? 'bg-accent' : 'bg-bg-hover'} relative`}>
              <span className={`absolute top-1 ${allowNsfw ? 'left-7' : 'left-1'} w-4 h-4 rounded-full bg-white transition-all`} />
            </span>
          </label>
        </div>

        <div className="space-y-3 pl-4 border-l-2 border-border">
          <h4 className="text-sm font-semibold text-text-secondary">{t('settingsContent.nsfwComfort')}</h4>
          <p className="text-xs text-text-muted">{t('settingsContent.nsfwComfortDesc')}</p>

          <div className="flex items-center justify-between bg-bg-hover/30 p-3 rounded-lg">
            <div>
              <p className="text-sm font-medium text-text-primary">{t('settingsContent.nsfwLewds')}</p>
              <p className="text-xs text-text-muted">{t('settingsContent.nsfwLewdsDesc')}</p>
            </div>
            <label className="inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={nsfwLewds}
                onChange={(e) => {
                  const next = e.target.checked;
                  setNsfwLewds(next);
                  saveContentSocialPreferences({ nsfwLewds: next });
                }}
                className="sr-only"
              />
              <span className={`w-12 h-6 rounded-full transition-colors ${nsfwLewds ? 'bg-accent' : 'bg-bg-hover'} relative`}>
                <span className={`absolute top-1 ${nsfwLewds ? 'left-7' : 'left-1'} w-4 h-4 rounded-full bg-white transition-all`} />
              </span>
            </label>
          </div>

          <div className="flex items-center justify-between bg-bg-hover/30 p-3 rounded-lg">
            <div>
              <p className="text-sm font-medium text-text-primary">{t('settingsContent.nsfwBlood')}</p>
              <p className="text-xs text-text-muted">{t('settingsContent.nsfwBloodDesc')}</p>
            </div>
            <label className="inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={nsfwBlood}
                onChange={(e) => {
                  const next = e.target.checked;
                  setNsfwBlood(next);
                  saveContentSocialPreferences({ nsfwBlood: next });
                }}
                className="sr-only"
              />
              <span className={`w-12 h-6 rounded-full transition-colors ${nsfwBlood ? 'bg-accent' : 'bg-bg-hover'} relative`}>
                <span className={`absolute top-1 ${nsfwBlood ? 'left-7' : 'left-1'} w-4 h-4 rounded-full bg-white transition-all`} />
              </span>
            </label>
          </div>

          <div className="flex items-center justify-between bg-bg-hover/30 p-3 rounded-lg">
            <div>
              <p className="text-sm font-medium text-text-primary">{t('settingsContent.nsfwGore')}</p>
              <p className="text-xs text-text-muted">{t('settingsContent.nsfwGoreDesc')}</p>
            </div>
            <label className="inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={nsfwGore}
                onChange={(e) => {
                  const next = e.target.checked;
                  setNsfwGore(next);
                  saveContentSocialPreferences({ nsfwGore: next });
                }}
                className="sr-only"
              />
              <span className={`w-12 h-6 rounded-full transition-colors ${nsfwGore ? 'bg-accent' : 'bg-bg-hover'} relative`}>
                <span className={`absolute top-1 ${nsfwGore ? 'left-7' : 'left-1'} w-4 h-4 rounded-full bg-white transition-all`} />
              </span>
            </label>
          </div>
        </div>
      </div>

      {/* DMs & Spam Filters Section */}
      <div className="space-y-4">
        <h3 className="text-xl font-bold text-text-primary">{t('settingsContent.dmsSpamFilters')}</h3>
        <p className="text-xs text-text-muted">Applies to new conversations. Existing conversations and accepted requests stay accepted. Pending requests allow one introductory message and can be reviewed in Home → Message requests.</p>

        <div className="space-y-2">
          <label className="flex items-center gap-3 p-3 bg-bg-hover/30 rounded-lg cursor-pointer hover:bg-bg-hover/50">
            <input
              type="radio"
              name="dmFilter"
              value="all"
              checked={dmFilter === 'all'}
              onChange={() => {
                setDmFilter('all');
                saveContentSocialPreferences({ dmFilter: 'all' });
              }}
              className="w-4 h-4"
            />
            <div>
              <p className="text-sm font-medium text-text-primary">{t('settingsContent.filterAll')}</p>
              <p className="text-xs text-text-muted">{t('settingsContent.filterAllDesc')}</p>
            </div>
          </label>

          <label className="flex items-center gap-3 p-3 bg-bg-hover/30 rounded-lg cursor-pointer hover:bg-bg-hover/50">
            <input
              type="radio"
              name="dmFilter"
              value="non-friends"
              checked={dmFilter === 'non-friends'}
              onChange={() => {
                setDmFilter('non-friends');
                saveContentSocialPreferences({ dmFilter: 'non-friends' });
              }}
              className="w-4 h-4"
            />
            <div>
              <p className="text-sm font-medium text-text-primary">{t('settingsContent.filterNonFriends')}</p>
              <p className="text-xs text-text-muted">{t('settingsContent.filterNonFriendsDesc')}</p>
            </div>
          </label>

          <label className="flex items-center gap-3 p-3 bg-bg-hover/30 rounded-lg cursor-pointer hover:bg-bg-hover/50">
            <input
              type="radio"
              name="dmFilter"
              value="none"
              checked={dmFilter === 'none'}
              onChange={() => {
                setDmFilter('none');
                saveContentSocialPreferences({ dmFilter: 'none' });
              }}
              className="w-4 h-4"
            />
            <div>
              <p className="text-sm font-medium text-text-primary">{t('settingsContent.doNotFilter')}</p>
              <p className="text-xs text-text-muted">{t('settingsContent.doNotFilterDesc')}</p>
            </div>
          </label>
        </div>
      </div>

      {/* Social Permissions Section */}
      <div className="space-y-4">
        <h3 className="text-xl font-bold text-text-primary">{t('settingsContent.socialPermissions')}</h3>
        <p className="text-xs text-text-muted">Shared-server eligibility uses matching, approved realm registrations on central, not a live membership check. Disable shared-server permissions if you do not want those registrations to allow new contact.</p>

        <div className="flex items-center justify-between bg-bg-hover/30 p-4 rounded-lg">
          <div>
            <p className="text-sm font-medium text-text-primary">{t('settingsContent.directMessages')}</p>
            <p className="text-xs text-text-muted">{t('settingsContent.directMessagesSocialDesc')}</p>
          </div>
          <label className="inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={allowDms}
              onChange={(e) => {
                const next = e.target.checked;
                setAllowDms(next);
                saveContentSocialPreferences({ allowDms: next });
              }}
              className="sr-only"
            />
            <span className={`w-12 h-6 rounded-full transition-colors ${allowDms ? 'bg-accent' : 'bg-bg-hover'} relative`}>
              <span className={`absolute top-1 ${allowDms ? 'left-7' : 'left-1'} w-4 h-4 rounded-full bg-white transition-all`} />
            </span>
          </label>
        </div>
      </div>

      {/* Friend Requests Section */}
      <div className="space-y-4">
        <h3 className="text-xl font-bold text-text-primary">{t('settingsContent.friendRequests')}</h3>

        <div className="flex items-center justify-between bg-bg-hover/30 p-4 rounded-lg">
          <div>
            <p className="text-sm font-medium text-text-primary">{t('settingsContent.everyone')}</p>
            <p className="text-xs text-text-muted">{t('settingsContent.everyoneDesc')}</p>
          </div>
          <label className="inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={frEveryone}
              onChange={(e) => {
                const next = e.target.checked;
                setFrEveryone(next);
                saveContentSocialPreferences({ frEveryone: next });
              }}
              className="sr-only"
            />
            <span className={`w-12 h-6 rounded-full transition-colors ${frEveryone ? 'bg-accent' : 'bg-bg-hover'} relative`}>
              <span className={`absolute top-1 ${frEveryone ? 'left-7' : 'left-1'} w-4 h-4 rounded-full bg-white transition-all`} />
            </span>
          </label>
        </div>

        <div className="flex items-center justify-between bg-bg-hover/30 p-4 rounded-lg">
          <div>
            <p className="text-sm font-medium text-text-primary">{t('settingsContent.friendOfFriends')}</p>
            <p className="text-xs text-text-muted">{t('settingsContent.friendOfFriendsDesc')}</p>
          </div>
          <label className="inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={frFriendOfFriends}
              onChange={(e) => {
                const next = e.target.checked;
                setFrFriendOfFriends(next);
                saveContentSocialPreferences({ frFriendOfFriends: next });
              }}
              className="sr-only"
            />
            <span className={`w-12 h-6 rounded-full transition-colors ${frFriendOfFriends ? 'bg-accent' : 'bg-bg-hover'} relative`}>
              <span className={`absolute top-1 ${frFriendOfFriends ? 'left-7' : 'left-1'} w-4 h-4 rounded-full bg-white transition-all`} />
            </span>
          </label>
        </div>

        <div className="flex items-center justify-between bg-bg-hover/30 p-4 rounded-lg">
          <div>
            <p className="text-sm font-medium text-text-primary">{t('settingsContent.serverMembers')}</p>
            <p className="text-xs text-text-muted">{t('settingsContent.serverMembersDesc')}</p>
          </div>
          <label className="inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={frServerMembers}
              onChange={(e) => {
                const next = e.target.checked;
                setFrServerMembers(next);
                saveContentSocialPreferences({ frServerMembers: next });
              }}
              className="sr-only"
            />
            <span className={`w-12 h-6 rounded-full transition-colors ${frServerMembers ? 'bg-accent' : 'bg-bg-hover'} relative`}>
              <span className={`absolute top-1 ${frServerMembers ? 'left-7' : 'left-1'} w-4 h-4 rounded-full bg-white transition-all`} />
            </span>
          </label>
        </div>
      </div>

      {/* Link Protection Section */}
      <div className="space-y-4">
        <div>
          <h3 className="text-xl font-bold text-text-primary">Custom Allowed Domains</h3>
          <p className="text-sm text-text-muted mt-1">
            Links outside the locked defaults and your custom domains are blocked before redirecting.
          </p>
        </div>

        <div className="bg-bg-hover/30 p-4 rounded-lg space-y-3">
          <div className="flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-accent shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-text-primary">Locked default domains</p>
              <p className="text-xs text-text-muted">These popular social domains and CatRealm invite links are always allowed.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {LOCKED_ALLOWED_DOMAINS.map((domain) => (
              <span key={domain} className="rounded-full border border-border bg-bg-input px-2.5 py-1 text-xs text-text-secondary">
                {domain}
              </span>
            ))}
          </div>
        </div>

        <div className="bg-bg-hover/30 p-4 rounded-lg space-y-3">
          <div>
            <p className="text-sm font-medium text-text-primary">Add a custom domain</p>
            <p className="text-xs text-text-muted">Allow a domain and its subdomains. Use the domain only, not a full path.</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={domainDraft}
              onChange={(e) => {
                setDomainDraft(e.target.value);
                setDomainError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addCustomDomain();
                }
              }}
              placeholder="example.com"
              className="flex-1 rounded border border-border bg-bg-input px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={addCustomDomain}
              className="inline-flex items-center justify-center gap-2 rounded bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Domain
            </button>
          </div>
          {domainError && <p className="text-xs text-red-400">{domainError}</p>}

          <div className="space-y-2">
            {customAllowedDomains.length > 0 ? (
              customAllowedDomains.map((domain) => (
                <div key={domain} className="flex items-center justify-between gap-3 rounded border border-border bg-bg-input px-3 py-2">
                  <span className="text-sm text-text-primary break-all">{domain}</span>
                  <button
                    type="button"
                    onClick={() => removeCustomDomain(domain)}
                    className="p-1.5 rounded text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    aria-label={`Remove ${domain}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            ) : (
              <p className="rounded border border-border bg-bg-input px-3 py-2 text-sm text-text-muted">
                No custom domains allowed yet.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Cat Cache Section */}
      <CatCacheSection />

      {/* Blocked Accounts Section */}
      <div className="space-y-4">
        <h3 className="text-xl font-bold text-text-primary">{t('settingsContent.blockedAccounts')}</h3>
        <p className="text-sm text-text-muted">{t('settingsContent.blockedAccountsDesc')}</p>

        <div className="bg-bg-hover/30 p-4 rounded-lg text-center text-sm text-text-muted">
          {t('settingsContent.noBlockedUsers')}
        </div>
      </div>
    </div>
  );
}

// ── Cat Cache ─────────────────────────────────────────────────────────────────

interface CachedImage {
  url: string;
  label: string;
  shape: 'circle' | 'square' | 'rect';
}

interface CacheCategory {
  id: string;
  label: string;
  description: string;
  images: CachedImage[];
}

function CacheLightbox({ image, onClose }: { image: CachedImage; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
      <div
        className="relative flex flex-col items-center gap-3 p-4 max-w-xl w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute -top-1 right-0 w-8 h-8 flex items-center justify-center rounded-full bg-bg-sidebar text-text-muted hover:text-text-primary transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
        <img
          src={image.url}
          alt={image.label}
          className="max-w-full max-h-[70vh] object-contain rounded-lg shadow-2xl"
          draggable={false}
        />
        <p className="text-sm text-white/70 truncate max-w-full px-4 text-center">{image.label}</p>
      </div>
    </div>
  );
}

function CacheTreeNode({ category, imgBust }: { category: CacheCategory; imgBust: number }) {
  const [open, setOpen] = useState(true);
  const [lightbox, setLightbox] = useState<CachedImage | null>(null);

  return (
    <>
      <div className="border border-border rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="w-full flex items-center gap-2 px-4 py-3 bg-bg-hover/30 hover:bg-bg-hover/50 transition-colors text-left"
        >
          {open
            ? <ChevronDown className="w-4 h-4 text-text-muted shrink-0" />
            : <ChevronRight className="w-4 h-4 text-text-muted shrink-0" />
          }
          <span className="text-sm font-semibold text-text-primary flex-1">{category.label}</span>
          <span className="text-xs text-text-muted bg-bg-hover px-2 py-0.5 rounded-full">
            {category.images.length}
          </span>
        </button>

        {open && (
          <div className="p-4 space-y-3 bg-bg-chat">
            <p className="text-xs text-text-muted">{category.description}</p>
            {category.images.length > 0 ? (
              <div className="flex flex-wrap gap-3">
                {category.images.map((img) => (
                  <button
                    key={`${img.url}-${imgBust}`}
                    type="button"
                    title={img.label}
                    onClick={() => setLightbox(img)}
                    className="flex flex-col items-center gap-1 group focus:outline-none"
                  >
                    <div className={`overflow-hidden bg-bg-hover ring-2 ring-transparent group-hover:ring-accent transition-all ${
                      img.shape === 'circle'
                        ? 'w-12 h-12 rounded-full'
                        : img.shape === 'square'
                          ? 'w-12 h-12 rounded-lg'
                          : 'w-20 h-12 rounded-md'
                    }`}>
                      <img
                        src={img.url}
                        alt={img.label}
                        className="w-full h-full object-cover"
                        draggable={false}
                      />
                    </div>
                    <span className="text-xs text-text-muted max-w-[80px] truncate text-center leading-tight group-hover:text-text-primary transition-colors">
                      {img.label}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-text-muted italic">Nothing cached in this category yet.</p>
            )}
          </div>
        )}
      </div>

      {lightbox && (
        <CacheLightbox image={lightbox} onClose={() => setLightbox(null)} />
      )}
    </>
  );
}

function RadioCacheRow() {
  const [bytes, setBytes] = useState<number | null>(null);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getRadioCacheBytes(RADIO_TRACK_URL).then((b) => { if (!cancelled) setBytes(b); });
    return () => { cancelled = true; };
  }, []);

  const handleRemove = useCallback(async () => {
    setRemoving(true);
    await clearRadioCache();
    setBytes(null);
    setRemoving(false);
  }, []);

  return (
    <div className="flex items-center gap-3 px-4 py-3 border border-border rounded-lg bg-bg-hover/30">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-text-primary">CatRealm Radio</p>
        <p className="text-xs text-text-muted">
          {bytes != null
            ? `${RADIO_TRACK_TITLE} is saved on this device (${Math.round(bytes / 1024 / 1024)} MB), so it plays without streaming.`
            : `Not saved yet. ${RADIO_TRACK_TITLE} downloads in the background after a minute of listening.`}
        </p>
      </div>
      {bytes != null && (
        <button
          type="button"
          onClick={handleRemove}
          disabled={removing}
          className="shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-600/20 border border-red-600/40 text-red-400 hover:bg-red-600/30 hover:text-red-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium"
        >
          <Trash2 className="w-4 h-4" />
          {removing ? 'Removing…' : 'Remove'}
        </button>
      )}
    </div>
  );
}

function CatCacheSection() {
  const servers = useServerStore((s) => s.servers);
  const user = useAuthStore((s) => s.user);
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const conversations = useDMStore((s) => s.conversations);
  const dmMessages = useDMStore((s) => s.messagesByConversation);
  const channelMessages = useMessageStore((s) => s.messagesByChannel);

  const [purging, setPurging] = useState(false);
  const [purged, setPurged] = useState(false);
  const [imgBust, setImgBust] = useState(0);

  const categories = useMemo<CacheCategory[]>(() => {
    const appBase = new URL('./', document.baseURI).href.replace(/\/$/, '');

    // ── Avatars ──────────────────────────────────────────────────────────────
    const avatars: CachedImage[] = [];

    if (user?.avatar) {
      const url = resolveAvatarUrl(user.avatar, serverUrl, user.accountType as 'local' | 'central');
      if (url) avatars.push({ url, label: 'Your avatar', shape: 'circle' });
    }

    for (const server of servers) {
      if (server.icon) {
        avatars.push({ url: server.icon, label: server.name, shape: 'circle' });
      }
    }

    const seenAvatars = new Set<string>();
    for (const conv of conversations) {
      if (!conv.otherAvatar || seenAvatars.has(conv.otherAvatar)) continue;
      seenAvatars.add(conv.otherAvatar);
      const url = /^https?:\/\//i.test(conv.otherAvatar)
        ? conv.otherAvatar
        : `${AUTH_BASE}${conv.otherAvatar}`;
      avatars.push({ url, label: conv.otherDisplayName || conv.otherUsername, shape: 'circle' });
    }

    // ── Banners ───────────────────────────────────────────────────────────────
    const banners: CachedImage[] = [];

    if (user?.banner) {
      const url = resolveAvatarUrl(user.banner, serverUrl, user.accountType as 'local' | 'central');
      if (url) banners.push({ url, label: 'Your banner', shape: 'rect' });
    }

    for (const server of servers) {
      const rawBanner = server.info?.serverBanner;
      if (rawBanner) {
        const bannerUrl = /^https?:\/\//i.test(rawBanner)
          ? rawBanner
          : `${server.url.replace(/\/+$/, '')}${rawBanner}`;
        banners.push({ url: bannerUrl, label: server.name, shape: 'rect' });
      }
    }

    // ── User Generated Content ─────────────────────────────────────────────────
    const ugc: CachedImage[] = [];
    const seenUgc = new Set<string>();

    for (const messages of Object.values(dmMessages)) {
      for (const msg of messages) {
        const attUrl = msg.attachmentUrl;
        const attType = msg.attachmentType;
        if (!attUrl || !attType?.startsWith('image/') || seenUgc.has(attUrl)) continue;
        seenUgc.add(attUrl);
        const fullUrl = /^https?:\/\//i.test(attUrl) ? attUrl : `${AUTH_BASE}${attUrl}`;
        ugc.push({ url: fullUrl, label: msg.attachmentName || 'Image', shape: 'rect' });
      }
    }

    for (const messages of Object.values(channelMessages)) {
      for (const msg of messages) {
        const attUrl = msg.attachment_url;
        const attType = msg.attachment_type;
        if (!attUrl || !attType?.startsWith('image/') || seenUgc.has(attUrl) || !/^https?:\/\//i.test(attUrl)) continue;
        seenUgc.add(attUrl);
        ugc.push({ url: attUrl, label: 'Image', shape: 'rect' });
      }
    }

    // ── System Images ──────────────────────────────────────────────────────────
    const system: CachedImage[] = [
      { url: `${appBase}/favicon-96x96.png`,              label: 'App favicon',    shape: 'square' },
      { url: `${appBase}/apple-touch-icon.png`,           label: 'iOS icon',       shape: 'square' },
      { url: `${appBase}/web-app-manifest-192x192.png`,   label: 'PWA icon (192)', shape: 'square' },
      { url: `${appBase}/web-app-manifest-512x512.png`,   label: 'PWA icon (512)', shape: 'square' },
      { url: `${appBase}/CatRealm.png`,                   label: 'Loading screen', shape: 'square' },
    ];

    return [
      {
        id: 'avatars',
        label: 'Avatars',
        description: 'Your profile picture, server icons, and DM contact avatars.',
        images: avatars,
      },
      {
        id: 'banners',
        label: 'Banners',
        description: 'Your profile banner and server banners.',
        images: banners,
      },
      {
        id: 'ugc',
        label: 'User Generated Content',
        description: 'Image attachments from chat messages loaded in your current session.',
        images: ugc,
      },
      {
        id: 'system',
        label: 'System Images',
        description: 'CatRealm app icons and the loading screen. These rarely change.',
        images: system,
      },
    ];
  }, [servers, user, serverUrl, conversations, dmMessages, channelMessages]);

  const allImages = useMemo(() => categories.flatMap((c) => c.images), [categories]);

  const handlePurge = useCallback(async () => {
    setPurging(true);
    setPurged(false);
    const unique = [...new Set(allImages.map((i) => i.url.split('?')[0]))];
    await Promise.allSettled(unique.map((url) => fetch(url, { cache: 'reload' })));
    setImgBust((k) => k + 1);
    setPurging(false);
    setPurged(true);
  }, [allImages]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold text-text-primary">Cat Cache</h3>
          <p className="text-sm text-text-muted mt-1">
            Images are cached by your browser for up to{' '}
            <span className="text-text-secondary font-medium">7 days</span> so they load
            instantly on repeat visits. They update automatically when changed — use Purge
            if something looks wrong or stuck.
          </p>
        </div>
        <div className="shrink-0 mt-1">
          <button
            type="button"
            onClick={handlePurge}
            disabled={purging || allImages.length === 0}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-600/20 border border-red-600/40 text-red-400 hover:bg-red-600/30 hover:text-red-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium"
          >
            <Trash2 className="w-4 h-4" />
            {purging ? 'Purging…' : 'Purge All'}
          </button>
        </div>
      </div>

      {purged && !purging && (
        <p className="text-xs text-green-400">Cache purged — all images re-fetched fresh.</p>
      )}

      <div className="space-y-2">
        {categories.map((cat) => (
          <CacheTreeNode key={cat.id} category={cat} imgBust={imgBust} />
        ))}
        <RadioCacheRow />
      </div>
    </div>
  );
}
