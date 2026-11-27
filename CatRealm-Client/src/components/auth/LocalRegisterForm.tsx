import { useState } from 'react';
import type { User } from '../../types';
import { useAuthStore } from '../../stores/authStore';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Spinner } from '../ui/Spinner';
import { QrCodeDisplay } from './QrCodeDisplay';

type PendingTotp = { enrollmentId: string; qrCode: string; manualCode: string };
type ConfirmedTotp = { token: string; user: User; recoveryCodes: string[] };

export function LocalRegisterForm() {
  const [username, setUsername] = useState('');
  const [method, setMethod] = useState<'password' | 'totp'>('password');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [pending, setPending] = useState<PendingTotp | null>(null);
  const [confirmed, setConfirmed] = useState<ConfirmedTotp | null>(null);
  const [savedCodes, setSavedCodes] = useState(false);
  const [validationError, setValidationError] = useState('');
  const { localRegister, localTotpStart, localTotpConfirm, completeLocalTotpRegistration,
    serverInfo, serverUrl, loading, error, clearError } = useAuthStore();
  const totpAvailable = serverInfo?.localTotpAuth && serverUrl?.startsWith('https://');
  const effectiveMethod = totpAvailable ? method : 'password';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError('');
    if (!/^[a-zA-Z0-9_]{4,32}$/.test(username)) {
      setValidationError('Username must be 4-32 letters, numbers, or underscores');
      return;
    }
    if (pending) {
      if (!/^[0-9]{6}$/.test(totpCode)) return;
      const result = await localTotpConfirm(pending.enrollmentId, totpCode);
      if (result) setConfirmed(result);
      return;
    }
    if (effectiveMethod === 'totp') {
      const result = await localTotpStart(username);
      if (result) setPending(result);
      return;
    }
    if (Array.from(password).length < 15 || new TextEncoder().encode(password).length > 72) {
      setValidationError('Password must be at least 15 characters and at most 72 bytes');
      return;
    }
    if (password !== confirm) {
      setValidationError('Passwords do not match');
      return;
    }
    void localRegister(username, password);
  };

  if (confirmed) {
    return <div className="space-y-4">
      <p className="text-sm text-text-secondary">Save these one-time recovery codes now. They are the only way to sign in if you lose your authenticator. They will not be shown again.</p>
      <div className="grid grid-cols-2 gap-2 rounded-md bg-bg-deepest p-3">
        {confirmed.recoveryCodes.map((code) => <code key={code} className="text-xs text-text-primary select-all break-all">{code}</code>)}
      </div>
      <label className="flex items-center gap-2 text-sm text-text-secondary">
        <input type="checkbox" checked={savedCodes} onChange={(e) => setSavedCodes(e.target.checked)} />
        I saved my recovery codes
      </label>
      <Button type="button" className="w-full" disabled={!savedCodes}
        onClick={() => completeLocalTotpRegistration(confirmed)}>Enter realm</Button>
    </div>;
  }

  if (pending) {
    return <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-text-secondary">Add <strong>CatRealm - local {username} {serverInfo?.name || 'CatRealm Server'}</strong> to your authenticator app. This secret belongs only to this realm.</p>
      <QrCodeDisplay qrCode={pending.qrCode} manualCode={pending.manualCode} />
      <Input label="Six-digit authenticator code" value={totpCode} inputMode="numeric"
        autoComplete="one-time-code" maxLength={6} autoFocus
        onChange={(e) => { setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6)); clearError(); }} />
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" variant="secondary" className="flex-1" onClick={() => { setPending(null); setTotpCode(''); clearError(); }}>Back</Button>
        <Button type="submit" className="flex-1" disabled={loading || totpCode.length !== 6}>
          {loading ? <Spinner size="sm" /> : 'Confirm code'}
        </Button>
      </div>
    </form>;
  }

  return <form onSubmit={handleSubmit} className="space-y-4">
    {totpAvailable && <div className="flex rounded-md bg-bg-deepest p-1 gap-1" role="group" aria-label="Local sign-in method">
      {(['password', 'totp'] as const).map((choice) => <button key={choice} type="button"
        onClick={() => { setMethod(choice); setValidationError(''); clearError(); }} aria-pressed={method === choice}
        className={`flex-1 text-xs py-1.5 rounded ${method === choice ? 'bg-bg-hover text-text-primary' : 'text-text-muted hover:text-text-secondary'}`}>
        {choice === 'password' ? 'Password' : 'Authenticator code'}
      </button>)}
    </div>}
    <Input label="Username" value={username} onChange={(e) => { setUsername(e.target.value); setValidationError(''); clearError(); }}
      autoFocus minLength={4} maxLength={32} />
    <p className="text-xs text-text-secondary">4-32 characters; letters, numbers, and underscores.</p>
    {effectiveMethod === 'password' ? <>
      <Input label="Password" type="password" value={password}
        onChange={(e) => { setPassword(e.target.value); setValidationError(''); clearError(); }} />
      <Input label="Confirm Password" type="password" value={confirm}
        onChange={(e) => { setConfirm(e.target.value); setValidationError(''); }} />
      <p className="text-xs text-text-secondary">At least 15 characters.</p>
    </> : <p className="text-sm text-text-secondary">You will scan a QR code and confirm a rotating code before the account is created.</p>}
    {(validationError || error) && <p className="text-sm text-danger">{validationError || error}</p>}
    <Button type="submit" className="w-full" disabled={loading}>
      {loading ? <Spinner size="sm" /> : effectiveMethod === 'totp' ? 'Set up authenticator' : 'Create Account'}
    </Button>
  </form>;
}
