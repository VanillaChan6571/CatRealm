import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertCircle, CheckCircle, KeyRound, Loader2, Shield } from 'lucide-react';
import { startRegistration } from '@simplewebauthn/browser';
import axios from 'axios';
import { AUTH_BASE } from '../lib/authApi';
import { AuthBackdrop } from '../components/auth/AuthBackdrop';

type Step = 'ready' | 'waiting' | 'complete' | 'error';

function friendlyWebAuthnError(message: string) {
  if (message.includes('timed out') || message.includes('not allowed') || message.includes('NotAllowedError')) {
    return 'Passkey registration was cancelled, timed out, or was not allowed by the authenticator.';
  }
  return message;
}

export function WebAuthnRegisterPage() {
  const { flowId } = useParams<{ flowId: string }>();
  const flowSecret = useMemo(() => new URLSearchParams(window.location.search).get('secret') || '', []);
  const [step, setStep] = useState<Step>('ready');
  const [error, setError] = useState<string | null>(null);

  const canRegister = Boolean(flowId && flowSecret);

  useEffect(() => {
    if (!canRegister) {
      setStep('error');
      setError('This passkey registration link is missing required information.');
    }
  }, [canRegister]);

  async function handleRegister() {
    if (!flowId || !flowSecret) return;
    setStep('waiting');
    setError(null);

    try {
      const optionsRes = await axios.post(`${AUTH_BASE}/api/security/webauthn/desktop/register-options`, {
        flowId,
        flowSecret,
      });
      const credential = await startRegistration({ optionsJSON: optionsRes.data });
      await axios.post(`${AUTH_BASE}/api/security/webauthn/desktop/register-verify`, {
        flowId,
        flowSecret,
        credential,
      });
      setStep('complete');
    } catch (err: unknown) {
      const rawMessage = axios.isAxiosError(err)
        ? String(err.response?.data?.error || err.message || 'Passkey registration failed.')
        : (err instanceof Error ? err.message : 'Passkey registration failed.');
      const message = friendlyWebAuthnError(rawMessage);
      await axios.post(`${AUTH_BASE}/api/security/webauthn/desktop/register-fail`, {
        flowId,
        flowSecret,
        error: message,
      }).catch(() => {});
      setError(message);
      setStep('error');
    }
  }

  return (
    <AuthBackdrop>
      <div className="invite-card-breathe w-full max-w-md rounded-xl border border-border bg-bg-elevated p-7 shadow-2xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
            <KeyRound className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-text-primary">Register Passkey</h1>
            <p className="mt-1 text-sm text-text-secondary">CatRealm account security</p>
          </div>
        </div>

        {step === 'ready' && (
          <div className="space-y-5">
            <p className="text-sm leading-6 text-text-secondary">
              Use this secure CatRealm page to register a passkey, security key, Touch ID, Windows Hello, or phone passkey.
            </p>
            <button
              type="button"
              onClick={() => void handleRegister()}
              disabled={!canRegister}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Shield className="h-4 w-4" />
              Continue
            </button>
          </div>
        )}

        {step === 'waiting' && (
          <div className="space-y-4 text-center">
            <Loader2 className="mx-auto h-10 w-10 animate-spin text-accent" />
            <div>
              <p className="font-medium text-text-primary">Waiting for your passkey</p>
              <p className="mt-1 text-sm text-text-secondary">Follow the browser or operating system prompt.</p>
            </div>
          </div>
        )}

        {step === 'complete' && (
          <div className="space-y-4 text-center">
            <CheckCircle className="mx-auto h-11 w-11 text-green-400" />
            <div>
              <p className="font-medium text-text-primary">Passkey Registered</p>
              <p className="mt-1 text-sm text-text-secondary">You can return to the CatRealm desktop app.</p>
            </div>
            <button
              type="button"
              onClick={() => window.close()}
              className="w-full rounded-lg border border-border px-4 py-2 text-sm text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
            >
              Close
            </button>
          </div>
        )}

        {step === 'error' && (
          <div className="space-y-4">
            <div className="flex gap-3 rounded-lg border border-danger/30 bg-danger/10 p-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
              <p className="text-sm text-danger">{error || 'Passkey registration failed.'}</p>
            </div>
            <button
              type="button"
              onClick={() => setStep('ready')}
              disabled={!canRegister}
              className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </AuthBackdrop>
  );
}
