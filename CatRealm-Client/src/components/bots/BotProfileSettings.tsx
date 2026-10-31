import { useCallback, useEffect, useState } from 'react';
import { ShieldBan, ShieldCheck } from 'lucide-react';
import { api } from '../../lib/api';
import { BOT_SCOPE_DEFINITIONS } from '../admin/botScopeDefinitions';
import type { BotConsent, BotScope } from '../../types';

interface BotProfileSettingsProps {
  botId: string;
  requestedScopes?: BotScope[];
}

function Toggle({ checked, onChange, disabled = false }: { checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`inline-flex items-center shrink-0 ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="sr-only"
        disabled={disabled}
      />
      <span className={`relative h-5 w-10 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-bg-hover'}`}>
        <span className={`absolute top-1 h-3 w-3 rounded-full bg-white transition-all ${checked ? 'left-6' : 'left-1'}`} />
      </span>
    </label>
  );
}

// Per-user consent controls shown on a bot's profile: what this bot is allowed
// to do to *you*. Backed by GET/PUT /api/bots/:id/consent.
export function BotProfileSettings({ botId, requestedScopes }: BotProfileSettingsProps) {
  const [consent, setConsent] = useState<BotConsent | null>(null);
  const [requested, setRequested] = useState<BotScope[]>(requestedScopes ?? []);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.get(`/api/bots/${botId}/consent`);
      setConsent(data?.consent ?? null);
      if (Array.isArray(data?.requestedScopes) && data.requestedScopes.length > 0) {
        setRequested(data.requestedScopes);
      }
    } catch {
      setError('Failed to load bot settings');
    } finally {
      setLoading(false);
    }
  }, [botId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (decision: 'allowed' | 'denied', scopes: Partial<Record<BotScope, boolean>>) => {
    setSaving(true);
    setError(null);
    try {
      const data = await api.put(`/api/bots/${botId}/consent`, { decision, scopes });
      setConsent(data?.consent ?? null);
    } catch {
      setError('Failed to save bot settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  const blocked = consent?.decision === 'denied';
  const visibleScopes = BOT_SCOPE_DEFINITIONS.filter((def) => requested.includes(def.scope));

  const handleScopeToggle = (scope: BotScope, value: boolean) => {
    const scopes: Partial<Record<BotScope, boolean>> = { ...(consent?.scopes ?? {}) , [scope]: value };
    void save('allowed', scopes);
  };

  const handleBlockToggle = (block: boolean) => {
    if (block) {
      void save('denied', {});
    } else {
      // Unblocking re-grants everything the bot requested; individual toggles
      // below let the user narrow it back down.
      const scopes: Partial<Record<BotScope, boolean>> = {};
      for (const scope of requested) scopes[scope] = true;
      void save('allowed', scopes);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-bg-input p-4 space-y-3">
      <div className="flex items-center gap-2">
        {blocked ? <ShieldBan className="h-4 w-4 text-danger" /> : <ShieldCheck className="h-4 w-4 text-accent" />}
        <h3 className="text-sm font-semibold text-text-primary">Bot Settings</h3>
      </div>
      <p className="text-xs text-text-muted">
        Control what this bot is allowed to do to you. These settings only affect your account.
      </p>

      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-chat p-3">
        <div>
          <div className="text-sm font-medium text-text-primary">Block this bot</div>
          <div className="text-xs text-text-muted">Denies everything, including commands.</div>
        </div>
        <Toggle checked={blocked} onChange={handleBlockToggle} disabled={saving} />
      </div>

      {!blocked && (
        <div className="space-y-2">
          {visibleScopes.map((def) => (
            <div key={def.scope} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-chat p-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-text-primary">{def.label}</div>
                <div className="text-xs text-text-muted">{def.description}</div>
              </div>
              <Toggle
                checked={consent?.decision === 'allowed' && consent?.scopes?.[def.scope] === true}
                onChange={(value) => handleScopeToggle(def.scope, value)}
                disabled={saving}
              />
            </div>
          ))}
          {!consent && (
            <p className="text-xs text-text-muted">
              You haven't decided yet — the bot will ask the first time you use one of its commands.
            </p>
          )}
        </div>
      )}

      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
