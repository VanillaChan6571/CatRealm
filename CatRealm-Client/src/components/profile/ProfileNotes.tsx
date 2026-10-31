import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createAuthenticatedApi } from '../../lib/authApi';
import { useAuthStore } from '../../stores/authStore';

interface ProfileNotesProps { userId: string | null; isOwnProfile: boolean }

export function ProfileNotes({ userId, isOwnProfile }: ProfileNotesProps) {
  const account = useAuthStore(s => s.user);
  if (isOwnProfile) return null;
  if (account?.accountType !== 'central' || !userId) {
    return <p className="text-xs text-text-muted">Private profile notes are available between central accounts.</p>;
  }
  return <NoteEditor key={`${account.id}:${userId}`} accountId={account.id} userId={userId} />;
}

function NoteEditor({ accountId, userId }: { accountId: string; userId: string }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saved = useRef('');
  const version = useRef(0);
  const queue = useRef(Promise.resolve());
  const current = () => live.current && useAuthStore.getState().user?.id === accountId
    && useAuthStore.getState().user?.accountType === 'central';

  useEffect(() => {
    live.current = true;
    let cancelled = false;
    // Never hydrate the old account-agnostic plaintext note cache.
    void createAuthenticatedApi().get(`/api/profile/notes/${userId}`).then(res => {
      if (cancelled || !current()) return;
      const note = typeof res.data.note === 'string' ? res.data.note : '';
      saved.current = note;
      setDraft(note);
      setLoading(false);
    }).catch(() => {
      if (!cancelled && current()) setError('Could not load this note. Reopen the profile to retry.');
    });
    return () => {
      cancelled = true;
      live.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [accountId, userId]);

  const save = (text: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const requestVersion = ++version.current;
    queue.current = queue.current.then(async () => {
      if (!current() || loading || text.trim() === saved.current) { if (current()) setSaving(false); return; }
      const api = createAuthenticatedApi();
      setSaving(true);
      setError(null);
      try {
        if (text.trim()) await api.put(`/api/profile/notes/${userId}`, { note: text.trim() });
        else await api.delete(`/api/profile/notes/${userId}`);
        if (current()) saved.current = text.trim();
      } catch {
        if (current()) setError('Note was not saved. Try saving again.');
      } finally {
        if (current() && requestVersion === version.current) setSaving(false);
      }
    });
  };

  return <div className="space-y-2">
    <label className="text-xs text-text-muted font-semibold">
      {t('profile.notes')} · {t('profile.onlyVisibleToYou')}
      {saving && <span className="ml-2">{t('common.saving')}</span>}
    </label>
    <textarea value={draft} disabled={loading} rows={3} maxLength={1000}
      onChange={e => {
        const text = e.target.value.slice(0, 1000);
        setDraft(text);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => save(text), 500);
      }}
      onBlur={() => save(draft)} placeholder={t('profile.privateNotePlaceholder')}
      className="w-full rounded border border-border bg-bg-input p-3 text-sm text-text-primary" />
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    <button disabled={loading || saving} onClick={() => save(draft)} className="text-xs text-accent disabled:opacity-50">{t('common.save')}</button>
  </div>;
}
