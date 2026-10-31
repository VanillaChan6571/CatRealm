import { useEffect, useRef, useState } from 'react';
import HCaptcha from '@hcaptcha/react-hcaptcha';
import { useAuthStore } from '../../stores/authStore';
import { authApi } from '../../lib/authApi';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Spinner } from '../ui/Spinner';
import { QrCodeDisplay } from './QrCodeDisplay';

const DEFAULT_HCAPTCHA_SITEKEY = import.meta.env.VITE_HCAPTCHA_SITEKEY || '';

export function CentralRegisterForm({ onRegistered }: { onRegistered: () => void }) {
  const isDesktopClient = typeof window !== 'undefined' && !!window.electron;
  const [username, setUsername] = useState('');
  const [captchaToken, setCaptchaToken] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [success, setSuccess] = useState(false);
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [confirmAge18, setConfirmAge18] = useState(false);
  const [hcaptchaSiteKey, setHcaptchaSiteKey] = useState(isDesktopClient ? '' : DEFAULT_HCAPTCHA_SITEKEY);
  const [captchaEnabled, setCaptchaEnabled] = useState<boolean>(!isDesktopClient && Boolean(DEFAULT_HCAPTCHA_SITEKEY));
  const usernameValid = /^[a-zA-Z0-9_]{4,32}$/.test(username);
  const captchaRef = useRef<HCaptcha>(null);

  const {
    centralRegisterStart,
    centralRegisterConfirm,
    centralRegPending,
    clearCentralReg,
    loading,
    error,
    clearError,
  } = useAuthStore();

  useEffect(() => {
    authApi.get('/api/register/hcaptcha-config')
      .then((res) => {
        const enabled = !!res.data?.enabled;
        const key = typeof res.data?.siteKey === 'string' ? res.data.siteKey.trim() : '';
        setCaptchaEnabled(enabled);
        setHcaptchaSiteKey(enabled ? key : '');
        if (!enabled) {
          setCaptchaToken('');
          captchaRef.current?.resetCaptcha();
        }
      })
      .catch(() => {
        // Keep local defaults if config cannot be fetched.
      });
  }, []);

  const handleStartSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!usernameValid || !acceptPrivacy || !acceptTerms || !confirmAge18) return;
    centralRegisterStart(username, captchaToken);
  };

  const handleConfirmSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (totpCode.length !== 6) return;
    centralRegisterConfirm(totpCode).then(() => {
      if (!useAuthStore.getState().error) {
        setSuccess(true);
      }
    });
  };

  // Step 3: Success - redirect to login
  if (success) {
    return (
      <div className="text-center space-y-4">
        <div className="text-success text-4xl">&#10003;</div>
        <p className="text-text-primary font-semibold">Account created successfully!</p>
        <p className="text-sm text-text-secondary">You can now log in with your authenticator app.</p>
        <Button
          onClick={() => {
            clearCentralReg();
            setSuccess(false);
            setUsername('');
            setTotpCode('');
            setCaptchaToken('');
            onRegistered();
          }}
          className="w-full"
        >
          Go to Login
        </Button>
      </div>
    );
  }

  // Step 2: QR code displayed, enter TOTP
  if (centralRegPending) {
    return (
      <form onSubmit={handleConfirmSubmit} className="space-y-4">
        <QrCodeDisplay
          qrCode={centralRegPending.qrCode}
          manualCode={centralRegPending.manualCode}
        />

        <Input
          label="Authenticator Code"
          placeholder="6-digit code from your app"
          value={totpCode}
          onChange={(e) => {
            setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6));
            if (error) clearError();
          }}
          maxLength={6}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
        />

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              clearCentralReg();
              clearError();
            }}
            className="flex-1"
          >
            Back
          </Button>
          <Button type="submit" className="flex-1" disabled={loading || totpCode.length !== 6}>
            {loading ? <Spinner size="sm" /> : 'Confirm'}
          </Button>
        </div>
      </form>
    );
  }

  // Step 1: Username + captcha
  return (
    <form onSubmit={handleStartSubmit} className="space-y-4">
      <Input
        label="Username"
        value={username}
        onChange={(e) => {
          setUsername(e.target.value);
          if (error) clearError();
        }}
        autoFocus
        minLength={4}
        maxLength={32}
      />

      <p className="text-xs text-text-secondary">4-32 characters; letters, numbers, and underscores.</p>

      <div className="space-y-2 text-sm text-text-secondary">
        <label className="flex items-start gap-2"><input type="checkbox" checked={acceptPrivacy} onChange={(e) => setAcceptPrivacy(e.target.checked)} className="mt-1" /><span>I have read and agree to the <a href="https://catrealm.app/privacy/" target="_blank" rel="noopener noreferrer" className="text-accent underline">Privacy Policy</a>.</span></label>
        <label className="flex items-start gap-2"><input type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} className="mt-1" /><span>I have read and agree to the <a href="https://catrealm.app/terms/" target="_blank" rel="noopener noreferrer" className="text-accent underline">Terms of Service</a>.</span></label>
        <label className="flex items-start gap-2"><input type="checkbox" checked={confirmAge18} onChange={(e) => setConfirmAge18(e.target.checked)} className="mt-1" /><span>I confirm that I am 18 years of age or older.</span></label>
      </div>

      {captchaEnabled && hcaptchaSiteKey && (
        <div className="flex justify-center">
          <HCaptcha
            ref={captchaRef}
            sitekey={hcaptchaSiteKey}
            theme="dark"
            onVerify={(token) => setCaptchaToken(token)}
            onExpire={() => setCaptchaToken('')}
          />
        </div>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}

      <Button
        type="submit"
        className="w-full"
        disabled={loading || !usernameValid || !acceptPrivacy || !acceptTerms || !confirmAge18 || (captchaEnabled && !!hcaptchaSiteKey && !captchaToken)}
      >
        {loading ? <Spinner size="sm" /> : 'Continue'}
      </Button>
    </form>
  );
}
