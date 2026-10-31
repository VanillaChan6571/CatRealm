import { useRef, useState } from 'react';
import { createAuthenticatedApi } from '../../../lib/authApi';

type ResetResult = {
  username: string;
  qrCode: string;
  manualCode: string;
};

export function CentralStaffTab() {
  const [targetUsername, setTargetUsername] = useState('');
  const [step, setStep] = useState<'idle' | 'confirm'>('idle');
  const [totpCode, setTotpCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResetResult | null>(null);
  const totpRef = useRef<HTMLInputElement>(null);

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
    </div>
  );
}
