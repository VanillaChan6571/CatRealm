import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import { AUTH_BASE, createAuthenticatedApi } from '../../lib/authApi';
import { forgetKnownAccount, loadKnownAccounts, type KnownAccount } from '../../lib/knownAccounts';
import { resolveAvatarUrl } from '../../utils/avatar';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { AvatarImage } from '../ui/AvatarImage';
import { CentralLoginForm } from '../auth/CentralLoginForm';
import { forgetDMVault } from '../../lib/dmKeyVault';
import { getLocalDeviceId } from '../../lib/deviceIdentity';

type View = { step: 'confirm' } | { step: 'forget' } | { step: 'pick' } | { step: 'login'; username: string };

export function LogoutConfirmDialog() {
  const activeModal = useUIStore((s) => s.activeModal);
  const modalData = useUIStore((s) => s.modalData);
  const closeModal = useUIStore((s) => s.closeModal);
  const logout = useAuthStore((s) => s.logout);
  const switchCentralAccount = useAuthStore((s) => s.switchCentralAccount);
  const user = useAuthStore((s) => s.user);
  const open = activeModal === 'confirmLogout';
  const [view, setView] = useState<View>({ step: 'confirm' });
  const [accounts, setAccounts] = useState<KnownAccount[]>([]);
  const [forgetError, setForgetError] = useState<string | null>(null);
  const [forgetCode, setForgetCode] = useState('');
  const [forgetPending, setForgetPending] = useState(false);
  const forgetRequest = useRef(0);
  const forgetInFlight = useRef(false);
  const forgetDeleting = useRef(false);

  const close = () => {
    if (forgetDeleting.current) return;
    forgetRequest.current++;
    forgetInFlight.current = false;
    setForgetCode('');
    setForgetError(null);
    setForgetPending(false);
    closeModal();
  };

  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setForgetCode('');
      setForgetError(null);
      // The small-screen You tab opens this straight into switching:
      // { mode: 'switch', username } signs in as that saved account, and an
      // empty username goes to a blank login ("Add account").
      const request = modalData as { mode?: string; username?: string } | null;
      if (request?.mode === 'switch' && typeof request.username === 'string') {
        setAccounts(loadKnownAccounts().filter((a) => a.id !== user?.id));
        setView({ step: 'login', username: request.username });
      } else {
        setView({ step: 'confirm' });
      }
    }
  }

  const handleLogout = () => {
    logout();
    close();
  };
  const handleForget = async () => {
    if (forgetInFlight.current || !user || user.accountType !== 'central') return;
    const code = forgetCode.trim();
    if (!/^\d{6}$/.test(code)) {
      setForgetError('Enter the six digit code from your authenticator.');
      return;
    }
    const userId = user.id;
    const deviceId = getLocalDeviceId();
    const token = useAuthStore.getState().token;
    const request = ++forgetRequest.current;
    forgetInFlight.current = true;
    setForgetPending(true);
    setForgetError(null);
    try {
      await createAuthenticatedApi().post('/api/security/step-up', { totpCode: code });
      if (request !== forgetRequest.current) return;
      const current = useAuthStore.getState();
      if (!token || current.user?.id !== userId || current.token !== token || getLocalDeviceId() !== deviceId) {
        throw new Error('Your session changed. Open this action again before forgetting keys.');
      }
      forgetDeleting.current = true;
      await forgetDMVault(userId, deviceId);
      forgetDeleting.current = false;
      if (request !== forgetRequest.current || useAuthStore.getState().token !== token) return;
      logout();
      close();
    } catch (error) {
      if (request === forgetRequest.current) {
        setForgetError((error as { response?: { data?: { error?: string } } })?.response?.data?.error
          ?? (error instanceof Error ? error.message : 'Could not remove local DM keys'));
      }
    } finally {
      forgetDeleting.current = false;
      if (request === forgetRequest.current) {
        forgetInFlight.current = false;
        setForgetPending(false);
      }
    }
  };

  const startSwitch = () => {
    const others = loadKnownAccounts().filter((a) => a.id !== user?.id);
    setAccounts(others);
    setView(others.length > 0 ? { step: 'pick' } : { step: 'login', username: '' });
  };

  const forget = (id: string) => {
    forgetKnownAccount(id);
    setAccounts((list) => list.filter((a) => a.id !== id));
  };

  return (
    <Modal open={open} onClose={close} title={view.step === 'confirm' ? 'Log Out' : view.step === 'forget' ? 'Forget Local DM Keys' : 'Switch Accounts'}>
      {view.step === 'confirm' && (
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Are you sure you want to log out? You will need to sign in again to access this server.
          </p>
          {forgetError && <p role="alert" className="text-sm text-danger">{forgetError}</p>}
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={close}>Cancel</Button>
            {user?.accountType === 'central' && (
              <Button className="!bg-yellow-400 hover:!bg-yellow-300 !text-black" onClick={startSwitch}>
                Switch Accounts
              </Button>
            )}
            <Button variant="danger" onClick={handleLogout}>Log Out</Button>
          </div>
          {user?.accountType === 'central' && (
            <button type="button" onClick={() => { setForgetCode(''); setForgetError(null); setView({ step: 'forget' }); }} className="text-xs text-danger underline">
              Log out and forget encrypted DM keys for this account on this device
            </button>
          )}
        </div>
      )}

      {view.step === 'forget' && (
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void handleForget(); }}>
          <p className="text-sm text-text-secondary">
            This removes this account’s encrypted DM keys from this device. Older messages may become unavailable here if no other key copy survives. You can log out without removing keys instead.
          </p>
          <Input
            label="Current authenticator code"
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            autoComplete="one-time-code"
            value={forgetCode}
            onChange={(event) => setForgetCode(event.target.value.replace(/\D/g, ''))}
            disabled={forgetPending}
            autoFocus
          />
          {forgetError && <p role="alert" className="text-sm text-danger">{forgetError}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => { forgetRequest.current++; setForgetCode(''); setForgetError(null); setView({ step: 'confirm' }); }} disabled={forgetPending}>Back</Button>
            <Button type="submit" variant="danger" disabled={forgetPending || !/^\d{6}$/.test(forgetCode)}>
              {forgetPending ? 'Verifying…' : 'Verify and forget keys'}
            </Button>
          </div>
        </form>
      )}

      {view.step === 'pick' && (
        <div className="space-y-4">
          <div className="space-y-1">
            {accounts.map((account) => (
              <div key={account.id} className="group flex items-center gap-1 rounded-lg hover:bg-bg-hover/60">
                <button
                  type="button"
                  onClick={() => setView({ step: 'login', username: account.username })}
                  className="flex-1 min-w-0 flex items-center gap-3 px-2 py-2 text-left"
                >
                  <div className="w-9 h-9 rounded-full avatar-bg overflow-hidden shrink-0 flex items-center justify-center text-white text-sm font-semibold">
                    <AvatarImage
                      src={resolveAvatarUrl(account.avatar, AUTH_BASE, 'central')}
                      alt={account.username}
                      size={36}
                      className="w-9 h-9 object-cover"
                      fallback={<span>{account.username.charAt(0).toUpperCase()}</span>}
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate">{account.displayName || account.username}</p>
                    <p className="text-xs text-text-muted truncate">@{account.username}</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => forget(account.id)}
                  className="p-2 mr-1 rounded text-text-muted opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-danger transition"
                  title="Remove from this list"
                  aria-label={`Remove ${account.username} from this list`}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2 justify-between">
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button variant="ghost" onClick={() => setView({ step: 'login', username: '' })}>Use another account</Button>
          </div>
        </div>
      )}

      {view.step === 'login' && (
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            You stay signed in as {user?.username} until the new account signs in.
          </p>
          <CentralLoginForm
            key={view.username}
            initialUsername={view.username}
            onSession={({ token, user: nextUser, syncKey }) => void switchCentralAccount(token, nextUser, syncKey)}
          />
          <div className="flex gap-2 justify-between">
            <Button variant="secondary" onClick={close}>Cancel</Button>
            {accounts.length > 0 && (
              <Button variant="ghost" onClick={() => setView({ step: 'pick' })}>Back</Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
