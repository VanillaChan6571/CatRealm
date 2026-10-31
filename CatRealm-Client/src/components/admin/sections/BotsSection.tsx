import { useCallback, useEffect, useState } from 'react';
import { Bot as BotIcon, Copy, Download, KeyRound, Plug, RefreshCw, Trash2, UserRound } from 'lucide-react';
import { api } from '../../../lib/api';
import { writeClipboardText } from '../../../lib/clipboard';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { AvatarImage } from '../../ui/AvatarImage';
import { resolveAvatarUrl } from '../../../utils/avatar';
import { useAuthStore } from '../../../stores/authStore';
import { BOT_SCOPE_DEFINITIONS } from '../botScopeDefinitions';
import type { BotScope, BotSummary } from '../../../types';

interface ApiErrorShape {
  response?: { data?: { error?: string } };
}

interface TokenState {
  botUsername: string;
  token: string;
}

function errorMessage(err: unknown, fallback: string) {
  return (err as ApiErrorShape).response?.data?.error || fallback;
}

function pluginStatusStyle(status: BotSummary['pluginStatus']) {
  if (status === 'running') return 'text-emerald-400';
  if (status === 'crashed' || status === 'install_failed') return 'text-red-400';
  if (status === 'restarting' || status === 'pending_install' || status === 'installing') return 'text-amber-400';
  return 'text-gray-400';
}

function pluginStatusLabel(status: BotSummary['pluginStatus']) {
  if (status === 'pending_install') return 'awaiting install approval';
  if (status === 'installing') return 'installing dependencies…';
  if (status === 'install_failed') return 'install failed — see server console';
  return status || 'stopped';
}

