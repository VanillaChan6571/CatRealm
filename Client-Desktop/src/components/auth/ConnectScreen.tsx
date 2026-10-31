import { useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { CentralLoginForm } from './CentralLoginForm';
import { CentralRegisterForm } from './CentralRegisterForm';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Spinner } from '../ui/Spinner';
import { AuthBackdrop } from './AuthBackdrop';

type View = 'home' | 'central' | 'server';
type CentralTab = 'login' | 'register';

export function ConnectScreen() {
  const [view, setView] = useState<View>('home');
  const [centralTab, setCentralTab] = useState<CentralTab>('login');
  const [url, setUrl] = useState('');
  const { setServerUrl, loading, error, clearError } = useAuthStore();

  const handleServerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setServerUrl(url.trim());
  };

  const goHome = () => {
    setView('home');
    setCentralTab('login');
    setUrl('');
    clearError();
  };

  // Home: two options
  if (view === 'home') {
    return (
      <AuthBackdrop>
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-text-primary mb-2">CatRealm</h1>
            <p className="text-text-secondary text-sm">Choose how you want to connect</p>
          </div>

          <div className="space-y-3">
            <button
              onClick={() => setView('central')}
              className="w-full bg-accent hover:bg-accent-hover text-white rounded-lg p-4 transition-colors text-left"
            >
              <p className="font-semibold text-sm">Login / Register</p>
              <p className="text-xs opacity-80 mt-0.5">
                Sign in with your CatRealm account
              </p>
            </button>

            <button
              onClick={() => setView('server')}
              className="w-full bg-bg-sidebar hover:bg-bg-hover text-text-primary rounded-lg p-4 transition-colors text-left border border-border"
            >
              <p className="font-semibold text-sm">Connect to Server</p>
              <p className="text-xs text-text-muted mt-0.5">
                Join a decentralized server with its own accounts
              </p>
            </button>
          </div>
        </div>
      </AuthBackdrop>
    );
  }

  // Central auth: login/register forms
  if (view === 'central') {
    return (
      <AuthBackdrop>
        <div className="w-full max-w-sm">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-text-primary mb-1">CatRealm</h1>
            <p className="text-text-secondary text-sm">Central account</p>
            <button
              onClick={goHome}
              className="text-xs text-text-muted hover:text-text-secondary transition-colors mt-1"
            >
              &larr; Back
            </button>
          </div>

          <div className="bg-bg-sidebar rounded-lg p-6 space-y-4">
            {/* Login / Register tabs */}
            <div className="flex gap-4 border-b border-border pb-2">
              <button
                onClick={() => { setCentralTab('login'); clearError(); }}
                className={`text-sm font-medium pb-1 transition-colors ${
                  centralTab === 'login'
                    ? 'text-text-primary border-b-2 border-accent'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                Log In
              </button>
              <button
                onClick={() => { setCentralTab('register'); clearError(); }}
                className={`text-sm font-medium pb-1 transition-colors ${
                  centralTab === 'register'
                    ? 'text-text-primary border-b-2 border-accent'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                Register
              </button>
            </div>

            {centralTab === 'login' && <CentralLoginForm />}
            {centralTab === 'register' && (
              <CentralRegisterForm onRegistered={() => setCentralTab('login')} />
            )}

            <p className="text-xs text-text-muted text-center">
              CatRealm accounts work across all CatRealm servers.
            </p>
          </div>
        </div>
      </AuthBackdrop>
    );
  }

  // Server URL input (decentralized path)
  return (
    <AuthBackdrop>
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-text-primary mb-1">CatRealm</h1>
          <p className="text-text-secondary text-sm">Connect to a server</p>
          <button
            onClick={goHome}
            className="text-xs text-text-muted hover:text-text-secondary transition-colors mt-1"
          >
            &larr; Back
          </button>
        </div>

        <form onSubmit={handleServerSubmit} className="bg-bg-sidebar rounded-lg p-6 space-y-4">
          <Input
            label="Server URL"
            placeholder="http://localhost:3000"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (error) clearError();
            }}
            autoFocus
          />

          {error && <p className="text-sm text-danger">{error}</p>}

          <Button type="submit" className="w-full" disabled={loading || !url.trim()}>
            {loading ? <Spinner size="sm" /> : 'Connect'}
          </Button>
        </form>
      </div>
    </AuthBackdrop>
  );
}
