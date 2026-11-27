import { useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Spinner } from '../ui/Spinner';

export function LocalLoginForm() {
  const [username, setUsername] = useState('');
  const [credential, setCredential] = useState('');
  const [method, setMethod] = useState<'password' | 'totp'>('password');
  const { localLogin, serverInfo, serverUrl, loading, error, clearError } = useAuthStore();
  const totpAvailable = serverInfo?.localTotpAuth && serverUrl?.startsWith('https://');
  const effectiveMethod = totpAvailable ? method : 'password';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !credential) return;
    void localLogin(username.trim(), credential, effectiveMethod);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {totpAvailable && <div className="flex rounded-md bg-bg-deepest p-1 gap-1" role="group" aria-label="Local sign-in method">
        {(['password', 'totp'] as const).map((choice) => (
          <button key={choice} type="button" onClick={() => { setMethod(choice); setCredential(''); clearError(); }}
            aria-pressed={method === choice}
            className={`flex-1 text-xs py-1.5 rounded ${method === choice ? 'bg-bg-hover text-text-primary' : 'text-text-muted hover:text-text-secondary'}`}>
            {choice === 'password' ? 'Password' : 'Authenticator code'}
          </button>
        ))}
      </div>}
      <Input
        label="Username"
        value={username}
        onChange={(e) => {
          setUsername(e.target.value);
          if (error) clearError();
        }}
        autoFocus
      />
      <Input
        label={effectiveMethod === 'password' ? 'Password' : 'Authenticator or recovery code'}
        type={effectiveMethod === 'password' ? 'password' : 'text'}
        autoComplete={effectiveMethod === 'totp' ? 'one-time-code' : 'current-password'}
        value={credential}
        onChange={(e) => {
          setCredential(e.target.value);
          if (error) clearError();
        }}
      />

      {error && <p className="text-sm text-danger">{error}</p>}

      <Button type="submit" className="w-full" disabled={loading || !username.trim() || !credential}>
        {loading ? <Spinner size="sm" /> : 'Log In'}
      </Button>
    </form>
  );
}