export function BotsSection() {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const [bots, setBots] = useState<BotSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tokenState, setTokenState] = useState<TokenState | null>(null);
  const [copied, setCopied] = useState(false);

  // Create form
  const [creating, setCreating] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newScopes, setNewScopes] = useState<Set<BotScope>>(new Set(['interactions']));
  const [saving, setSaving] = useState(false);

  // Profile editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftDisplayName, setDraftDisplayName] = useState('');
  const [draftBio, setDraftBio] = useState('');
  const [draftScopes, setDraftScopes] = useState<Set<BotScope>>(new Set(['interactions']));

  // Confirmations
  const [confirmRegen, setConfirmRegen] = useState<BotSummary | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<BotSummary | null>(null);

  // Refreshes after actions (upload, toggle, regen) update the list in place;
  // only the very first load swaps the tab to the loading placeholder.
  const loadBots = useCallback(async ({ initial = false } = {}) => {
    try {
      if (initial) setLoading(true);
      setError(null);
      const data = await api.get('/api/bots');
      setBots(Array.isArray(data?.bots) ? data.bots : []);
    } catch (err: unknown) {
      setError(errorMessage(err, 'Failed to load bots'));
    } finally {
      if (initial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBots({ initial: true });
  }, [loadBots]);

  const handleCopyToken = async () => {
    if (!tokenState) return;
    const ok = await writeClipboardText(tokenState.token);
    setCopied(ok);
    if (ok) setTimeout(() => setCopied(false), 2000);
  };

  const toggleScope = (set: Set<BotScope>, scope: BotScope, apply: (next: Set<BotScope>) => void) => {
    const next = new Set(set);
    if (next.has(scope)) next.delete(scope);
    else next.add(scope);
    next.add('interactions');
    apply(next);
  };

  const handleCreate = async () => {
    const username = newUsername.trim();
    if (!username) {
      setError('Bot username required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const data = await api.post('/api/bots', {
        username,
        requestedScopes: Array.from(newScopes),
      });
      if (data?.token) setTokenState({ botUsername: username, token: data.token });
      setCreating(false);
      setNewUsername('');
      setNewScopes(new Set(['interactions']));
      await loadBots();
    } catch (err: unknown) {
      setError(errorMessage(err, 'Failed to create bot'));
    } finally {
      setSaving(false);
    }
  };

  const handleRegenerate = async (bot: BotSummary) => {
    try {
      setError(null);
      const data = await api.post(`/api/bots/${bot.id}/regenerate-token`);
      if (data?.token) setTokenState({ botUsername: bot.username || 'bot', token: data.token });
      await loadBots();
    } catch (err: unknown) {
      setError(errorMessage(err, 'Failed to regenerate token'));
    }
  };

  const handleToggleEnabled = async (bot: BotSummary) => {
    try {
      setError(null);
      await api.patch(`/api/bots/${bot.id}`, { enabled: !bot.enabled });
      await loadBots();
    } catch (err: unknown) {
      setError(errorMessage(err, 'Failed to update bot'));
    }
  };

  const handleDelete = async (bot: BotSummary) => {
    try {
      setError(null);
      await api.delete(`/api/bots/${bot.id}`);
      if (editingId === bot.id) setEditingId(null);
      await loadBots();
    } catch (err: unknown) {
      setError(errorMessage(err, 'Failed to delete bot'));
    }
  };

  const beginEdit = (bot: BotSummary) => {
    setEditingId(bot.id);
    setDraftDisplayName(bot.displayName || '');
    setDraftBio(bot.bio || '');
    setDraftScopes(new Set<BotScope>(['interactions', ...bot.requestedScopes]));
  };

  const handleSaveEdit = async (bot: BotSummary) => {
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/api/bots/${bot.id}/profile`, {
        displayName: draftDisplayName,
        bio: draftBio,
      });
      await api.patch(`/api/bots/${bot.id}`, { requestedScopes: Array.from(draftScopes) });
      setEditingId(null);
      await loadBots();
    } catch (err: unknown) {
      setError(errorMessage(err, 'Failed to save bot'));
    } finally {
      setSaving(false);
    }
  };

  // Approving runs npm install on the server; the status flips to
  // "installing" and we poll below until it settles.
  const handleApproveInstall = async (bot: BotSummary) => {
    try {
      setError(null);
      await api.post(`/api/bots/${bot.id}/install`);
      await loadBots();
    } catch (err: unknown) {
      setError(errorMessage(err, 'Failed to approve install'));
    }
  };

  // While any plugin is installing, refresh every few seconds so the status
  // (and the started bot) shows up without a manual reload.
  useEffect(() => {
    if (!bots.some((b) => b.pluginStatus === 'installing')) return;
    const timer = setTimeout(() => void loadBots(), 3000);
    return () => clearTimeout(timer);
  }, [bots, loadBots]);

  const handleImageUpload = async (bot: BotSummary, kind: 'avatar' | 'banner', file: File) => {
    try {
      setError(null);
      const form = new FormData();
      form.append(kind, file);
      await api.post(`/api/bots/${bot.id}/${kind}`, form);
      await loadBots();
    } catch (err: unknown) {
      setError(errorMessage(err, `Failed to upload ${kind}`));
    }
  };

  if (loading) {
    return <div className="text-center py-12 text-gray-400">Loading bots…</div>;
  }

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-100 mb-2">Bots</h2>
          <p className="text-gray-400">
            Bot accounts connect with a token and act like members — their server powers come from the
            roles you assign them in Roles &amp; Members. Users individually allow or deny what each bot
            can do to them.
          </p>
        </div>
        <Button type="button" onClick={() => setCreating((v) => !v)}>
          {creating ? 'Cancel' : 'Create Bot'}
        </Button>
      </div>

      {tokenState && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
          <div className="text-sm font-semibold text-gray-100">Bot token for @{tokenState.botUsername}</div>
          <div className="mt-1 text-sm text-gray-300">
            Save this token now — it will not be shown again. Regenerating invalidates it immediately.
          </div>
          <div className="mt-3 rounded-lg border border-gray-700 bg-gray-900/60 p-3 break-all font-mono text-sm text-gray-100">
            {tokenState.token}
          </div>
          <div className="mt-3 flex gap-2">
            <Button type="button" variant="secondary" onClick={() => void handleCopyToken()}>
              <Copy className="mr-2 h-4 w-4" /> {copied ? 'Copied!' : 'Copy Token'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setTokenState(null)}>
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-lg bg-red-900/20 border border-red-600/30 text-red-400">{error}</div>
      )}

      {creating && (
        <div className="rounded-xl border border-blue-600/30 bg-blue-900/10 p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Bot username</label>
            <input
              type="text"
              value={newUsername}
              onChange={(event) => setNewUsername(event.target.value)}
              placeholder="MusicBot"
              className="w-full max-w-sm rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-gray-100"
            />
            <p className="mt-1 text-xs text-gray-500">4-32 characters; letters, numbers and underscores.</p>
          </div>
          <div>
            <div className="text-sm font-medium text-gray-300 mb-2">Permissions the bot asks users for</div>
            <div className="space-y-2">
              {BOT_SCOPE_DEFINITIONS.map((def) => (
                <label key={def.scope} className={`flex items-start gap-3 rounded-lg border border-gray-700 bg-gray-900/40 p-3 ${def.alwaysRequested ? 'opacity-70' : 'cursor-pointer'}`}>
                  <input
                    type="checkbox"
                    checked={def.alwaysRequested || newScopes.has(def.scope)}
                    disabled={def.alwaysRequested}
                    onChange={() => toggleScope(newScopes, def.scope, setNewScopes)}
                    className="mt-1"
                  />
                  <span>
                    <span className="block text-sm font-medium text-gray-200">{def.label}{def.alwaysRequested ? ' (always requested)' : ''}</span>
                    <span className="block text-xs text-gray-400">{def.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
          <Button type="button" onClick={() => void handleCreate()} disabled={saving}>
            {saving ? 'Creating…' : 'Create Bot & Generate Token'}
          </Button>
        </div>
      )}

      {bots.length === 0 && !creating ? (
        <div className="text-center py-12 rounded-lg border border-dashed border-gray-700 bg-gray-800/30">
          <BotIcon className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400">No bots yet. Create one, or drop a plugin bot into realm-plugins/ on the server.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {bots.map((bot) => {
            const isEditing = editingId === bot.id;
            return (
              <div key={bot.id} className="rounded-xl border border-gray-700 bg-gray-800/40 p-4">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-block h-2.5 w-2.5 rounded-full ${bot.online ? 'bg-emerald-400' : 'bg-gray-500'}`} title={bot.online ? 'Online' : 'Offline'} />
                      <div className="w-8 h-8 rounded-full overflow-hidden bg-gray-700 flex items-center justify-center text-sm text-white">
                        <AvatarImage
                          src={resolveAvatarUrl(bot.avatar, serverUrl)}
                          alt={bot.username || 'bot'}
                          size={32}
                          className="w-8 h-8 object-cover"
                          fallback={<span>{(bot.username || '?').charAt(0).toUpperCase()}</span>}
                        />
                      </div>
                      <h3 className="text-lg font-semibold text-gray-100">{bot.displayName || bot.username}</h3>
                      <span className="text-sm text-gray-400">@{bot.username}</span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-gray-900/70 px-2.5 py-1 text-xs text-gray-300">
                        {bot.kind === 'plugin' ? <Plug className="h-3 w-3" /> : <UserRound className="h-3 w-3" />}
                        {bot.kind === 'plugin' ? 'Plugin' : 'Token'}
                      </span>
                      {bot.kind === 'plugin' && (
                        <span className={`text-xs font-medium ${pluginStatusStyle(bot.pluginStatus)}`}>
                          {pluginStatusLabel(bot.pluginStatus)}
                        </span>
                      )}
                      {!bot.enabled && <span className="text-xs text-amber-400 font-medium">Disabled</span>}
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                      <div className="rounded-lg border border-gray-700 bg-gray-900/40 p-3">
                        <div className="text-xs uppercase tracking-[0.18em] text-gray-500">Token</div>
                        <div className="mt-2 flex items-center gap-2 text-sm text-gray-100">
                          <KeyRound className="h-4 w-4 text-gray-400" />
                          <span className="font-mono">{bot.tokenPreview || 'Unavailable'}</span>
                        </div>
                      </div>
                      <div className="rounded-lg border border-gray-700 bg-gray-900/40 p-3">
                        <div className="text-xs uppercase tracking-[0.18em] text-gray-500">Requested consent</div>
                        <div className="mt-2 text-sm text-gray-100">
                          {bot.requestedScopes.map((s) => BOT_SCOPE_DEFINITIONS.find((d) => d.scope === s)?.label || s).join(', ')}
                        </div>
                      </div>
                      <div className="rounded-lg border border-gray-700 bg-gray-900/40 p-3">
                        <div className="text-xs uppercase tracking-[0.18em] text-gray-500">Commands</div>
                        <div className="mt-2 text-sm text-gray-100">{bot.commandCount} registered</div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {bot.kind === 'plugin' && (bot.pluginStatus === 'pending_install' || bot.pluginStatus === 'install_failed') && (
                      <Button type="button" onClick={() => void handleApproveInstall(bot)}>
                        <Download className="mr-2 h-4 w-4" />
                        {bot.pluginStatus === 'install_failed' ? 'Retry Install' : 'Approve Install'}
                      </Button>
                    )}
                    <Button type="button" variant="secondary" onClick={() => (isEditing ? setEditingId(null) : beginEdit(bot))}>
                      {isEditing ? 'Cancel' : 'Edit'}
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => void handleToggleEnabled(bot)}>
                      {bot.enabled ? 'Disable' : 'Enable'}
                    </Button>
                    {bot.kind === 'token' && (
                      <Button type="button" variant="secondary" onClick={() => setConfirmRegen(bot)}>
                        <RefreshCw className="mr-2 h-4 w-4" /> Token
                      </Button>
                    )}
                    {bot.kind === 'token' && (
                      <Button type="button" variant="secondary" onClick={() => setConfirmDelete(bot)}>
                        <Trash2 className="mr-2 h-4 w-4" /> Delete
                      </Button>
                    )}
                  </div>
                </div>

                {isEditing && (
                  <div className="mt-4 rounded-lg border border-blue-600/30 bg-blue-900/10 p-4 space-y-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">Display name</label>
                        <input
                          type="text"
                          value={draftDisplayName}
                          onChange={(event) => setDraftDisplayName(event.target.value)}
                          className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-gray-100"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm font-medium text-gray-300 mb-2">Avatar</label>
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp,image/gif"
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              if (file) void handleImageUpload(bot, 'avatar', file);
                              event.target.value = '';
                            }}
                            className="block w-full text-xs text-gray-400 file:mr-2 file:rounded-lg file:border-0 file:bg-gray-700 file:px-3 file:py-1.5 file:text-gray-200"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-300 mb-2">Banner</label>
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp,image/gif"
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              if (file) void handleImageUpload(bot, 'banner', file);
                              event.target.value = '';
                            }}
                            className="block w-full text-xs text-gray-400 file:mr-2 file:rounded-lg file:border-0 file:bg-gray-700 file:px-3 file:py-1.5 file:text-gray-200"
                          />
                        </div>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Bio</label>
                      <textarea
                        value={draftBio}
                        onChange={(event) => setDraftBio(event.target.value)}
                        rows={2}
                        maxLength={500}
                        className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-gray-100"
                      />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-gray-300 mb-2">Requested consent scopes</div>
                      <div className="grid gap-2 md:grid-cols-2">
                        {BOT_SCOPE_DEFINITIONS.map((def) => (
                          <label key={def.scope} className={`flex items-start gap-2 text-sm text-gray-300 ${def.alwaysRequested ? 'opacity-70' : 'cursor-pointer'}`}>
                            <input
                              type="checkbox"
                              checked={def.alwaysRequested || draftScopes.has(def.scope)}
                              disabled={def.alwaysRequested}
                              onChange={() => toggleScope(draftScopes, def.scope, setDraftScopes)}
                              className="mt-0.5"
                            />
                            <span>{def.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button type="button" onClick={() => void handleSaveEdit(bot)} disabled={saving}>
                        {saving ? 'Saving…' : 'Save'}
                      </Button>
                      <Button type="button" variant="secondary" onClick={() => setEditingId(null)} disabled={saving}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!confirmRegen}
        onClose={() => setConfirmRegen(null)}
        onConfirm={() => {
          if (confirmRegen) void handleRegenerate(confirmRegen);
          setConfirmRegen(null);
        }}
        title="Regenerate bot token?"
        message={`The current token for @${confirmRegen?.username ?? ''} stops working immediately and the bot is disconnected until it reconnects with the new token.`}
        confirmText="Regenerate"
        cancelText="Cancel"
      />
      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) void handleDelete(confirmDelete);
          setConfirmDelete(null);
        }}
        title="Delete bot?"
        message={`@${confirmDelete?.username ?? ''} will be removed from the member list and its token revoked. Its past messages are kept.`}
        confirmText="Delete"
        cancelText="Cancel"
      />
    </div>
  );
}
