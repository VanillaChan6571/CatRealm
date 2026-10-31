import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, TextInput, View } from 'react-native';
import { ShieldCheck } from 'lucide-react-native';
import { Pressable, Text } from '@/components';
import { AUTH_BASE, createAuthenticatedApi } from '@/lib/api';
import { getLocalDeviceId, registerCurrentDevice } from '@/lib/deviceIdentity';
import { getSocket } from '@/lib/socket';
import { approveTrustedDeviceRequest, type DeviceApprovalRequest } from '@/lib/trustedDeviceApproval';
import { useAuthStore } from '@/stores/authStore';
import { useTheme } from '@/theme';

function errorMessage(error: unknown, fallback: string) {
  return (error as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
    ?? (error as { message?: string })?.message
    ?? fallback;
}

export function DeviceApprovalPrompt() {
  const theme = useTheme();
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);
  const accountSwitching = useAuthStore((state) => state.accountSwitching);
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
    if (token && !accountSwitching && user?.accountType === 'central') return;
    startedForAccountRef.current = null;
    setOutgoing(null);
    setIncoming([]);
    setEnteringCode(false);
    setCode('');
    setError(null);
  }, [accountSwitching, token, user?.accountType]);

  const loadPending = useCallback(async () => {
    try {
      const response = await createAuthenticatedApi().get<{ requests: DeviceApprovalRequest[] }>('/api/devices/approval-requests/pending');
      setIncoming(response.data.requests);
    } catch {
      // Expected on an untrusted requesting device.
    }
  }, []);

  const startOutgoing = useCallback(async (deviceId: string) => {
    const response = await createAuthenticatedApi().post<{ request?: DeviceApprovalRequest }>(
      `/api/devices/${encodeURIComponent(deviceId)}/request-approval`,
      {},
    );
    if (response.data.request) setOutgoing(response.data.request);
  }, []);

  useEffect(() => {
    if (!token || accountSwitching || user?.accountType !== 'central' || startedForAccountRef.current === user.id) return;
    startedForAccountRef.current = user.id;
    let cancelled = false;
    void registerCurrentDevice().then(async (deviceId) => {
      const response = await createAuthenticatedApi().get<{ devices: Array<{ id: string; dmTrustState: string }> }>('/api/devices');
      if (cancelled) return;
      const device = response.data.devices.find((entry) => entry.id === deviceId);
      if (device?.dmTrustState === 'untrusted') await startOutgoing(deviceId);
      else await loadPending();
    }).catch((err) => {
      const responseCode = (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
      if (responseCode !== 'NO_TRUSTED_DEVICE' && !cancelled) setError(errorMessage(err, 'Could not start device approval.'));
    });
    return () => { cancelled = true; };
  }, [accountSwitching, loadPending, startOutgoing, token, user?.accountType, user?.id]);

  useEffect(() => {
    if (!token || accountSwitching || user?.accountType !== 'central') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [accountSwitching, token, user?.accountType]);

  useEffect(() => {
    if (!token || accountSwitching || user?.accountType !== 'central' || outgoing) return;
    const timer = setInterval(() => void loadPending(), 10_000);
    return () => clearInterval(timer);
  }, [accountSwitching, loadPending, outgoing, token, user?.accountType]);

  useEffect(() => {
    if (!outgoing?.id) return;
    const poll = setInterval(() => {
      void createAuthenticatedApi().get<{ request: DeviceApprovalRequest }>(
        `/api/devices/approval-requests/${encodeURIComponent(outgoing.id)}/status`,
      ).then(({ data }) => {
        if (data.request.status === 'pending') setOutgoing((previous) => previous ? { ...previous, ...data.request } : previous);
        else setOutgoing(null);
      }).catch(() => {});
    }, 2000);
    return () => clearInterval(poll);
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
    if (!token || accountSwitching || user?.accountType !== 'central') return;
    let attached: ReturnType<typeof getSocket> = null;
    const requested = (request: DeviceApprovalRequest) => {
      void getLocalDeviceId().then((deviceId) => {
        if (request.requesterDeviceId === deviceId) return;
        setIncoming((previous) => previous.some((entry) => entry.id === request.id) ? previous : [...previous, request]);
      });
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
    const timer = setInterval(attach, 1000);
    return () => {
      clearInterval(timer);
      attached?.off('device:approval-requested', requested);
      attached?.off('device:approval-resolved', resolved);
    };
  }, [accountSwitching, outgoing?.id, token, user?.accountType]);

  async function deny() {
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      await createAuthenticatedApi().post(`/api/devices/approval-requests/${encodeURIComponent(current.id)}/deny`, {
        approverDeviceId: await getLocalDeviceId(),
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

  const visible = Boolean(outgoing || current);
  const seconds = outgoing ? Math.max(0, Math.ceil((outgoing.codeExpiresAt * 1000 - now) / 1000)) : 0;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      supportedOrientations={['portrait', 'portrait-upside-down', 'landscape', 'landscape-left', 'landscape-right']}
      onRequestClose={() => {}}
    >
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: theme.colors.bgElev1, borderColor: theme.colors.lineSoft }]}>
          <ShieldCheck size={38} color={theme.colors.accent} />
          {outgoing ? (
            <>
              <Text variant="title" style={styles.center}>Approve this device</Text>
              <Text variant="bodySmall" color={theme.colors.text3} style={styles.center}>
                A prompt was sent to your other trusted CatRealm devices. Choose Yes there, then enter this code.
              </Text>
              <Text style={[styles.displayCode, { color: theme.colors.text }]}>{outgoing.code ?? '••••-••••'}</Text>
              <Text variant="bodySmall" color={theme.colors.text3} style={styles.center}>This code changes in {seconds} second{seconds === 1 ? '' : 's'}.</Text>
            </>
          ) : current ? (
            <>
              <Text variant="title" style={styles.center}>Device wants to be trusted</Text>
              <Text variant="bodySmall" color={theme.colors.text3} style={styles.center}>
                {current.deviceName} ({current.platform}) wants access to your encrypted DMs.
              </Text>
              {!enteringCode ? (
                <>
                  <Text variant="bodySmall" color={theme.colors.text3} style={styles.center}>Only continue if you recognize this device and started the request yourself.</Text>
                  <View style={styles.actions}>
                    <Pressable haptic disabled={busy} onPress={() => void deny()} style={[styles.button, { borderColor: theme.colors.lineSoft, borderWidth: 1 }]}><Text color={theme.colors.danger}>No</Text></Pressable>
                    <Pressable haptic disabled={busy} onPress={() => setEnteringCode(true)} style={[styles.button, { backgroundColor: theme.colors.accent }]}><Text color={theme.colors.textOnAccent}>Yes</Text></Pressable>
                  </View>
                </>
              ) : (
                <>
                  <Text variant="bodySmall" style={styles.center}>Enter the 8-digit code shown on that device.</Text>
                  <TextInput autoFocus keyboardType="number-pad" textContentType="oneTimeCode" maxLength={9} value={code}
                    onChangeText={(value) => {
                      const digits = value.replace(/\D/g, '').slice(0, 8);
                      setCode(digits.length > 4 ? `${digits.slice(0, 4)}-${digits.slice(4)}` : digits);
                    }}
                    placeholder="0000-0000" placeholderTextColor={theme.colors.text3}
                    style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.lineSoft, backgroundColor: theme.colors.bgElev2 }]} />
                  <View style={styles.actions}>
                    <Pressable haptic disabled={busy} onPress={() => { setEnteringCode(false); setCode(''); setError(null); }} style={[styles.button, { borderColor: theme.colors.lineSoft, borderWidth: 1 }]}><Text color={theme.colors.text2}>Back</Text></Pressable>
                    <Pressable haptic disabled={busy || !/^\d{4}-\d{4}$/.test(code)} onPress={() => void approve()} style={[styles.button, { backgroundColor: theme.colors.accent, opacity: busy || !/^\d{4}-\d{4}$/.test(code) ? 0.5 : 1 }]}>
                      {busy ? <ActivityIndicator color={theme.colors.textOnAccent} /> : <Text color={theme.colors.textOnAccent}>Trust device</Text>}
                    </Pressable>
                  </View>
                </>
              )}
            </>
          ) : null}
          {error ? <Text variant="bodySmall" color={theme.colors.danger} style={styles.center}>{error}</Text> : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 22, backgroundColor: 'rgba(0,0,0,0.72)' },
  card: { width: '100%', maxWidth: 430, alignItems: 'center', gap: 14, padding: 24, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth },
  center: { textAlign: 'center' },
  displayCode: { fontSize: 34, lineHeight: 44, fontWeight: '800', letterSpacing: 5, fontVariant: ['tabular-nums'] },
  input: { width: '100%', borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, textAlign: 'center', fontSize: 25, letterSpacing: 4, fontVariant: ['tabular-nums'] },
  actions: { width: '100%', flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 4 },
  button: { minWidth: 92, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10, paddingHorizontal: 16 },
});
