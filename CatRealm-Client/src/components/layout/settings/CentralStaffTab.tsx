import { useEffect, useRef, useState } from 'react';
import { createAuthenticatedApi } from '../../../lib/authApi';

type ResetResult = {
  username: string;
  qrCode: string;
  manualCode: string;
};

type RealmSafetySignal = { id: string; subjectUserId: string; realmUrl: string; realmReportId: string; reason: string; artifactKind: string; createdAt: number };
type ProfileSafetyCase = { id: string; reporterUserId: string; subjectUserId: string; reason: string; createdAt: number; details?: string | null };

export function CentralStaffTab() {
  const [targetUsername, setTargetUsername] = useState('');
  const [step, setStep] = useState<'idle' | 'confirm'>('idle');
  const [totpCode, setTotpCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResetResult | null>(null);
  const totpRef = useRef<HTMLInputElement>(null);
  const [safetyLoading, setSafetyLoading] = useState(false);
  const [safetyError, setSafetyError] = useState<string | null>(null);
  const [realmSignals, setRealmSignals] = useState<RealmSafetySignal[]>([]);
  const [profileCases, setProfileCases] = useState<ProfileSafetyCase[]>([]);
  const [selectedProfileCase, setSelectedProfileCase] = useState<ProfileSafetyCase | null>(null);
  const [staffTotpCode, setStaffTotpCode] = useState('');
  const [staffPortalLoading, setStaffPortalLoading] = useState(false);

  async function openStaffPortal() {
    const portalWindow = window.open('about:blank', '_blank');
    if (portalWindow) portalWindow.opener = null;
    setStaffPortalLoading(true);
    setSafetyError(null);
    try {
      await createAuthenticatedApi().post('/api/security/step-up', { totpCode: staffTotpCode.trim() });
      const response = await createAuthenticatedApi().post('/api/staff/handoff');
      setStaffTotpCode('');
      if (portalWindow) portalWindow.location.replace(response.data.portalUrl);
      else window.location.assign(response.data.portalUrl);
    } catch (err: unknown) {
      portalWindow?.close();
      setSafetyError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Could not open the staff portal.');
    } finally {
      setStaffPortalLoading(false);
    }
  }

  // Message evidence and decisions live only in the isolated staff portal.

  async function loadRealmSignals() {
    try {
      const res = await createAuthenticatedApi().get('/api/admin/safety/realm-signals', { params: { status: 'pending' } });
      setRealmSignals(Array.isArray(res.data?.signals) ? res.data.signals : []);
    } catch (err: unknown) {
      setSafetyError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to load Realm safety signals.');
    }
  }
  useEffect(() => { void loadRealmSignals(); }, []);
  async function loadProfileCases() {
    try {
      const res = await createAuthenticatedApi().get('/api/admin/safety/profile-reports', { params: { status: 'pending' } });
      setProfileCases(Array.isArray(res.data?.reports) ? res.data.reports : []);
      setSelectedProfileCase(null);
    } catch (err: unknown) { setSafetyError((err as any)?.response?.data?.error ?? 'Failed to load profile reports.'); }
  }
  useEffect(() => { void loadProfileCases(); }, []);

  async function openProfileCase(id: string) {
    try { const res = await createAuthenticatedApi().get(`/api/admin/safety/profile-reports/${id}`); setSelectedProfileCase(res.data.report); }
    catch (err: unknown) { setSafetyError((err as any)?.response?.data?.error ?? 'Failed to open profile report.'); }
  }

  async function reviewProfileCase(id: string, status: 'confirmed' | 'dismissed' | 'escalated') {
    setSafetyLoading(true);
    try { await createAuthenticatedApi().patch(`/api/admin/safety/profile-reports/${id}`, { status }); await loadProfileCases(); }
    catch (err: unknown) { setSafetyError((err as any)?.response?.data?.error ?? 'Failed to review profile report.'); }
    finally { setSafetyLoading(false); }
  }

  async function reviewRealmSignal(signalId: string, status: 'confirmed' | 'dismissed' | 'escalated') {
    setSafetyLoading(true);
    try {
      await createAuthenticatedApi().patch(`/api/admin/safety/realm-signals/${signalId}`, { status });
      await loadRealmSignals();
    } catch (err: unknown) {
      setSafetyError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to review Realm signal.');
    } finally { setSafetyLoading(false); }
  }

  function handleRequestReset() {
    if (!targetUsername.trim()) return;
    setError(null);
    setResult(null);
    setTotpCode('');
    setStep('confirm');
    setTimeout(() => totpRef.current?.focus(), 50);
  }

  function handleCancel() {
    setStep('idle');
    setTotpCode('');
    setError(null);
  }

  async function handleConfirmReset() {
    const code = totpCode.trim();
    if (!code) return;

    setLoading(true);
    setError(null);

    try {
      const api = createAuthenticatedApi();
      const res = await api.post('/api/admin/reset-2fa', {
        username: targetUsername.trim(),
        totpCode: code,
      });
      setResult(res.data as ResetResult);
      setTargetUsername('');
      setTotpCode('');
      setStep('idle');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Failed to reset 2FA. Please try again.';
      setError(msg);
      setTotpCode('');
      setTimeout(() => totpRef.current?.focus(), 50);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <h3 className="text-xl font-bold text-text-primary">Central Staff Control</h3>
      <p className="text-sm text-text-muted">
        Admin tools for managing central accounts.
      </p>

      <div className="rounded border border-accent/40 bg-accent/5 p-4 space-y-3">
        <div><p className="text-sm font-medium text-text-primary">Isolated Safety Operations portal</p><p className="mt-1 text-xs text-text-muted">Verify your authenticator to create a one-time, two-minute handoff. The portal uses a separate one-hour session with a fifteen-minute idle limit.</p></div>
        <div className="flex flex-wrap gap-2">
          <input value={staffTotpCode} onChange={(event) => setStaffTotpCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit authenticator code" aria-label="Authenticator code for staff portal" className="min-w-56 rounded border border-border bg-bg-input px-3 py-2 text-sm text-text-primary" />
          <button type="button" disabled={staffPortalLoading || staffTotpCode.length !== 6} onClick={() => void openStaffPortal()} className="rounded bg-accent px-3 py-2 text-sm font-semibold text-bg-primary disabled:opacity-50">{staffPortalLoading ? 'Opening…' : 'Open Safety Portal'}</button>
        </div>
        {safetyError && <p role="alert" className="text-xs text-danger">{safetyError}</p>}
      </div>

      <div className="rounded border border-border bg-bg-hover/30 p-4 space-y-4">
        <div>
          <p className="text-sm font-medium text-text-primary">Reset User 2FA</p>
          <p className="text-xs text-text-muted mt-1">
            Generates a new 2FA secret for the specified user. Share the QR code or manual code with them so they can re-enrol their authenticator app.
          </p>
        </div>

        {step === 'idle' && (
          <div className="flex gap-2">
            <input
              type="text"
              value={targetUsername}
              onChange={(e) => setTargetUsername(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleRequestReset(); }}
              placeholder="Username"
              className="flex-1 bg-bg-input border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
            />
            <button
              type="button"
              onClick={handleRequestReset}
              disabled={!targetUsername.trim()}
              className="px-4 py-2 rounded bg-accent text-white text-sm disabled:opacity-60 whitespace-nowrap"
            >
              Reset 2FA
            </button>
          </div>
        )}

        {step === 'confirm' && (
          <div className="space-y-3 rounded border border-border bg-bg-primary/40 p-3">
            <p className="text-sm text-text-primary">
              Enter your 2FA code to confirm reset for{' '}
              <span className="font-semibold">{targetUsername.trim()}</span>.
            </p>
            <div className="flex gap-2">
              <input
                ref={totpRef}
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleConfirmReset(); }}
                placeholder="000000"
                className="w-32 bg-bg-input border border-border rounded px-3 py-2 text-sm text-text-primary font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-accent/50"
              />
              <button
                type="button"
                onClick={() => void handleConfirmReset()}
                disabled={loading || totpCode.length !== 6}
                className="px-4 py-2 rounded bg-accent text-white text-sm disabled:opacity-60 whitespace-nowrap"
              >
                {loading ? 'Confirming…' : 'Confirm Reset'}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={loading}
                className="px-4 py-2 rounded border border-border text-sm text-text-muted hover:text-text-primary disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
            {error && <p className="text-xs text-danger">{error}</p>}
          </div>
        )}

        {step === 'idle' && error && (
          <p className="text-xs text-danger">{error}</p>
        )}

        {result && (
          <div className="space-y-3 pt-2 border-t border-border">
            <p className="text-sm text-text-primary">
              2FA reset for <span className="font-semibold">{result.username}</span>. Share the QR code or manual key below.
            </p>
            <div className="flex flex-col items-center gap-3">
              <img
                src={result.qrCode}
                alt="New 2FA QR Code"
                className="w-48 h-48 rounded border border-border bg-white p-1"
              />
              <div className="w-full rounded border border-border bg-bg-primary/60 p-3">
                <p className="text-xs text-text-muted mb-1">Manual key</p>
                <p className="text-sm font-mono text-text-primary break-all select-all">{result.manualCode}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="rounded border border-border bg-bg-hover/30 p-4 space-y-3">
        <div><p className="text-sm font-medium text-text-primary">Realm signals for Central identities</p><p className="mt-1 text-xs text-text-muted">Metadata-only, Realm-signed signals. Content remains with the independent Realm. Confirming or escalating restricts the linked Central account; it does not claim control over Realm infrastructure.</p></div>
        {realmSignals.length === 0 ? <p className="text-sm text-text-muted">No pending Realm signals.</p> : realmSignals.map((signal) => <div key={signal.id} className="rounded border border-border bg-bg-primary/40 p-3 text-sm"><p className="text-text-primary">{signal.artifactKind} · {signal.reason.replaceAll('_', ' ')}</p><p className="break-all text-xs text-text-muted">{signal.realmUrl} · subject {signal.subjectUserId}</p><div className="mt-2 flex gap-2"><button disabled={safetyLoading} onClick={() => void reviewRealmSignal(signal.id, 'confirmed')} className="rounded bg-red-600 px-2 py-1 text-xs text-white">Confirm & restrict</button><button disabled={safetyLoading} onClick={() => void reviewRealmSignal(signal.id, 'escalated')} className="rounded bg-amber-600 px-2 py-1 text-xs text-white">Escalate</button><button disabled={safetyLoading} onClick={() => void reviewRealmSignal(signal.id, 'dismissed')} className="rounded border border-border px-2 py-1 text-xs text-text-primary">Dismiss</button></div></div>)}
      </div>

      <div className="rounded border border-border bg-bg-hover/30 p-4 space-y-3">
        <div><p className="text-sm font-medium text-text-primary">Profile child-safety reports</p><p className="mt-1 text-xs text-text-muted">Account-level concerns without a selected message artifact.</p></div>
        <div className="grid gap-3 md:grid-cols-2"><div className="space-y-2">{profileCases.length === 0 ? <p className="text-sm text-text-muted">No pending profile reports.</p> : profileCases.map((item) => <button key={item.id} onClick={() => void openProfileCase(item.id)} className="w-full rounded border border-border bg-bg-primary/40 p-3 text-left text-sm"><span className="text-text-primary">{item.reason.replaceAll('_', ' ')}</span><span className="block text-xs text-text-muted">Subject {item.subjectUserId}</span></button>)}</div><div className="rounded border border-border bg-bg-primary/40 p-3">{selectedProfileCase ? <div className="space-y-3 text-sm"><p className="text-text-primary">Subject {selectedProfileCase.subjectUserId}</p><p className="whitespace-pre-wrap text-text-secondary">{selectedProfileCase.details || 'No additional context.'}</p><div className="flex flex-wrap gap-2"><button onClick={() => void reviewProfileCase(selectedProfileCase.id, 'confirmed')} className="rounded bg-red-600 px-2 py-1 text-xs text-white">Confirm & restrict</button><button onClick={() => void reviewProfileCase(selectedProfileCase.id, 'escalated')} className="rounded bg-amber-600 px-2 py-1 text-xs text-white">Escalate</button><button onClick={() => void reviewProfileCase(selectedProfileCase.id, 'dismissed')} className="rounded border border-border px-2 py-1 text-xs">Dismiss</button></div></div> : <p className="text-sm text-text-muted">Open a profile report to view its submitted context.</p>}</div></div>
      </div>
    </div>
  );
}
