import { useCallback, useEffect, useRef, useState } from 'react';
import { createAuthenticatedApi, AUTH_BASE } from '../../lib/authApi';
import { getLocalDeviceId } from '../../lib/deviceIdentity';
import { getSocket } from '../../lib/socket';
import { approveSurvivingDevice } from '../../lib/approveSurvivingDevice';
import { verifyCurrentDeviceForKeySharing } from '../../lib/verifyDeviceForKeySharing';
import { canRequestPeerKeyRecovery, createSurvivorTrustProof, fetchDMKeyManifest, getLocalConversationSecret, shareDMKeyForRecovery, syncKnownConversationKeys, type DMKeyManifest, type DMKeyRecoveryRequest } from '../../messaging/crypto/dmKeyStore';
import { useAuthStore } from '../../stores/authStore';

type RecoveryState = { incoming: DMKeyRecoveryRequest | null; outgoing: DMKeyRecoveryRequest | null; serverNowMs?: number };

export function DMKeyRecoveryPanel({ conversationId, otherUsername, onIncomingChange }: {
  conversationId: string;
  otherUsername: string;
  onIncomingChange: (pending: boolean) => void;
}) {
  const userId = useAuthStore((state) => state.user?.id);
  const [state, setState] = useState<RecoveryState>({ incoming: null, outgoing: null });
  const [eligible, setEligible] = useState(false);
  const [manifest, setManifest] = useState<DMKeyManifest | null>(null);
  const [hasLocalKey, setHasLocalKey] = useState(false);
  const [selfApprovalUnavailable, setSelfApprovalUnavailable] = useState(false);
  const [totp, setTotp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const refreshRevision = useRef(0);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const revision = ++refreshRevision.current;
    const api = createAuthenticatedApi();
    const [statusResult, manifestResult] = await Promise.allSettled([
      api.get<RecoveryState>(`/api/dms/conversations/${conversationId}/key-recovery`),
      fetchDMKeyManifest(conversationId),
    ]);
    if (refreshRevision.current !== revision || useAuthStore.getState().user?.id !== userId) return;
    if (statusResult.status === 'rejected') return;
    setState(statusResult.value.data);
    setClockOffsetMs(typeof statusResult.value.data.serverNowMs === 'number' ? statusResult.value.data.serverNowMs - Date.now() : 0);
    setManifest(manifestResult.status === 'fulfilled' ? manifestResult.value : null);
    setHasLocalKey(manifestResult.status === 'fulfilled' && manifestResult.value.activeKeyVersion != null
      ? Boolean(getLocalConversationSecret(conversationId, manifestResult.value.activeKeyVersion))
      : false);
    setEligible(manifestResult.status === 'fulfilled'
      ? canRequestPeerKeyRecovery(manifestResult.value, userId, getLocalDeviceId())
      : false);
  }, [conversationId, userId]);

  useEffect(() => {
    let alive = true;
    setState({ incoming: null, outgoing: null });
    setEligible(false);
    setManifest(null);
    setHasLocalKey(false);
    setSelfApprovalUnavailable(false);
    setError(null);
    onIncomingChange(false);
    const update = () => { if (alive) void refresh().catch(() => {}); };
    const socket = getSocket(AUTH_BASE);
    const onRecoveryUpdate = (payload: { conversationId?: string }) => {
      if (payload.conversationId === conversationId) update();
    };
    update();
    socket?.on('dm:key-recovery:updated', onRecoveryUpdate);
    socket?.on('device:trust-updated', update);
    const poll = window.setInterval(update, 30_000);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive = false;
      refreshRevision.current += 1;
      window.clearInterval(poll);
      window.clearInterval(clock);
      socket?.off('dm:key-recovery:updated', onRecoveryUpdate);
      socket?.off('device:trust-updated', update);
      onIncomingChange(false);
    };
  }, [conversationId, refresh, onIncomingChange]);

  useEffect(() => {
    onIncomingChange(Boolean(state.incoming && ['pending', 'reviewing', 'approved'].includes(state.incoming.status)));
  }, [state.incoming, onIncomingChange]);

  const localDevice = manifest?.devices.find((device) => device.id === getLocalDeviceId() && device.userId === userId);
  const localKeyNeedsTrust = hasLocalKey && manifest?.activeKeyVersion != null && (!localDevice || localDevice.dmTrustState !== 'trusted');
  const peerHasKey = manifest?.activeKeyVersion != null && manifest.devices.some((device) =>
    device.userId !== userId && device.dmTrustState === 'trusted' && device.hasWrappedKeyVersions.includes(manifest.activeKeyVersion!));
  if (!eligible && !localKeyNeedsTrust && !state.incoming && !state.outgoing) return null;

  const api = createAuthenticatedApi();
  const assertActiveAccount = () => {
    if (useAuthStore.getState().user?.id !== userId) throw new Error('Account changed.');
  };
  const verifyFactor = async (method: 'totp' | 'passkey') => {
    if (method === 'passkey') await verifyCurrentDeviceForKeySharing();
    else {
      if (!/^\d{6}$/.test(totp)) throw new Error('Enter your six-digit 2FA code.');
      await api.post('/api/security/step-up', { totpCode: totp });
    }
  };
  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      setTotp('');
      await refresh();
    } catch (cause) {
      const response = (cause as { response?: { data?: { error?: string; code?: string } } })?.response;
      if (response?.data?.code === 'NO_PRIOR_DEVICE_KEY') setSelfApprovalUnavailable(true);
      setError(response?.data?.error
        || (cause instanceof Error ? cause.message : 'Key recovery failed. Please try again.'));
    } finally { setBusy(false); }
  };
  const request = (method: 'totp' | 'passkey') => run(async () => {
    await verifyFactor(method);
    assertActiveAccount();
    await api.post(`/api/dms/conversations/${conversationId}/key-recovery`, { deviceId: getLocalDeviceId() });
  });
  const submitSurvivorProof = async (request: DMKeyRecoveryRequest) => {
    const proof = await createSurvivorTrustProof(request);
    assertActiveAccount();
    await api.post(`/api/dms/conversations/${conversationId}/key-recovery/${request.id}/survivor-proof`, { proof });
  };
  const requestSurvivorTrust = () => run(async () => {
    await verifyFactor('totp');
    assertActiveAccount();
    const created = await api.post<{ request: DMKeyRecoveryRequest }>(`/api/dms/conversations/${conversationId}/key-recovery`, {
      deviceId: getLocalDeviceId(), mode: 'survivor-trust',
    });
    await submitSurvivorProof(created.data.request);
  });
  const retrySurvivorProof = () => run(async () => {
    if (!state.outgoing) return;
    await verifyFactor('totp');
    await submitSurvivorProof(state.outgoing);
  });
  const approveSurvivor = () => run(async () => {
    assertActiveAccount();
    await approveSurvivingDevice(totp);
    void syncKnownConversationKeys().catch(() => {});
  });
  const review = (method: 'totp' | 'passkey') => run(async () => {
    if (!state.incoming) return;
    await verifyFactor(method);
    assertActiveAccount();
    await api.post(`/api/dms/conversations/${conversationId}/key-recovery/${state.incoming.id}/review`, { deviceId: getLocalDeviceId() });
  });
  const cancel = (requestId: string) => run(async () => {
    assertActiveAccount();
    await api.post(`/api/dms/conversations/${conversationId}/key-recovery/${requestId}/cancel`);
  });
  const continueSharing = () => run(async () => {
    const incoming = state.incoming;
    if (!incoming) return;
    assertActiveAccount();
    if (incoming.mode === 'survivor-trust') {
      const proof = await createSurvivorTrustProof(incoming);
      assertActiveAccount();
      await api.post(`/api/dms/conversations/${conversationId}/key-recovery/${incoming.id}/approve`, { proof });
      return;
    }
    if (incoming.status === 'reviewing') {
      await api.post(`/api/dms/conversations/${conversationId}/key-recovery/${incoming.id}/approve`);
    }
    assertActiveAccount();
    try {
      await shareDMKeyForRecovery(incoming);
    } catch (cause) {
      if (!(cause as { response?: { data?: { proofRequired?: boolean } } })?.response?.data?.proofRequired) throw cause;
      await verifyCurrentDeviceForKeySharing();
      assertActiveAccount();
      await shareDMKeyForRecovery(incoming);
    }
  });
  const countdown = state.incoming?.reviewUntil ? Math.max(0, Math.ceil((state.incoming.reviewUntil * 1000 - now - clockOffsetMs) / 1000)) : 20;

  return <div role="status" className="mx-4 mt-2 rounded border border-red-500/40 bg-red-500/10 px-3 py-3 text-sm text-text-primary">
    {localKeyNeedsTrust ? <>
      <strong>This device still has the DM key</strong>
      <p className="mt-1 text-text-secondary">{localDevice
        ? selfApprovalUnavailable
          ? 'Central has no earlier key copy for this device. Ask the other DM participant to compare the shared key from a trusted device.'
          : 'Central marks this device untrusted for key sharing. Enter your authenticator code to prove you own this account and this device’s existing encryption key.'
        : 'Central does not recognize this device. Check its registration in Account Security → Devices.'} Keep this app and its data intact until key sharing succeeds.</p>
      {localDevice && <>
        <input aria-label="2FA code to verify this device" inputMode="numeric" autoComplete="one-time-code" value={totp} onChange={(event) => setTotp(event.target.value)} maxLength={6} placeholder="6-digit 2FA code" className="mt-2 rounded border border-border bg-bg-elevated px-2 py-1" />
        {!selfApprovalUnavailable && <button type="button" onClick={() => void approveSurvivor()} disabled={busy || !/^\d{6}$/.test(totp)} className="ml-2 rounded bg-red-500/20 px-3 py-1 disabled:opacity-50">Verify this device with 2FA</button>}
        {state.outgoing?.mode === 'survivor-trust' ? <>
          <p className="mt-2 text-text-secondary">{state.outgoing.survivorProofReady
            ? `Waiting for ${otherUsername} to compare the same DM key and approve this device. This request expires in 24 hours.`
            : 'The request is waiting for this device’s key proof. Send it before the other person can review.'}</p>
          {!state.outgoing.survivorProofReady && <button type="button" onClick={() => void retrySurvivorProof()} disabled={busy || !/^\d{6}$/.test(totp)} className="mt-2 rounded bg-red-500/20 px-3 py-1 disabled:opacity-50">Send key proof with 2FA</button>}
          <button type="button" onClick={() => void cancel(state.outgoing!.id)} disabled={busy} className="ml-2 underline">Cancel verification request</button>
        </> : peerHasKey ? <>
          <p className="mt-2 text-text-secondary">If Central has no earlier key copy for this device, ask {otherUsername} to compare this DM key from a trusted device. Both accounts must confirm with 2FA.</p>
          <button type="button" onClick={() => void requestSurvivorTrust()} disabled={busy || !/^\d{6}$/.test(totp)} className="mt-2 rounded bg-red-500/20 px-3 py-1 disabled:opacity-50">Ask {otherUsername} to verify this DM key</button>
        </> : <p className="mt-2 text-text-secondary">{otherUsername} has no trusted copy of this DM key available for shared verification.</p>}
      </>}
    </> : state.outgoing ? <>
      <strong>DM key recovery requested</strong>
      <p className="mt-1 text-text-secondary">{state.outgoing.mode === 'survivor-trust'
        ? `Waiting for ${otherUsername} to compare the shared DM key and approve this device. This request expires in 24 hours.`
        : `Waiting for ${otherUsername} to verify their identity and choose whether to share an encrypted copy of this DM key with this device. This request expires in 24 hours.`}</p>
      <button type="button" onClick={() => void cancel(state.outgoing!.id)} disabled={busy} className="mt-2 underline">Cancel request</button>
    </> : state.incoming ? <>
      <strong className="text-red-300">{state.incoming.mode === 'survivor-trust'
        ? `${otherUsername} asks you to verify their device using this DM key`
        : `${otherUsername} is requesting a copy of this DM key`}</strong>
      {state.incoming.status === 'pending' ? <>
        {state.incoming.mode === 'survivor-trust' && !state.incoming.survivorProofReady
          ? <p className="mt-1 text-text-secondary">Waiting for the other device to submit its DM key proof before you can review.</p>
          : <>
        <p className="mt-1 text-text-secondary">Verify with 2FA or a passkey before reviewing this request. Your device must hold the key. {state.incoming.mode === 'survivor-trust' ? 'The devices compare proofs without sending the key to Central.' : ''}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input aria-label="2FA code for DM key recovery" inputMode="numeric" autoComplete="one-time-code" value={totp} onChange={(event) => setTotp(event.target.value)} maxLength={6} placeholder="6-digit 2FA code" className="rounded border border-border bg-bg-elevated px-2 py-1" />
          <button type="button" onClick={() => void review('totp')} disabled={busy} className="rounded bg-red-500/20 px-3 py-1">Review with 2FA</button>
          <button type="button" onClick={() => void review('passkey')} disabled={busy} className="rounded bg-red-500/20 px-3 py-1">Review with passkey</button>
        </div>
        </>}
      </> : state.incoming.status === 'reviewing' ? <>
        <p className="mt-2 font-semibold text-red-200">Final Notice</p>
        <p className="mt-1">{state.incoming.mode === 'survivor-trust'
          ? 'Approving will restore trust to the other account’s device if it holds the same DM key. That device may then receive other DM keys belonging to that account. Do not continue if you think you are being tricked. Confirm the person through a channel you already trust.'
          : 'If you share this DM key, the person receiving it may not be who they say they are. This is the final security check. Do not continue if you think you are being tricked. If you share a server, confirm with them there through a channel you already trust.'}</p>
        <div className="mt-3 flex gap-3">
          <button type="button" onClick={() => void cancel(state.incoming!.id)} disabled={busy} className="rounded border border-border px-3 py-1">Cancel &amp; Close</button>
          <button type="button" onClick={() => void continueSharing()} disabled={busy || countdown > 0} className="rounded bg-red-600 px-3 py-1 text-white disabled:opacity-50">{countdown > 0 ? `Continue in ${countdown} seconds` : 'Continue'}</button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-text-secondary">
          <span>If your verification expired or you changed devices, restart the review:</span>
          <input aria-label="2FA code to restart DM key recovery review" inputMode="numeric" autoComplete="one-time-code" value={totp} onChange={(event) => setTotp(event.target.value)} maxLength={6} placeholder="6-digit 2FA code" className="rounded border border-border bg-bg-elevated px-2 py-1" />
          <button type="button" onClick={() => void review('totp')} disabled={busy} className="underline">Verify again with 2FA</button>
          <button type="button" onClick={() => void review('passkey')} disabled={busy} className="underline">Verify again with passkey</button>
        </div>
      </> : <>
        <p className="mt-1">Approval was recorded. Send the encrypted key copy to finish recovery.</p>
        <button type="button" onClick={() => void continueSharing()} disabled={busy} className="mt-2 rounded bg-red-600 px-3 py-1 text-white">Send encrypted key</button>
        <p className="mt-2 text-xs text-text-secondary">If this device cannot send it, verify a device that holds the key and review again.</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <input aria-label="2FA code to restart DM key recovery review" inputMode="numeric" autoComplete="one-time-code" value={totp} onChange={(event) => setTotp(event.target.value)} maxLength={6} placeholder="6-digit 2FA code" className="rounded border border-border bg-bg-elevated px-2 py-1" />
          <button type="button" onClick={() => void review('totp')} disabled={busy} className="underline">Review again with 2FA</button>
          <button type="button" onClick={() => void review('passkey')} disabled={busy} className="underline">Review again with passkey</button>
        </div>
      </>}
    </> : <>
      <strong>Request decrypt</strong>
      <p className="mt-1 text-text-secondary">None of your trusted devices can decrypt this DM. You can ask {otherUsername} to verify their identity and share an encrypted copy with this device. Verify your identity first.</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input aria-label="2FA code for DM key recovery" inputMode="numeric" autoComplete="one-time-code" value={totp} onChange={(event) => setTotp(event.target.value)} maxLength={6} placeholder="6-digit 2FA code" className="rounded border border-border bg-bg-elevated px-2 py-1" />
        <button type="button" onClick={() => void request('totp')} disabled={busy} className="rounded bg-red-500/20 px-3 py-1">Request decrypt with 2FA</button>
        <button type="button" onClick={() => void request('passkey')} disabled={busy} className="rounded bg-red-500/20 px-3 py-1">Request decrypt with passkey</button>
      </div>
    </>}
    {error && <p role="alert" className="mt-2 text-red-300">{error}</p>}
  </div>;
}
