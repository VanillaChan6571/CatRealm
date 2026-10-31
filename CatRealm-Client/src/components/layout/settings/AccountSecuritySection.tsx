import { useEffect, useRef, useState } from 'react';
import { Copy, Check, Trash2, Shield, KeyRound, Laptop, Smartphone, Globe, Pencil } from 'lucide-react';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { useTranslation } from 'react-i18next';
import { AUTH_BASE, createAuthenticatedApi } from '../../../lib/authApi';
import { writeClipboardText } from '../../../lib/clipboard';
import { clearLocalDeviceIdentity, getLocalDeviceId, type UserDevice } from '../../../lib/deviceIdentity';
import { useAuthStore } from '../../../stores/authStore';
import { syncKnownConversationKeys } from '../../../messaging/crypto/dmKeyStore';
import { completeHostedDeviceProof } from '../../../lib/hostedDeviceProof';
import { verifyCurrentDeviceForKeySharing } from '../../../lib/verifyDeviceForKeySharing';
import { approveSurvivingDevice } from '../../../lib/approveSurvivingDevice';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { useSettingsStore } from '../../../stores/settingsStore';
import { httpRealmGatewayEnabled } from '../../../lib/httpRealmGateway';

type BackupCode = { code: string; used: boolean };
type BackupStatus = { generated: false } | { generated: true; total: number; remaining: number; generatedAt: number };
type Credential = { id: string; name: string; createdAt: number; transports: string[] };

function getWebAuthnOriginSupport() {
  if (typeof window === 'undefined') {
    return { supported: false, hostedDesktopFlow: false, reason: 'Passkeys require a browser window with a valid web origin.' };
  }

  if (window.electron?.openPasskeyWindow) return { supported: true, hostedDesktopFlow: true, reason: null };
  const { protocol, hostname } = window.location;
  if (protocol === 'https:') return { supported: true, hostedDesktopFlow: false, reason: null };
  if (protocol === 'http:' && hostname === 'localhost') return { supported: true, hostedDesktopFlow: false, reason: null };
  if (protocol === 'file:') {
    if (window.electron) {
      return {
        supported: true,
        hostedDesktopFlow: true,
        reason: 'The desktop app will open a secure CatRealm passkey window to complete registration.',
      };
    }
    return {
      supported: false,
      hostedDesktopFlow: false,
      reason: 'Passkeys and security keys cannot be registered from this local file page. Open CatRealm in your browser to register one.',
    };
  }

  return {
    supported: false,
    hostedDesktopFlow: false,
    reason: 'Passkeys require HTTPS, or localhost during development.',
  };
}

