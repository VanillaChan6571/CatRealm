import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, TextInput, View } from 'react-native';
import { Pressable, Text } from '@/components';
import { useTheme } from '@/theme';
import { AUTH_BASE, createAuthenticatedApi } from '@/lib/api';
import { getLocalDeviceId } from '@/lib/deviceIdentity';
import { getSocket } from '@/lib/socket';
import { verifyCurrentDeviceForKeySharing } from '@/lib/verifyDeviceForKeySharing';
import { approveSurvivingDevice } from '@/lib/approveSurvivingDevice';
import { canRequestPeerKeyRecovery, createSurvivorTrustProof, fetchDMKeyManifest, getLocalConversationSecret, shareDMKeyForRecovery, syncTrustedDeviceKeysForConversation, type DMKeyManifest, type DMKeyRecoveryRequest } from '@/lib/dmKeyStore';
import { useAuthStore } from '@/stores/authStore';

type RecoveryState = { incoming: DMKeyRecoveryRequest | null; outgoing: DMKeyRecoveryRequest | null; serverNowMs?: number };
type LookupIssue = { source: 'recovery' | 'key' | 'device'; status: number | null };

function lookupIssueText(issue: LookupIssue): string {
  if (issue.source === 'device') return 'This device could not read its local encryption identity. Open device settings and try registering it again.';
  const check = issue.source === 'recovery' ? 'DM key recovery' : 'DM keys';
  if (issue.status === 429) return `Central is rate limiting ${check} checks. Wait for the limit to reset, then retry.`;
  if (issue.status === 401) return `Your Central session was rejected while checking ${check}. Sign in again to renew it.`;
  if (issue.status === 403) return `Central denied this device access to ${check}. Check this device's trust status in Settings.`;
  if (issue.status === 404) return `Central returned HTTP 404 for this conversation's ${check} check. That operation is unavailable for this conversation right now.`;
  if (issue.status != null) return `Central returned HTTP ${issue.status} while checking ${check}. Retry the check shortly.`;
  return `The ${check} check did not get a response from Central. Retry that check.`;
}

function responseStatus(error: unknown): number | null {
  const status = (error as { response?: { status?: unknown } })?.response?.status;
  return typeof status === 'number' ? status : null;
}

