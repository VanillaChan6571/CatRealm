import { useCallback, useEffect, useState } from 'react';
import { Copy, KeyRound, RefreshCw, Trash2, Webhook as WebhookIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../lib/api';
import { Button } from '../../ui/Button';
import type { Webhook } from '../../../types';

type WebhookMode = 'simple' | 'secured';

interface AdminWebhook extends Webhook {
  scopeName: string;
}

interface SecretState {
  inboundUrl: string | null;
  signingSecret: string | null;
  webhookName: string;
  authMode: WebhookMode;
}

interface ApiErrorShape {
  response?: {
    data?: {
      error?: string;
    };
  };
}

const SIMPLE_BADGE = 'border-amber-500/30 bg-amber-500/10';
const SECURED_BADGE = 'border-emerald-500/30 bg-emerald-500/10';

function Toggle({ checked, onChange, disabled = false }: { checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`inline-flex items-center ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'} shrink-0`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="sr-only"
        disabled={disabled}
      />
      <span className={`relative h-6 w-12 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-bg-hover'}`}>
        <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-all ${checked ? 'left-7' : 'left-1'}`} />
      </span>
    </label>
  );
}

function modeStyle(mode: WebhookMode) {
  return mode === 'simple' ? SIMPLE_BADGE : SECURED_BADGE;
}

function formatTimestamp_raw(value: number | null) {
  if (!value) return null;
  return new Date(value * 1000).toLocaleString();
}

export function WebhooksSection() {
  const { t } = useTranslation();

  const modeText = (mode: WebhookMode) =>
    mode === 'simple' ? `🔓 ${t('admin.simpleMode')}` : `🔒 ${t('admin.securedMode')}`;

  const formatDeliveryStatus = (webhook: AdminWebhook) => {
    if (!webhook.lastDeliveryStatus) return t('admin.neverSent');
    if (webhook.lastDeliveryStatus === 'retrying') return t('admin.retrying');
    if (webhook.lastDeliveryStatus === 'pending') return t('admin.queued');
    if (webhook.lastDeliveryStatus === 'delivered') return t('admin.delivered');
    return t('admin.deliveryFailed');
  };

  const formatTimestamp = (value: number | null) =>
    formatTimestamp_raw(value) ?? t('admin.neverValue');

  const [webhooks, setWebhooks] = useState<AdminWebhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftCallbackUrl, setDraftCallbackUrl] = useState('');
  const [draftInboundEnabled, setDraftInboundEnabled] = useState(true);
  const [draftOutboundEnabled, setDraftOutboundEnabled] = useState(false);
  const [draftAuthMode, setDraftAuthMode] = useState<WebhookMode>('secured');
  const [draftIpLockEnabled, setDraftIpLockEnabled] = useState(true);
  const [draftAllowMessageCreate, setDraftAllowMessageCreate] = useState(true);
  const [draftAllowConversationUpsert, setDraftAllowConversationUpsert] = useState(true);
  const [saving, setSaving] = useState(false);
  const [secretState, setSecretState] = useState<SecretState | null>(null);

  const loadWebhooks = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.get('/api/admin/webhooks');
      setWebhooks(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      const apiError = err as ApiErrorShape;
      setError(apiError.response?.data?.error || 'Failed to load webhooks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWebhooks();
  }, [loadWebhooks]);

  const handleCopy = async (value: string | null) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      setError(t('admin.failedClipboard'));
    }
  };

  const beginEdit = (webhook: AdminWebhook) => {
    const authMode = (webhook.authMode || 'secured') as WebhookMode;
    setEditingId(webhook.id);
    setDraftName(webhook.name);
    setDraftCallbackUrl(webhook.callbackUrl || '');
    setDraftInboundEnabled(webhook.inboundEnabled);
    setDraftOutboundEnabled(webhook.outboundEnabled);
    setDraftAuthMode(authMode);
    setDraftIpLockEnabled(webhook.ipLockEnabled);
    setDraftAllowMessageCreate(webhook.actionFlags?.allowMessageCreate !== false);
    setDraftAllowConversationUpsert(webhook.actionFlags?.allowConversationUpsert !== false);
    setError(null);
  };

  const clearEdit = () => {
    setEditingId(null);
    setDraftName('');
    setDraftCallbackUrl('');
    setDraftInboundEnabled(true);
    setDraftOutboundEnabled(false);
    setDraftAuthMode('secured');
    setDraftIpLockEnabled(true);
    setDraftAllowMessageCreate(true);
    setDraftAllowConversationUpsert(true);
  };

  const handleSave = async () => {
    if (!editingId) return;
    setSaving(true);
    setError(null);
    try {
      const current = webhooks.find((entry) => entry.id === editingId);
      await api.patch(`/api/admin/webhooks/${editingId}`, {
        name: draftName.trim(),
        authMode: draftAuthMode,
        callbackUrl: draftAuthMode === 'secured' ? (draftCallbackUrl.trim() || null) : null,
        inboundEnabled: draftAuthMode === 'simple' ? true : draftInboundEnabled,
        outboundEnabled: draftAuthMode === 'secured' ? draftOutboundEnabled : false,
        ipLockEnabled: draftAuthMode === 'simple' ? draftIpLockEnabled : false,
        actionFlags: current?.scopeType === 'category'
          ? { allowConversationUpsert: draftAllowConversationUpsert }
          : { allowMessageCreate: draftAllowMessageCreate },
      });
      clearEdit();
      await loadWebhooks();
    } catch (err: unknown) {
      const apiError = err as ApiErrorShape;
      setError(apiError.response?.data?.error || 'Failed to save webhook');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (webhookId: string) => {
    try {
      setError(null);
      await api.delete(`/api/admin/webhooks/${webhookId}`);
      if (editingId === webhookId) clearEdit();
      await loadWebhooks();
    } catch (err: unknown) {
      const apiError = err as ApiErrorShape;
      setError(apiError.response?.data?.error || 'Failed to delete webhook');
    }
  };

  const handleToggleEnabled = async (webhook: AdminWebhook) => {
    try {
      setError(null);
      await api.patch(`/api/admin/webhooks/${webhook.id}`, { enabled: !webhook.enabled });
      await loadWebhooks();
    } catch (err: unknown) {
      const apiError = err as ApiErrorShape;
      setError(apiError.response?.data?.error || 'Failed to update webhook');
    }
  };

  const handleRegenerate = async (webhook: AdminWebhook) => {
    try {
      setError(null);
      const data = await api.post(`/api/admin/webhooks/${webhook.id}/regenerate-secret`);
      setSecretState({
        inboundUrl: data?.webhook?.inboundUrl ?? webhook.inboundUrl ?? null,
        signingSecret: data?.signingSecret ?? null,
        webhookName: data?.webhook?.name ?? webhook.name,
        authMode: (data?.webhook?.authMode || webhook.authMode || 'secured') as WebhookMode,
      });
      await loadWebhooks();
    } catch (err: unknown) {
      const apiError = err as ApiErrorShape;
      setError(apiError.response?.data?.error || 'Failed to regenerate secret');
    }
  };

  const handleResetIpLock = async (webhook: AdminWebhook) => {
    try {
      setError(null);
      await api.patch(`/api/admin/webhooks/${webhook.id}`, { resetIpLock: true });
      await loadWebhooks();
    } catch (err: unknown) {
      const apiError = err as ApiErrorShape;
      setError(apiError.response?.data?.error || 'Failed to reset IP lock');
    }
  };

  if (loading) {
    return <div className="text-center py-12 text-gray-400">{t('admin.loadingWebhooks')}</div>;
  }

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-100 mb-2">{t('admin.webhooks')}</h2>
        <p className="text-gray-400">{t('admin.webhooksDesc')}</p>
      </div>

      {secretState && (
        <div className={`rounded-xl border p-4 ${modeStyle(secretState.authMode)}`}>
          <div className="text-sm font-semibold text-gray-100">
            {secretState.authMode === 'simple' ? t('admin.simpleUrlRefreshed') : t('admin.securedSecretRefreshed')}
          </div>
          <div className="mt-1 text-sm text-gray-300">
            {t('admin.willNotShowAgain', { name: secretState.webhookName })}
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">{t('admin.inboundUrl')}</div>
              <div className="mt-2 break-all text-sm text-gray-100">{secretState.inboundUrl || t('admin.inboundDisabled')}</div>
            </div>
            <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">
                {secretState.authMode === 'simple' ? t('admin.urlToken') : t('admin.signingSecret')}
              </div>
              <div className="mt-2 break-all font-mono text-sm text-gray-100">{secretState.signingSecret || t('admin.unavailable')}</div>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button type="button" variant="secondary" onClick={() => void handleCopy(secretState.inboundUrl)}>
              <Copy className="mr-2 h-4 w-4" /> {t('admin.copyUrl')}
            </Button>
            <Button type="button" variant="secondary" onClick={() => void handleCopy(secretState.signingSecret)}>
              <Copy className="mr-2 h-4 w-4" /> {t('admin.copySecret')}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-lg bg-red-900/20 border border-red-600/30 text-red-400">
          {error}
        </div>
      )}

      {webhooks.length === 0 ? (
        <div className="text-center py-12 rounded-lg border border-dashed border-gray-700 bg-gray-800/30">
          <WebhookIcon className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400">{t('admin.noWebhooks')}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {webhooks.map((webhook) => {
            const authMode = (webhook.authMode || 'secured') as WebhookMode;
            const isEditing = editingId === webhook.id;
            return (
              <div key={webhook.id} className={`rounded-xl border p-4 ${modeStyle(authMode)}`}>
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-block h-2.5 w-2.5 rounded-full ${webhook.enabled ? 'bg-emerald-400' : 'bg-gray-500'}`} />
                      <h3 className="text-lg font-semibold text-gray-100">{webhook.name}</h3>
                      <span className="rounded-full bg-gray-900/70 px-2.5 py-1 text-xs text-gray-300">
                        {modeText(authMode)}
                      </span>
                      <span className="rounded-full bg-gray-900/70 px-2.5 py-1 text-xs text-gray-300">
                        {webhook.scopeType === 'channel' ? t('admin.channelScope') : t('admin.categoryScope')}: {webhook.scopeName}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-lg border border-gray-700 bg-gray-900/40 p-3">
                        <div className="text-xs uppercase tracking-[0.18em] text-gray-500">{t('admin.inboundUrl')}</div>
                        <div className="mt-2 break-all text-sm text-gray-100">{webhook.inboundUrl || t('admin.inboundDisabled')}</div>
                      </div>
                      <div className="rounded-lg border border-gray-700 bg-gray-900/40 p-3">
                        <div className="text-xs uppercase tracking-[0.18em] text-gray-500">{t('admin.behavior')}</div>
                        <div className="mt-2 text-sm text-gray-100">
                          {webhook.scopeType === 'category'
                            ? (webhook.actionFlags?.allowConversationUpsert !== false ? t('admin.createReuseAllowed') : t('admin.createReuseBlocked'))
                            : (webhook.actionFlags?.allowMessageCreate !== false ? t('admin.postingAllowed') : t('admin.postingBlocked'))}
                        </div>
                        {authMode === 'simple' && (
                          <div className="mt-1 text-xs text-gray-400">
                            {t('admin.ipLockLabel', { status: webhook.ipLockEnabled ? (webhook.lockedIp || t('admin.waitingFirstCaller')) : t('admin.ipLockOff') })}
                          </div>
                        )}
                        {authMode === 'secured' && (
                          <div className="mt-1 text-xs text-gray-400">
                            {t('admin.outboundLabel', { status: webhook.outboundEnabled ? t('admin.enabledLabel') : t('admin.disabledLabel') })}
                          </div>
                        )}
                      </div>
                      <div className="rounded-lg border border-gray-700 bg-gray-900/40 p-3">
                        <div className="text-xs uppercase tracking-[0.18em] text-gray-500">{t('admin.secretPreview')}</div>
                        <div className="mt-2 flex items-center gap-2 text-sm text-gray-100">
                          <KeyRound className="h-4 w-4 text-gray-400" />
                          <span className="font-mono">{webhook.secretPreview || 'Unavailable'}</span>
                        </div>
                      </div>
                      <div className="rounded-lg border border-gray-700 bg-gray-900/40 p-3">
                        <div className="text-xs uppercase tracking-[0.18em] text-gray-500">{t('admin.delivery')}</div>
                        <div className="mt-2 text-sm text-gray-100">{formatDeliveryStatus(webhook)}</div>
                        <div className="mt-1 text-xs text-gray-400">{formatTimestamp(webhook.lastDeliveryAt)}</div>
                        {webhook.lastDeliveryError && (
                          <div className="mt-2 text-xs text-red-400">{webhook.lastDeliveryError}</div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="secondary" onClick={() => beginEdit(webhook)}>
                      {t('admin.editButton')}
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => void handleToggleEnabled(webhook)}>
                      {webhook.enabled ? t('admin.disableButton') : t('admin.enableButton')}
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => void handleRegenerate(webhook)}>
                      <RefreshCw className="mr-2 h-4 w-4" /> {t('admin.secretButton')}
                    </Button>
                    {authMode === 'simple' && webhook.ipLockEnabled && (
                      <Button type="button" variant="secondary" onClick={() => void handleResetIpLock(webhook)}>
                        {t('admin.resetIpLock')}
                      </Button>
                    )}
                    <Button type="button" variant="secondary" onClick={() => void handleDelete(webhook.id)}>
                      <Trash2 className="mr-2 h-4 w-4" /> {t('admin.deleteRole')}
                    </Button>
                  </div>
                </div>

                {isEditing && (
                  <div className="mt-4 rounded-lg border border-blue-600/30 bg-blue-900/10 p-4 space-y-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">{t('admin.webhookName')}</label>
                        <input
                          type="text"
                          value={draftName}
                          onChange={(event) => setDraftName(event.target.value)}
                          className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-gray-100"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">{t('admin.modeLabel')}</label>
                        <select
                          value={draftAuthMode}
                          onChange={(event) => {
                            const nextMode = event.target.value as WebhookMode;
                            setDraftAuthMode(nextMode);
                            if (nextMode === 'simple') setDraftIpLockEnabled(true);
                          }}
                          className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-gray-100"
                        >
                          <option value="simple">{t('admin.simpleMode')}</option>
                          <option value="secured">{t('admin.securedMode')}</option>
                        </select>
                      </div>
                    </div>

                    {draftAuthMode === 'secured' && (
                      <>
                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="flex items-center gap-2 text-sm text-gray-300">
                            <Toggle checked={draftInboundEnabled} onChange={setDraftInboundEnabled} />
                            {t('admin.inboundEnabled')}
                          </label>
                          <label className="flex items-center gap-2 text-sm text-gray-300">
                            <Toggle checked={draftOutboundEnabled} onChange={setDraftOutboundEnabled} />
                            {t('admin.outboundEnabled')}
                          </label>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-300 mb-2">{t('admin.callbackUrl')}</label>
                          <input
                            type="text"
                            value={draftCallbackUrl}
                            onChange={(event) => setDraftCallbackUrl(event.target.value)}
                            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-gray-100"
                            placeholder="https://example.com/catrealm/webhooks"
                          />
                        </div>
                      </>
                    )}

                    {draftAuthMode === 'simple' && (
                      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                        <label className="flex items-center gap-2 text-sm text-gray-200">
                          <Toggle checked={draftIpLockEnabled} onChange={setDraftIpLockEnabled} />
                          {t('admin.lockFirstCaller')}
                        </label>
                        <div className="mt-2 text-xs text-gray-400">
                          {t('admin.lockDesc')}
                        </div>
                        {webhook.lockedIp && (
                          <div className="mt-2 text-xs text-gray-300">
                            {t('admin.currentLockedIp', { ip: webhook.lockedIp })}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex flex-wrap gap-4">
                      {webhook.scopeType === 'channel' && (
                        <label className="flex items-center gap-2 text-sm text-gray-300">
                          <Toggle checked={draftAllowMessageCreate} onChange={setDraftAllowMessageCreate} />
                          {t('admin.allowChannelPosting')}
                        </label>
                      )}
                      {webhook.scopeType === 'category' && (
                        <label className="flex items-center gap-2 text-sm text-gray-300">
                          <Toggle checked={draftAllowConversationUpsert} onChange={setDraftAllowConversationUpsert} />
                          {t('admin.allowCreateReuse')}
                        </label>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <Button type="button" onClick={() => void handleSave()} disabled={saving}>
                        {saving ? t('admin.savingEllipsis') : t('common.save')}
                      </Button>
                      <Button type="button" variant="secondary" onClick={clearEdit} disabled={saving}>
                        {t('common.cancel')}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
