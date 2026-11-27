import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { createAuthenticatedApi } from '../../lib/authApi';
import { useAuthStore } from '../../stores/authStore';

type ConsentStatus = { required: boolean };

/** Policy version this client asks users to accept; bump when the policies change. */
const POLICY_VERSION = '2026-10-17';

// Remembers that an account already accepted POLICY_VERSION on this device, so
// returning users get the app right away while the server check runs.
function consentCacheKey(userId: string) {
  return `catrealm.centralConsent.${POLICY_VERSION}.${userId}`;
}

function readCachedConsent(userId: string | undefined): boolean {
  if (!userId) return false;
  try {
    return window.localStorage.getItem(consentCacheKey(userId)) === '1';
  } catch {
    return false;
  }
}

function writeCachedConsent(userId: string | undefined, accepted: boolean) {
  if (!userId) return;
  try {
    if (accepted) window.localStorage.setItem(consentCacheKey(userId), '1');
    else window.localStorage.removeItem(consentCacheKey(userId));
  } catch {
    // Storage blocked: fall back to waiting for the server check.
  }
}

export function CentralConsentGate({ children }: { children: ReactNode }) {
  const userId = useAuthStore((s) => s.user?.id);
  const logout = useAuthStore((s) => s.logout);
  const [required, setRequired] = useState<boolean | null>(null);
  const [checkedUserId, setCheckedUserId] = useState<string | null>(null);
  const [privacy, setPrivacy] = useState(false);
  const [terms, setTerms] = useState(false);
  const [age, setAge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const check = useCallback(async () => {
    const checkedUserId = useAuthStore.getState().user?.id;
    setCheckedUserId(checkedUserId ?? null);
    setRequired(null);
    setError('');
    try {
      const response = await createAuthenticatedApi().get<ConsentStatus>('/api/consent');
      if (useAuthStore.getState().user?.id === checkedUserId) {
        setRequired(response.data.required);
        writeCachedConsent(checkedUserId, !response.data.required);
      }
    } catch {
      if (useAuthStore.getState().user?.id === checkedUserId) setError('Could not check your account. Check your connection and try again.');
    }
  }, []);

  useEffect(() => { void check(); }, [check, userId]);

  async function accept() {
    if (!privacy || !terms || !age) return;
    const acceptingUserId = useAuthStore.getState().user?.id;
    setBusy(true);
    setError('');
    try {
      const response = await createAuthenticatedApi().post<ConsentStatus>('/api/consent', {
        acceptPrivacy: privacy, acceptTerms: terms, confirmAge18: age,
        termsVersion: POLICY_VERSION, privacyVersion: POLICY_VERSION,
      });
      if (useAuthStore.getState().user?.id === acceptingUserId) {
        setRequired(response.data.required);
        writeCachedConsent(acceptingUserId, !response.data.required);
      }
    } catch {
      if (useAuthStore.getState().user?.id === acceptingUserId) setError('Could not save your choices. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const currentRequirement = checkedUserId === userId ? required : null;
  if (currentRequirement === false) return <>{children}</>;
  if (currentRequirement === null && !error) {
    // Still checking. Don't flash the policy dialog: returning users who already
    // accepted this version see the app (the dialog still appears if the server
    // says otherwise), everyone else sees a plain background until the answer.
    return readCachedConsent(userId)
      ? <>{children}</>
      : <div className="h-full w-full bg-bg-deepest" aria-busy="true" />;
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-labelledby="central-consent-title">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-bg-sidebar p-6 text-text-primary shadow-2xl">
        <h1 id="central-consent-title" className="text-xl font-bold">Continue using CatRealm Central</h1>
        <p className="mt-2 text-sm text-text-secondary">Please review the current policies and confirm your age to continue. You can log out if you do not agree.</p>
        {currentRequirement === true && <div className="mt-5 space-y-3 text-sm">
          <label className="flex items-start gap-3"><input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} className="mt-1" /><span>I have read and agree to the <a href="https://catrealm.app/privacy/" target="_blank" rel="noopener noreferrer" className="text-accent underline">Privacy Policy</a>.</span></label>
          <label className="flex items-start gap-3"><input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="mt-1" /><span>I have read and agree to the <a href="https://catrealm.app/terms/" target="_blank" rel="noopener noreferrer" className="text-accent underline">Terms of Service</a>.</span></label>
          <label className="flex items-start gap-3"><input type="checkbox" checked={age} onChange={(e) => setAge(e.target.checked)} className="mt-1" /><span>I confirm that I am 18 years of age or older.</span></label>
        </div>}
        {error && <p className="mt-4 text-sm text-danger" role="alert">{error}</p>}
        <div className="mt-6 flex gap-3">
          <button type="button" onClick={() => logout()} className="rounded-lg border border-border px-4 py-2">Log out</button>
          {currentRequirement === null
            ? <button type="button" onClick={() => void check()} className="rounded-lg bg-accent px-4 py-2 text-white">Retry</button>
            : <button type="button" disabled={!privacy || !terms || !age || busy} onClick={() => void accept()} className="rounded-lg bg-accent px-4 py-2 text-white disabled:opacity-50">{busy ? 'Saving…' : 'Agree and continue'}</button>}
        </div>
      </div>
    </div>
  );
}
