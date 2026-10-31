import { useEffect, useState } from 'react';
import { Bot as BotIcon, Check, X } from 'lucide-react';
import { useUIStore } from '../../stores/uiStore';
import { useAuthStore } from '../../stores/authStore';
import { api } from '../../lib/api';
import { AvatarImage } from '../ui/AvatarImage';
import { Button } from '../ui/Button';
import { resolveAvatarUrl } from '../../utils/avatar';
import { BOT_SCOPE_DEFINITIONS } from '../admin/botScopeDefinitions';
import type { BotScope } from '../../types';

export interface BotConsentModalData {
  botId: string;
  botUsername?: string | null;
  botDisplayName?: string | null;
  botAvatar?: string | null;
  requestedScopes: BotScope[];
  /** Called after the user decides; `allowed` reflects their choice. */
  onDecided?: (allowed: boolean) => void;
}

export function BotConsentModal() {
  const activeModal = useUIStore((s) => s.activeModal);
  const modalData = useUIStore((s) => s.modalData) as BotConsentModalData | null;
  const closeModal = useUIStore((s) => s.closeModal);
  const serverUrl = useAuthStore((s) => s.serverUrl);

  const open = activeModal === 'botConsent' && !!modalData?.botId;
  const requested = modalData?.requestedScopes?.length
    ? modalData.requestedScopes
    : (['interactions'] as BotScope[]);

  // Users can untick individual scopes before allowing.
  const [granted, setGranted] = useState<Set<BotScope>>(new Set(requested));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setGranted(new Set(requested));
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, modalData?.botId]);

  if (!open || !modalData) return null;

  const decide = async (decision: 'allowed' | 'denied') => {
    setSaving(true);
    setError(null);
    try {
      const scopes: Partial<Record<BotScope, boolean>> = {};
      for (const scope of requested) {
        scopes[scope] = decision === 'allowed' && granted.has(scope);
      }
      await api.put(`/api/bots/${modalData.botId}/consent`, { decision, scopes });
      const cb = modalData.onDecided;
      closeModal();
      cb?.(decision === 'allowed');
    } catch (err) {
      setError((err as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed to save your choice');
      setSaving(false);
    }
  };

  const name = modalData.botDisplayName || modalData.botUsername || 'This bot';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 modal-backdrop-in">
      <div className="w-full max-w-md mx-4 rounded-xl border border-border bg-bg-elevated shadow-2xl modal-panel-in overflow-hidden">
        <div className="p-5 flex items-center gap-3 border-b border-border">
          <div className="w-12 h-12 rounded-full overflow-hidden bg-indigo-600/30 flex items-center justify-center text-white shrink-0">
            <AvatarImage
              src={resolveAvatarUrl(modalData.botAvatar, serverUrl)}
              alt={name}
              size={48}
              className="w-12 h-12 object-cover"
              fallback={<BotIcon className="w-6 h-6" />}
            />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-text-primary truncate">{name}</h2>
              <span className="rounded bg-indigo-600 px-1 py-px text-[10px] font-bold uppercase text-white">BOT</span>
            </div>
            <p className="text-sm text-text-muted">wants permission to interact with you</p>
          </div>
        </div>

        <div className="p-5 space-y-2 max-h-72 overflow-y-auto">
          {BOT_SCOPE_DEFINITIONS.filter((def) => requested.includes(def.scope)).map((def) => (
            <label
              key={def.scope}
              className="flex items-start gap-3 rounded-lg border border-border bg-bg-input p-3 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={granted.has(def.scope)}
                onChange={() => {
                  setGranted((prev) => {
                    const next = new Set(prev);
                    if (next.has(def.scope)) next.delete(def.scope);
                    else next.add(def.scope);
                    return next;
                  });
                }}
                className="mt-1"
              />
              <span>
                <span className="block text-sm font-medium text-text-primary">{def.label}</span>
                <span className="block text-xs text-text-muted">{def.description}</span>
              </span>
            </label>
          ))}
          <p className="text-xs text-text-muted pt-1">
            You can change this anytime from the bot's profile. Denying blocks the bot from interacting with you.
          </p>
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>

        <div className="p-4 flex justify-end gap-2 border-t border-border bg-bg-input/40">
          <Button type="button" variant="secondary" disabled={saving} onClick={() => void decide('denied')}>
            <X className="mr-1.5 h-4 w-4" /> Deny
          </Button>
          <Button type="button" disabled={saving} onClick={() => void decide('allowed')}>
            <Check className="mr-1.5 h-4 w-4" /> Allow
          </Button>
        </div>
      </div>
    </div>
  );
}
