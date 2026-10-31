import { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, GripVertical, ChevronDown, ChevronUp, Smile } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { createApi } from '../../../lib/api';
import { isHttpGatewayRealm } from '../../../lib/httpRealmGateway';
import { useServerStore } from '../../../stores/serverStore';
import type { Role, Channel } from '../../../types';
import { WelcomeFlow } from '../../onboarding/WelcomeFlow';
import { DEFAULT_EMOJI_CATEGORIES, loadEmojiMetadataLookup } from '../../../lib/emojiMetadata';
import { SharedDefaultEmojiPicker } from '../../chat/SharedExpressionPickerSections';

interface WelcomeAnswer {
  id: string;
  question_id: string;
  text: string;
  emoji: string | null;
  role_ids: string[];
  channel_ids: string[];
  position: number;
}

interface WelcomeQuestion {
  id: string;
  question: string;
  allow_multiple: boolean;
  required: boolean;
  position: number;
  answers: WelcomeAnswer[];
}

interface WelcomeRule {
  id: string;
  content: string;
  position: number;
}

interface WelcomeBoardSectionProps {
  onStatusChange: (enabled: boolean) => void;
}

interface ExpressionManifestEntry {
  id: string;
  name: string;
  absolute_url?: string;
}

function Toggle({ checked, onChange, disabled = false }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`inline-flex items-center ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'} shrink-0`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only" disabled={disabled} />
      <span className={`relative h-6 w-12 rounded-full transition-colors ${checked ? 'bg-blue-600' : 'bg-gray-600'}`}>
        <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-all ${checked ? 'left-7' : 'left-1'}`} />
      </span>
    </label>
  );
}

export function WelcomeBoardSection({ onStatusChange }: WelcomeBoardSectionProps) {
  const { t } = useTranslation();
  const api = createApi();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [enabled, setEnabled] = useState(false);
  const [bg, setBg] = useState('');
  const [rulesMode, setRulesMode] = useState<'structured' | 'markdown'>('structured');
  const [rulesMarkdown, setRulesMarkdown] = useState('');
  const [questions, setQuestions] = useState<WelcomeQuestion[]>([]);
  const [rules, setRules] = useState<WelcomeRule[]>([]);
  const [expandedQuestions, setExpandedQuestions] = useState<Set<string>>(new Set());

  const [availableRoles, setAvailableRoles] = useState<Role[]>([]);
  const [availableChannels, setAvailableChannels] = useState<Channel[]>([]);
  const [serverExpressionEntries, setServerExpressionEntries] = useState<ExpressionManifestEntry[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);

  const dragItem = useRef<{ type: 'question' | 'rule' | 'answer'; id: string; questionId?: string } | null>(null);
  const dragOver = useRef<string | null>(null);

  const isReady = questions.length >= 2 && (
    rulesMode === 'markdown' ? rulesMarkdown.trim().length > 0 : rules.length > 0
  );

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [adminRes, rolesRes, channelsRes, expressionsRes] = await Promise.all([
        api.get('/api/admin/welcome'),
        api.get('/api/roles'),
        api.get('/api/channels'),
        isHttpGatewayRealm(useServerStore.getState().activeServerUrl)
          ? Promise.resolve({ data: { emotes: [] } })
          : api.get('/api/expressions/manifest').catch(() => ({ data: { emotes: [] } })),
      ]);
      setEnabled(adminRes.data.enabled);
      onStatusChange(adminRes.data.enabled);
      setBg(adminRes.data.bg || '');
      setRulesMode(adminRes.data.rulesMode || 'structured');
      setRulesMarkdown(adminRes.data.rulesMarkdown || '');
      setQuestions(adminRes.data.questions || []);
      setRules(adminRes.data.rules || []);
      setAvailableRoles(Array.isArray(rolesRes.data) ? rolesRes.data : rolesRes.data?.roles ?? []);
      const ch = Array.isArray(channelsRes.data) ? channelsRes.data : channelsRes.data?.channels ?? [];
      setAvailableChannels(ch.filter((c: Channel) => c.type === 'basic' || c.type === 'announcement'));
      const emotes = Array.isArray(expressionsRes.data?.emotes) ? expressionsRes.data.emotes : [];
      setServerExpressionEntries(emotes.slice(0, 72).map((entry: ExpressionManifestEntry) => ({
        id: entry.id,
        name: entry.name,
        absolute_url: entry.absolute_url,
      })));
    } catch {
      setError('Failed to load Welcome Board settings');
    } finally {
      setLoading(false);
    }
  }

  async function saveSettings(patch: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    try {
      await api.put('/api/admin/welcome/settings', patch);
      if (patch.welcome_board_enabled !== undefined) {
        const next = !!patch.welcome_board_enabled;
        setEnabled(next);
        onStatusChange(next);
      }
      if (patch.welcome_board_bg !== undefined) setBg(String(patch.welcome_board_bg));
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Save failed';
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  async function saveRules() {
    setSaving(true);
    setError(null);
    try {
      await api.put('/api/admin/welcome/rules', { rulesMode, rulesMarkdown, rules });
    } catch {
      setError('Failed to save rules');
    } finally {
      setSaving(false);
    }
  }

  async function resetAllUsersOnboarding() {
    setSaving(true);
    setError(null);
    try {
      await api.post('/api/admin/welcome/reset-onboarding');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Reset failed';
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  // ── Questions ────────────────────────────────────────────────────────────────

  async function addQuestion() {
    try {
      const res = await api.post('/api/admin/welcome/questions', { question: 'New question', allow_multiple: false, required: false });
      setQuestions((prev) => [...prev, res.data]);
      setExpandedQuestions((prev) => new Set(prev).add(res.data.id));
    } catch {
      setError('Failed to add question');
    }
  }

  async function updateQuestion(id: string, patch: Partial<WelcomeQuestion>) {
    try {
      await api.put(`/api/admin/welcome/questions/${id}`, patch);
      setQuestions((prev) => prev.map((q) => q.id === id ? { ...q, ...patch } : q));
    } catch {
      setError('Failed to update question');
    }
  }

  async function deleteQuestion(id: string) {
    try {
      await api.delete(`/api/admin/welcome/questions/${id}`);
      setQuestions((prev) => prev.filter((q) => q.id !== id));
    } catch {
      setError('Failed to delete question');
    }
  }

  function handleQuestionDragStart(id: string) {
    dragItem.current = { type: 'question', id };
  }

  function handleQuestionDragOver(e: React.DragEvent, id: string) {
    e.preventDefault();
    dragOver.current = id;
  }

  async function handleQuestionDrop() {
    if (!dragItem.current || dragItem.current.type !== 'question') return;
    const fromId = dragItem.current.id;
    const toId = dragOver.current;
    if (!toId || fromId === toId) return;

    const reordered = [...questions];
    const fromIdx = reordered.findIndex((q) => q.id === fromId);
    const toIdx = reordered.findIndex((q) => q.id === toId);
    const [item] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, item);
    setQuestions(reordered);
    dragItem.current = null;
    dragOver.current = null;

    try {
      await api.put('/api/admin/welcome/questions/reorder', { ids: reordered.map((q) => q.id) });
    } catch {
      setError('Failed to reorder questions');
    }
  }

  // ── Answers ──────────────────────────────────────────────────────────────────

  async function addAnswer(questionId: string) {
    try {
      const res = await api.post(`/api/admin/welcome/questions/${questionId}/answers`, { text: 'New answer', emoji: null, role_ids: [], channel_ids: [] });
      setQuestions((prev) => prev.map((q) => q.id === questionId ? { ...q, answers: [...q.answers, res.data] } : q));
    } catch {
      setError('Failed to add answer');
    }
  }

  async function updateAnswer(questionId: string, answerId: string, patch: Partial<WelcomeAnswer>) {
    try {
      await api.put(`/api/admin/welcome/answers/${answerId}`, patch);
      setQuestions((prev) => prev.map((q) => q.id === questionId
        ? { ...q, answers: q.answers.map((a) => a.id === answerId ? { ...a, ...patch } : a) }
        : q
      ));
    } catch {
      setError('Failed to update answer');
    }
  }

  async function deleteAnswer(questionId: string, answerId: string) {
    try {
      await api.delete(`/api/admin/welcome/answers/${answerId}`);
      setQuestions((prev) => prev.map((q) => q.id === questionId ? { ...q, answers: q.answers.filter((a) => a.id !== answerId) } : q));
    } catch {
      setError('Failed to delete answer');
    }
  }

  // ── Rules ────────────────────────────────────────────────────────────────────

  function addRule() {
    const newRule: WelcomeRule = { id: crypto.randomUUID(), content: '', position: rules.length };
    setRules((prev) => [...prev, newRule]);
  }

  function updateRuleContent(id: string, content: string) {
    setRules((prev) => prev.map((r) => r.id === id ? { ...r, content } : r));
  }

  function deleteRule(id: string) {
    setRules((prev) => prev.filter((r) => r.id !== id));
  }

  function handleRuleDragStart(id: string) {
    dragItem.current = { type: 'rule', id };
  }

  function handleRuleDragOver(e: React.DragEvent, id: string) {
    e.preventDefault();
    dragOver.current = id;
  }

  function handleRuleDrop() {
    if (!dragItem.current || dragItem.current.type !== 'rule') return;
    const fromId = dragItem.current.id;
    const toId = dragOver.current;
    if (!toId || fromId === toId) return;

    const reordered = [...rules];
    const fromIdx = reordered.findIndex((r) => r.id === fromId);
    const toIdx = reordered.findIndex((r) => r.id === toId);
    const [item] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, item);
    setRules(reordered);
    dragItem.current = null;
    dragOver.current = null;
  }

  if (loading) {
    return <div className="flex items-center justify-center h-32 text-gray-400">{t('common.loading')}</div>;
  }

  return (
    <>
      {previewOpen && <WelcomeFlow previewOnly onComplete={() => setPreviewOpen(false)} />}
      <div className="space-y-8 max-w-2xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-100">{t('admin.welcomeBoard')}</h2>
          <p className="text-sm text-gray-400 mt-0.5">{t('admin.welcomeBoardDesc')}</p>
        </div>
        <div className="flex items-center gap-2">
          {enabled && (
            <button
              type="button"
              onClick={() => setPreviewOpen(true)}
              className="rounded-lg border border-blue-500/40 bg-blue-500/10 px-3 py-1.5 text-xs font-semibold text-blue-300 transition-colors hover:bg-blue-500/20"
            >
              {t('admin.previewWelcome')}
            </button>
          )}
          <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${enabled ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-400'}`}>
            {enabled ? t('admin.boardEnabled') : t('admin.boardNotConfigured')}
          </span>
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{error}</div>
      )}

      {/* Background Image */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-gray-200">{t('admin.backgroundImageUrl')}</h3>
        <div className="flex gap-2">
          <input
            type="url"
            value={bg}
            onChange={(e) => setBg(e.target.value)}
            placeholder="https://example.com/background.jpg"
            className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={() => saveSettings({ welcome_board_bg: bg })}
            disabled={saving}
            className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium disabled:opacity-60 transition-colors"
          >
            {t('common.save')}
          </button>
        </div>
      </section>

      {/* Pre-Join Questions */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-200">{t('admin.preJoinQuestions')}</h3>
            <p className="text-xs text-gray-500 mt-0.5">{t('admin.preJoinQuestionsDesc')}</p>
          </div>
          <button
            onClick={addQuestion}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" /> {t('admin.addQuestion')}
          </button>
        </div>

        {questions.length === 0 && (
          <div className="text-center py-8 text-gray-500 text-sm border border-dashed border-gray-700 rounded-lg">
            {t('admin.noQuestions')}
          </div>
        )}

        {questions.map((q, idx) => {
          const expanded = expandedQuestions.has(q.id);
          return (
            <div
              key={q.id}
              className="border border-gray-700 rounded-lg bg-gray-800/40"
              draggable
              onDragStart={() => handleQuestionDragStart(q.id)}
              onDragOver={(e) => handleQuestionDragOver(e, q.id)}
              onDrop={handleQuestionDrop}
            >
              <div className="flex items-center gap-2 px-3 py-2">
                <GripVertical className="w-4 h-4 text-gray-600 cursor-grab shrink-0" />
                <span className="text-xs text-gray-500 w-5 shrink-0">{idx + 1}.</span>
                <input
                  type="text"
                  value={q.question}
                  onChange={(e) => setQuestions((prev) => prev.map((x) => x.id === q.id ? { ...x, question: e.target.value } : x))}
                  onBlur={(e) => updateQuestion(q.id, { question: e.target.value })}
                  placeholder={t('admin.questionPlaceholder')}
                  className="flex-1 bg-transparent text-sm text-gray-100 placeholder-gray-500 focus:outline-none min-w-0"
                />
                <div className="flex items-center gap-3 shrink-0">
                  <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={q.allow_multiple}
                      onChange={(e) => updateQuestion(q.id, { allow_multiple: e.target.checked })}
                      className="rounded"
                    />
                    {t('admin.multiLabel')}
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={q.required}
                      onChange={(e) => updateQuestion(q.id, { required: e.target.checked })}
                      className="rounded"
                    />
                    {t('admin.requiredLabel')}
                  </label>
                  <button
                    onClick={() => setExpandedQuestions((prev) => {
                      const next = new Set(prev);
                      if (expanded) next.delete(q.id);
                      else next.add(q.id);
                      return next;
                    })}
                    className="p-1 text-gray-400 hover:text-gray-200 transition-colors"
                  >
                    {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  <button onClick={() => deleteQuestion(q.id)} className="p-1 text-gray-600 hover:text-red-400 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {expanded && (
                <div className="border-t border-gray-700 px-3 py-2 space-y-2">
                  {q.answers.map((a) => (
                    <AnswerRow
                      key={a.id}
                      answer={a}
                      availableRoles={availableRoles}
                      availableChannels={availableChannels}
                      serverExpressionEntries={serverExpressionEntries}
                      onChange={(patch) => updateAnswer(q.id, a.id, patch)}
                      onDelete={() => deleteAnswer(q.id, a.id)}
                    />
                  ))}
                  <button
                    onClick={() => addAnswer(q.id)}
                    className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors py-1"
                  >
                    <Plus className="w-3 h-3" /> {t('admin.addAnswer')}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </section>

      {/* Rules */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-200">{t('admin.serverRules')}</h3>
          <div className="flex rounded-lg overflow-hidden border border-gray-600">
            <button
              onClick={() => setRulesMode('structured')}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${rulesMode === 'structured' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}
            >
              {t('admin.structuredMode')}
            </button>
            <button
              onClick={() => setRulesMode('markdown')}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${rulesMode === 'markdown' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}
            >
              {t('admin.markdownMode')}
            </button>
          </div>
        </div>

        {rulesMode === 'structured' ? (
          <div className="space-y-2">
            {rules.map((r, idx) => (
              <div
                key={r.id}
                className="flex items-start gap-2"
                draggable
                onDragStart={() => handleRuleDragStart(r.id)}
                onDragOver={(e) => handleRuleDragOver(e, r.id)}
                onDrop={handleRuleDrop}
              >
                <GripVertical className="w-4 h-4 text-gray-600 cursor-grab mt-2 shrink-0" />
                <span className="text-xs text-gray-500 mt-2 w-5 shrink-0">{idx + 1}.</span>
                <textarea
                  value={r.content}
                  onChange={(e) => updateRuleContent(r.id, e.target.value)}
                  rows={2}
                  placeholder={t('admin.ruleDescPlaceholder')}
                  className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"
                />
                <button onClick={() => deleteRule(r.id)} className="mt-2 p-1 text-gray-600 hover:text-red-400 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            <button
              onClick={addRule}
              className="flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300 transition-colors"
            >
              <Plus className="w-4 h-4" /> {t('admin.addRule')}
            </button>
          </div>
        ) : (
          <textarea
            value={rulesMarkdown}
            onChange={(e) => setRulesMarkdown(e.target.value)}
            rows={10}
            placeholder="# Server Rules&#10;&#10;1. Be respectful..."
            className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 font-mono resize-y"
          />
        )}

        <button
          onClick={saveRules}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium disabled:opacity-60 transition-colors"
        >
          {saving ? t('common.saving') : t('admin.saveRules')}
        </button>
      </section>

      {/* Enable Toggle */}
      <section className="border-t border-gray-700 pt-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-200">{t('admin.enableWelcomeBoard')}</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {isReady ? t('admin.boardReadyDesc') : t('admin.boardNotReadyDesc')}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void resetAllUsersOnboarding()}
              disabled={saving}
              className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-300 transition-colors hover:bg-amber-500/20 disabled:opacity-60"
            >
              {t('admin.resetOnboarding')}
            </button>
            <Toggle
              checked={enabled}
              onChange={(v) => saveSettings({ welcome_board_enabled: v })}
              disabled={!isReady && !enabled}
            />
          </div>
        </div>
      </section>
      </div>
    </>
  );
}

// ── AnswerRow ─────────────────────────────────────────────────────────────────

interface AnswerRowProps {
  answer: WelcomeAnswer;
  availableRoles: Role[];
  availableChannels: Channel[];
  serverExpressionEntries: ExpressionManifestEntry[];
  onChange: (patch: Partial<WelcomeAnswer>) => void;
  onDelete: () => void;
}

function AnswerRow({ answer, availableRoles, availableChannels, serverExpressionEntries, onChange, onDelete }: AnswerRowProps) {
  const { t } = useTranslation();
  const [text, setText] = useState(answer.text);
  const [emoji, setEmoji] = useState(answer.emoji || '');
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>(answer.role_ids);
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>(answer.channel_ids);
  const [rolesOpen, setRolesOpen] = useState(false);
  const [channelsOpen, setChannelsOpen] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [emojiMetadataLoaded, setEmojiMetadataLoaded] = useState(false);
  const [emojiCategory, setEmojiCategory] = useState<(typeof DEFAULT_EMOJI_CATEGORIES)[number]['name']>('People');
  const [emojiTab, setEmojiTab] = useState<'default' | 'server'>('default');
  const rolesRef = useRef<HTMLDivElement | null>(null);
  const channelsRef = useRef<HTMLDivElement | null>(null);
  const emojiRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!emojiPickerOpen || emojiMetadataLoaded) return;
    let cancelled = false;
    void loadEmojiMetadataLookup()
      .then(() => {
        if (!cancelled) setEmojiMetadataLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setEmojiMetadataLoaded(false);
      });
    return () => {
      cancelled = true;
    };
  }, [emojiPickerOpen, emojiMetadataLoaded]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (rolesRef.current && target && !rolesRef.current.contains(target)) {
        setRolesOpen(false);
      }
      if (channelsRef.current && target && !channelsRef.current.contains(target)) {
        setChannelsOpen(false);
      }
      if (emojiRef.current && target && !emojiRef.current.contains(target)) {
        setEmojiPickerOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  const toggleRole = (roleId: string) => {
    const next = selectedRoleIds.includes(roleId)
      ? selectedRoleIds.filter((id) => id !== roleId)
      : [...selectedRoleIds, roleId];
    setSelectedRoleIds(next);
    onChange({ role_ids: next });
  };

  const toggleChannel = (channelId: string) => {
    const next = selectedChannelIds.includes(channelId)
      ? selectedChannelIds.filter((id) => id !== channelId)
      : [...selectedChannelIds, channelId];
    setSelectedChannelIds(next);
    onChange({ channel_ids: next });
  };

  const selectEmoji = (nextEmoji: string) => {
    setEmoji(nextEmoji);
    onChange({ emoji: nextEmoji || null });
    setEmojiPickerOpen(false);
  };

  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-gray-700/50 last:border-0">
      <div className="relative shrink-0" ref={emojiRef}>
        <button
          type="button"
          onClick={() => setEmojiPickerOpen((current) => !current)}
          className="flex h-9 w-11 items-center justify-center rounded border border-gray-600 bg-gray-700 text-lg transition-colors hover:border-blue-500"
          title={t('admin.chooseEmoji')}
        >
          {emoji ? <span>{emoji}</span> : <Smile className="h-4 w-4 text-gray-300" />}
        </button>
        {emojiPickerOpen && (
          <div className="absolute left-0 top-full z-30 mt-2 w-80 rounded-xl border border-gray-600 bg-gray-800 p-3 shadow-2xl">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t('admin.selectEmoji')}</div>
              {emoji && (
                <button
                  type="button"
                  onClick={() => selectEmoji('')}
                  className="text-xs text-gray-400 transition-colors hover:text-gray-200"
                >
                  {t('admin.clearEmoji')}
                </button>
              )}
            </div>
            <div className="mb-3 flex overflow-hidden rounded-lg border border-gray-600">
              <button
                type="button"
                onClick={() => setEmojiTab('default')}
                className={`flex-1 px-3 py-1.5 text-xs font-medium transition-colors ${emojiTab === 'default' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
              >
                {t('admin.emojiTab')}
              </button>
              <button
                type="button"
                onClick={() => setEmojiTab('server')}
                className={`flex-1 px-3 py-1.5 text-xs font-medium transition-colors ${emojiTab === 'server' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
              >
                {t('admin.serverEmotesTab')}
              </button>
            </div>
            {emojiTab === 'default' ? (
              <SharedDefaultEmojiPicker
                hasSearchQuery={false}
                selectedCategoryName={emojiCategory}
                categories={DEFAULT_EMOJI_CATEGORIES}
                onSelectCategory={(categoryName) => setEmojiCategory(categoryName as (typeof DEFAULT_EMOJI_CATEGORIES)[number]['name'])}
                emojiMetadataLoaded={emojiMetadataLoaded}
                entries={DEFAULT_EMOJI_CATEGORIES
                  .find((category) => category.name === emojiCategory)?.emojis
                  .map((entry) => ({ key: entry, emoji: entry, category: emojiCategory })) ?? []}
                onSelectEmoji={selectEmoji}
              />
            ) : serverExpressionEntries.length === 0 ? (
              <div className="text-xs text-gray-400">{t('admin.noServerEmotes')}</div>
            ) : (
              <div className="grid max-h-56 grid-cols-6 gap-2 overflow-y-auto pr-1">
                {serverExpressionEntries.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => selectEmoji(`:${entry.name}:`)}
                    className="flex h-10 items-center justify-center rounded-lg border border-gray-600 bg-gray-700 p-1 transition-colors hover:border-blue-500 hover:bg-gray-600"
                    title={`:${entry.name}:`}
                  >
                    {entry.absolute_url ? (
                      <img src={entry.absolute_url} alt={entry.name} className="h-7 w-7 object-contain" />
                    ) : (
                      <span className="text-[11px] text-gray-300">:{entry.name}:</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => onChange({ text })}
        placeholder={t('admin.answerPlaceholder')}
        className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 min-w-0"
      />
      <div className="flex gap-1.5 flex-wrap max-w-xs">
        {availableRoles.length > 0 && (
          <div className="relative" ref={rolesRef}>
            <button
              type="button"
              onClick={() => {
                setRolesOpen((current) => !current);
                setChannelsOpen(false);
              }}
              className="px-2 py-1 rounded text-xs bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
            >
              {t('admin.rolesButton')} {selectedRoleIds.length > 0 && `(${selectedRoleIds.length})`}
            </button>
            {rolesOpen && (
              <div className="absolute right-0 top-full mt-1 z-20 max-h-56 min-w-48 overflow-y-auto rounded-lg border border-gray-600 bg-gray-800 p-2 shadow-xl">
                <div className="mb-2 text-[11px] uppercase tracking-wide text-gray-500">{t('admin.grantRoles')}</div>
                {availableRoles.map((r) => (
                  <label key={r.id} className="flex items-center gap-2 cursor-pointer text-xs text-gray-300 hover:text-gray-100 py-1">
                    <input type="checkbox" checked={selectedRoleIds.includes(r.id)} onChange={() => toggleRole(r.id)} className="rounded" />
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: r.color || '#888' }} />
                    <span className="truncate">{r.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
        {availableChannels.length > 0 && (
          <div className="relative" ref={channelsRef}>
            <button
              type="button"
              onClick={() => {
                setChannelsOpen((current) => !current);
                setRolesOpen(false);
              }}
              className="px-2 py-1 rounded text-xs bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
            >
              {t('admin.channelsButton')} {selectedChannelIds.length > 0 && `(${selectedChannelIds.length})`}
            </button>
            {channelsOpen && (
              <div className="absolute right-0 top-full mt-1 z-20 max-h-56 min-w-52 overflow-y-auto rounded-lg border border-gray-600 bg-gray-800 p-2 shadow-xl">
                <div className="mb-2 text-[11px] uppercase tracking-wide text-gray-500">{t('admin.revealChannels')}</div>
                {availableChannels.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 cursor-pointer text-xs text-gray-300 hover:text-gray-100 py-1">
                    <input type="checkbox" checked={selectedChannelIds.includes(c.id)} onChange={() => toggleChannel(c.id)} className="rounded" />
                    <span className="truncate">#{c.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <button onClick={onDelete} className="p-1 text-gray-600 hover:text-red-400 transition-colors shrink-0 mt-0.5">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
