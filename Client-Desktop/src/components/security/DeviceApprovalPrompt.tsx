import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Laptop, ShieldCheck, Smartphone, X } from 'lucide-react';
import { AUTH_BASE, createAuthenticatedApi } from '../../lib/authApi';
import { getLocalDeviceId, registerCurrentDevice } from '../../lib/deviceIdentity';
import { getSocket } from '../../lib/socket';
import { approveTrustedDeviceRequest, type DeviceApprovalRequest } from '../../lib/trustedDeviceApproval';
import { useAuthStore } from '../../stores/authStore';

function errorMessage(error: unknown, fallback: string) {
  return (error as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
    ?? (error as { message?: string })?.message
    ?? fallback;
}

export function DeviceApprovalPrompt() {
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);
  const [outgoing, setOutgoing] = useState<DeviceApprovalRequest | null>(null);
  const [incoming, setIncoming] = useState<DeviceApprovalRequest[]>([]);
  const [enteringCode, setEnteringCode] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const rotatingRef = useRef(false);
  const startedForAccountRef = useRef<string | null>(null);

  const current = incoming[0] ?? null;

  useEffect(() => {
    if (token && user?.accountType === 'central') return;
    startedForAccountRef.current = null;
    setOutgoing(null);
    setIncoming([]);
    setEnteringCode(false);
    setCode('');
    setError(null);
  }, [token, user?.accountType]);

  const loadPending = useCallback(async () => {
    try {
      const response = await createAuthenticatedApi().get<{ requests: DeviceApprovalRequest[] }>('/api/devices/approval-requests/pending');
      setIncoming(response.data.requests);
    } catch {
      // Untrusted devices correctly receive 403 here; their outgoing flow is handled separately.
    }
  }, []);

  const startOutgoing = useCallback(async () => {
    const deviceId = getLocalDeviceId();
    const response = await createAuthenticatedApi().post<{ request?: DeviceApprovalRequest; alreadyTrusted?: boolean }>(
      `/api/devices/${encodeURIComponent(deviceId)}/request-approval`,
      {},
    );
    if (response.data.request) setOutgoing(response.data.request);
  }, []);

  useEffect(() => {
    if (!token || user?.accountType !== 'central' || startedForAccountRef.current === user.id) return;
    startedForAccountRef.current = user.id;
    let cancelled = false;
    void registerCurrentDevice().then(async (device) => {
      if (cancelled) return;
      if (device.dmTrustState === 'untrusted') await startOutgoing();
      else await loadPending();
    }).catch((err) => {
      const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
      if (code !== 'NO_TRUSTED_DEVICE' && !cancelled) setError(errorMessage(err, 'Could not start device approval.'));
    });
    return () => { cancelled = true; };
  }, [loadPending, startOutgoing, token, user?.accountType, user?.id]);

  useEffect(() => {
    if (!token || user?.accountType !== 'central') return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [token, user?.accountType]);

  useEffect(() => {
    if (!token || user?.accountType !== 'central' || outgoing) return;
    const timer = window.setInterval(() => void loadPending(), 10_000);
    return () => window.clearInterval(timer);
  }, [loadPending, outgoing, token, user?.accountType]);

  useEffect(() => {
    if (!outgoing?.id) return;
    const poll = window.setInterval(() => {
      void createAuthenticatedApi().get<{ request: DeviceApprovalRequest }>(
        `/api/devices/approval-requests/${encodeURIComponent(outgoing.id)}/status`,
      ).then(({ data }) => {
        if (data.request.status === 'pending') setOutgoing((previous) => previous ? { ...previous, ...data.request } : previous);
        else setOutgoing(null);
      }).catch(() => {});
    }, 2000);
    return () => window.clearInterval(poll);
  }, [outgoing?.id]);

  useEffect(() => {
    if (!outgoing || outgoing.status !== 'pending' || outgoing.codeExpiresAt * 1000 > now || outgoing.expiresAt * 1000 <= now || rotatingRef.current) return;
    rotatingRef.current = true;
    void createAuthenticatedApi().post<{ code: string; codeExpiresAt: number; expiresAt: number }>(
      `/api/devices/approval-requests/${encodeURIComponent(outgoing.id)}/rotate`,
      {},
    ).then(({ data }) => setOutgoing((previous) => previous ? { ...previous, ...data, status: 'pending' } : previous))
      .catch((err) => setError(errorMessage(err, 'Could not rotate the device code.')))
      .finally(() => { rotatingRef.current = false; });
  }, [now, outgoing]);

  useEffect(() => {
    if (!token || user?.accountType !== 'central') return;
    let attached: ReturnType<typeof getSocket> = null;
    const requested = (request: DeviceApprovalRequest) => {
      if (request.requesterDeviceId === getLocalDeviceId()) return;
      setIncoming((previous) => previous.some((entry) => entry.id === request.id) ? previous : [...previous, request]);
    };
    const resolved = ({ requestId, status }: { requestId?: string; status?: string }) => {
      if (!requestId) return;
      setIncoming((previous) => previous.filter((entry) => entry.id !== requestId));
      if (outgoing?.id === requestId && status !== 'pending') setOutgoing(null);
    };
    const attach = () => {
      const socket = getSocket(AUTH_BASE);
      if (!socket || socket === attached) return;
      attached?.off('device:approval-requested', requested);
      attached?.off('device:approval-resolved', resolved);
      attached = socket;
      socket.on('device:approval-requested', requested);
      socket.on('device:approval-resolved', resolved);
    };
    attach();
    const timer = window.setInterval(attach, 1000);
    return () => {
      window.clearInterval(timer);
      attached?.off('device:approval-requested', requested);
      attached?.off('device:approval-resolved', resolved);
    };
  }, [outgoing?.id, token, user?.accountType]);

  async function deny() {
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      await createAuthenticatedApi().post(`/api/devices/approval-requests/${encodeURIComponent(current.id)}/deny`, {
        approverDeviceId: getLocalDeviceId(),
      });
      setIncoming((previous) => previous.slice(1));
      setEnteringCode(false);
      setCode('');
    } catch (err) {
      setError(errorMessage(err, 'Could not deny this request.'));
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!current || !/^\d{8}$/.test(code.replace(/\D/g, ''))) return;
    setBusy(true);
    setError(null);
    try {
      await approveTrustedDeviceRequest(current.id, code);
      setIncoming((previous) => previous.slice(1));
      setEnteringCode(false);
      setCode('');
    } catch (err) {
      setError(errorMessage(err, 'Could not approve this device.'));
    } finally {
      setBusy(false);
    }
  }

  if (outgoing) {
    const seconds = Math.max(0, Math.ceil((outgoing.codeExpiresAt * 1000 - now) / 1000));
    return (
      <div className="fixed inset-0 z-[10000] grid place-items-center bg-black/70 p-4 backdrop-blur-sm">
        <div className="w-full max-w-md rounded-2xl border border-border bg-bg-primary p-6 text-center shadow-2xl">
          <ShieldCheck className="mx-auto mb-3 h-10 w-10 text-accent" />
          <h2 className="text-xl font-semibold text-text-primary">Approve this device</h2>
          <p className="mt-2 text-sm text-text-muted">A prompt was sent to your other trusted CatRealm devices. Choose Yes there, then enter this code.</p>
          <div className="my-6 font-mono text-4xl font-bold tracking-[0.16em] text-text-primary">{outgoing.code ?? '••••-••••'}</div>
          <p className="text-xs text-text-muted">This code changes in {seconds} second{seconds === 1 ? '' : 's'}.</p>
          {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        </div>
      </div>
    );
  }

  if (!current) return null;
  const DeviceIcon = current.platform === 'ios' || current.platform === 'android' ? Smartphone : Laptop;
  return (
    <div className="fixed inset-0 z-[10000] grid place-items-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-border bg-bg-primary p-6 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-accent/15 p-3"><DeviceIcon className="h-6 w-6 text-accent" /></div>
          <div>
            <h2 className="text-xl font-semibold text-text-primary">Device wants to be trusted</h2>
            <p className="mt-1 text-sm text-text-muted"><strong className="text-text-primary">{current.deviceName}</strong> ({current.platform}) wants access to your encrypted DMs.</p>
          </div>
        </div>
        {!enteringCode ? (
          <>
            <p className="mt-5 text-sm text-text-muted">Only continue if you recognize this device and started the request yourself.</p>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" disabled={busy} onClick={() => void deny()} className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-text-muted hover:text-danger"><X className="h-4 w-4" />No</button>
              <button type="button" disabled={busy} onClick={() => setEnteringCode(true)} className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-white"><Check className="h-4 w-4" />Yes</button>
            </div>
          </>
        ) : (
          <>
            <label className="mt-5 block text-sm text-text-primary">Enter the 8-digit code shown on that device.</label>
            <input autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={9} value={code}
              onChange={(event) => {
                const digits = event.target.value.replace(/\D/g, '').slice(0, 8);
                setCode(digits.length > 4 ? `${digits.slice(0, 4)}-${digits.slice(4)}` : digits);
              }}
              onKeyDown={(event) => { if (event.key === 'Enter') void approve(); }}
              placeholder="0000-0000" className="mt-2 w-full rounded-lg border border-border bg-bg-secondary px-4 py-3 text-center font-mono text-2xl tracking-[0.18em] text-text-primary" />
            {error && <p className="mt-3 text-sm text-danger">{error}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" disabled={busy} onClick={() => { setEnteringCode(false); setCode(''); setError(null); }} className="rounded-lg border border-border px-4 py-2 text-text-muted">Back</button>
              <button type="button" disabled={busy || !/^\d{4}-\d{4}$/.test(code)} onClick={() => void approve()} className="rounded-lg bg-accent px-4 py-2 text-white disabled:opacity-50">{busy ? 'Checking…' : 'Trust device'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
