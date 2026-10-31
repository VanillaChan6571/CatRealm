import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../ui/Button';
import { createAuthenticatedApi } from '../../../lib/authApi';
import { useNowPlayingStore } from '../../../stores/nowPlayingStore';

// Mirrors Central's check: Last.fm usernames are 2-15 letters, digits, _ or -.
const LASTFM_USERNAME_RE = /^[A-Za-z0-9_-]{2,15}$/;

interface LastfmResponse {
  lastfmUsername: string | null;
  nowPlaying?: unknown;
}

export function LastfmConnection({ userId }: { userId: string | undefined }) {
  const { t } = useTranslation();
  const [linked, setLinked] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    createAuthenticatedApi().get<LastfmResponse>('/api/profile/me/lastfm')
      .then((res) => { if (!cancelled) setLinked(res.data.lastfmUsername ?? null); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const apply = (data: LastfmResponse) => {
    setLinked(data.lastfmUsername ?? null);
    if (userId) useNowPlayingStore.getState().setNowPlaying(userId, data.nowPlaying);
  };

  const link = async () => {
    const username = draft.trim();
    if (!LASTFM_USERNAME_RE.test(username)) {
      setError(t('lastfm.invalidUsername'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await createAuthenticatedApi().put<LastfmResponse>('/api/profile/me/lastfm', { username });
      apply(res.data);
      setDraft('');
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      setError(status === 404 ? t('lastfm.userNotFound') : status === 400 ? t('lastfm.invalidUsername') : t('lastfm.linkFailed'));
    } finally {
      setSaving(false);
    }
  };

  const unlink = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await createAuthenticatedApi().delete<LastfmResponse>('/api/profile/me/lastfm');
      apply(res.data);
    } catch {
      setError(t('lastfm.unlinkFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-text-primary">{t('lastfm.title')}</label>
      <p className="text-xs text-text-muted">{t('lastfm.description')}</p>
      {loading ? (
        <p className="text-xs text-text-muted">{t('common.loading')}</p>
      ) : linked ? (
        <div className="flex items-center justify-between gap-3 rounded border border-border bg-bg-input px-3 py-2">
          <span className="text-sm text-text-primary truncate">
            {t('lastfm.linkedAs')}{' '}
            <a href={`https://www.last.fm/user/${encodeURIComponent(linked)}`} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">{linked}</a>
          </span>
          <Button size="sm" variant="secondary" onClick={unlink} disabled={saving}>
            {t('lastfm.unlink')}
          </Button>
        </div>
      ) : (
        <form
          className="flex gap-2"
          onSubmit={(event) => { event.preventDefault(); void link(); }}
        >
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={15}
            placeholder={t('lastfm.usernamePlaceholder')}
            className="flex-1 px-3 py-2 bg-bg-input border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
            autoComplete="off"
            spellCheck={false}
          />
          <Button size="sm" type="submit" disabled={saving || !draft.trim()}>
            {saving ? t('common.saving') : t('lastfm.link')}
          </Button>
        </form>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
