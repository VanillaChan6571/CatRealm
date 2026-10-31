import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, KeyRound, RefreshCw, Trash2, Webhook, Lock, LockOpen } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { api } from '../../lib/api';
import type { Webhook as WebhookType } from '../../types';

type ScopeType = 'channel' | 'category';
type WebhookMode = 'simple' | 'secured';

interface WebhookManagerProps {
  scopeType: ScopeType;
  scopeId: string;
  title: string;
  description: string;
}

interface SecretState {
  inboundUrl: string | null;
  signingSecret: string | null;
  webhookName: string;
  authMode: WebhookMode;
}

interface DraftState {
  authMode: WebhookMode;
  name: string;
  inboundEnabled: boolean;
  outboundEnabled: boolean;
  callbackUrl: string;
  ipLockEnabled: boolean;
  actionFlags: {
    allowMessageCreate?: boolean;
    allowConversationUpsert?: boolean;
  };
}

interface ApiErrorShape {
  response?: {
    data?: {
      error?: string;
    };
  };
}

const SIMPLE_BADGE = 'bg-amber-500/15 text-amber-300 border-amber-500/30';
const SECURED_BADGE = 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';

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
      <span
        className={`relative h-6 w-12 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-bg-hover'}`}
      >
        <span
          className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-all ${checked ? 'left-7' : 'left-1'}`}
        />
      </span>
    </label>
  );
}

function buildEmptyDraft(scopeType: ScopeType, authMode: WebhookMode): DraftState {
  return {
    authMode,
    name: '',
    inboundEnabled: true,
    outboundEnabled: authMode === 'secured' ? false : false,
    callbackUrl: '',
    ipLockEnabled: authMode === 'simple',
    actionFlags: scopeType === 'category'
      ? { allowConversationUpsert: true }
      : { allowMessageCreate: true },
  };
}

function modeBadgeClass(mode: WebhookMode) {
  return mode === 'simple' ? SIMPLE_BADGE : SECURED_BADGE;
}

function modeLabel(mode: WebhookMode) {
  return mode === 'simple' ? 'Simple' : 'Secured Webhooks';
}

function formatDeliveryStatus(webhook: WebhookType) {
  if (!webhook.lastDeliveryStatus) return 'Never sent';
  if (webhook.lastDeliveryStatus === 'retrying') return 'Retrying';
  if (webhook.lastDeliveryStatus === 'pending') return 'Queued';
  if (webhook.lastDeliveryStatus === 'delivered') return 'Delivered';
  return 'Failed';
}

function formatTimestamp(value: number | null) {
  if (!value) return 'Never';
  return new Date(value * 1000).toLocaleString();
}

export function WebhookManager({ scopeType, scopeId, title, description }: WebhookManagerProps) {
  const [webhooks, setWebhooks] = useState<WebhookType[]>([]);
  const [activeMode, setActiveMode] = useState<WebhookMode>('simple');
  const [draft, setDraft] = useState<DraftState>(buildEmptyDraft(scopeType, 'simple'));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [secretState, setSecretState] = useState<SecretState | null>(null);

  const basePath = useMemo(() => (
    scopeType === 'channel' ? `/api/channels/${scopeId}/webhooks` : `/api/categories/${scopeId}/webhooks`
  ), [scopeId, scopeType]);

  const loadWebhooks = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.get(basePath);
      setWebhooks(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      const apiError = err as ApiErrorShape;
      setError(apiError.response?.data?.error || 'Failed to load webhooks');
    } finally {
      setLoading(false);
    }
  }, [basePath]);

  useEffect(() => {
    if (!scopeId) return;
    void loadWebhooks();
  }, [loadWebhooks, scopeId]);

  const filteredWebhooks = useMemo(() => (
    webhooks.filter((webhook) => (webhook.authMode || 'secured') === activeMode)
  ), [activeMode, webhooks]);

  const resetDraft = useCallback((mode: WebhookMode = activeMode) => {
    setDraft(buildEmptyDraft(scopeType, mode));
    setEditingId(null);
  }, [activeMode, scopeType]);

  const handleCopy = async (value: string | null) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      setError('Failed to copy to clipboard');
    }
  };

  const beginEdit = (webhook: WebhookType) => {
    const nextMode = (webhook.authMode || 'secured') as WebhookMode;
    setActiveMode(nextMode);
    setEditingId(webhook.id);
    setDraft({
      authMode: nextMode,
      name: webhook.name,
      inboundEnabled: webhook.inboundEnabled,
      outboundEnabled: webhook.outboundEnabled,
      callbackUrl: webhook.callbackUrl || '',
      ipLockEnabled: webhook.ipLockEnabled,
      actionFlags: webhook.actionFlags || buildEmptyDraft(scopeType, nextMode).actionFlags,
    });
    setError('');
  };

  const handleModeChange = (mode: WebhookMode) => {
    setActiveMode(mode);
    setEditingId(null);
    setDraft(buildEmptyDraft(scopeType, mode));
    setError('');
  };

  const handleSubmit = async () => {
    if (!draft.name.trim()) {
      setError('Webhook name required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        authMode: draft.authMode,
        name: draft.name.trim(),
        inboundEnabled: draft.inboundEnabled,
        outboundEnabled: draft.authMode === 'secured' ? draft.outboundEnabled : false,
        callbackUrl: draft.authMode === 'secured' ? (draft.callbackUrl.trim() || null) : null,
        ipLockEnabled: draft.authMode === 'simple' ? draft.ipLockEnabled : false,
        actionFlags: draft.actionFlags,
      };
      if (editingId) {
        await api.patch(`${basePath}/${editingId}`, payload);
      } else {
        const created = await api.post(basePath, payload);
        setSecretState({
          inboundUrl: created?.webhook?.inboundUrl ?? null,
          signingSecret: created?.signingSecret ?? null,
          webhookName: created?.webhook?.name ?? draft.name.trim(),
          authMode: draft.authMode,
        });
      }
      resetDraft(draft.authMode);
      await loadWebhooks();
    } catch (err: unknown) {
      const apiError = err as ApiErrorShape;
      setError(apiError.response?.data?.error || 'Failed to save webhook');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleEnabled = async (webhook: WebhookType) => {
    setError('');
    try {
      await api.patch(`${basePath}/${webhook.id}`, { enabled: !webhook.enabled });
      await loadWebhooks();
    } catch (err: unknown) {
      const apiError = err as ApiErrorShape;
      setError(apiError.response?.data?.error || 'Failed to update webhook');
    }
  };

  const handleDelete = async (webhookId: string) => {
    setError('');
    try {
      await api.delete(`${basePath}/${webhookId}`);
      if (editingId === webhookId) resetDraft();
      await loadWebhooks();
    } catch (err: unknown) {
      const apiError = err as ApiErrorShape;
      setError(apiError.response?.data?.error || 'Failed to delete webhook');
    }
  };

  const handleRegenerate = async (webhook: WebhookType) => {
    setError('');
    try {
      const regenerated = await api.post(`${basePath}/${webhook.id}/regenerate-secret`);
      setSecretState({
        inboundUrl: regenerated?.webhook?.inboundUrl ?? webhook.inboundUrl ?? null,
        signingSecret: regenerated?.signingSecret ?? null,
        webhookName: regenerated?.webhook?.name ?? webhook.name,
        authMode: (regenerated?.webhook?.authMode || webhook.authMode || 'secured') as WebhookMode,
      });
      await loadWebhooks();
    } catch (err: unknown) {
      const apiError = err as ApiErrorShape;
      setError(apiError.response?.data?.error || 'Failed to regenerate secret');
    }
  };

  const handleResetIpLock = async (webhook: WebhookType) => {
    setError('');
    try {
      await api.patch(`${basePath}/${webhook.id}`, { resetIpLock: true });
      await loadWebhooks();
    } catch (err: unknown) {
      const apiError = err as ApiErrorShape;
      setError(apiError.response?.data?.error || 'Failed to reset IP lock');
    }
  };

  const isCategory = scopeType === 'category';

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-bg-elevated/40 p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-bg-input p-3 text-text-secondary">
            <Webhook className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="text-base font-semibold text-text-primary">{title}</div>
            <div className="mt-1 text-sm text-text-muted">{description}</div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => handleModeChange('simple')}
          className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-colors ${
            activeMode === 'simple' ? SIMPLE_BADGE : 'border-border bg-bg-input/40 text-text-secondary hover:bg-bg-hover/50'
          }`}
        >
          🔓 Simple
        </button>
        <button
          type="button"
          onClick={() => handleModeChange('secured')}
          className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-colors ${
            activeMode === 'secured' ? SECURED_BADGE : 'border-border bg-bg-input/40 text-text-secondary hover:bg-bg-hover/50'
          }`}
        >
          🔒 Secured Webhooks
        </button>
      </div>

      {secretState && (
        <div className={`rounded-2xl border p-5 ${modeBadgeClass(secretState.authMode)}`}>
          <div className="text-sm font-semibold text-text-primary">
            {secretState.authMode === 'simple' ? 'Save this simple webhook URL now' : 'Save this secured webhook secret now'}
          </div>
          <div className="mt-1 text-sm text-text-muted">
            {secretState.webhookName} will not show the full secret again after you close this panel.
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-border bg-bg-input/70 p-3">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary">Inbound URL</div>
              <div className="mt-2 break-all text-sm text-text-primary">{secretState.inboundUrl || 'Inbound disabled'}</div>
              <Button type="button" variant="secondary" className="mt-3" onClick={() => void handleCopy(secretState.inboundUrl)}>
                <Copy className="mr-2 h-4 w-4" /> Copy URL
              </Button>
            </div>
            <div className="rounded-xl border border-border bg-bg-input/70 p-3">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary">
                {secretState.authMode === 'simple' ? 'URL Token' : 'Signing Secret'}
              </div>
              <div className="mt-2 break-all font-mono text-sm text-text-primary">{secretState.signingSecret || 'Unavailable'}</div>
              <Button type="button" variant="secondary" className="mt-3" onClick={() => void handleCopy(secretState.signingSecret)}>
                <Copy className="mr-2 h-4 w-4" /> Copy Secret
              </Button>
            </div>
          </div>
          <Button type="button" variant="ghost" className="mt-4" onClick={() => setSecretState(null)}>
            Close
          </Button>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="rounded-2xl border border-border bg-bg-elevated/30 p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            {activeMode === 'simple' ? <LockOpen className="h-4 w-4 text-amber-300" /> : <Lock className="h-4 w-4 text-emerald-300" />}
            {editingId ? `Edit ${modeLabel(activeMode)}` : `Create ${modeLabel(activeMode)}`}
          </div>
          <div className="mt-1 text-xs text-text-muted">
            {activeMode === 'simple'
              ? 'Simple webhooks work with tools that only accept a plain URL. Choose which inbound actions are allowed.'
              : 'Secured webhooks require signed requests and optionally support outbound callbacks.'}
          </div>
          <div className="mt-4 space-y-4">
            <Input
              label="Webhook Name"
              value={draft.name}
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
              placeholder={activeMode === 'simple' ? 'Support Plugin' : 'Support Bridge'}
            />
            <label className="flex items-center justify-between rounded-xl border border-border bg-bg-input/40 px-3 py-3 text-sm text-text-primary">
              <span>Enable inbound requests</span>
              <Toggle
                checked={draft.inboundEnabled}
                onChange={(value) => setDraft((current) => ({ ...current, inboundEnabled: value }))}
                disabled={activeMode === 'simple'}
              />
            </label>

            {activeMode === 'simple' ? (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-3">
                <div className="text-sm font-semibold text-text-primary">Allowed Actions</div>
                <label className="flex items-center justify-between text-sm text-text-primary">
                  <span>Lock to first caller IP</span>
                  <Toggle
                    checked={draft.ipLockEnabled}
                    onChange={(value) => setDraft((current) => ({ ...current, ipLockEnabled: value }))}
                  />
                </label>
                <div className="text-xs text-text-muted">
                  Enabled by default. The first successful request binds this webhook to that source IP until you reset it.
                </div>
                {!isCategory && (
                  <label className="flex items-center justify-between text-sm text-text-primary">
                    <span>Allow message posting in this channel</span>
                    <Toggle
                      checked={draft.actionFlags.allowMessageCreate !== false}
                      onChange={(value) => setDraft((current) => ({
                        ...current,
                        actionFlags: { ...current.actionFlags, allowMessageCreate: value },
                      }))}
                    />
                  </label>
                )}
                {isCategory && (
                  <label className="flex items-center justify-between text-sm text-text-primary">
                    <span>Allow create or reuse channel in this category</span>
                    <Toggle
                      checked={draft.actionFlags.allowConversationUpsert !== false}
                      onChange={(value) => setDraft((current) => ({
                        ...current,
                        actionFlags: { ...current.actionFlags, allowConversationUpsert: value },
                      }))}
                    />
                  </label>
                )}
              </div>
            ) : (
              <>
                <label className="flex items-center justify-between rounded-xl border border-border bg-bg-input/40 px-3 py-3 text-sm text-text-primary">
                  <span>Enable outbound callbacks</span>
                  <Toggle
                    checked={draft.outboundEnabled}
                    onChange={(value) => setDraft((current) => ({ ...current, outboundEnabled: value }))}
                  />
                </label>
                <Input
                  label="Callback URL"
                  value={draft.callbackUrl}
                  onChange={(event) => setDraft((current) => ({ ...current, callbackUrl: event.target.value }))}
                  placeholder="https://example.com/catrealm/webhooks"
                />
              </>
            )}

            <div className="flex gap-2">
              <Button type="button" onClick={() => void handleSubmit()} disabled={saving}>
                {saving ? 'Saving…' : editingId ? 'Update Webhook' : 'Create Webhook'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => resetDraft(activeMode)} disabled={saving}>
                Clear
              </Button>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {loading && <div className="text-sm text-text-muted">Loading webhooks…</div>}
          {!loading && filteredWebhooks.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border bg-bg-elevated p-8 text-center text-sm text-text-muted">
              No {activeMode === 'simple' ? 'simple' : 'secured'} webhooks configured yet.
            </div>
          )}
          {filteredWebhooks.map((webhook) => {
            const authMode = (webhook.authMode || 'secured') as WebhookMode;
            return (
              <div key={webhook.id} className={`rounded-2xl border p-5 ${modeBadgeClass(authMode)}`}>
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-base font-semibold text-text-primary">
                      <span>{authMode === 'simple' ? '🔓' : '🔒'}</span>
                      <span className="truncate">{webhook.name}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      <span className="rounded-full border border-current/30 px-2.5 py-1">
                        {authMode === 'simple' ? 'Simple' : 'Secured Webhooks'}
                      </span>
                      <span className="rounded-full border border-current/30 px-2.5 py-1">
                        {webhook.inboundEnabled ? 'Inbound On' : 'Inbound Off'}
                      </span>
                      {authMode === 'secured' && (
                        <span className="rounded-full border border-current/30 px-2.5 py-1">
                          {webhook.outboundEnabled ? 'Outbound On' : 'Outbound Off'}
                        </span>
                      )}
                      <span className="rounded-full border border-current/30 px-2.5 py-1">
                        {formatDeliveryStatus(webhook)}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="secondary" onClick={() => beginEdit(webhook)}>
                      Edit
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => void handleToggleEnabled(webhook)}>
                      {webhook.enabled ? 'Disable' : 'Enable'}
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => void handleRegenerate(webhook)}>
                      <RefreshCw className="mr-2 h-4 w-4" /> Secret
                    </Button>
                    {authMode === 'simple' && webhook.ipLockEnabled && (
                      <Button type="button" variant="secondary" onClick={() => void handleResetIpLock(webhook)}>
                        Reset IP Lock
                      </Button>
                    )}
                    <Button type="button" variant="secondary" onClick={() => void handleDelete(webhook.id)}>
                      <Trash2 className="mr-2 h-4 w-4" /> Delete
                    </Button>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-3">
                  <div className="rounded-xl border border-border bg-bg-input/40 p-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary">Inbound Endpoint</div>
                    <div className="mt-2 break-all text-sm text-text-primary">{webhook.inboundUrl || 'Inbound disabled'}</div>
                    <Button type="button" variant="ghost" className="mt-2" onClick={() => void handleCopy(webhook.inboundUrl)}>
                      <Copy className="mr-2 h-4 w-4" /> Copy
                    </Button>
                  </div>
                  <div className="rounded-xl border border-border bg-bg-input/40 p-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary">Secret Preview</div>
                    <div className="mt-2 flex items-center gap-2 text-sm text-text-primary">
                      <KeyRound className="h-4 w-4 text-text-secondary" />
                      <span className="font-mono">{webhook.secretPreview || 'Unavailable'}</span>
                    </div>
                    {authMode === 'simple' ? (
                      <div className="mt-2 text-xs text-text-muted">URL-only mode for plugins that just want a webhook URL.</div>
                    ) : (
                      <div className="mt-2 text-xs text-text-muted">Signed requests required. Regenerate to show a new full secret once.</div>
                    )}
                  </div>
                  <div className="rounded-xl border border-border bg-bg-input/40 p-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary">Behavior</div>
                    <div className="mt-2 text-sm text-text-primary">
                      {!isCategory && (webhook.actionFlags?.allowMessageCreate !== false ? 'Can post messages' : 'Posting disabled')}
                      {isCategory && (webhook.actionFlags?.allowConversationUpsert !== false ? 'Can create or reuse channels' : 'Channel creation disabled')}
                    </div>
                    {authMode === 'simple' && (
                      <div className="mt-1 text-xs text-text-muted">
                        IP lock: {webhook.ipLockEnabled ? (webhook.lockedIp || 'Waiting for first caller') : 'Off'}
                      </div>
                    )}
                    {authMode === 'secured' && (
                      <div className="mt-1 text-xs text-text-muted">Last attempt: {formatTimestamp(webhook.lastDeliveryAt)}</div>
                    )}
                    {webhook.lastDeliveryError && (
                      <div className="mt-2 text-xs text-danger">{webhook.lastDeliveryError}</div>
                    )}
                  </div>
                </div>

                {authMode === 'secured' && webhook.callbackUrl && (
                  <div className="mt-3 rounded-xl border border-border bg-bg-input/30 px-3 py-2 text-sm text-text-muted">
                    Callback URL: <span className="break-all text-text-primary">{webhook.callbackUrl}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {error && <div className="text-sm text-danger">{error}</div>}
    </div>
  );
}