export function DMKeyRecoveryPanel({ conversationId, otherUsername, onIncomingChange, onLocalKeyNeedsTrustChange, decryptFailure, keySyncRetryAt, onRetryMessages, onOpenDeviceSettings }: {
  conversationId: string;
  otherUsername: string;
  onIncomingChange: (pending: boolean) => void;
  onLocalKeyNeedsTrustChange?: (needsTrust: boolean) => void;
  decryptFailure?: 1 | 2 | 'unknown' | 'rate_limited' | null;
  keySyncRetryAt?: number;
  onRetryMessages?: () => Promise<unknown>;
  onOpenDeviceSettings?: () => void;
}) {
  const theme = useTheme();
  const userId = useAuthStore((state) => state.user?.id);
  const [state, setState] = useState<RecoveryState>({ incoming: null, outgoing: null });
  const [eligible, setEligible] = useState(false);
  const [manifest, setManifest] = useState<DMKeyManifest | null>(null);
  const [localDeviceId, setLocalDeviceId] = useState<string | null>(null);
  const [hasLocalKey, setHasLocalKey] = useState(false);
  const [selfApprovalUnavailable, setSelfApprovalUnavailable] = useState(false);
  const [lookupIssue, setLookupIssue] = useState<LookupIssue | null>(null);
  const [checked, setChecked] = useState(false);
  const [localRetryAt, setLocalRetryAt] = useState(0);
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
    const deviceId = manifestResult.status === 'fulfilled' ? await getLocalDeviceId().catch(() => null) : null;
    const localKey = manifestResult.status === 'fulfilled' && manifestResult.value.activeKeyVersion != null
      ? await getLocalConversationSecret(conversationId, manifestResult.value.activeKeyVersion).catch(() => null)
      : null;
    if (refreshRevision.current !== revision || useAuthStore.getState().user?.id !== userId) return;
    setChecked(true);
    const statusIssue: LookupIssue | null = statusResult.status === 'rejected'
      ? { source: 'recovery', status: responseStatus(statusResult.reason) } : null;
    const manifestIssue: LookupIssue | null = manifestResult.status === 'rejected'
      ? { source: 'key', status: responseStatus(manifestResult.reason) } : null;
    const issue = manifestIssue?.status === 429 ? manifestIssue
      : statusIssue ?? manifestIssue ?? (deviceId === null ? { source: 'device' as const, status: null } : null);
    setLookupIssue(issue);
    if (issue?.status === 429) setLocalRetryAt((previous) => previous > Date.now() ? previous : Date.now() + 60_000);
    if (statusResult.status === 'fulfilled') {
      setState(statusResult.value.data);
      setClockOffsetMs(typeof statusResult.value.data.serverNowMs === 'number' ? statusResult.value.data.serverNowMs - Date.now() : 0);
    }
    setManifest(manifestResult.status === 'fulfilled' ? manifestResult.value : null);
    setLocalDeviceId(deviceId);
    setHasLocalKey(Boolean(localKey));
    setEligible(statusResult.status === 'fulfilled' && manifestResult.status === 'fulfilled' && deviceId !== null
      ? canRequestPeerKeyRecovery(manifestResult.value, userId, deviceId)
      : false);
  }, [conversationId, userId]);

  useEffect(() => {
    let alive = true;
    setState({ incoming: null, outgoing: null });
    setEligible(false);
    setManifest(null);
    setLocalDeviceId(null);
    setHasLocalKey(false);
    setSelfApprovalUnavailable(false);
    setLookupIssue(null);
    setChecked(false);
    setLocalRetryAt(0);
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
    const poll = setInterval(update, 30_000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive = false;
      refreshRevision.current += 1;
      clearInterval(poll);
      clearInterval(clock);
      socket?.off('dm:key-recovery:updated', onRecoveryUpdate);
      socket?.off('device:trust-updated', update);
      onIncomingChange(false);
    };
  }, [conversationId, refresh, onIncomingChange]);

  useEffect(() => {
    onIncomingChange(Boolean(state.incoming && ['pending', 'reviewing', 'approved'].includes(state.incoming.status)));
  }, [state.incoming, onIncomingChange]);

  const localDevice = manifest?.devices.find((device) => device.id === localDeviceId && device.userId === userId);
  const localKeyNeedsTrust = hasLocalKey && manifest?.activeKeyVersion != null && (!localDevice || localDevice.dmTrustState !== 'trusted');
  useEffect(() => {
    onLocalKeyNeedsTrustChange?.(Boolean(localKeyNeedsTrust));
    return () => onLocalKeyNeedsTrustChange?.(false);
  }, [localKeyNeedsTrust, onLocalKeyNeedsTrustChange]);
  if (!eligible && !localKeyNeedsTrust && !state.incoming && !state.outgoing && !decryptFailure) return null;

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
    Keyboard.dismiss();
    setBusy(true);
    setError(null);
    try {
      await action();
      setTotp('');
      await refresh();
    } catch (cause) {
      const response = (cause as { response?: { status?: number; headers?: Record<string, string>; data?: { error?: string; code?: string } } })?.response;
      if (response?.data?.code === 'NO_PRIOR_DEVICE_KEY') setSelfApprovalUnavailable(true);
      if (response?.status === 429) {
        const retrySeconds = Number(response.headers?.['retry-after']);
        const waitSeconds = Number.isFinite(retrySeconds) && retrySeconds > 0 ? Math.ceil(retrySeconds) : 60;
        setLocalRetryAt(Date.now() + waitSeconds * 1000);
        setError(`Central is rate limiting this request. Wait ${waitSeconds >= 120 ? `${Math.ceil(waitSeconds / 60)} minutes` : `${waitSeconds} seconds`} before trying again.`);
      } else {
        setError(response?.data?.error || (cause instanceof Error ? cause.message : 'Key recovery failed. Please try again.'));
      }
    } finally { setBusy(false); }
  };
  const request = (method: 'totp' | 'passkey') => run(async () => {
    await verifyFactor(method);
    assertActiveAccount();
    await api.post(`/api/dms/conversations/${conversationId}/key-recovery`, { deviceId: await getLocalDeviceId() });
  });
  const requestSurvivorTrust = () => run(async () => {
    await verifyFactor('totp');
    assertActiveAccount();
    const created = await api.post<{ request: DMKeyRecoveryRequest }>(`/api/dms/conversations/${conversationId}/key-recovery`, {
      deviceId: await getLocalDeviceId(), mode: 'survivor-trust',
    });
    await submitSurvivorProof(created.data.request);
  });
  const submitSurvivorProof = async (request: DMKeyRecoveryRequest) => {
    const proof = await createSurvivorTrustProof(request);
    assertActiveAccount();
    await api.post(`/api/dms/conversations/${conversationId}/key-recovery/${request.id}/survivor-proof`, { proof });
  };
  const retrySurvivorProof = () => void run(async () => {
    if (!state.outgoing) return;
    await verifyFactor('totp');
    await submitSurvivorProof(state.outgoing);
  });
  const review = (method: 'totp' | 'passkey') => run(async () => {
    if (!state.incoming) return;
    await verifyFactor(method);
    assertActiveAccount();
    await api.post(`/api/dms/conversations/${conversationId}/key-recovery/${state.incoming.id}/review`, { deviceId: await getLocalDeviceId() });
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
  const peerHasKey = manifest?.activeKeyVersion != null && manifest.devices.some((device) =>
    device.userId !== userId && device.dmTrustState === 'trusted' && device.hasWrappedKeyVersions.includes(manifest.activeKeyVersion!));
  const retry = () => void run(async () => { await onRetryMessages?.(); });
  const approveSurvivor = () => void run(async () => {
    assertActiveAccount();
    await approveSurvivingDevice(totp);
    if (manifest?.activeKeyVersion != null) {
      const secret = await getLocalConversationSecret(conversationId, manifest.activeKeyVersion);
      if (secret) void syncTrustedDeviceKeysForConversation(conversationId, manifest.activeKeyVersion, secret).catch(() => {});
    }
  });
  const retryCheck = () => void run(async () => {});
  const retryCountdown = Math.max(0, Math.ceil((Math.max(keySyncRetryAt ?? 0, localRetryAt) - now) / 1000));
  const action = (label: string, onPress: () => void, disabled = busy) => (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: disabled ? theme.colors.bgElev3 : theme.colors.danger }}>
      <Text variant="bodySmall" color={disabled ? theme.colors.text3 : theme.colors.textOnAccent}>{label}</Text>
    </Pressable>
  );

  return <View style={{ marginHorizontal: 12, marginTop: 8, padding: 12, gap: 8, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.danger, backgroundColor: theme.colors.bgElev1 }}>
    {localKeyNeedsTrust ? <>
      <Text variant="body" style={{ fontWeight: '700' }}>This device still has the DM key</Text>
      <Text variant="bodySmall" color={theme.colors.text2}>
        {localDevice
          ? selfApprovalUnavailable
            ? 'Central has no earlier key copy for this device. Ask the other DM participant to compare the shared key from a trusted device.'
            : 'Central marks this device untrusted for key sharing. Enter your authenticator code to prove you own this account and this device’s existing encryption key.'
          : 'Central does not recognize this device. Open Account Security → Devices to check its registration.'}
        {' Keep this app and its data intact until key sharing succeeds.'}
      </Text>
      {localDevice ? <>
        <TextInput accessibilityLabel="2FA code to verify this device" keyboardType="number-pad" textContentType="oneTimeCode" value={totp} onChangeText={setTotp} maxLength={6} placeholder="6-digit 2FA code" placeholderTextColor={theme.colors.text3} style={{ color: theme.colors.text, borderColor: theme.colors.lineSoft, borderWidth: 1, borderRadius: 8, padding: 8 }} />
        {!selfApprovalUnavailable ? action('Verify this device with 2FA', approveSurvivor, busy || retryCountdown > 0 || !/^\d{6}$/.test(totp)) : null}
        {state.outgoing?.mode === 'survivor-trust' ? <>
          <Text variant="bodySmall" color={theme.colors.text2}>{state.outgoing.survivorProofReady
            ? `Waiting for ${otherUsername} to verify the same DM key. This request expires in 24 hours.`
            : 'The request is waiting for this device’s key proof. Send it before the other person can review.'}</Text>
          {!state.outgoing.survivorProofReady ? action('Send key proof with 2FA', retrySurvivorProof, busy || retryCountdown > 0 || !/^\d{6}$/.test(totp)) : null}
          {action('Cancel verification request', () => void cancel(state.outgoing!.id))}
        </> : peerHasKey ? <>
          <Text variant="bodySmall" color={theme.colors.text2}>If Central has no earlier key copy for this device, ask {otherUsername} to verify the shared DM key from a trusted device. Both accounts must confirm with 2FA.</Text>
          {action(`Ask ${otherUsername} to verify this DM key`, () => void requestSurvivorTrust(), busy || retryCountdown > 0 || !/^\d{6}$/.test(totp))}
        </> : <Text variant="bodySmall" color={theme.colors.text2}>{otherUsername} has no trusted copy of this DM key available for shared verification.</Text>}
      </> : null}
      {onOpenDeviceSettings ? action('Open device approval', onOpenDeviceSettings) : null}
    </> : state.outgoing ? <>
      <Text variant="body" style={{ fontWeight: '700' }}>DM key recovery requested</Text>
      <Text variant="bodySmall" color={theme.colors.text2}>{state.outgoing.mode === 'survivor-trust'
        ? `Waiting for ${otherUsername} to compare the shared DM key and approve this device. This request expires in 24 hours.`
        : `Waiting for ${otherUsername} to verify their identity and decide whether to share an encrypted key copy with this device. This request expires in 24 hours.`}</Text>
      {action('Cancel request', () => void cancel(state.outgoing!.id))}
    </> : state.incoming ? <>
      <Text variant="body" color={theme.colors.danger} style={{ fontWeight: '700' }}>{state.incoming.mode === 'survivor-trust'
        ? `${otherUsername} asks you to verify their device using this DM key`
        : `${otherUsername} is requesting a copy of this DM key`}</Text>
      {state.incoming.status === 'pending' ? <>
        {state.incoming.mode === 'survivor-trust' && !state.incoming.survivorProofReady
          ? <Text variant="bodySmall" color={theme.colors.text2}>Waiting for the other device to submit its DM key proof before you can review.</Text>
          : <>
        <Text variant="bodySmall" color={theme.colors.text2}>Verify with 2FA or a passkey before reviewing this request. Your device must hold the key. {state.incoming.mode === 'survivor-trust' ? 'The two devices will compare proofs without sending the key to Central.' : ''}</Text>
        <TextInput accessibilityLabel="2FA code for DM key recovery" keyboardType="number-pad" textContentType="oneTimeCode" value={totp} onChangeText={setTotp} maxLength={6} placeholder="6-digit 2FA code" placeholderTextColor={theme.colors.text3} style={{ color: theme.colors.text, borderColor: theme.colors.lineSoft, borderWidth: 1, borderRadius: 8, padding: 8 }} />
        {action('Review with 2FA', () => void review('totp'))}
        {action('Review with passkey', () => void review('passkey'))}
        </>}
      </> : state.incoming.status === 'reviewing' ? <>
        <Text variant="body" color={theme.colors.danger} style={{ fontWeight: '700' }}>Final Notice</Text>
        <Text variant="bodySmall">{state.incoming.mode === 'survivor-trust'
          ? 'Approving will restore trust to the other account’s device if it holds the same DM key. That device may then receive other DM keys belonging to that account. Do not continue if you think you are being tricked. Confirm the person through a channel you already trust.'
          : 'If you share this DM key, the person receiving it may not be who they say they are. This is the final security check. Do not continue if you think you are being tricked. If you share a server, confirm with them there through a channel you already trust.'}</Text>
        {action('Cancel & Close', () => void cancel(state.incoming!.id))}
        {action(countdown > 0 ? `Continue in ${countdown} seconds` : 'Continue', () => void continueSharing(), busy || countdown > 0)}
        <Text variant="bodySmall" color={theme.colors.text2}>If verification expired or you changed devices, restart the review:</Text>
        <TextInput accessibilityLabel="2FA code to restart DM key recovery review" keyboardType="number-pad" textContentType="oneTimeCode" value={totp} onChangeText={setTotp} maxLength={6} placeholder="6-digit 2FA code" placeholderTextColor={theme.colors.text3} style={{ color: theme.colors.text, borderColor: theme.colors.lineSoft, borderWidth: 1, borderRadius: 8, padding: 8 }} />
        {action('Verify again with 2FA', () => void review('totp'))}
        {action('Verify again with passkey', () => void review('passkey'))}
      </> : <>
        <Text variant="bodySmall">Approval was recorded. Send the encrypted key copy to finish recovery.</Text>
        {action('Send encrypted key', () => void continueSharing())}
        <Text variant="bodySmall" color={theme.colors.text2}>If this device cannot send it, verify a device that holds the key and review again.</Text>
        <TextInput accessibilityLabel="2FA code to restart DM key recovery review" keyboardType="number-pad" textContentType="oneTimeCode" value={totp} onChangeText={setTotp} maxLength={6} placeholder="6-digit 2FA code" placeholderTextColor={theme.colors.text3} style={{ color: theme.colors.text, borderColor: theme.colors.lineSoft, borderWidth: 1, borderRadius: 8, padding: 8 }} />
        {action('Review again with 2FA', () => void review('totp'))}
        {action('Review again with passkey', () => void review('passkey'))}
      </>}
    </> : decryptFailure === 'rate_limited' ? <>
      <Text variant="body" style={{ fontWeight: '700' }}>Key sync is temporarily busy</Text>
      <Text variant="bodySmall" color={theme.colors.text2}>Too many key requests were sent while opening this conversation. Wait for the limit to reset, then retry.</Text>
      {action(retryCountdown > 0 ? `Retry in ${retryCountdown} seconds` : 'Retry messages', retry, busy || retryCountdown > 0)}
    </> : decryptFailure === 1 ? <>
      <Text variant="body" style={{ fontWeight: '700' }}>Older message cannot be decrypted</Text>
      <Text variant="bodySmall" color={theme.colors.text2}>This message uses the older account encryption format. A DM key recovery request cannot unlock it. Check your account sync key or open it on a device that can still read it.</Text>
      {action('Retry messages', retry)}
    </> : eligible ? <>
      <Text variant="body" style={{ fontWeight: '700' }}>Request decrypt</Text>
      <Text variant="bodySmall" color={theme.colors.text2}>None of your trusted devices can decrypt this DM. Ask {otherUsername} to verify their identity and share an encrypted copy with this device. Verify your identity first.</Text>
      <TextInput accessibilityLabel="2FA code for DM key recovery" keyboardType="number-pad" textContentType="oneTimeCode" value={totp} onChangeText={setTotp} maxLength={6} placeholder="6-digit 2FA code" placeholderTextColor={theme.colors.text3} style={{ color: theme.colors.text, borderColor: theme.colors.lineSoft, borderWidth: 1, borderRadius: 8, padding: 8 }} />
      {action('Request decrypt with 2FA', () => void request('totp'))}
      {action('Request decrypt with passkey', () => void request('passkey'))}
    </> : <>
      <Text variant="body" style={{ fontWeight: '700' }}>Unable to decrypt this DM</Text>
      <Text variant="bodySmall" color={theme.colors.text2}>
        {!checked
          ? 'Checking this device and the available DM keys…'
          : !manifest
          ? lookupIssue ? lookupIssueText(lookupIssue) : 'The DM key record is unavailable. Retry the check.'
          : manifest.activeKeyVersion == null
            ? 'This conversation has no current DM key that the other person can share.'
            : lookupIssue?.source === 'device'
              ? lookupIssueText(lookupIssue)
            : !localDevice || localDevice.dmTrustState !== 'trusted' || !localDevice.dmPublicKey
              ? 'This device must be registered and trusted before it can request a DM key. Open Settings and approve this device.'
              : localDevice.hasWrappedKeyVersions.includes(manifest.activeKeyVersion)
                ? 'The server has a key copy for this device, but it cannot decrypt the message. Retry downloading the key. If that fails, this device may need a new trusted identity.'
                : !peerHasKey
                  ? `No trusted device belonging to ${otherUsername} currently holds this DM key. Try another device that can still read the conversation.`
                  : 'Key recovery is not ready. Retry checking your device status.'}
      </Text>
      {manifest && lookupIssue && lookupIssue.source !== 'device' ? <Text variant="bodySmall" color={theme.colors.danger}>{lookupIssueText(lookupIssue)}</Text> : null}
      {action(retryCountdown > 0 ? `Retry in ${retryCountdown} seconds` : !manifest || lookupIssue?.source === 'recovery' ? 'Retry Central check' : 'Retry key sync',
        !manifest || lookupIssue?.source === 'recovery' ? retryCheck : retry, busy || !checked || retryCountdown > 0)}
      {manifest && (!localDevice || localDevice.dmTrustState !== 'trusted' || !localDevice.dmPublicKey) && onOpenDeviceSettings
        ? action('Open device settings', onOpenDeviceSettings) : null}
    </>}
    {error ? <Text variant="bodySmall" color={theme.colors.danger}>{error}</Text> : null}
  </View>;
}
