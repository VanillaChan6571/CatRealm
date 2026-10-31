import { useEffect, useState } from 'react';
import { createAuthenticatedApi } from '../../lib/authApi';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import { Button } from '../ui/Button';

export function PasskeyRecommendationBanner() {
  const user = useAuthStore((state) => state.user);
  const openModal = useUIStore((state) => state.openModal);
  const accountId = user?.accountType === 'central' ? user.id : null;
  const [checkedAccountId, setCheckedAccountId] = useState<string | null>(null);
  const [hasNoPasskeys, setHasNoPasskeys] = useState(false);
  const [dismissedAccountId, setDismissedAccountId] = useState<string | null>(null);

  useEffect(() => {
    setCheckedAccountId(null);
    if (!accountId) return;
    let active = true;
    let lastCheckedAt = 0;
    let revision = 0;
    const check = (force = false) => {
      if (!force && Date.now() - lastCheckedAt < 30_000) return;
      lastCheckedAt = Date.now();
      const currentRevision = ++revision;
      void createAuthenticatedApi().get<{ credentials: unknown[] }>('/api/security/webauthn/credentials')
        .then(({ data }) => {
          if (!active || currentRevision !== revision || useAuthStore.getState().user?.id !== accountId) return;
          setHasNoPasskeys(Array.isArray(data.credentials) && data.credentials.length === 0);
          setCheckedAccountId(accountId);
        })
        .catch(() => {
          if (active && currentRevision === revision) setCheckedAccountId(null);
        });
    };
    const onFocus = () => check();
    const onCredentialsChanged = () => check(true);
    check(true);
    window.addEventListener('focus', onFocus);
    window.addEventListener('catrealm:passkeys-changed', onCredentialsChanged);
    return () => {
      active = false;
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('catrealm:passkeys-changed', onCredentialsChanged);
    };
  }, [accountId]);

  if (!accountId || checkedAccountId !== accountId || !hasNoPasskeys || dismissedAccountId === accountId) return null;

  return (
    <div role="status" className="shrink-0 border-b border-amber-500/40 bg-amber-500/10 px-4 py-3">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
        <div className="min-w-[240px] flex-1">
          <p className="text-sm font-medium text-text-primary">Add a passkey or security key</p>
          <p className="text-xs text-text-secondary">This Central account has no passkey or security key. Add one for a stronger sign-in option and device verification.</p>
        </div>
        <Button size="sm" onClick={() => openModal('profileSettings', { initialTab: 'account-security' })}>Add passkey</Button>
        <Button size="sm" variant="ghost" onClick={() => setDismissedAccountId(accountId)}>Later</Button>
      </div>
    </div>
  );
}