function DevicesSection() {
  const { t } = useTranslation();
  const [devices, setDevices] = useState<UserDevice[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [approveId, setApproveId] = useState<string | null>(null);
  const [retrustId, setRetrustId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [upgradingId, setUpgradingId] = useState<string | null>(null);
  const [provingId, setProvingId] = useState<string | null>(null);
  const [selfApprovingId, setSelfApprovingId] = useState<string | null>(null);
  const [selfApprovalCode, setSelfApprovalCode] = useState('');
  const [savingLaunchId, setSavingLaunchId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentDeviceId = getLocalDeviceId();
  const logout = useAuthStore((s) => s.logout);

  function deviceSecurity(device: UserDevice) {
    return device.deviceSecurity || 'software_protected';
  }

  useEffect(() => {
    createAuthenticatedApi().get<{ devices: UserDevice[] }>('/api/devices')
      .then((r) => setDevices(r.data.devices))
      .catch(() => setError('Failed to load devices.'))
      .finally(() => setLoaded(true));
  }, []);

  function updateDevice(device: UserDevice) {
    setDevices((prev) => prev.map((entry) => entry.id === device.id ? device : entry));
  }

  async function proveCurrentDevice() {
    const current = devices.find((device) => device.id === currentDeviceId);
    if (!current || deviceSecurity(current) === 'software_protected') return;
    setProvingId(current.id);
    try {
      updateDevice(await verifyCurrentDeviceForKeySharing());
      void syncKnownConversationKeys().catch(() => {});
    } finally {
      setProvingId(null);
    }
  }

  async function runWithProofRetry(action: () => Promise<void>) {
    try {
      await action();
    } catch (err: unknown) {
      const data = (err as { response?: { data?: { proofRequired?: boolean; error?: string } } })?.response?.data;
      if (!data?.proofRequired) throw err;
      await proveCurrentDevice();
      await action();
    }
  }

  async function handleRevoke(totpCode: string) {
    if (!revokeId) return;
    setLoading(true);
    setError(null);
    try {
      await runWithProofRetry(async () => {
        await createAuthenticatedApi().post(`/api/devices/${revokeId}/revoke`, { totpCode, actorDeviceId: currentDeviceId });
      });
      setDevices((prev) => prev.map((d) => d.id === revokeId ? {
        ...d,
        dmTrustState: 'revoked',
        revokedAt: Math.floor(Date.now() / 1000),
        pushCapable: false,
      } : d));
      if (revokeId === currentDeviceId) {
        clearLocalDeviceIdentity();
        logout();
        return;
      }
      setRevokeId(null);
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to remove device.');
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove(totpCode: string) {
    if (!approveId) return;
    setLoading(true);
    setError(null);
    try {
      let approved: UserDevice | null = null;
      await runWithProofRetry(async () => {
        const r = await createAuthenticatedApi().post<{ device: UserDevice }>(`/api/devices/${approveId}/approve`, {
          totpCode,
          approverDeviceId: currentDeviceId,
        });
        approved = r.data.device;
      });
      if (approved) updateDevice(approved);
      void syncKnownConversationKeys().catch(() => {});
      setApproveId(null);
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to approve device.');
    } finally {
      setLoading(false);
    }
  }

  async function handleRename() {
    const targetId = renameId;
    const name = renameDraft.trim();
    if (!targetId) return;
    if (!name) { setRenameId(null); return; }
    setLoading(true);
    setError(null);
    try {
      const r = await createAuthenticatedApi().patch<{ device: UserDevice }>(`/api/devices/${targetId}`, { deviceName: name });
      updateDevice(r.data.device);
      setRenameId(null);
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to rename device.');
    } finally {
      setLoading(false);
    }
  }

  // Refresh a stale passkey proof on another trusted device by vouching from
  // this one — TOTP path for software-protected vouchers, passkey otherwise.
  async function handleRetrust(totpCode?: string) {
    const targetId = retrustId;
    if (!targetId) return;
    setLoading(true);
    setError(null);
    try {
      let updated: UserDevice | null = null;
      await runWithProofRetry(async () => {
        const r = await createAuthenticatedApi().post<{ device: UserDevice }>(`/api/devices/${targetId}/retrust`, {
          totpCode,
          actorDeviceId: currentDeviceId,
        });
        updated = r.data.device;
      });
      if (updated) updateDevice(updated);
      void syncKnownConversationKeys().catch(() => {});
      setRetrustId(null);
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to re-trust device.');
    } finally {
      setLoading(false);
    }
  }

  async function handleRetrustWithPasskey(deviceId: string) {
    setLoading(true);
    setError(null);
    try {
      await proveCurrentDevice();
      const r = await createAuthenticatedApi().post<{ device: UserDevice }>(`/api/devices/${deviceId}/retrust`, {
        actorDeviceId: currentDeviceId,
      });
      updateDevice(r.data.device);
      void syncKnownConversationKeys().catch(() => {});
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        ?? (err as { message?: string })?.message
        ?? 'Failed to re-trust device.');
    } finally {
      setLoading(false);
    }
  }

  async function handleApproveWithPasskey(deviceId: string) {
    setLoading(true);
    setError(null);
    try {
      await proveCurrentDevice();
      const r = await createAuthenticatedApi().post<{ device: UserDevice }>(`/api/devices/${deviceId}/approve`, {
        approverDeviceId: currentDeviceId,
      });
      updateDevice(r.data.device);
      void syncKnownConversationKeys().catch(() => {});
      setApproveId(null);
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        ?? (err as { message?: string })?.message
        ?? 'Failed to approve device.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSelfApproveWithPasskey(deviceId: string) {
    setSelfApprovingId(deviceId);
    setError(null);
    try {
      const api = createAuthenticatedApi();
      const startRes = await api.post('/api/security/webauthn/desktop/device-approval/start', { deviceId });
      if (startRes.data?.alreadyTrusted) {
        const devicesRes = await api.get<{ devices: UserDevice[] }>('/api/devices');
        setDevices(devicesRes.data.devices);
        return;
      }

      const flowId = String(startRes.data.flowId || '');
      const hostedUrl = String(startRes.data.url || '').startsWith('http')
        ? String(startRes.data.url)
        : `${AUTH_BASE}${startRes.data.url}`;
      const openResult = window.electron?.openPasskeyWindow
        ? await window.electron.openPasskeyWindow(hostedUrl)
        : (() => {
            const opened = window.open(hostedUrl, '_blank', 'noopener,noreferrer,width=520,height=720');
            return {
              ok: Boolean(opened),
              reason: opened ? undefined : 'popup-blocked',
              message: opened ? undefined : 'Allow pop-ups for CatRealm to approve this device with a passkey.',
            };
          })();
      if (!openResult.ok) {
        throw new Error(openResult.message || 'Open the CatRealm passkey approval window to continue.');
      }

      for (let attempt = 0; attempt < 120; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        const statusRes = await api.get(`/api/security/webauthn/desktop/device-approval/${encodeURIComponent(flowId)}/status`);
        if (statusRes.data.status === 'complete') {
          if (statusRes.data.device) updateDevice(statusRes.data.device);
          return;
        }
        if (statusRes.data.status === 'failed') {
          throw new Error(statusRes.data.error || 'Device approval failed.');
        }
      }
      throw new Error('Device approval timed out. Start again if the passkey window is still open.');
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        ?? (err as { message?: string })?.message
        ?? 'Failed to approve this device with a passkey.');
    } finally {
      setSelfApprovingId(null);
    }
  }

  async function handleSelfApproveWith2FA(deviceId: string) {
    if (deviceId !== currentDeviceId) return;
    setSelfApprovingId(deviceId);
    setError(null);
    try {
      await approveSurvivingDevice(selfApprovalCode);
      setSelfApprovalCode('');
      const response = await createAuthenticatedApi().get<{ devices: UserDevice[] }>('/api/devices');
      setDevices(response.data.devices);
      void syncKnownConversationKeys().catch(() => {});
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        ?? (err as { message?: string })?.message
        ?? 'Failed to verify this device.');
    } finally {
      setSelfApprovingId(null);
    }
  }

  async function handleUpgradeProtection(deviceId: string) {
    setUpgradingId(deviceId);
    setError(null);
    try {
      const api = createAuthenticatedApi();
      if (window.electron) {
        updateDevice(await completeHostedDeviceProof(api, deviceId));
        void syncKnownConversationKeys().catch(() => {});
        return;
      }

      const optionsRes = await api.post(`/api/devices/${deviceId}/protection/options`, {});
      const credential = await startAuthentication({ optionsJSON: optionsRes.data });
      const verifyRes = await api.post<{ device: UserDevice }>(`/api/devices/${deviceId}/protection/verify`, { credential });
      updateDevice(verifyRes.data.device);
      void syncKnownConversationKeys().catch(() => {});
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        ?? (err as { message?: string })?.message
        ?? 'Failed to upgrade device protection.');
    } finally {
      setUpgradingId(null);
    }
  }

  async function handleToggleLaunchProof(device: UserDevice, proofRequiredOnLaunch: boolean) {
    setSavingLaunchId(device.id);
    setError(null);
    try {
      const res = await createAuthenticatedApi().patch<{ device: UserDevice }>(`/api/devices/${device.id}`, {
        proofRequiredOnLaunch,
      });
      updateDevice(res.data.device);
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to update launch proof preference.');
    } finally {
      setSavingLaunchId(null);
    }
  }

  function securityLabel(device: UserDevice) {
    if (device.dmTrustState === 'revoked' || device.revokedAt) return t('security.revoked');
    if (device.dmTrustState !== 'trusted') return t('security.untrusted');
    switch (device.deviceSecurity) {
      case 'security_key_protected':
        return t('security.trustedSecurityKey');
      case 'platform_protected':
        return t('security.trustedDevice');
      case 'passkey_protected':
        return t('security.trustedPasskey');
      default:
        return t('security.trustedSoftware');
    }
  }

  function Icon({ platform }: { platform: UserDevice['platform'] }) {
    if (platform === 'ios' || platform === 'android') return <Smartphone className="w-4 h-4 text-text-muted shrink-0" />;
    if (platform === 'web') return <Globe className="w-4 h-4 text-text-muted shrink-0" />;
    return <Laptop className="w-4 h-4 text-text-muted shrink-0" />;
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium text-text-primary">{t('security.devices')}</p>
        <p className="text-xs text-text-muted mt-0.5">
          {t('security.devicesDesc')}
        </p>
      </div>
      {loaded && devices.length === 0 && <p className="text-xs text-text-muted">{t('security.noDevices')}</p>}
      <div className="space-y-2">
        {devices.map((device) => {
          const current = device.id === currentDeviceId;
          const revoked = Boolean(device.revokedAt);
          const currentDevice = devices.find((entry) => entry.id === currentDeviceId);
          const canApproveWithPasskey = !current
            && device.dmTrustState === 'untrusted'
            && !!currentDevice
            && currentDevice.dmTrustState === 'trusted'
            && deviceSecurity(currentDevice) !== 'software_protected';
          const canSelfApproveWithPasskey = current && device.dmTrustState === 'untrusted';
          // Stale proof on a passkey-bound device blocks its encrypted-key
          // uploads (30-day server window) — offer to vouch from this device.
          const proofStale = !device.lastProofAt
            || (Date.now() / 1000 - device.lastProofAt) > 30 * 24 * 60 * 60;
          const canRetrust = !current
            && device.dmTrustState === 'trusted'
            && deviceSecurity(device) !== 'software_protected'
            && proofStale
            && !!currentDevice
            && currentDevice.dmTrustState === 'trusted';
          return (
            <div key={device.id} className="flex items-start justify-between gap-3 px-3 py-2 rounded border border-border bg-bg-primary/40">
              <div className="flex items-start gap-2 min-w-0">
                <Icon platform={device.platform} />
                <div className="min-w-0">
                  {renameId === device.id ? (
                    <input
                      type="text"
                      value={renameDraft}
                      maxLength={80}
                      autoFocus
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleRename();
                        if (e.key === 'Escape') { setRenameId(null); setError(null); }
                      }}
                      onBlur={() => void handleRename()}
                      disabled={loading}
                      className="w-48 bg-bg-input border border-border rounded px-2 py-0.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
                    />
                  ) : (
                    <p className="text-sm text-text-primary truncate">
                      {device.deviceName} {current && <span className="text-xs text-accent">{t('security.thisDevice')}</span>}
                    </p>
                  )}
                  <p className="text-xs text-text-muted">
                    {device.platform === 'web' ? t('security.webBrowser') : device.platform} · {securityLabel(device)}
                    {device.pushCapable ? ` ${t('security.pushEnabled')}` : ''}
                  </p>
                  <p className="text-xs text-text-muted">
                    {t('security.firstSeen', { date: new Date(device.firstSeenAt * 1000).toLocaleDateString(), time: new Date(device.lastSeenAt * 1000).toLocaleString() })}
                  </p>
                  {current && device.dmTrustState === 'trusted' && !revoked && (
                    <label className="mt-1 flex items-center gap-2 text-xs text-text-muted">
                      <input
                        type="checkbox"
                        checked={device.proofRequiredOnLaunch}
                        disabled={savingLaunchId === device.id || deviceSecurity(device) === 'software_protected'}
                        onChange={(event) => void handleToggleLaunchProof(device, event.currentTarget.checked)}
                      />
                      {t('security.requirePasskeyLaunch')}
                    </label>
                  )}
                </div>
              </div>
              {!revoked && (
                <div className="flex items-center gap-1 shrink-0">
                  {current && device.dmTrustState === 'trusted' && deviceSecurity(device) === 'software_protected' && (
                    <button
                      type="button"
                      onClick={() => void handleUpgradeProtection(device.id)}
                      disabled={upgradingId === device.id}
                      className="px-2 py-1 rounded border border-border text-xs text-text-muted hover:text-text-primary disabled:opacity-60"
                    >
                      {upgradingId === device.id ? t('security.waiting') : t('security.upgrade')}
                    </button>
                  )}
                  {current && device.dmTrustState === 'trusted' && deviceSecurity(device) !== 'software_protected' && (
                    <button
                      type="button"
                      onClick={() => void proveCurrentDevice().catch((err) => {
                        setError((err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
                          ?? (err as { message?: string })?.message
                          ?? 'Proof failed.');
                      })}
                      disabled={provingId === device.id}
                      className="px-2 py-1 rounded border border-border text-xs text-text-muted hover:text-text-primary disabled:opacity-60"
                    >
                      {provingId === device.id ? t('security.verifying') : t('security.verify')}
                    </button>
                  )}
                  {canRetrust && (
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        if (deviceSecurity(currentDevice!) !== 'software_protected') {
                          void handleRetrustWithPasskey(device.id);
                        } else {
                          setRetrustId(device.id);
                        }
                      }}
                      disabled={loading}
                      className="px-2 py-1 rounded border border-border text-xs text-text-muted hover:text-text-primary disabled:opacity-60"
                      title={t('security.retrustHint')}
                    >
                      {t('security.retrust')}
                    </button>
                  )}
                  {device.dmTrustState === 'untrusted' && (
                    <>
                      {canSelfApproveWithPasskey && (
                        <>
                        <span className="text-xs text-text-muted">If this device held a DM key before it lost trust, verify with 2FA and its existing encryption key. Keep this app’s data intact.</span>
                        <input
                          aria-label="2FA code to verify this device"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          maxLength={6}
                          value={selfApprovalCode}
                          onChange={(event) => setSelfApprovalCode(event.target.value.replace(/\D/g, ''))}
                          placeholder="6-digit 2FA code"
                          className="px-2 py-1 rounded border border-border bg-transparent text-xs text-text-primary"
                        />
                        <button
                          type="button"
                          onClick={() => void handleSelfApproveWith2FA(device.id)}
                          disabled={selfApprovingId === device.id || !/^\d{6}$/.test(selfApprovalCode)}
                          className="px-2 py-1 rounded border border-border text-xs text-text-muted hover:text-text-primary disabled:opacity-60"
                        >
                          Verify this device with 2FA
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleSelfApproveWithPasskey(device.id)}
                          disabled={selfApprovingId === device.id}
                          className="px-2 py-1 rounded border border-border text-xs text-text-muted hover:text-text-primary disabled:opacity-60"
                        >
                          {selfApprovingId === device.id ? t('security.waiting') : t('security.approveWithPasskey')}
                        </button>
                        </>
                      )}
                      {canApproveWithPasskey && (
                        <button
                          type="button"
                          onClick={() => void handleApproveWithPasskey(device.id)}
                          disabled={loading}
                          className="px-2 py-1 rounded border border-border text-xs text-text-muted hover:text-text-primary disabled:opacity-60"
                        >
                          {t('security.passkey')}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => { setError(null); setApproveId(device.id); }}
                        className="px-2 py-1 rounded border border-border text-xs text-text-muted hover:text-text-primary"
                      >
                        {t('security.approve')}
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => { setError(null); setRenameDraft(device.deviceName); setRenameId(device.id); }}
                    className="p-1.5 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
                    aria-label={t('security.renameDevice')}
                    title={t('security.renameDevice')}
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => { setError(null); setRevokeId(device.id); }}
                    className="p-1.5 rounded hover:bg-bg-hover text-text-muted hover:text-danger transition-colors"
                    aria-label={t('security.removeDevice')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {revokeId && (
        <TotpPrompt
          label={t('security.removeTotpPrompt')}
          loading={loading}
          onConfirm={handleRevoke}
          onCancel={() => { setRevokeId(null); setError(null); }}
          error={error}
        />
      )}
      {approveId && (
        <TotpPrompt
          label={t('security.approveTotpPrompt')}
          loading={loading}
          onConfirm={handleApprove}
          onCancel={() => { setApproveId(null); setError(null); }}
          error={error}
        />
      )}
      {retrustId && (
        <TotpPrompt
          label={t('security.retrustTotpPrompt')}
          loading={loading}
          onConfirm={(code) => void handleRetrust(code)}
          onCancel={() => { setRetrustId(null); setError(null); }}
          error={error}
        />
      )}
      {!revokeId && !approveId && !retrustId && error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

// ── Small reusable 2FA prompt ───────────────────────────────────────────────────
function TotpPrompt({
  label,
  loading,
  onConfirm,
  onCancel,
  error,
}: {
  label: string;
  loading: boolean;
  onConfirm: (code: string) => void;
  onCancel: () => void;
  error: string | null;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { setTimeout(() => ref.current?.focus(), 30); }, []);

  return (
    <div className="rounded border border-border bg-bg-primary/40 p-3 space-y-2">
      <p className="text-sm text-text-primary">{label}</p>
      <div className="flex gap-2">
        <input
          ref={ref}
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => { if (e.key === 'Enter' && code.length === 6) onConfirm(code); }}
          placeholder="000000"
          className="w-28 bg-bg-input border border-border rounded px-3 py-1.5 text-sm text-text-primary font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-accent/50"
        />
        <button
          type="button"
          onClick={() => onConfirm(code)}
          disabled={loading || code.length !== 6}
          className="px-3 py-1.5 rounded bg-accent text-white text-sm disabled:opacity-60"
        >
          {loading ? t('security.verifying') : t('security.confirm')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="px-3 py-1.5 rounded border border-border text-sm text-text-muted hover:text-text-primary disabled:opacity-60"
        >
          {t('common.cancel')}
        </button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

// ── Backup Codes sub-section ────────────────────────────────────────────────────
function BackupCodesSection() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [codes, setCodes] = useState<BackupCode[] | null>(null);
  const [prompt, setPrompt] = useState<'generate' | 'reveal' | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    createAuthenticatedApi().get('/api/security/backup-codes/status')
      .then((r) => setStatus(r.data as BackupStatus))
      .catch(() => setStatus({ generated: false }));
  }, []);

  async function handleGenerate(totpCode: string) {
    setLoading(true);
    setError(null);
    try {
      const r = await createAuthenticatedApi().post('/api/security/backup-codes/generate', { totpCode });
      const newCodes: BackupCode[] = (r.data.codes as string[]).map((c) => ({ code: c, used: false }));
      setCodes(newCodes);
      setStatus({ generated: true, total: 10, remaining: 10, generatedAt: Math.floor(Date.now() / 1000) });
      setPrompt(null);
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed. Try again.');
    } finally { setLoading(false); }
  }

  async function handleReveal(totpCode: string) {
    setLoading(true);
    setError(null);
    try {
      const r = await createAuthenticatedApi().post('/api/security/backup-codes/reveal', { totpCode });
      setCodes(r.data.codes as BackupCode[]);
      setPrompt(null);
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed. Try again.');
    } finally { setLoading(false); }
  }

  async function handleCopyAll() {
    if (!codes) return;
    const text = codes.map((c) => c.code).join('\n');
    const ok = await writeClipboardText(text);
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 2000); }
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium text-text-primary">{t('security.backupCodes')}</p>
        <p className="text-xs text-text-muted mt-0.5">
          {t('security.backupCodesDesc')}
        </p>
      </div>

      {status && (
        <div className="text-xs text-text-muted">
          {status.generated
            ? t('security.codesRemaining', { remaining: status.remaining, total: status.total, date: new Date(status.generatedAt * 1000).toLocaleDateString() })
            : t('security.noBackupCodes')}
        </div>
      )}

      {prompt === 'generate' && (
        <TotpPrompt
          label={status?.generated ? t('security.regeneratePrompt') : t('security.generatePrompt')}
          loading={loading}
          onConfirm={handleGenerate}
          onCancel={() => { setPrompt(null); setError(null); }}
          error={error}
        />
      )}

      {prompt === 'reveal' && (
        <TotpPrompt
          label={t('security.revealPrompt')}
          loading={loading}
          onConfirm={handleReveal}
          onCancel={() => { setPrompt(null); setError(null); }}
          error={error}
        />
      )}

      {!prompt && (
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => { setCodes(null); setError(null); setPrompt('generate'); }}
            className="px-3 py-1.5 rounded bg-accent text-white text-xs"
          >
            {status?.generated ? t('security.regenerateCodes') : t('security.generateCodes')}
          </button>
          {status?.generated && (
            <button
              type="button"
              onClick={() => { setCodes(null); setError(null); setPrompt('reveal'); }}
              className="px-3 py-1.5 rounded border border-border text-xs text-text-muted hover:text-text-primary"
            >
              {t('security.revealCodes')}
            </button>
          )}
        </div>
      )}

      {codes && (
        <div className="space-y-2 pt-1">
          <div className="grid grid-cols-2 gap-1.5">
            {codes.map(({ code, used }) => (
              <code
                key={code}
                className={`text-xs font-mono px-2 py-1.5 rounded bg-bg-primary/60 border border-border break-all select-all ${used ? 'opacity-40 line-through' : 'text-text-primary'}`}
              >
                {code}
              </code>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void handleCopyAll()}
            className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? t('security.copiedCodes') : t('security.copyAllCodes')}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Change 2FA Key sub-section ──────────────────────────────────────────────────
function Change2FASection() {
  const { t } = useTranslation();
  const [step, setStep] = useState<'idle' | 'verify' | 'confirm'>('idle');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleStart(totpCode: string) {
    setLoading(true);
    setError(null);
    try {
      const r = await createAuthenticatedApi().post('/api/security/change-2fa/start', { totpCode });
      setQrCode(r.data.qrCode);
      setManualCode(r.data.manualCode);
      setStep('confirm');
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed. Try again.');
    } finally { setLoading(false); }
  }

  async function handleConfirm(totpCode: string) {
    setLoading(true);
    setError(null);
    try {
      await createAuthenticatedApi().post('/api/security/change-2fa/confirm', { totpCode });
      setStep('idle');
      setQrCode(null);
      setManualCode(null);
      setDone(true);
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed. Try again.');
    } finally { setLoading(false); }
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium text-text-primary">{t('security.change2FA')}</p>
        <p className="text-xs text-text-muted mt-0.5">
          {t('security.change2FADesc')}
        </p>
      </div>

      {done && <p className="text-xs text-green-400">{t('security.change2FASuccess')}</p>}

      {step === 'idle' && (
        <button
          type="button"
          onClick={() => { setDone(false); setError(null); setStep('verify'); }}
          className="px-3 py-1.5 rounded bg-accent text-white text-xs"
        >
          {t('security.change2FAButton')}
        </button>
      )}

      {step === 'verify' && (
        <TotpPrompt
          label={t('security.verifyCurrentCode')}
          loading={loading}
          onConfirm={handleStart}
          onCancel={() => { setStep('idle'); setError(null); }}
          error={error}
        />
      )}

      {step === 'confirm' && qrCode && (
        <div className="space-y-3 rounded border border-border bg-bg-primary/40 p-3">
          <p className="text-sm text-text-primary">{t('security.scanQR')}</p>
          <div className="flex flex-col items-center gap-3">
            <img src={qrCode} alt={t('security.newQRCodeAlt')} className="w-40 h-40 rounded border border-border bg-white p-1" />
            {manualCode && (
              <div className="w-full rounded border border-border bg-bg-primary/60 p-2">
                <p className="text-xs text-text-muted mb-0.5">{t('security.manualKey')}</p>
                <p className="text-xs font-mono text-text-primary break-all select-all">{manualCode}</p>
              </div>
            )}
          </div>
          <TotpPrompt
            label={t('security.enterNewCode')}
            loading={loading}
            onConfirm={handleConfirm}
            onCancel={() => { setStep('idle'); setQrCode(null); setManualCode(null); setError(null); }}
            error={error}
          />
        </div>
      )}
    </div>
  );
}

// ── Security Keys sub-section ───────────────────────────────────────────────────
function SecurityKeysSection() {
  const { t } = useTranslation();
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<{ type: 'register' } | { type: 'remove'; id: string } | null>(null);
  const [verifyingFactor, setVerifyingFactor] = useState(false);
  const webAuthnSupport = getWebAuthnOriginSupport();
  const currentDeviceId = getLocalDeviceId();

  useEffect(() => {
    createAuthenticatedApi().get('/api/security/webauthn/credentials')
      .then((r) => { setCredentials(r.data.credentials); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, []);

  function handleRegister() { setError(null); setPendingAction({ type: 'register' }); }

  async function performRegister() {
    setError(null);
    if (!webAuthnSupport.supported) {
      setError(webAuthnSupport.reason);
      return;
    }
    setRegistering(true);
    try {
      const api = createAuthenticatedApi();
      if (webAuthnSupport.hostedDesktopFlow) {
        const startRes = await api.post('/api/security/webauthn/desktop/register/start', {
          name: keyName.trim() || 'Security Key',
          deviceId: currentDeviceId,
        });
        const hostedUrl = new URL(startRes.data.url, AUTH_BASE).toString();
        const openResult = window.electron?.openPasskeyWindow
          ? await window.electron.openPasskeyWindow(hostedUrl)
          : await window.electron?.openExternal?.(hostedUrl);
        if (openResult && !openResult.ok) {
          throw new Error(openResult.message || 'Failed to open the CatRealm passkey window.');
        }

        const flowId = startRes.data.flowId;
        const startedAt = Date.now();
        const timeoutMs = 10 * 60 * 1000;
        while (Date.now() - startedAt < timeoutMs) {
          await new Promise((resolve) => window.setTimeout(resolve, 1500));
          const statusRes = await api.get(`/api/security/webauthn/desktop/register/${encodeURIComponent(flowId)}/status`);
          if (statusRes.data.status === 'complete') {
            const listRes = await api.get('/api/security/webauthn/credentials');
            setCredentials(listRes.data.credentials);
            window.dispatchEvent(new Event('catrealm:passkeys-changed'));
            setKeyName('');
            return;
          }
          if (statusRes.data.status === 'failed') {
            throw new Error(statusRes.data.error || 'Passkey registration failed.');
          }
        }
        throw new Error('Passkey registration timed out. Start again if the passkey window is still open.');
      }

      const optionsRes = await api.get('/api/security/webauthn/register-options', {
        params: { deviceId: currentDeviceId },
      });
      const attResp = await startRegistration({ optionsJSON: optionsRes.data });
      await api.post('/api/security/webauthn/register-verify', {
        credential: attResp,
        name: keyName.trim() || 'Security Key',
        deviceId: currentDeviceId,
      });
      setKeyName('');
      // Refresh list
      const listRes = await api.get('/api/security/webauthn/credentials');
      setCredentials(listRes.data.credentials);
      window.dispatchEvent(new Event('catrealm:passkeys-changed'));
    } catch (err: unknown) {
      const rawMsg = (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        ?? (err as { message?: string })?.message
        ?? 'Registration failed. Try again.';
      const msg = rawMsg.includes('is an invalid domain')
        ? 'Passkeys require HTTPS, or localhost during development. The packaged desktop app cannot register passkeys from file:// yet.'
        : rawMsg;
      setError(msg);
    } finally { setRegistering(false); }
  }

  function handleRemove(id: string) { setError(null); setPendingAction({ type: 'remove', id }); }

  async function performRemove(id: string) {
    setRemovingId(id);
    try {
      try {
        await createAuthenticatedApi().delete(`/api/security/webauthn/credentials/${id}`, {
          data: { deviceId: currentDeviceId },
        });
      } catch (err: unknown) {
        const data = (err as { response?: { status?: number; data?: { downgradeAvailable?: boolean; boundDevices?: Array<{ deviceName: string }>; error?: string } } })?.response?.data;
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status !== 409 || !data?.downgradeAvailable) throw err;
        const names = (data.boundDevices ?? []).map((device) => device.deviceName).filter(Boolean).join(', ');
        const ok = window.confirm(
          `This key protects ${names || 'one or more devices'}. Removing it will downgrade those devices to software-protected trust. Continue?`
        );
        if (!ok) return;
        await createAuthenticatedApi().delete(`/api/security/webauthn/credentials/${id}?downgrade=1`, {
          data: { deviceId: currentDeviceId },
        });
      }
      setCredentials((prev) => prev.filter((c) => c.id !== id));
      window.dispatchEvent(new Event('catrealm:passkeys-changed'));
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to remove key. Try again.');
    } finally { setRemovingId(null); }
  }

  async function verifyManagementFactor(totpCode: string) {
    const action = pendingAction;
    if (!action) return;
    setVerifyingFactor(true);
    setError(null);
    try {
      await createAuthenticatedApi().post('/api/security/step-up', { totpCode });
      setPendingAction(null);
      if (action.type === 'register') await performRegister();
      else await performRemove(action.id);
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Could not verify your authenticator.');
    } finally { setVerifyingFactor(false); }
  }

  return (
    <div className="space-y-3">
      {pendingAction && (
        <TotpPrompt label="Verify your current authenticator to manage passkeys" loading={verifyingFactor}
          onConfirm={verifyManagementFactor} onCancel={() => { setPendingAction(null); setError(null); }} error={error} />
      )}
      <div>
        <p className="text-sm font-medium text-text-primary">{t('security.securityKeys')}</p>
        <p className="text-xs text-text-muted mt-0.5">
          {t('security.securityKeysDesc')}
        </p>
      </div>

      {!webAuthnSupport.supported && (
        <div className="rounded border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          {webAuthnSupport.reason}
        </div>
      )}
      {webAuthnSupport.hostedDesktopFlow && (
        <div className="rounded border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-text-secondary">
          {webAuthnSupport.reason}
        </div>
      )}

      {loaded && credentials.length === 0 && (
        <p className="text-xs text-text-muted">{t('security.noSecurityKeys')}</p>
      )}

      {credentials.length > 0 && (
        <div className="space-y-2">
          {credentials.map((cred) => (
            <div key={cred.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded border border-border bg-bg-primary/40">
              <div className="flex items-center gap-2 min-w-0">
                <KeyRound className="w-4 h-4 text-text-muted shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm text-text-primary truncate">{cred.name}</p>
                  <p className="text-xs text-text-muted">{t('security.addedDate', { date: new Date(cred.createdAt * 1000).toLocaleDateString() })}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleRemove(cred.id)}
                disabled={removingId === cred.id}
                className="p-1.5 rounded hover:bg-bg-hover text-text-muted hover:text-danger transition-colors disabled:opacity-50 shrink-0"
                aria-label={t('security.removeKey')}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2 items-center flex-wrap">
        <input
          type="text"
          value={keyName}
          onChange={(e) => setKeyName(e.target.value)}
          placeholder={t('security.keyLabelPlaceholder')}
          maxLength={64}
          className="w-44 bg-bg-input border border-border rounded px-3 py-1.5 text-xs text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
        />
        <button
          type="button"
          onClick={() => void handleRegister()}
          disabled={registering || !webAuthnSupport.supported}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-accent text-white text-xs disabled:opacity-60"
        >
          <Shield className="w-3.5 h-3.5" />
          {registering ? t('security.waitingForKey') : t('security.registerKey')}
        </button>
      </div>
      <p className="text-xs text-text-muted">
        {t('security.keyLabelNote')}
      </p>

      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

type BlockingGroupChat = { id: string; name: string; memberCount: number };
type GroupMember = { id: string; username: string; displayName: string | null; isOwner: boolean };

function DangerZoneSection() {
  const { t } = useTranslation();
  const logout = useAuthStore((s) => s.logout);
  const [step, setStep] = useState<'idle' | 'confirm' | 'totp'>('idle');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<BlockingGroupChat[] | null>(null);
  const [membersByGroup, setMembersByGroup] = useState<Record<string, GroupMember[]>>({});
  const [transferTarget, setTransferTarget] = useState<Record<string, string>>({});
  const [transferringId, setTransferringId] = useState<string | null>(null);

  async function ensureMembersLoaded(groupId: string) {
    if (membersByGroup[groupId]) return;
    try {
      const r = await createAuthenticatedApi().get<{ members: GroupMember[] }>(`/api/group-chats/${groupId}`);
      setMembersByGroup((prev) => ({ ...prev, [groupId]: r.data.members }));
    } catch {
      // leave unset; the picker will just stay empty for this group
    }
  }

  async function handleTransfer(groupId: string) {
    const newOwnerId = transferTarget[groupId];
    if (!newOwnerId) return;
    setTransferringId(groupId);
    setError(null);
    try {
      await createAuthenticatedApi().post(`/api/group-chats/${groupId}/transfer-ownership`, { newOwnerId });
      setBlocked((prev) => (prev ? prev.filter((g) => g.id !== groupId) : prev));
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? t('security.transferOwnershipFailed'));
    } finally {
      setTransferringId(null);
    }
  }

  async function handleDelete(totpCode: string) {
    setLoading(true);
    setError(null);
    try {
      await createAuthenticatedApi().delete('/api/security/account', { data: { totpCode } });
      clearLocalDeviceIdentity();
      logout();
    } catch (err: unknown) {
      const data = (err as { response?: { status?: number; data?: { error?: string; blockingGroupChats?: BlockingGroupChat[] } } })?.response;
      if (data?.status === 409 && data.data?.blockingGroupChats) {
        setBlocked(data.data.blockingGroupChats);
        for (const g of data.data.blockingGroupChats) void ensureMembersLoaded(g.id);
        setError(null);
      } else {
        setError(data?.data?.error ?? t('security.deleteAccountFailed'));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="border border-danger/40 rounded-lg -m-4 p-4">
      <h5 className="text-sm font-semibold text-danger">{t('security.dangerZone')}</h5>
      <p className="text-xs text-text-muted mt-0.5 mb-3">{t('security.dangerZoneDesc')}</p>

      {step === 'idle' && (
        <button
          type="button"
          onClick={() => { setStep('confirm'); setError(null); setBlocked(null); }}
          className="px-3 py-1.5 rounded bg-danger text-white text-sm hover:bg-danger/90"
        >
          {t('security.deleteAccount')}
        </button>
      )}

      <ConfirmDialog
        open={step === 'confirm'}
        onClose={() => setStep('idle')}
        onConfirm={() => setStep('totp')}
        variant="danger"
        title={t('security.deleteAccountConfirmTitle')}
        message={t('security.deleteAccountConfirmMessage')}
        confirmText={t('security.deleteAccount')}
        cancelText={t('common.cancel')}
      />

      {step === 'totp' && !blocked && (
        <TotpPrompt
          label={t('security.deleteAccountTotpPrompt')}
          loading={loading}
          onConfirm={handleDelete}
          onCancel={() => { setStep('idle'); setError(null); }}
          error={error}
        />
      )}

      {step === 'totp' && blocked && (
        <div className="rounded border border-border bg-bg-primary/40 p-3 space-y-3">
          <div>
            <p className="text-sm text-text-primary">{t('security.deleteAccountBlockedTitle')}</p>
            <p className="text-xs text-text-muted mt-0.5">{t('security.deleteAccountBlockedIntro')}</p>
          </div>
          {blocked.length === 0 ? (
            <TotpPrompt
              label={t('security.deleteAccountTotpPrompt')}
              loading={loading}
              onConfirm={handleDelete}
              onCancel={() => { setStep('idle'); setError(null); setBlocked(null); }}
              error={error}
            />
          ) : (
            blocked.map((group) => (
              <div key={group.id} className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-text-primary">{group.name}</span>
                <span className="text-xs text-text-muted">({group.memberCount})</span>
                <select
                  value={transferTarget[group.id] || ''}
                  onChange={(e) => setTransferTarget((prev) => ({ ...prev, [group.id]: e.target.value }))}
                  className="bg-bg-input border border-border rounded px-2 py-1 text-xs text-text-primary"
                >
                  <option value="">{t('security.transferTo')}</option>
                  {(membersByGroup[group.id] || []).filter((m) => !m.isOwner).map((m) => (
                    <option key={m.id} value={m.id}>{m.displayName || m.username}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void handleTransfer(group.id)}
                  disabled={!transferTarget[group.id] || transferringId === group.id}
                  className="px-2 py-1 rounded bg-accent text-white text-xs disabled:opacity-60"
                >
                  {t('security.transferOwnership')}
                </button>
              </div>
            ))
          )}
          {error && blocked.length > 0 && <p className="text-xs text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
}

// ── Top-level export ────────────────────────────────────────────────────────────
export function AccountSecuritySection() {
  const { t } = useTranslation();
  const autoTryHttpRealmGateway = useSettingsStore((s) => s.autoTryHttpRealmGateway);
  const setAutoTryHttpRealmGateway = useSettingsStore((s) => s.setAutoTryHttpRealmGateway);
  return (
    <div className="space-y-4">
      <div className="border-b border-border pb-2">
        <h4 className="text-base font-semibold text-text-primary">{t('security.accountSecurity')}</h4>
        <p className="text-xs text-text-muted mt-0.5">
          {t('security.accountSecurityDesc')}
        </p>
      </div>

      <div className="space-y-6">
        {httpRealmGatewayEnabled() && typeof window !== 'undefined' && window.location.protocol === 'https:' && (
          <label className="bg-bg-hover/30 p-4 rounded-lg flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={autoTryHttpRealmGateway}
              onChange={(event) => setAutoTryHttpRealmGateway(event.target.checked)}
              className="mt-1 accent-accent"
            />
            <span>
              <span className="block text-sm font-medium text-text-primary">Auto try HTTP for realms without HTTPS</span>
              <span className="block text-xs text-text-muted mt-1">
                When a saved HTTP realm is blocked by your browser, try connecting through CatRealm's HTTPS gateway automatically. The gateway-to-realm connection is unencrypted HTTP.
              </span>
            </span>
          </label>
        )}
        <div className="bg-bg-hover/30 p-4 rounded-lg">
          <BackupCodesSection />
        </div>
        <div className="bg-bg-hover/30 p-4 rounded-lg">
          <Change2FASection />
        </div>
        <div className="bg-bg-hover/30 p-4 rounded-lg">
          <SecurityKeysSection />
        </div>
        <div className="bg-bg-hover/30 p-4 rounded-lg">
          <DevicesSection />
        </div>
        <div className="bg-bg-hover/30 p-4 rounded-lg">
          <DangerZoneSection />
        </div>
      </div>
    </div>
  );
}
