import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createApi } from '../../lib/api';
import { createAuthenticatedApi } from '../../lib/authApi';
import { useAuthStore } from '../../stores/authStore';
import { nicknameScope, useNicknamesStore } from '../../stores/nicknamesStore';
import { Button } from '../ui/Button';

export function ProfileNickname({ userId, isOwnProfile, inCentralContext }: {
  userId: string; isOwnProfile: boolean; inCentralContext: boolean;
}) {
  const auth = useAuthStore();
  const scope = nicknameScope(inCentralContext);
  if (isOwnProfile || !auth.user) return null;
  return <NicknameEditor key={`${scope}:${userId}`} scope={scope} userId={userId} central={inCentralContext} />;
}

function NicknameEditor({ scope, userId, central }: { scope: string; userId: string; central: boolean }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const api = () => central ? createAuthenticatedApi() : createApi();
  useEffect(() => {
    let live = true;
    void api().get('/api/profile/nicknames').then(res => {
      if (!live || nicknameScope(central) !== scope) return;
      useNicknamesStore.getState().loadNicknames(scope, res.data);
      setDraft(res.data.find((row: { target_user_id: string }) => row.target_user_id === userId)?.nickname || '');
      setLoading(false);
    }).catch(() => { if (live) setError('Could not load nicknames. Reopen this profile to retry.'); });
    return () => { live = false; };
  }, [scope, userId, central]);
  const save = async (nickname: string) => {
    if (nicknameScope(central) !== scope || saving || loading) return;
    setSaving(true);
    setError(null);
    try {
      if (nickname.trim()) await api().put(`/api/profile/nicknames/${userId}`, { nickname: nickname.trim() });
      else await api().delete(`/api/profile/nicknames/${userId}`);
      if (nicknameScope(central) !== scope) return;
      useNicknamesStore.getState().setNickname(scope, userId, nickname.trim());
      setDraft(nickname.trim());
    } catch { setError('Nickname was not saved. Please try again.'); }
    finally { setSaving(false); }
  };
  return <div className="space-y-2">
    <label className="text-xs text-text-muted">{t('profile.privateNickname')} · {t('profile.onlyYouSeeThis')}</label>
    <div className="flex gap-2">
      <input value={draft} onChange={e => setDraft(e.target.value)} maxLength={32} disabled={loading || saving}
        placeholder={t('profile.nicknamePlaceholder')} className="flex-1 bg-bg-input border border-border rounded px-3 py-2 text-sm" />
      <Button size="sm" disabled={loading || saving} onClick={() => void save(draft)}>{t('common.save')}</Button>
      <Button size="sm" variant="ghost" disabled={loading || saving} onClick={() => void save('')}>{t('profile.clear')}</Button>
    </div>
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
  </div>;
}
