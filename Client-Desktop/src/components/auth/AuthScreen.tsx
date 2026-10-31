import { useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { LocalLoginForm } from './LocalLoginForm';
import { LocalRegisterForm } from './LocalRegisterForm';
import { CentralLoginForm } from './CentralLoginForm';
import { CentralRegisterForm } from './CentralRegisterForm';
import { AuthBackdrop } from './AuthBackdrop';
type Tab = 'login' | 'register';
type AccountType = 'local' | 'central';

export function AuthScreen() {
  const { serverInfo, disconnect, clearError } = useAuthStore();
  const [tab, setTab] = useState<Tab>('login');
  const [accountType, setAccountType] = useState<AccountType>('local');

  if (!serverInfo) return null;

  const mode = serverInfo.mode;
  const showAccountToggle = mode === 'mixed';

  // Determine which account type is active
  const effectiveType: AccountType =
    mode === 'decentral_only' ? 'local' :
    mode === 'central_only' ? 'central' :
    accountType;

  const switchTab = (newTab: Tab) => {
    setTab(newTab);
    clearError();
  };

  return (
    <AuthBackdrop>
      <div className="w-full max-w-sm">
        {/* Server info header */}
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-text-primary mb-1">{serverInfo.name}</h1>
          {serverInfo.description && (
            <p className="text-text-secondary text-sm mb-2">{serverInfo.description}</p>
          )}
          <button
            onClick={disconnect}
            className="text-xs text-text-muted hover:text-text-secondary transition-colors"
          >
            &larr; Different server
          </button>
        </div>

        <div className="bg-bg-sidebar rounded-lg p-6 space-y-4">
          {/* Account type toggle for mixed mode */}
          {showAccountToggle && (
            <div className="flex rounded-md bg-bg-deepest p-1 gap-1">
              <button
                onClick={() => { setAccountType('local'); clearError(); }}
                className={`flex-1 text-xs py-1.5 rounded transition-colors ${
                  accountType === 'local'
                    ? 'bg-bg-hover text-text-primary'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                Local Account
              </button>
              <button
                onClick={() => { setAccountType('central'); clearError(); }}
                className={`flex-1 text-xs py-1.5 rounded transition-colors ${
                  accountType === 'central'
                    ? 'bg-bg-hover text-text-primary'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                CatRealm Account
              </button>
            </div>
          )}

          {/* Login / Register tabs */}
          <div className="flex gap-4 border-b border-border pb-2">
            <button
              onClick={() => switchTab('login')}
              className={`text-sm font-medium pb-1 transition-colors ${
                tab === 'login'
                  ? 'text-text-primary border-b-2 border-accent'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              Log In
            </button>
            {(effectiveType === 'local' ? serverInfo.registrationOpen : true) && (
              <button
                onClick={() => switchTab('register')}
                className={`text-sm font-medium pb-1 transition-colors ${
                  tab === 'register'
                    ? 'text-text-primary border-b-2 border-accent'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                Register
              </button>
            )}
          </div>

          {/* Forms */}
          {effectiveType === 'local' && tab === 'login' && <LocalLoginForm />}
          {effectiveType === 'local' && tab === 'register' && <LocalRegisterForm />}
          {effectiveType === 'central' && tab === 'login' && <CentralLoginForm />}
          {effectiveType === 'central' && tab === 'register' && (
            <CentralRegisterForm onRegistered={() => setTab('login')} />
          )}

          {/* Help text */}
          {showAccountToggle && (
            <p className="text-xs text-text-muted text-center">
              {effectiveType === 'local'
                ? 'Local accounts are specific to this server.'
                : 'CatRealm accounts work across all CatRealm servers.'}
            </p>
          )}
        </div>
      </div>
    </AuthBackdrop>
  );
}
