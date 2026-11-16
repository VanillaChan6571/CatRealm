import { useState } from 'react';
import type React from 'react';
import { createApi } from '../../lib/api';
import { createAuthenticatedApi } from '../../lib/authApi';
import { MessageFormatter } from '../chat/MessageFormatter';
import { useTranslation } from 'react-i18next';

interface ProfileBioEditorProps {
  bio: string | null;
  isOwnProfile: boolean;
  inCentralContext: boolean;
  onUpdate: (newBio: string) => void;
}

/** Bios use the same markdown as messages (bold, italics, protected links…), without embeds. */
function BioText({ text }: { text: string }) {
  return <MessageFormatter text={text} allowLinks allowEmbeds={false} />;
}

export function ProfileBioEditor({
  bio,
  isOwnProfile,
  inCentralContext,
  onUpdate,
}: ProfileBioEditorProps) {
  const { t } = useTranslation();
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

  // In your own bio a plain click on a link enters edit mode, like the rest of the box;
  // Ctrl/Cmd-click falls through to the link, which opens it behind the usual safety check.
  const handleOwnBioClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    const link = (e.target as HTMLElement).closest('a');
    if (!link || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();
    setDraft(bio || '');
    setSaveError(null);
    setIsEditing(true);
  };

  if (!isOwnProfile) {
    return (
      <div className="space-y-2">
        <label className="text-xs text-text-muted font-semibold">{t('profile.bio')}</label>
        <div className="rounded border border-border bg-bg-input p-3 text-sm text-text-secondary whitespace-pre-wrap min-h-[60px]">
          {bio?.trim()
            ? <BioText text={bio.trim()} />
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
        onClickCapture={handleOwnBioClickCapture}
        className="rounded border border-border bg-bg-input p-3 text-sm text-text-secondary whitespace-pre-wrap min-h-[60px] cursor-text hover:border-accent/50 transition-colors"
      >
        {bio?.trim()
          ? <BioText text={bio.trim()} />
          : <span className="text-text-muted italic">{t('profile.clickAddBio')}</span>}
      </div>
    </div>
  );
}
