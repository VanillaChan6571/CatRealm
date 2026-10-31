import { useEffect, useRef, useState } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';
import axios from 'axios';
import { useAuthStore } from '../../stores/authStore';
import { AUTH_BASE, getCentralDeviceHeaders, getDesktopClientHeaders } from '../../lib/authApi';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Spinner } from '../ui/Spinner';

type CentralSession = { token: string; user: { id: string; username: string }; syncKey: string | null };

type CentralLoginFormProps = {
  initialUsername?: string;
  // Switch mode: hand the new session back instead of replacing the current one,
  // so a failed or cancelled attempt leaves the signed-in account untouched.
  onSession?: (session: CentralSession) => void;
};

export function CentralLoginForm({ initialUsername = '', onSession }: CentralLoginFormProps = {}) {
  const [username, setUsername] = useState(initialUsername);
  const [totpCode, setTotpCode] = useState('');
  const [hasPasskey, setHasPasskey] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const { centralLogin, centralLoginWithToken, loading: storeLoading, error: storeError, clearError: clearStoreError } = useAuthStore();
  const [switchLoading, setSwitchLoading] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const loading = onSession ? switchLoading : storeLoading;
  const error = onSession ? switchError : storeError;
  const clearError = onSession ? () => setSwitchError(null) : clearStoreError;
  const setError = (msg: string) => (onSession ? setSwitchError(msg) : useAuthStore.setState({ error: msg, loading: false }));
  const finish = (token: string, authUser: { id: string; username: string }, syncKey: string | null) => (
    onSession ? onSession({ token, user: authUser, syncKey }) : centralLoginWithToken(token, authUser.id, authUser.username, syncKey)
  );
  const mounted = useRef(false);
  const passkeyAttempt = useRef(0);
  const passkeyAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      passkeyAbort.current?.abort();
    };
  }, []);

  // Detect if the user has registered security keys (debounced on username change)
  useEffect(() => {
    if (!username.trim()) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const desktop = Boolean(window.electron?.openPasskeyWindow);
        const path = desktop ? 'desktop/login/available' : 'login-options';
        const res = await axios.post(`${AUTH_BASE}/api/security/webauthn/${path}`, { username: username.trim() }, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setHasPasskey(desktop ? res.data.available === true : Array.isArray(res.data.allowCredentials) && res.data.allowCredentials.length > 0);
      } catch { if (!controller.signal.aborted) setHasPasskey(false); }
    }, 500);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [username]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !totpCode.trim()) return;
    passkeyAttempt.current++;
    passkeyAbort.current?.abort();
    if (!onSession) {
      centralLogin(username.trim(), totpCode.trim());
      return;
    }
    setSwitchLoading(true);
    setSwitchError(null);
    axios.post(`${AUTH_BASE}/api/login`, { username: username.trim(), totpCode: totpCode.trim() }, {
      headers: { ...getDesktopClientHeaders(), ...getCentralDeviceHeaders() },
    })
      .then((res) => {
        if (!mounted.current) return;
        finish(res.data.token, res.data.user, res.data.syncKey ?? null);
      })
      .catch((err: unknown) => {
        if (!mounted.current) return;
        setSwitchLoading(false);
        setSwitchError((axios.isAxiosError(err) ? err.response?.data?.error : null) || 'Invalid username or 2FA code');
      });
  };

  const handlePasskeyLogin = async () => {
    if (!username.trim()) return;
    passkeyAbort.current?.abort();
    const controller = new AbortController();
    passkeyAbort.current = controller;
    const attempt = ++passkeyAttempt.current;
    const initialUserId = useAuthStore.getState().user?.id;
    const initialToken = useAuthStore.getState().token;
    const isCurrentAttempt = () => mounted.current && attempt === passkeyAttempt.current && !controller.signal.aborted
      && useAuthStore.getState().user?.id === initialUserId && useAuthStore.getState().token === initialToken;
    setPasskeyLoading(true);
    clearError();
    try {
      if (window.electron?.openPasskeyWindow) {
        const headers = getCentralDeviceHeaders();
        const start = await axios.post(`${AUTH_BASE}/api/security/webauthn/desktop/login/start`, { username: username.trim() }, { headers, signal: controller.signal });
        if (!isCurrentAttempt()) return;
        const opened = await window.electron.openPasskeyWindow(new URL(start.data.url, AUTH_BASE).toString());
        if (!isCurrentAttempt()) return;
        if (opened && !opened.ok) throw new Error(opened.message || 'Could not open the passkey window.');
        const deadline = Date.now() + 300000;
        while (Date.now() < deadline && isCurrentAttempt()) {
          await new Promise(resolve => window.setTimeout(resolve, 1500));
          if (!isCurrentAttempt()) return;
          const result = await axios.post(`${AUTH_BASE}/api/security/webauthn/desktop/login/status`, {
            flowId: start.data.flowId, pollSecret: start.data.pollSecret,
          }, { headers, signal: controller.signal });
          if (!isCurrentAttempt()) return;
          if (result.data.status === 'complete') {
            const { token, user: authUser, syncKey } = result.data;
            finish(token, authUser, syncKey ?? null);
            return;
          }
          if (result.data.status === 'failed') throw new Error('Passkey authentication failed. Start again.');
        }
        throw new Error('Passkey authentication timed out. Start again.');
      }
      const optionsRes = await axios.post(`${AUTH_BASE}/api/security/webauthn/login-options`, { username: username.trim() }, { signal: controller.signal });
      if (!isCurrentAttempt()) return;
      const authResp = await startAuthentication({ optionsJSON: optionsRes.data });
      if (!isCurrentAttempt()) return;
      const verifyRes = await axios.post(`${AUTH_BASE}/api/security/webauthn/login-verify`, {
        username: username.trim(),
        credential: authResp,
      }, { headers: getCentralDeviceHeaders(), signal: controller.signal });
      if (!isCurrentAttempt()) return;
      const { token, user: authUser, syncKey } = verifyRes.data;
      finish(token, authUser, syncKey ?? null);
    } catch (err: unknown) {
      if (!isCurrentAttempt()) return;
      const msg = axios.isAxiosError(err)
        ? err.response?.data?.error
        : (err as { message?: string })?.message;
      setError(msg ?? 'Passkey authentication failed');
    } finally { if (mounted.current && attempt === passkeyAttempt.current) setPasskeyLoading(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Username"
        value={username}
        onChange={(e) => {
          setUsername(e.target.value);
          setHasPasskey(false);
          if (error) clearError();
        }}
        autoFocus
      />
      <Input
        label="Authenticator Code"
        placeholder="6-digit code or backup code"
        value={totpCode}
        onChange={(e) => {
          // Allow 6-digit TOTP (numeric only) OR 64-char hex backup code
          const raw = e.target.value;
          const stripped = raw.replace(/[^a-fA-F0-9]/g, '');
          setTotpCode(stripped.slice(0, 64));
          if (error) clearError();
        }}
        maxLength={64}
        inputMode="text"
        autoComplete="one-time-code"
      />

      {error && <p className="text-sm text-danger">{error}</p>}

      <Button
        type="submit"
        className="w-full"
        disabled={loading || passkeyLoading || !username.trim() || (totpCode.length !== 6 && totpCode.length !== 64)}
      >
        {loading ? <Spinner size="sm" /> : 'Log In'}
      </Button>

      {hasPasskey && (
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          onClick={() => void handlePasskeyLogin()}
          disabled={loading || passkeyLoading || !username.trim()}
        >
          {passkeyLoading ? <Spinner size="sm" /> : 'Use passkey / security key'}
        </Button>
      )}
    </form>
  );
}
