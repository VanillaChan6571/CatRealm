import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { createApi } from '../../lib/api';
import { createAuthenticatedApi } from '../../lib/authApi';
import { useContentSocialStore } from '../../stores/contentSocialStore';
import { useUIStore } from '../../stores/uiStore';
import { isAllowedExternalUrl, openProtectedExternalUrl } from '../../utils/externalLinks';
import { useTranslation } from 'react-i18next';

interface ProfileBioEditorProps {
  bio: string | null;
  isOwnProfile: boolean;
  inCentralContext: boolean;
  onUpdate: (newBio: string) => void;
}

const BIO_URL_REGEX = /https?:\/\/[^\s]+/gi;

function renderBioWithLinks(
  text: string,
  isLinkAllowed: (url: string) => boolean,
  onLinkClick?: (url: string, e: React.MouseEvent<HTMLAnchorElement>) => void
): ReactNode[] {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  const matches = [...text.matchAll(BIO_URL_REGEX)];

  matches.forEach((match, idx) => {
    const url = match[0];
    const start = match.index ?? -1;
    if (start < 0) return;

    if (start > lastIndex) {
      parts.push(<span key={`text-${idx}`}>{text.slice(lastIndex, start)}</span>);
    }

    const allowed = isLinkAllowed(url);
    parts.push(
      <a
        key={`url-${idx}`}
        href={url}
        target="_blank"
        rel="noreferrer"
        className={allowed
          ? 'text-accent hover:underline break-all'
          : 'text-red-400 hover:text-red-300 hover:underline decoration-red-400/70 break-all'
        }
        onClick={(e) => onLinkClick?.(url, e)}
      >
        {allowed ? url : <><span aria-hidden="true">⚠ </span>{url}</>}
      </a>
    );

    lastIndex = start + url.length;
  });

  if (lastIndex < text.length) {
    parts.push(<span key="text-tail">{text.slice(lastIndex)}</span>);
  }

  return parts;
}

export function ProfileBioEditor({
  bio,
  isOwnProfile,
  inCentralContext,
  onUpdate,
}: ProfileBioEditorProps) {
  const { t } = useTranslation();
  const openModal = useUIStore((s) => s.openModal);
  const customAllowedDomains = useContentSocialStore((s) => s.customAllowedDomains);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(bio || '');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!isOwnProfile) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const api = inCentralContext ? createAuthenticatedApi() : createApi();
      await api.put('/api/profile/me', { bio: draft.trim() });
      onUpdate(draft.trim());
      setIsEditing(false);
    } catch (err) {
      console.error('Failed to update bio:', err);
      setSaveError('Bio was not saved. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setDraft(bio || '');
    setIsEditing(false);
  };

  const handleOpenLink = (url: string) => {
    openProtectedExternalUrl(url, openModal);
  };

  const isLinkAllowed = useCallback((url: string) => isAllowedExternalUrl(url), [customAllowedDomains]);

  const handleViewerBioLinkClick = (url: string, e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    e.stopPropagation();
    handleOpenLink(url);
  };

  const handleOwnBioLinkClick = (url: string, e: React.MouseEvent<HTMLAnchorElement>) => {
    const modifierHeld = e.ctrlKey || e.metaKey;
    if (modifierHeld) {
      // Keep modal in view mode when intentionally opening a link.
      e.preventDefault();
      e.stopPropagation();
      handleOpenLink(url);
      return;
    }
    // In editable bios, normal click should still enter edit mode.
    e.preventDefault();
  };

  if (!isOwnProfile) {
    return (
      <div className="space-y-2">
        <label className="text-xs text-text-muted font-semibold">{t('profile.bio')}</label>
        <div className="rounded border border-border bg-bg-input p-3 text-sm text-text-secondary whitespace-pre-wrap min-h-[60px]">
          {bio?.trim()
            ? renderBioWithLinks(bio.trim(), isLinkAllowed, handleViewerBioLinkClick)
            : <span className="text-text-muted italic">{t('profile.noBioSet')}</span>}
        </div>
      </div>
    );
  }

  if (isEditing) {
    return (
      <div className="space-y-2">
        <label className="text-xs text-text-muted font-semibold">
          {t('profile.bio')}
          {isSaving && <span className="ml-2 text-accent">{t('common.saving')}</span>}
        </label>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, 500))}
          autoFocus
          maxLength={500}
          rows={4}
          className="w-full rounded border border-border bg-bg-input p-3 text-sm text-text-primary resize-none focus:outline-none focus:border-accent"
          placeholder={t('profile.clickAddBio')}
        />
        <div className="flex items-center justify-between text-xs">
          {saveError && <p role="alert" className="text-xs text-danger">{saveError}</p>}
          <span className="text-text-muted">{t('profile.characterCount', { count: draft.length, max: 500 })}</span>
          <div className="flex gap-2">
            <button
              onClick={handleCancel}
              disabled={isSaving}
              className="text-text-muted hover:text-text-primary"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="text-accent hover:text-accent-hover disabled:opacity-50"
            >
              {t('common.save')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <label className="text-xs text-text-muted font-semibold">{t('profile.bio')}</label>
      <div
        onClick={() => { setDraft(bio || ''); setSaveError(null); setIsEditing(true); }}
        className="rounded border border-border bg-bg-input p-3 text-sm text-text-secondary whitespace-pre-wrap min-h-[60px] cursor-text hover:border-accent/50 transition-colors"
      >
        {bio?.trim()
          ? renderBioWithLinks(bio.trim(), isLinkAllowed, handleOwnBioLinkClick)
          : <span className="text-text-muted italic">{t('profile.clickAddBio')}</span>}
      </div>
    </div>
  );
}
